/**
 * animeMeta 存量封面升级云函数测试
 *
 * 用极小 wx-server-sdk mock 验证：成员鉴权、详情缓存复用、条件更新（CAS）以及
 * “只改 cover，不动活跃时间/历史”的写入边界。不会访问真实云环境或弹弹play。
 */
const Module = require('module');

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

async function run() {
  const sourceId = 14360;
  const small = 'https://assets.anixplayer.net/image/poster/small/14360-34a7dad806748262214bfb81852bd57c.jpg';
  const medium = 'https://assets.anixplayer.net/image/poster/medium/14360-c7351ec616e97746a8f34ddaa3525aea.jpg';
  let casQuery = null;
  let casData = null;
  let currentOpenid = 'me';
  let lockDoc = null;
  let itemProjection = null;

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
          doc: (id) => ({
            get: async () => {
              if (String(id).startsWith('cover_upgrade_lock:')) {
                if (!lockDoc) throw new Error('not found');
                return { data: lockDoc };
              }
              return {
                data: {
                  expireAt: Date.now() + 60_000,
                  payload: { sourceId, cover: medium, airDay: 5, isOnAir: true },
                },
              };
            },
          }),
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
  const originalLoad = Module._load;
  const originalAppId = process.env.DDP_APP_ID;
  const originalSecret = process.env.DDP_APP_SECRET;
  const indexPath = require.resolve('../cloudfunctions/animeMeta/index');

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    process.env.DDP_APP_ID = 'test-app';
    process.env.DDP_APP_SECRET = 'test-secret';
    delete require.cache[indexPath];
    const fn = require(indexPath);
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
    console.log('\nanimeMeta 存量封面升级测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
