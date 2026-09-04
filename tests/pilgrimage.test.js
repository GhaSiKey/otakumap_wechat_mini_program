/**
 * 圣地巡礼前端工具层测试
 *
 * 零依赖、Node 直接运行：
 *   node tests/pilgrimage.test.js
 */

const C = require('../miniprogram/packageFeatures/utils/pilgrimage/config');
const Api = require('../miniprogram/packageFeatures/utils/pilgrimage/cloud-api');
const Geo = require('../miniprogram/packageFeatures/utils/pilgrimage/geo');
const T = require('../miniprogram/packageFeatures/utils/pilgrimage/transform');
const Storage = require('../miniprogram/packageFeatures/utils/pilgrimage/storage');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${a}\n     期望: ${e}`);
  }
}

function ok(name, value) {
  eq(name, !!value, true);
}

function near(name, actual, expected, tolerance) {
  if (typeof actual === 'number' && Math.abs(actual - expected) <= tolerance) pass++;
  else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${actual}\n     期望: ${expected} ± ${tolerance}`);
  }
}

function point(overrides) {
  return Object.assign({
    id: 'p-default',
    cn: '',
    name: '',
    imageThumb: '',
    imagePreview: '',
    epRaw: null,
    episodeKey: C.EPISODE.UNKNOWN_KEY,
    episodeLabel: C.COPY.UNKNOWN_EPISODE,
    seconds: null,
    timeLabel: '',
    geo: null,
    origin: '',
    originUrl: '',
  }, overrides || {});
}

async function testCloudApi() {
  let call = null;
  const wxMock = {
    cloud: {
      callFunction(options) {
        call = options;
        options.success({ result: { ok: true, code: 'OK', data: { id: 115908 } } });
      },
    },
  };
  const summary = await Api.getSubjectSummary('115908', wxMock);
  eq('summary 调用云函数名', call.name, C.CLOUD_FUNCTION);
  eq('summary 只传动作与 bgmSubjectId', call.data, {
    action: C.ACTION.GET_SUBJECT_SUMMARY,
    bgmSubjectId: 115908,
  });
  eq('summary 透传统一信封', summary, { ok: true, code: 'OK', data: { id: 115908 } });

  await Api.getSubjectPoints(115908, wxMock);
  eq('points 使用独立 action', call.data.action, C.ACTION.GET_SUBJECT_POINTS);

  call = null;
  const invalid = await Api.getSubjectPoints('not-an-id', wxMock);
  eq('非法 subject id 前端拦截', invalid.code, C.ERR_CODE.INVALID_PARAM);
  eq('非法 subject id 不发云调用', call, null);
  eq('科学计数法字符串不冒充 subject id', Api.normalizeBgmSubjectId('1e3'), null);
  eq('带前导零字符串与云端同样拒绝', Api.normalizeBgmSubjectId('0115908'), null);

  const timeoutWx = {
    cloud: {
      callFunction(options) {
        options.fail({
          errCode: -504003,
          errMsg: 'Invoking task timed out after 3 seconds FUNCTIONS_TIME_LIMIT_EXCEEDED',
        });
      },
    },
  };
  const timeout = await Api.getSubjectSummary(115908, timeoutWx);
  eq('云函数超时单独分类', timeout.code, C.ERR_CODE.FUNCTION_TIMEOUT);
  eq('云函数超时提取秒数', timeout.timeoutSeconds, 3);

  const malformedWx = {
    cloud: { callFunction(options) { options.success({ result: { data: {} } }); } },
  };
  const malformed = await Api.getSubjectSummary(115908, malformedWx);
  eq('异常信封归一为内部错误', malformed.code, C.ERR_CODE.INTERNAL);
}

function testConfig() {
  eq('巡礼搜索页固定路径', C.PAGE_PATH.SEARCH, '/packageFeatures/pages/pilgrimage/pilgrimage-search');
  eq('巡礼地图页固定路径', C.PAGE_PATH.MAP, '/packageFeatures/pages/pilgrimage/pilgrimage-map');
  eq('地点详情页固定路径', C.PAGE_PATH.SPOT_DETAIL, '/packageFeatures/pages/pilgrimage/spot-detail');
  eq('缺映射有专用空态文案', C.ERR_MESSAGES.ERR_SUBJECT_UNMAPPED, C.COPY.EMPTY.NO_MAPPING);
  eq('完整地图链接使用 Anitabi 官方地图路由', C.URL.anitabiSubjectMap(115908), 'https://anitabi.cn/map?bangumiId=115908');
}

function testGeo() {
  ok('合法经纬度通过校验', Geo.isValidCoordinate({ latitude: 35, longitude: 135 }));
  ok('经纬度边界合法', Geo.isValidCoordinate(-90, 180));
  eq('纬度越界不合法', Geo.isValidCoordinate({ latitude: 91, longitude: 0 }), false);
  eq('字符串坐标不冒充数值', Geo.isValidCoordinate({ latitude: '35', longitude: '135' }), false);
  eq('NaN 坐标不合法', Geo.isValidCoordinate({ latitude: NaN, longitude: 135 }), false);

  const kyoto = { latitude: 35.0116, longitude: 135.7681 };
  eq('京都属于境外，不施加 GCJ 偏移', Geo.wgs84ToGcj02(kyoto), kyoto);
  const naha = { latitude: 26.2124, longitude: 127.6809 };
  eq('冲绳也不会被中国矩形范围误偏移', Geo.wgs84ToGcj02(naha), naha);
  const newYork = { latitude: 40.7128, longitude: -74.006 };
  eq('远离中国的坐标原样返回', Geo.wgs84ToGcj02(newYork), newYork);

  const shanghai = Geo.wgs84ToGcj02({ latitude: 31.2304, longitude: 121.4737 });
  ok('上海坐标会转换为 GCJ-02', Math.abs(shanghai.latitude - 31.2304) > 0.001);
  near('上海 GCJ 纬度结果合理', shanghai.latitude, 31.22846, 0.0001);
  near('上海 GCJ 经度结果合理', shanghai.longitude, 121.47822, 0.0001);
}

function testTransform() {
  const points = [
    point({
      id: 'ep2-late', cn: '二号桥', name: '第二橋', episodeKey: 'episode:2', episodeLabel: '第2集',
      epRaw: '2', seconds: 80, timeLabel: '01:20', geo: { latitude: 35.0116, longitude: 135.7681 },
    }),
    point({
      id: 'ep1-late', cn: '京都站', name: '京都駅', imagePreview: 'https://image/preview.jpg',
      episodeKey: 'episode:1', episodeLabel: '第1集', epRaw: '1', seconds: 90, timeLabel: '01:30',
      geo: { latitude: 35.0116, longitude: 135.7681 }, origin: 'Google Maps',
    }),
    point({
      id: 'ep1-early', cn: '上海路口', name: '交差点', imageThumb: 'https://image/thumb.jpg',
      episodeKey: 'episode:1', episodeLabel: '第1集', epRaw: '1', seconds: 30, timeLabel: '00:30',
      geo: { latitude: 31.2304, longitude: 121.4737 },
    }),
    point({
      id: 'sp', name: 'Opening Place', episodeKey: 'special:op', episodeLabel: 'OP', seconds: 5,
      timeLabel: '00:05', geo: { latitude: 34, longitude: 134 },
    }),
    point({ id: 'unknown', cn: '无集数地点', geo: { latitude: 34.5, longitude: 135.5 } }),
    point({ id: 'bad-geo', cn: '坏坐标', episodeKey: 'episode:3', episodeLabel: '第3集', geo: [35, 135] }),
  ];

  eq(
    '按数字集数、时间、特殊集数、其他稳定排序',
    T.sortPoints(points).map((item) => item.id),
    ['ep1-early', 'ep1-late', 'ep2-late', 'bad-geo', 'sp', 'unknown']
  );
  const equalA = point({ id: '', cn: '同名', episodeKey: 'episode:1', seconds: 1, token: 'a' });
  const equalB = point({ id: '', cn: '同名', episodeKey: 'episode:1', seconds: 1, token: 'b' });
  eq('比较字段相同保持输入顺序', T.sortPoints([equalB, equalA]).map((item) => item.token), ['b', 'a']);

  eq('地点搜索匹配中文名', T.searchPoints(points, ' 京都 ').map((item) => item.id), ['ep1-late']);
  eq('地点搜索兼容大小写与空格', T.searchPoints(points, 'opening place').map((item) => item.id), ['sp']);
  eq('地点搜索也可匹配来源', T.searchPoints(points, 'googlemaps').map((item) => item.id), ['ep1-late']);
  eq('空关键词返回稳定排序全集', T.searchPoints(points, '').length, points.length);

  eq(
    '集数筛选只返回目标集并按时间排序',
    T.filterPointsByEpisode(points, 'episode:1').map((item) => item.id),
    ['ep1-early', 'ep1-late']
  );
  eq('全部集数 key 不过滤', T.filterPointsByEpisode(points, C.EPISODE.ALL_KEY).length, points.length);
  eq('搜索与集数筛选可以组合', T.deriveVisiblePoints(points, { keyword: '路口', episodeKey: 'episode:1' }).map((p) => p.id), ['ep1-early']);

  const options = T.buildEpisodeOptions(points);
  eq('集数选项以全部开头并带总数', options[0], {
    key: C.EPISODE.ALL_KEY, label: C.COPY.ALL_EPISODES, count: points.length, isAll: true,
  });
  eq('同集地点聚合计数', options.find((item) => item.key === 'episode:1').count, 2);
  eq('未知集数排在末尾', options[options.length - 1].key, C.EPISODE.UNKNOWN_KEY);
  eq(
    '缺 episodeLabel 时可由云端 episodeKey 安全降级',
    T.episodeLabelOf(point({ episodeKey: 'episode:12', episodeLabel: '', epRaw: null })),
    '第12集'
  );

  const previewFallback = T.buildPointViewModel(points[1], 0);
  eq('缩略图缺失时回退预览图', previewFallback.imageThumb, 'https://image/preview.jpg');
  eq('中文名优先且保留原名', [previewFallback.displayName, previewFallback.secondaryName], ['京都站', '京都駅']);
  eq('集数与时间组成列表元信息', previewFallback.metaLabel, '第1集 · 01:30');

  const rawShape = T.buildPointViewModel({ id: 'raw', name: '旧结构', ep: 1, s: 2, geo: [35, 135] }, 0);
  eq('前端不再解释 Anitabi 原始 geo 数组', rawShape.hasCoordinate, false);
  eq('前端不再解释原始 ep 字段', rawShape.episodeKey, C.EPISODE.UNKNOWN_KEY);

  const markers = T.buildMarkers(points);
  eq('非法坐标地点不会生成 marker', markers.some((marker) => marker.title === '坏坐标'), false);
  eq('marker id 全部是数字', markers.every((marker) => Number.isInteger(marker.id)), true);
  eq('marker id 在同批数据中无碰撞', new Set(markers.map((marker) => marker.id)).size, markers.length);
  eq('marker 从配置起点连续编号', markers.map((marker) => marker.id), [1, 2, 3, 4, 5]);
  eq('marker DTO 只保留原生地图所需字段', Object.keys(markers[0]).sort(), [
    'anchor', 'height', 'iconPath', 'id', 'latitude', 'longitude', 'title', 'width',
  ]);
  eq('marker 使用包内图标并以尖端锚定坐标', {
    iconPath: markers[0].iconPath,
    width: markers[0].width,
    height: markers[0].height,
    anchor: markers[0].anchor,
  }, {
    iconPath: C.ASSET.MAP_MARKER,
    width: C.THRESHOLD.MARKER_WIDTH_PX,
    height: C.THRESHOLD.MARKER_HEIGHT_PX,
    anchor: { x: 0.5, y: 1 },
  });
  const kyotoMarker = markers.find((marker) => marker.title === '京都站');
  eq('日本 marker 保持 WGS84', [kyotoMarker.latitude, kyotoMarker.longitude], [35.0116, 135.7681]);
  const shanghaiMarker = markers.find((marker) => marker.title === '上海路口');
  ok('中国大陆 marker 使用 GCJ-02', Math.abs(shanghaiMarker.longitude - 121.4737) > 0.001);

  eq(
    '同集点默认排除当前点并稳定排序',
    T.findSameEpisodePoints(points, 'ep1-late').map((item) => item.id),
    ['ep1-early']
  );
  eq('同集点可显式包含当前点', T.findSameEpisodePoints(points, 'ep1-late', { includeCurrent: true }).length, 2);
  eq('未知集数不误归为同一集', T.findSameEpisodePoints(points, 'unknown'), []);
  eq('不存在的当前点安全返回空', T.findSameEpisodePoints(points, 'missing'), []);
}

function createMemoryAdapter() {
  const values = new Map();
  return {
    values,
    get: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  };
}

function subject(id, overrides) {
  return Object.assign({
    bgmSubjectId: id,
    cn: `番剧${id}`,
    title: `Anime ${id}`,
    cover: `https://image/${id}.jpg`,
    city: '宇治市',
    pointsLength: id,
    imagesLength: id - 1,
  }, overrides || {});
}

function testStorage() {
  const adapter = createMemoryAdapter();
  let clock = 1000;
  const store = Storage.createPilgrimageStorage(adapter, { now: () => clock });
  eq('收藏初始为空', store.getFavoriteSubjects(), []);
  eq('最近浏览初始为空', store.getRecentSubjects(), []);

  let favorites = store.saveFavoriteSubject(subject(115908, { sourceId: 14360 }));
  eq('收藏写入 subject id', favorites[0].bgmSubjectId, 115908);
  eq('收藏保存时间使用注入时钟', favorites[0].savedAt, 1000);
  eq('收藏可保留 DDP sourceId 供回跳', favorites[0].sourceId, 14360);
  eq('收藏状态可查询', store.isFavoriteSubject('115908'), true);

  clock = 2000;
  favorites = store.saveFavoriteSubject(subject(115908, { cn: '更新后的标题' }));
  eq('重复收藏去重', favorites.length, 1);
  eq('重复收藏更新展示快照', favorites[0].cn, '更新后的标题');
  eq('重复收藏保留首次收藏时间', favorites[0].savedAt, 1000);

  let toggled = store.toggleFavoriteSubject(subject(115908));
  eq('切换收藏可移除', { ok: toggled.ok, favorite: toggled.isFavorite, count: toggled.items.length }, { ok: true, favorite: false, count: 0 });
  toggled = store.toggleFavoriteSubject(subject(115908));
  eq('再次切换可恢复收藏', { ok: toggled.ok, favorite: toggled.isFavorite }, { ok: true, favorite: true });

  clock = 3000;
  let recents = store.recordRecentSubject(subject(1));
  clock = 4000;
  recents = store.recordRecentSubject(subject(2));
  clock = 5000;
  recents = store.recordRecentSubject(subject(1, { cn: '番剧1新标题' }));
  eq('最近浏览去重并把最新项移到前面', recents.map((item) => item.bgmSubjectId), [1, 2]);
  eq('再次浏览会更新时间', recents[0].viewedAt, 5000);
  eq('再次浏览会更新展示快照', recents[0].cn, '番剧1新标题');

  for (let id = 10; id < 10 + C.STORAGE_LIMIT.RECENT_SUBJECTS + 5; id++) {
    clock += 1;
    store.recordRecentSubject(subject(id));
  }
  recents = store.getRecentSubjects();
  eq('最近浏览遵守上限', recents.length, C.STORAGE_LIMIT.RECENT_SUBJECTS);
  eq('最近浏览保留最新项', recents[0].bgmSubjectId, 10 + C.STORAGE_LIMIT.RECENT_SUBJECTS + 4);

  store.clearRecentSubjects();
  eq('清空最近浏览会删除对应存储', store.getRecentSubjects(), []);

  const badAdapter = createMemoryAdapter();
  badAdapter.values.set(C.STORAGE_KEY.FAVORITE_SUBJECTS, { version: C.STORAGE_VERSION + 1, items: [subject(1)] });
  const badStore = Storage.createPilgrimageStorage(badAdapter);
  eq('版本不匹配的旧数据安全忽略', badStore.getFavoriteSubjects(), []);
  badAdapter.values.set(C.STORAGE_KEY.FAVORITE_SUBJECTS, '{bad json');
  eq('损坏 JSON 安全忽略', badStore.getFavoriteSubjects(), []);

  badAdapter.values.set(C.STORAGE_KEY.FAVORITE_SUBJECTS, {
    version: C.STORAGE_VERSION,
    items: [
      Object.assign(subject(1), { savedAt: 1 }),
      Object.assign(subject(1), { savedAt: 2 }),
      Object.assign(subject(2), { savedAt: 3 }),
    ],
  });
  eq('读取阶段也会按 subject id 去重', badStore.getFavoriteSubjects().map((item) => item.bgmSubjectId), [1, 2]);

  const limitedAdapter = createMemoryAdapter();
  const limitedStore = Storage.createPilgrimageStorage(limitedAdapter, { now: () => clock++ });
  for (let id = 1; id <= C.STORAGE_LIMIT.FAVORITE_SUBJECTS + 5; id++) {
    limitedStore.saveFavoriteSubject(subject(id));
  }
  const limitedFavorites = limitedStore.getFavoriteSubjects();
  eq('收藏列表遵守上限', limitedFavorites.length, C.STORAGE_LIMIT.FAVORITE_SUBJECTS);
  eq('收藏超限时保留最近加入项', limitedFavorites[0].bgmSubjectId, C.STORAGE_LIMIT.FAVORITE_SUBJECTS + 5);

  const throwingStore = Storage.createPilgrimageStorage({
    get: () => undefined,
    set: () => { throw new Error('quota exceeded'); },
    remove: () => { throw new Error('denied'); },
  });
  eq('Storage 写失败不伪装成已收藏', throwingStore.saveFavoriteSubject(subject(1)), []);
  eq('Storage 写失败的 toggle 返回 ok=false', throwingStore.toggleFavoriteSubject(subject(1)), {
    ok: false,
    isFavorite: false,
    items: [],
  });
  const removalFailureAdapter = createMemoryAdapter();
  const removalFailureStore = Storage.createPilgrimageStorage(removalFailureAdapter);
  removalFailureStore.saveFavoriteSubject(subject(2));
  removalFailureAdapter.set = () => false;
  eq('取消收藏写失败会保留实际状态并返回 ok=false', removalFailureStore.toggleFavoriteSubject(subject(2)), {
    ok: false,
    isFavorite: true,
    items: removalFailureStore.getFavoriteSubjects(),
  });
  const falseWriteStore = Storage.createPilgrimageStorage({ get: () => undefined, set: () => false });
  eq('适配器显式返回 false 也视作写失败', falseWriteStore.saveFavoriteSubject(subject(1)), []);
  eq('非法番剧对象不会污染 Storage', store.saveFavoriteSubject({ id: -1 }).some((item) => item.bgmSubjectId === -1), false);
}

async function run() {
  testConfig();
  await testCloudApi();
  testGeo();
  testTransform();
  testStorage();
}

run()
  .catch((error) => {
    fail++;
    failures.push(`  ❌ 测试异常\n     ${error && error.stack ? error.stack : error}`);
  })
  .finally(() => {
    console.log('\n圣地巡礼工具层测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
