/**
 * animeMeta 云函数测试
 *
 * 用极小 wx-server-sdk / https mock 验证：BGM subject ID 解析、旧详情缓存兼容、
 * 成员鉴权、详情缓存复用、条件更新（CAS）以及“只改 cover”的写入边界。
 * 不会访问真实云环境或弹弹play。
 */
const Module = require('module');
const { EventEmitter } = require('events');
const Subject = require('../cloudfunctions/animeMeta/bgm-subject');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${JSON.stringify(actual)}\n     期望: ${JSON.stringify(expected)}`);
  }
}

function runSubjectParserTests() {
  eq('解析 bangumi.tv canonical subject URL', Subject.parseBgmSubjectId(' https://bangumi.tv/subject/975 '), 975);
  eq('同时允许 http 的 bgm.tv canonical subject URL', Subject.parseBgmSubjectId('http://BGM.TV/subject/12345'), 12345);
  eq(
    '多个合法来源一致时解析唯一 subject ID',
    Subject.extractBgmSubjectId({
      bangumiUrl: 'https://bangumi.tv/subject/11',
      onlineDatabases: [{ url: 'https://bgm.tv/subject/11' }],
    }),
    11
  );
  eq(
    '多个合法来源冲突时宁可空态也不误绑',
    Subject.extractBgmSubjectId({
      bangumiUrl: 'https://bangumi.tv/subject/11',
      onlineDatabases: [{ url: 'https://bgm.tv/subject/22' }],
    }),
    null
  );
  eq(
    'raw bangumiUrl 非法时回退 onlineDatabases.url',
    Subject.extractBgmSubjectId({
      bangumiUrl: 'https://bangumi.tv/subject/11?from=ddp',
      onlineDatabases: [
        { name: 'IMDb', url: 'https://www.imdb.com/title/tt123/' },
        { name: 'Bangumi', url: 'https://bgm.tv/subject/22' },
      ],
    }),
    22
  );
  eq(
    '绝不把弹弹play bangumiId 当 subject ID',
    Subject.extractBgmSubjectId({ bangumiId: '12345' }),
    null
  );
  eq(
    '拒绝 query、伪域名、非 canonical 路径与非正安全整数',
    [
      'https://bgm.tv/subject/1?from=ddp',
      'https://bgm.tv/subject/1#section',
      'https://bgm.tv/subject/1/',
      'https://bgm.tv:443/subject/1',
      'https://user@bgm.tv/subject/1',
      'https://anime.bgm.tv/subject/1',
      'https://bgm.tv.evil.example/subject/1',
      'https://bgm.tv/foo/../subject/1',
      'ftp://bgm.tv/subject/1',
      'https://bgm.tv/subject/0',
      'https://bgm.tv/subject/01',
      'https://bgm.tv/subject/9007199254740993',
    ].map(Subject.parseBgmSubjectId),
    Array(12).fill(null)
  );
}

async function run() {
  runSubjectParserTests();
  const sourceId = 14360;
  const freshSourceId = 22345;
  const ddpIdOnlySourceId = 22346;
  const small = 'https://assets.anixplayer.net/image/poster/small/14360-34a7dad806748262214bfb81852bd57c.jpg';
  const medium = 'https://assets.anixplayer.net/image/poster/medium/14360-c7351ec616e97746a8f34ddaa3525aea.jpg';
  let casQuery = null;
  let casData = null;
  let currentOpenid = 'me';
  let lockDoc = null;
  let itemProjection = null;
  let upstreamCalls = 0;
  const cacheWrites = [];
  const cacheDocs = new Map([
    [
      `detail:${sourceId}`,
      {
        expireAt: Date.now() + 60_000,
        // 模拟上线前已存在、没有 bgmSubjectId 的详情缓存。
        payload: { sourceId, cover: medium, airDay: 5, isOnAir: true },
      },
    ],
  ]);
  const upstreamDetails = new Map([
    [
      sourceId,
      {
        animeId: sourceId,
        animeTitle: '旧缓存待补映射的番剧',
        imageUrl: medium,
        bangumiUrl: 'https://bgm.tv/subject/328609',
      },
    ],
    [
      freshSourceId,
      {
        animeId: freshSourceId,
        animeTitle: '带 BGM 映射的番剧',
        // DDP 自有 ID 故意与正确 subject ID 不同，保证不会误用。
        bangumiId: '999999',
        // query 使直接 URL 无效，应回退 onlineDatabases。
        bangumiUrl: 'https://bangumi.tv/subject/11?from=ddp',
        onlineDatabases: [{ name: 'Bangumi', url: 'https://bgm.tv/subject/975' }],
      },
    ],
    [
      ddpIdOnlySourceId,
      {
        animeId: ddpIdOnlySourceId,
        animeTitle: '只有 DDP 新 ID 的番剧',
        bangumiId: '12345',
        bangumiUrl: null,
        onlineDatabases: [{ name: 'Bangumi', url: 'https://bgm.tv.evil.example/subject/12345' }],
      },
    ],
  ]);

  const db = {
    collection(name) {
      if (name === 'shared_boards') {
        return {
          doc: () => ({ get: async () => ({ data: { _id: 'board-1', memberOpenids: ['me', 'peer'] } }) }),
        };
      }
      if (name === 'shared_board_items') {
        return {
          where(query) {
            if (query._id) {
              casQuery = query;
              return {
                update: async ({ data }) => {
                  casData = data;
                  return { stats: { updated: 1 } };
                },
              };
            }
            const queryChain = {
              field: (projection) => {
                itemProjection = projection;
                return queryChain;
              },
              orderBy: () => queryChain,
              limit: () => ({
                get: async () => ({
                  data: [{ _id: 'item-1', boardId: 'board-1', deleted: false, sourceId, cover: small }],
                }),
              }),
            };
            return queryChain;
          },
        };
      }
      if (name === 'anime_meta_cache') {
        return {
          add: async ({ data }) => {
            if (lockDoc) throw new Error('duplicate _id');
            lockDoc = Object.assign({}, data);
            return { _id: data._id };
          },
          doc: (id) => {
            const cacheId = String(id);
            return {
              get: async () => {
                if (cacheId.startsWith('cover_upgrade_lock:')) {
                  if (!lockDoc) throw new Error('not found');
                  return { data: lockDoc };
                }
                const record = cacheDocs.get(cacheId);
                if (!record) throw new Error('not found');
                return { data: record };
              },
              set: async ({ data }) => {
                cacheWrites.push({ id: cacheId, data });
                cacheDocs.set(cacheId, data);
                return { stats: { updated: 1 } };
              },
            };
          },
          where: (query) => ({
            update: async ({ data }) => {
              if (!lockDoc || query._id !== lockDoc._id || query.leaseUntil !== lockDoc.leaseUntil) {
                return { stats: { updated: 0 } };
              }
              lockDoc = Object.assign({}, lockDoc, data);
              return { stats: { updated: 1 } };
            },
          }),
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: currentOpenid }),
  };
  const httpsMock = {
    get(url, options, callback) {
      upstreamCalls++;
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = (error) => {
        if (error) process.nextTick(() => request.emit('error', error));
      };

      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        callback(response);
        const id = Number(String(url).split('/').pop());
        const body = JSON.stringify({ success: true, bangumi: upstreamDetails.get(id) || {} });
        response.emit('data', Buffer.from(body));
        response.emit('end');
      });
      return request;
    },
  };
  const originalLoad = Module._load;
  const originalAppId = process.env.DDP_APP_ID;
  const originalSecret = process.env.DDP_APP_SECRET;
  const indexPath = require.resolve('../cloudfunctions/animeMeta/index');

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      if (request === 'https') return httpsMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    process.env.DDP_APP_ID = 'test-app';
    process.env.DDP_APP_SECRET = 'test-secret';
    delete require.cache[indexPath];
    const fn = require(indexPath);

    for (const invalidAnimeId of ['123abc', 123.9, '1e3', 0, -1]) {
      const invalidDetail = await fn.main({ action: 'detail', animeId: invalidAnimeId });
      eq(`严格拒绝非法 animeId ${String(invalidAnimeId)}`, invalidDetail.code, 'ERR_INVALID_PARAM');
    }
    eq('非法 animeId 不请求弹弹play', upstreamCalls, 0);

    const writesBeforeLegacyRead = cacheWrites.length;
    const legacy = await fn.main({ action: 'detail', animeId: sourceId });
    eq(
      '旧详情缓存缺字段时懒刷新并补出 subject ID',
      {
        cached: legacy.data.cached,
        hasField: Object.prototype.hasOwnProperty.call(legacy.data.bangumi, 'bgmSubjectId'),
        bgmSubjectId: legacy.data.bangumi.bgmSubjectId,
      },
      { cached: false, hasField: true, bgmSubjectId: 328609 }
    );
    eq('旧缓存只在真实详情刷新成功后覆盖', cacheWrites.length, writesBeforeLegacyRead + 1);

    const fresh = await fn.main({ action: 'detail', animeId: freshSourceId });
    eq(
      '新详情经裁剪返回 onlineDatabases 回退解析的 subject ID',
      { cached: fresh.data.cached, bgmSubjectId: fresh.data.bangumi.bgmSubjectId },
      { cached: false, bgmSubjectId: 975 }
    );
    eq(
      '详情裁剪不透传原始 URL 或 DDP bangumiId',
      {
        bangumiUrl: Object.prototype.hasOwnProperty.call(fresh.data.bangumi, 'bangumiUrl'),
        onlineDatabases: Object.prototype.hasOwnProperty.call(fresh.data.bangumi, 'onlineDatabases'),
        bangumiId: Object.prototype.hasOwnProperty.call(fresh.data.bangumi, 'bangumiId'),
      },
      { bangumiUrl: false, onlineDatabases: false, bangumiId: false }
    );
    eq('新详情缓存只保存裁剪后的 subject ID', cacheDocs.get(`detail:${freshSourceId}`).payload.bgmSubjectId, 975);

    const freshCached = await fn.main({ action: 'detail', animeId: freshSourceId });
    eq(
      '新详情缓存命中后保留数值 subject ID 且不再请求上游',
      { cached: freshCached.data.cached, bgmSubjectId: freshCached.data.bangumi.bgmSubjectId, upstreamCalls },
      { cached: true, bgmSubjectId: 975, upstreamCalls: 2 }
    );

    const ddpOnly = await fn.main({ action: 'detail', animeId: ddpIdOnlySourceId });
    eq(
      '云函数详情也绝不从 DDP bangumiId 或伪域名推导 subject ID',
      ddpOnly.data.bangumi.bgmSubjectId,
      null
    );

    const result = await fn.main({ action: 'upgradeBoardCovers', boardId: 'board-1' });

    eq('存量升级成功信封', result.ok, true);
    eq('存量升级只检查一条候选', result.data.checked, 1);
    eq('存量升级返回 medium 映射', result.data.updates, [{ itemId: 'item-1', cover: medium }]);
    eq('存量升级只投影迁移必需字段', itemProjection, {
      _id: true,
      sourceId: true,
      cover: true,
      updateTime: true,
    });
    eq('同板升级会创建跨实例冷却锁', lockDoc && lockDoc.kind, 'cover_upgrade_lock');
    eq('CAS 锁定 item/board/sourceId/旧 cover/未删除', casQuery, {
      _id: 'item-1',
      boardId: 'board-1',
      deleted: false,
      sourceId,
      cover: small,
    });
    eq('静默维护只写 cover 字段', casData, { cover: medium });

    const throttled = await fn.main({ action: 'upgradeBoardCovers', boardId: 'board-1' });
    eq(
      '冷却期内同板重复调用不再请求/写入候选',
      { ok: throttled.ok, throttled: throttled.data.throttled, checked: throttled.data.checked },
      { ok: true, throttled: true, checked: 0 }
    );

    lockDoc.leaseUntil = Date.now() - 1;
    const resumed = await fn.main({ action: 'upgradeBoardCovers', boardId: 'board-1' });
    eq(
      '冷却过期后可按旧 lease 条件抢占并继续升级',
      { ok: resumed.ok, throttled: resumed.data.throttled, upgraded: resumed.data.upgraded },
      { ok: true, throttled: false, upgraded: 1 }
    );

    currentOpenid = 'outsider';
    const denied = await fn.main({ action: 'upgradeBoardCovers', boardId: 'board-1' });
    eq('非成员不能触发板封面升级', { ok: denied.ok, code: denied.code }, { ok: false, code: 'ERR_NOT_MEMBER' });
  } finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
    if (originalAppId === undefined) delete process.env.DDP_APP_ID;
    else process.env.DDP_APP_ID = originalAppId;
    if (originalSecret === undefined) delete process.env.DDP_APP_SECRET;
    else process.env.DDP_APP_SECRET = originalSecret;
  }
}

run()
  .catch((e) => {
    fail++;
    failures.push(`  ❌ 云函数测试异常\n     ${e && e.stack ? e.stack : e}`);
  })
  .finally(() => {
    console.log('\nanimeMeta 云函数与 BGM subjectId 测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
