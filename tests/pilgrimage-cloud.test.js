/**
 * pilgrimageData 云函数测试。
 *
 * 直接测试纯转换、上游白名单/错误分类、缓存降级和公开 action；不会访问真实网络或云环境。
 */
const assert = require('assert');
const { EventEmitter } = require('events');
const Module = require('module');

const { ACTION, ANITABI, CACHE, LIMIT, ERR } = require('../cloudfunctions/pilgrimageData/constants');
const { PilgrimageError } = require('../cloudfunctions/pilgrimageData/errors');
const {
  parsePositiveInteger,
  previewImageUrl,
  coordinatePair,
  normalizePoint,
  buildSummaryDto,
  buildPointsDto,
} = require('../cloudfunctions/pilgrimageData/transform');
const {
  buildUpstreamUrl,
  assertAllowedUpstreamUrl,
  createRequestJson,
} = require('../cloudfunctions/pilgrimageData/upstream');
const { createCacheStore } = require('../cloudfunctions/pilgrimageData/cache');
const {
  validCachedPayload,
  createPilgrimageService,
} = require('../cloudfunctions/pilgrimageData/service');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}

function fakeHttps(scenario) {
  const state = { requestedUrl: '', options: null };
  return {
    state,
    get(url, options, callback) {
      state.requestedUrl = String(url);
      state.options = options;
      const req = new EventEmitter();
      req.setTimeout = (ms, onTimeout) => {
        state.timeoutMs = ms;
        if (scenario.timeout) queueMicrotask(onTimeout);
      };
      req.destroy = (error) => {
        state.destroyedWith = error;
        queueMicrotask(() => req.emit('error', error));
      };

      if (scenario.requestError) {
        queueMicrotask(() => req.emit('error', scenario.requestError));
      } else if (!scenario.timeout && !scenario.hang) {
        queueMicrotask(() => {
          const res = new EventEmitter();
          res.statusCode = scenario.status === undefined ? 200 : scenario.status;
          res.headers = scenario.headers || {};
          res.resume = () => {};
          res.destroy = (error) => queueMicrotask(() => res.emit('error', error));
          callback(res);
          queueMicrotask(() => {
            if (scenario.body !== undefined && scenario.body !== null) {
              res.emit('data', Buffer.from(String(scenario.body)));
            }
            res.emit('end');
          });
        });
      }
      return req;
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test('bgmSubjectId 只接受安全的正整数或纯数字字符串', () => {
  assert.strictEqual(parsePositiveInteger(115908), 115908);
  assert.strictEqual(parsePositiveInteger(' 328609 '), 328609);
  for (const invalid of [0, -1, 1.5, '0', '-1', '1.5', '1x', '', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.strictEqual(parsePositiveInteger(invalid), null, `应拒绝 ${String(invalid)}`);
  }
});

test('图片只接受 image.anitabi.cn 精确 HTTPS 主机并生成 h360 预览', () => {
  assert.strictEqual(
    previewImageUrl('https://image.anitabi.cn/points/1/a.jpg?foo=h160&plan=h160&x=1'),
    'https://image.anitabi.cn/points/1/a.jpg?foo=h160&plan=h360&x=1'
  );
  assert.strictEqual(
    previewImageUrl('https://image.anitabi.cn/points/1/a.jpg?plan=original'),
    'https://image.anitabi.cn/points/1/a.jpg?plan=original'
  );
  for (const rejected of [
    'http://image.anitabi.cn/points/1/a.jpg?plan=h160',
    'https://image.anitabi.cn.evil.example/points/1/a.jpg?plan=h160',
    'https://cdn.anitabi.cn/points/1/a.jpg?plan=h160',
    'https://user@image.anitabi.cn/points/1/a.jpg?plan=h160',
    'https://image.anitabi.cn:444/points/1/a.jpg?plan=h160',
    'javascript:alert(1)',
  ]) {
    assert.strictEqual(previewImageUrl(rejected), '', `应拒绝图片 URL: ${rejected}`);
  }
});

test('坐标与地标字段宽容解析，保留来源并生成集数/时间展示字段', () => {
  assert.deepStrictEqual(coordinatePair(['35.661', '139.4892']), {
    latitude: 35.661,
    longitude: 139.4892,
  });
  assert.deepStrictEqual(coordinatePair({ lat: 91, lng: 181 }), {
    latitude: null,
    longitude: null,
  });

  const point = normalizePoint({
    id: 'uf2raath2',
    cn: '东京赛马场',
    name: '東京競馬場',
    image: { url: 'https://image.anitabi.cn/points/509297/a.jpg?plan=h160' },
    ep: '5',
    s: '6:38',
    geo: { latitude: '35.661', longitude: '139.4892' },
    origin: 'Anitabi@AmaiAya',
    originURL: 'https://anitabi.cn/',
  });
  assert.deepStrictEqual(point, {
    id: 'uf2raath2',
    cn: '东京赛马场',
    name: '東京競馬場',
    imageThumb: 'https://image.anitabi.cn/points/509297/a.jpg?plan=h160',
    imagePreview: 'https://image.anitabi.cn/points/509297/a.jpg?plan=h360',
    epRaw: '5',
    episodeKey: 'episode:5',
    episodeLabel: '第5集',
    seconds: 398,
    timeLabel: '06:38',
    geo: { latitude: 35.661, longitude: 139.4892 },
    origin: 'Anitabi@AmaiAya',
    originUrl: 'https://anitabi.cn/',
  });

  const special = normalizePoint({ id: 'op', ep: 'OP1', s: '1:02:03', geo: '35,139' });
  assert.deepStrictEqual(
    {
      epRaw: special.epRaw,
      episodeKey: special.episodeKey,
      episodeLabel: special.episodeLabel,
      seconds: special.seconds,
      timeLabel: special.timeLabel,
    },
    {
      epRaw: 'OP1',
      episodeKey: 'special:op1',
      episodeLabel: 'OP1',
      seconds: 3723,
      timeLabel: '1:02:03',
    }
  );
  assert.strictEqual(normalizePoint({ name: '缺少稳定 ID', geo: [35, 139] }), null);
  assert.strictEqual(normalizePoint({ id: '   ', name: '空白 ID' }), null);
  const untrustedImage = normalizePoint({
    id: 'untrusted-image',
    image: 'https://image.anitabi.cn.evil.example/points/a.jpg?plan=h160',
  });
  assert.strictEqual(untrustedImage.imageThumb, '');
  assert.strictEqual(untrustedImage.imagePreview, '');
});

test('summary DTO 字段稳定且拒绝 ID 不匹配的数据', () => {
  const raw = {
    id: 115908,
    cn: '吹响吧！上低音号',
    title: '響け！ユーフォニアム',
    city: '宇治市',
    cover: 'https://image.anitabi.cn/bangumi/115908.jpg?plan=h160',
    color: '#02a7bd',
    geo: [34.9064, 135.8122],
    zoom: '12.38',
    modified: '1674702846652',
    pointsLength: '388',
    imagesLength: 380,
    litePoints: [{ id: 'a', ep: 1, s: 52, geo: [35, 135] }],
  };
  const dto = buildSummaryDto(raw, 115908);
  assert.deepStrictEqual(Object.keys(dto), [
    'id', 'cn', 'title', 'city', 'cover', 'color', 'center', 'zoom', 'modified',
    'pointsLength', 'imagesLength', 'previewPoints',
  ]);
  assert.deepStrictEqual(dto.center, { latitude: 34.9064, longitude: 135.8122 });
  assert.strictEqual(dto.pointsLength, 388);
  assert.strictEqual(dto.previewPoints.length, 1);
  assert.strictEqual(buildSummaryDto(raw, 328609), null);
  assert.strictEqual(buildSummaryDto({}, 115908), null);
});

test('points DTO 限制响应条数并报告实际返回数', () => {
  const raw = Array.from({ length: LIMIT.POINTS_MAX + 20 }, (_, index) => ({
    id: `p${index}`,
    image: `https://image.anitabi.cn/points/1/${index}.jpg?plan=h160`,
    ep: index + 1,
    s: index,
    geo: [35, 139],
  }));
  const dto = buildPointsDto(raw, 115908);
  assert.strictEqual(dto.subjectId, 115908);
  assert.strictEqual(dto.returnedCount, LIMIT.POINTS_MAX);
  assert.strictEqual(dto.sourceCount, LIMIT.POINTS_MAX + 20);
  assert.strictEqual(dto.truncated, true);
  assert.strictEqual(dto.points.length, LIMIT.POINTS_MAX);
  assert.strictEqual(buildPointsDto([], 115908), null);
  assert.strictEqual(buildPointsDto([null, {}], 115908), null);
});

test('points DTO 丢弃空 ID 并按规范化后的 ID 保留首条去重', () => {
  const dto = buildPointsDto([
    { id: '', name: '空 ID', geo: [35, 139] },
    { id: ' duplicate ', name: '首条', geo: [35, 139] },
    { id: 'duplicate', name: '重复条', geo: [36, 140] },
    { id: 'unique', name: '另一条', geo: [37, 141] },
  ], 115908);
  assert.deepStrictEqual(dto.points.map((point) => ({ id: point.id, name: point.name })), [
    { id: 'duplicate', name: '首条' },
    { id: 'unique', name: '另一条' },
  ]);
  assert.strictEqual(dto.returnedCount, 2);
  assert.strictEqual(dto.sourceCount, 4);
  assert.strictEqual(dto.truncated, false);
});

test('新旧缓存都必须满足 point ID 非空且唯一的 DTO 契约', () => {
  assert.strictEqual(validCachedPayload(ACTION.GET_SUBJECT_SUMMARY, 1, {
    id: 1,
    previewPoints: [{ id: 'a' }, { id: 'b' }],
  }), true);
  assert.strictEqual(validCachedPayload(ACTION.GET_SUBJECT_SUMMARY, 1, {
    id: 1,
    previewPoints: [{ id: '' }],
  }), false);
  assert.strictEqual(validCachedPayload(ACTION.GET_SUBJECT_POINTS, 1, {
    subjectId: 1,
    points: [{ id: 'a' }, { id: 'a' }],
    returnedCount: 2,
  }), false);
  assert.strictEqual(validCachedPayload(ACTION.GET_SUBJECT_POINTS, 1, {
    subjectId: 1,
    points: [{ id: 'a' }, { id: 'b' }],
    returnedCount: 2,
  }), true);
});

test('上游 URL 只能由两个公开 action 构造，points 保留无图地点', () => {
  assert.strictEqual(
    String(buildUpstreamUrl(ACTION.GET_SUBJECT_SUMMARY, 115908)),
    'https://api.anitabi.cn/bangumi/115908/lite'
  );
  assert.strictEqual(
    String(buildUpstreamUrl(ACTION.GET_SUBJECT_POINTS, 115908)),
    'https://api.anitabi.cn/bangumi/115908/points/detail'
  );
  assert.strictEqual(
    String(assertAllowedUpstreamUrl('https://api.anitabi.cn/bangumi/1/lite')),
    'https://api.anitabi.cn/bangumi/1/lite'
  );
  assert.throws(
    () => assertAllowedUpstreamUrl('https://evil.example/bangumi/1/lite'),
    (error) => error.code === ERR.INVALID_PARAM
  );
  assert.throws(
    () => assertAllowedUpstreamUrl('https://api.anitabi.cn/bangumi/1/points/detail?haveImage=true&url=https://evil.example'),
    (error) => error.code === ERR.INVALID_PARAM
  );
});

test('真实请求适配层固定域名、GET 头和超时', async () => {
  const fake = fakeHttps({ body: JSON.stringify({ id: 115908 }) });
  const requestJson = createRequestJson({ httpsModule: fake, timeoutMs: 1234 });
  const result = await requestJson(ACTION.GET_SUBJECT_SUMMARY, 115908);
  assert.deepStrictEqual(result, { id: 115908 });
  assert.strictEqual(fake.state.requestedUrl, 'https://api.anitabi.cn/bangumi/115908/lite');
  assert.strictEqual(fake.state.options.method, 'GET');
  assert.strictEqual(fake.state.options.headers.Accept, 'application/json');
  assert.strictEqual(fake.state.options.headers['User-Agent'], ANITABI.USER_AGENT);
  assert.strictEqual(fake.state.timeoutMs, 1234);
});

test('绝对超时、socket 超时、403、其他 HTTP、非 JSON、空响应和网络错误分别编码', async () => {
  await expectCode(
    createRequestJson({ httpsModule: fakeHttps({ timeout: true }), timeoutMs: 1 })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_TIMEOUT
  );
  const hangingHttps = fakeHttps({ hang: true });
  await expectCode(
    createRequestJson({ httpsModule: hangingHttps, timeoutMs: 1 })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_TIMEOUT
  );
  assert.strictEqual(hangingHttps.state.destroyedWith.code, ERR.UPSTREAM_TIMEOUT);
  await expectCode(
    createRequestJson({ httpsModule: fakeHttps({ status: 403, body: '<html>blocked</html>' }) })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_FORBIDDEN
  );
  await expectCode(
    createRequestJson({ httpsModule: fakeHttps({ status: 502, body: 'bad gateway' }) })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_HTTP
  );
  await expectCode(
    createRequestJson({ httpsModule: fakeHttps({ status: 200, body: '<html>challenge</html>' }) })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_NON_JSON
  );
  await expectCode(
    createRequestJson({ httpsModule: fakeHttps({ status: 200, body: '' }) })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_NON_JSON
  );
  await expectCode(
    createRequestJson({ httpsModule: fakeHttps({ requestError: new Error('socket closed') }) })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_NETWORK
  );
});

test('上游响应体有硬限制', async () => {
  await expectCode(
    createRequestJson({
      httpsModule: fakeHttps({ body: JSON.stringify({ long: 'x'.repeat(100) }) }),
      maxBodyBytes: 20,
    })(ACTION.GET_SUBJECT_SUMMARY, 1),
    ERR.UPSTREAM_RESPONSE_TOO_LARGE
  );
});

test('缓存集合、TTL 与 stale 窗口符合约定', async () => {
  const now = 1_000_000;
  let stored = null;
  let collectionName = '';
  let documentId = '';
  const db = {
    collection(name) {
      collectionName = name;
      return {
        doc(id) {
          documentId = id;
          return {
            get: async () => ({ data: stored }),
            set: async ({ data }) => { stored = data; },
          };
        },
      };
    },
  };
  const cache = createCacheStore(db, { now: () => now, logger: silentLogger() });
  const payload = { id: 115908 };
  assert.strictEqual(await cache.write(CACHE.KIND_SUMMARY, '115908', payload), true);
  assert.strictEqual(collectionName, 'pilgrimage_cache');
  assert.strictEqual(documentId, 'subject_summary:115908');
  assert.ok(stored.expireAt - now >= 2 * 60 * 60 * 1000);
  assert.ok(stored.staleUntil > stored.expireAt);
  assert.deepStrictEqual(await cache.read(CACHE.KIND_SUMMARY, '115908'), {
    state: 'fresh',
    payload,
  });
});

test('缓存失败不阻断上游与成功返回', async () => {
  let upstreamCalls = 0;
  const cache = {
    read: async () => { throw new Error('db unavailable'); },
    write: async () => { throw new Error('db unavailable'); },
  };
  const service = createPilgrimageService({
    cache,
    logger: silentLogger(),
    requestJson: async () => {
      upstreamCalls++;
      return { id: 115908, cn: '测试', litePoints: [] };
    },
  });
  const result = await service.handle({
    action: ACTION.GET_SUBJECT_SUMMARY,
    bgmSubjectId: 115908,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, ERR.OK);
  assert.strictEqual(result.data.id, 115908);
  assert.strictEqual(upstreamCalls, 1);
});

test('新鲜缓存直返；瞬时上游故障可 stale-on-error 且不改变 DTO', async () => {
  const payload = { id: 115908, previewPoints: [] };
  let upstreamCalls = 0;
  const freshService = createPilgrimageService({
    cache: {
      read: async () => ({ state: 'fresh', payload }),
      write: async () => true,
    },
    requestJson: async () => { upstreamCalls++; return null; },
    logger: silentLogger(),
  });
  assert.deepStrictEqual(
    await freshService.handle({ action: ACTION.GET_SUBJECT_SUMMARY, bgmSubjectId: 115908 }),
    { ok: true, code: ERR.OK, data: payload }
  );
  assert.strictEqual(upstreamCalls, 0);

  const staleService = createPilgrimageService({
    cache: {
      read: async () => ({ state: 'stale', payload }),
      write: async () => true,
    },
    requestJson: async () => {
      throw new PilgrimageError(ERR.UPSTREAM_FORBIDDEN, 'blocked');
    },
    logger: silentLogger(),
  });
  assert.deepStrictEqual(
    await staleService.handle({ action: ACTION.GET_SUBJECT_SUMMARY, bgmSubjectId: 115908 }),
    { ok: true, code: ERR.OK_STALE_CACHE, data: payload }
  );
});

test('无数据不使用 stale 掩盖，并与非法参数分开', async () => {
  const payload = { subjectId: 1, points: [{ id: 'old' }], returnedCount: 1 };
  const service = createPilgrimageService({
    cache: {
      read: async () => ({ state: 'stale', payload }),
      write: async () => true,
    },
    requestJson: async () => [],
    logger: silentLogger(),
  });
  const empty = await service.handle({ action: ACTION.GET_SUBJECT_POINTS, bgmSubjectId: 1 });
  assert.deepStrictEqual(
    { ok: empty.ok, code: empty.code, data: empty.data },
    { ok: false, code: ERR.NO_DATA, data: null }
  );
  const invalid = await service.handle({ action: ACTION.GET_SUBJECT_POINTS, bgmSubjectId: '../1' });
  assert.deepStrictEqual(
    { ok: invalid.ok, code: invalid.code, data: invalid.data },
    { ok: false, code: ERR.INVALID_PARAM, data: null }
  );
});

test('wx-server-sdk 入口只暴露两个 action 并保持统一信封', async () => {
  const originalLoad = Module._load;
  const indexPath = require.resolve('../cloudfunctions/pilgrimageData/index');
  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database() {
      return {
        collection() {
          return { doc: () => ({ get: async () => { throw new Error('not found'); } }) };
        },
      };
    },
  };

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    const cloudFunction = require(indexPath);
    const result = await cloudFunction.main({ action: 'search', keyword: '孤独摇滚' });
    assert.deepStrictEqual(
      { ok: result.ok, code: result.code, data: result.data },
      { ok: false, code: ERR.INVALID_PARAM, data: null }
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
  }
});

(async () => {
  let passed = 0;
  const failures = [];
  for (const item of tests) {
    try {
      await item.fn();
      passed++;
    } catch (error) {
      failures.push(`  ❌ ${item.name}\n     ${error && error.stack ? error.stack : error}`);
    }
  }

  console.log('\npilgrimageData 云函数测试');
  console.log('─'.repeat(48));
  if (failures.length) {
    console.log(failures.join('\n'));
    console.log('─'.repeat(48));
  }
  console.log(`通过 ${passed} / 失败 ${failures.length}`);
  process.exitCode = failures.length ? 1 : 0;
})();
