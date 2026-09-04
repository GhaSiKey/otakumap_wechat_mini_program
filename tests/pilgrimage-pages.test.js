/**
 * 圣地巡礼页面级回归测试
 *
 * 用 Node 模拟 Page / wx，并只替换页面依赖的 API 方法。每个场景结束后恢复
 * require cache、全局对象与 mock 方法，避免影响同进程内的其他测试。
 *
 * 运行：node tests/pilgrimage-pages.test.js
 */

const assert = require('assert');
const fs = require('fs');

const AnimeApi = require('../miniprogram/packageFeatures/utils/anime-meta/cloud-api');
const PilgrimageApi = require('../miniprogram/packageFeatures/utils/pilgrimage/cloud-api');
const PilgrimageConfig = require('../miniprogram/packageFeatures/utils/pilgrimage/config');
const PilgrimageGeo = require('../miniprogram/packageFeatures/utils/pilgrimage/geo');
const PilgrimageStorage = require('../miniprogram/packageFeatures/utils/pilgrimage/storage');

const SEARCH_PAGE = '../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-search.js';
const MAP_PAGE = '../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-map.js';
const DETAIL_PAGE = '../miniprogram/packageFeatures/pages/pilgrimage/spot-detail.js';

function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce((copy, key) => {
    copy[key] = cloneData(value[key]);
    return copy;
  }, {});
}

function instantiatePage(definition) {
  return Object.assign(Object.create(definition), {
    data: cloneData(definition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch || {});
      if (typeof callback === 'function') callback.call(this);
    },
  });
}

function snapshotGlobal(name) {
  return {
    exists: Object.prototype.hasOwnProperty.call(global, name),
    value: global[name],
  };
}

function restoreGlobal(name, snapshot) {
  if (snapshot.exists) global[name] = snapshot.value;
  else delete global[name];
}

/**
 * fresh require 页面并安装最小运行时。patches 形如 [module, method, replacement]。
 */
async function withPage(pageRequest, options, run) {
  const pagePath = require.resolve(pageRequest);
  const pageCacheBefore = require.cache[pagePath];
  const pageGlobal = snapshotGlobal('Page');
  const wxGlobal = snapshotGlobal('wx');
  const pagesGlobal = snapshotGlobal('getCurrentPages');
  const patches = (options && options.patches) || [];
  const originals = patches.map(([target, method]) => [target, method, target[method]]);
  let definition = null;

  try {
    patches.forEach(([target, method, replacement]) => {
      target[method] = replacement;
    });
    delete require.cache[pagePath];
    global.Page = (pageDefinition) => {
      definition = pageDefinition;
    };
    global.wx = (options && options.wx) || {};
    global.getCurrentPages = (options && options.getCurrentPages) || (() => []);
    require(pagePath);
    assert.ok(definition, `${pageRequest} 应注册 Page`);
    await run(instantiatePage(definition));
  } finally {
    originals.forEach(([target, method, original]) => {
      target[method] = original;
    });
    delete require.cache[pagePath];
    if (pageCacheBefore) require.cache[pagePath] = pageCacheBefore;
    restoreGlobal('Page', pageGlobal);
    restoreGlobal('wx', wxGlobal);
    restoreGlobal('getCurrentPages', pagesGlobal);
  }
}

async function waitUntil(description, predicate) {
  for (let index = 0; index < 30; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`等待超时：${description}`);
}

function point(overrides) {
  return Object.assign({
    id: 'point-default',
    cn: '',
    name: '',
    imageThumb: '',
    imagePreview: '',
    epRaw: null,
    episodeKey: PilgrimageConfig.EPISODE.UNKNOWN_KEY,
    episodeLabel: PilgrimageConfig.COPY.UNKNOWN_EPISODE,
    seconds: null,
    timeLabel: '',
    geo: null,
    origin: '',
    originUrl: '',
  }, overrides || {});
}

const SUMMARY = Object.freeze({
  id: 115908,
  cn: '巡礼测试番剧',
  title: 'Pilgrimage Test Anime',
  city: '京都市',
  cover: 'https://image.example/cover.jpg',
  center: { latitude: 35.0116, longitude: 135.7681 },
  zoom: 12,
  pointsLength: 5,
  imagesLength: 3,
});

const POINTS = Object.freeze([
  point({
    id: 'station',
    cn: '京都站',
    name: '京都駅',
    imageThumb: 'https://image.anitabi.cn/points/station.jpg?plan=h160',
    imagePreview: 'https://image.anitabi.cn/points/station.jpg?plan=h360',
    episodeKey: 'episode:1',
    episodeLabel: '第1集',
    epRaw: '1',
    seconds: 30,
    timeLabel: '00:30',
    geo: { latitude: 35.0116, longitude: 135.7681 },
    origin: '车站广场',
    originUrl: 'https://source.example/station',
  }),
  point({
    id: 'crossing',
    cn: '上海路口',
    name: '交差点',
    episodeKey: 'episode:1',
    episodeLabel: '第1集',
    epRaw: '1',
    seconds: 80,
    timeLabel: '01:20',
    geo: { latitude: 31.2304, longitude: 121.4737 },
    origin: '街景投稿',
    originUrl: 'https://source.example/crossing',
  }),
  point({
    id: 'bridge',
    cn: '宇治桥',
    name: '宇治橋',
    episodeKey: 'episode:2',
    episodeLabel: '第2集',
    epRaw: '2',
    seconds: 15,
    timeLabel: '00:15',
    geo: { latitude: 34.8893, longitude: 135.8077 },
    origin: '河岸',
    originUrl: 'https://source.example/bridge',
  }),
]);

function baseWx(overrides) {
  return Object.assign({
    getStorageSync: () => undefined,
    setStorageSync: () => true,
    removeStorageSync: () => true,
    setNavigationBarTitle: () => {},
    showToast: () => {},
    navigateTo: () => {},
    navigateBack: () => {},
    redirectTo: () => {},
    pageScrollTo: () => {},
  }, overrides || {});
}

async function testSearchUnmappedNavigation() {
  const navigations = [];
  await withPage(SEARCH_PAGE, {
    wx: baseWx({
      navigateTo(options) {
        navigations.push(options.url);
        if (typeof options.success === 'function') options.success();
      },
    }),
    patches: [
      [AnimeApi, 'searchAnime', async () => ({
        ok: true,
        data: {
          cached: false,
          animes: [{
            sourceId: 14360,
            name: '未映射 & 番剧',
            cover: 'https://image.example/poster.jpg?a=1&b=2',
            typeDesc: 'TV动画',
            year: '2026',
            totalEp: 12,
          }],
        },
      })],
      [AnimeApi, 'getAnimeDetail', async () => ({
        ok: true,
        data: {
          // 即便上游还有同名字段，页面也只能采用服务端明确解析出的 bgmSubjectId。
          bangumi: {
            sourceId: 14360,
            bangumiId: 999999,
            bgmSubjectId: null,
            name: '未映射 & 番剧',
            cover: 'https://image.example/detail.jpg?a=1&b=2',
          },
        },
      })],
    ],
  }, async (page) => {
    page.onLoad();
    await page.onSearch({ detail: { value: '未映射番剧' } });
    assert.strictEqual(page.data.animes.length, 1);

    await page.onAnimeTap({ currentTarget: { dataset: { sourceid: 14360 } } });
    assert.strictEqual(navigations.length, 1);
    const [pathname, queryString] = navigations[0].split('?');
    const query = new URLSearchParams(queryString);
    assert.strictEqual(pathname, PilgrimageConfig.PAGE_PATH.MAP);
    assert.strictEqual(query.get('unmapped'), '1');
    assert.strictEqual(query.get('sourceId'), '14360');
    assert.strictEqual(query.get('bgmSubjectId'), null);
    assert.strictEqual(query.get('name'), '未映射 & 番剧');
    assert.strictEqual(query.get('cover'), 'https://image.example/detail.jpg?a=1&b=2');
    page.onUnload();
  });
}

async function testSearchInputInvalidatesPendingDetail() {
  const navigations = [];
  let resolveDetail;
  await withPage(SEARCH_PAGE, {
    wx: baseWx({
      navigateTo(options) {
        navigations.push(options.url);
      },
    }),
    patches: [
      [AnimeApi, 'searchAnime', async () => ({
        ok: true,
        data: {
          animes: [{ sourceId: 14360, name: '旧搜索结果', cover: '' }],
        },
      })],
      [AnimeApi, 'getAnimeDetail', () => new Promise((resolve) => {
        resolveDetail = resolve;
      })],
    ],
  }, async (page) => {
    page.onLoad();
    await page.onSearch({ detail: { value: '旧关键词' } });
    assert.strictEqual(page.data.animes.length, 1);

    const detailRequest = page.onAnimeTap({
      currentTarget: { dataset: { sourceid: 14360 } },
    });
    assert.strictEqual(page.data.resolvingSourceId, 14360);

    const overlongKeyword = '新'.repeat(PilgrimageConfig.THRESHOLD.SEARCH_KEYWORD_MAX + 8);
    page.onSearchChange({ detail: { value: overlongKeyword } });
    assert.strictEqual(page.data.keyword.length, PilgrimageConfig.THRESHOLD.SEARCH_KEYWORD_MAX);
    assert.deepStrictEqual(page.data.animes, []);
    assert.strictEqual(page.data.searched, false);
    assert.strictEqual(page.data.resolvingSourceId, null);

    resolveDetail({
      ok: true,
      data: {
        bangumi: {
          sourceId: 14360,
          bgmSubjectId: SUMMARY.id,
          name: '旧搜索结果',
        },
      },
    });
    await detailRequest;
    assert.deepStrictEqual(navigations, [], '旧详情响应不得在输入变化后继续导航');
    page.onUnload();
  });
}

async function testSearchFavoriteRemovalFeedback() {
  const savedSubject = {
    bgmSubjectId: SUMMARY.id,
    sourceId: 14360,
    name: SUMMARY.cn,
    cover: SUMMARY.cover,
    city: SUMMARY.city,
    pointsLength: SUMMARY.pointsLength,
  };
  let storedFavorites = [savedSubject];
  let removalFails = true;
  const toasts = [];

  await withPage(SEARCH_PAGE, {
    wx: baseWx({
      showToast(options) {
        toasts.push(options);
      },
    }),
    patches: [
      [PilgrimageStorage.defaultStorage, 'getFavoriteSubjects', () => storedFavorites],
      [PilgrimageStorage.defaultStorage, 'getRecentSubjects', () => []],
      [PilgrimageStorage.defaultStorage, 'removeFavoriteSubject', () => {
        if (!removalFails) storedFavorites = [];
        return storedFavorites;
      }],
    ],
  }, async (page) => {
    page.onLoad();
    page.onShow();
    assert.strictEqual(page.data.favorites.length, 1);

    const event = { currentTarget: { dataset: { subjectid: SUMMARY.id } } };
    page.onRemoveFavorite(event);
    assert.strictEqual(page.data.favorites.length, 1, '删除写入失败时应保留当前收藏');
    assert.deepStrictEqual(toasts.pop(), {
      title: PilgrimageConfig.COPY.SEARCH_PAGE.REMOVE_FAVORITE_FAIL,
      icon: 'none',
    });

    removalFails = false;
    page.onRemoveFavorite(event);
    assert.strictEqual(page.data.favorites.length, 0);
    assert.deepStrictEqual(toasts.pop(), {
      title: PilgrimageConfig.COPY.SEARCH_PAGE.REMOVE_FAVORITE_SUCCESS,
      icon: 'success',
    });
    page.onUnload();
  });
}

async function testSearchSavedSubjectDedupeAndCoverErrors() {
  let favoriteCover = 'https://assets.anixplayer.net/favorite-old.jpg';
  const sharedSubject = {
    bgmSubjectId: SUMMARY.id,
    sourceId: 14360,
    name: SUMMARY.cn,
    cover: favoriteCover,
  };
  const recentOnly = {
    bgmSubjectId: SUMMARY.id + 1,
    sourceId: 14361,
    name: '另一部番剧',
    cover: favoriteCover,
  };

  await withPage(SEARCH_PAGE, {
    wx: baseWx(),
    patches: [
      [PilgrimageStorage.defaultStorage, 'getFavoriteSubjects', () => [
        Object.assign({}, sharedSubject, { cover: favoriteCover }),
      ]],
      [PilgrimageStorage.defaultStorage, 'getRecentSubjects', () => [
        Object.assign({}, sharedSubject, { cover: favoriteCover }),
        Object.assign({}, recentOnly, { cover: favoriteCover }),
      ]],
    ],
  }, async (page) => {
    page.onLoad();
    page.onShow();

    assert.deepStrictEqual(page.data.favorites.map((item) => item.bgmSubjectId), [SUMMARY.id]);
    assert.deepStrictEqual(
      page.data.recents.map((item) => item.bgmSubjectId),
      [SUMMARY.id + 1],
      '最近浏览不应再次展示已收藏作品'
    );

    const favoriteKey = page.data.favorites[0].coverKey;
    const recentKey = page.data.recents[0].coverKey;
    assert.notStrictEqual(favoriteKey, recentKey, '不同区域的封面失败状态必须隔离');
    page.onCoverError({ currentTarget: { dataset: { key: favoriteKey } } });
    assert.strictEqual(page.data.coverErrorKeys[favoriteKey], true);
    assert.strictEqual(page.data.coverErrorKeys[recentKey], undefined);

    favoriteCover = 'https://assets.anixplayer.net/favorite-new.jpg';
    page.onShow();
    assert.notStrictEqual(page.data.favorites[0].coverKey, favoriteKey);
    assert.strictEqual(page.data.coverErrorKeys[favoriteKey], undefined, '封面 URL 更新后应重新尝试加载');
    page.onUnload();
  });
}

function testSearchAccessibilityMarkupAndLicenseCopy() {
  const wxml = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-search.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-search.wxss'),
    'utf8'
  );
  assert.match(wxml, /<t-search[\s\S]*?maxlength="\{\{searchKeywordMax\}\}"/);
  assert.match(wxml, /aria-label="\{\{copy\.SEARCH_ARIA_LABEL\}\}"/);
  assert.doesNotMatch(wxml, /<t-search[\s\S]*?action="\{\{copy\.SEARCH_ACTION\}\}"/);
  assert.doesNotMatch(wxml, /bind:action-click="onSearch"/);
  assert.match(
    wxml,
    /<view[\s\S]*?class="search-box__submit"[\s\S]*?aria-role="button"[\s\S]*?<t-icon[^>]*name="search"[\s\S]*?\{\{copy\.SEARCH_ACTION\}\}/
  );
  assert.doesNotMatch(wxml, /<button[\s\S]*?class="search-box__submit"/);
  assert.match(wxml, /aria-role="button"[\s\S]*?aria-label="\{\{item\.openAriaLabel\}\}"/);
  assert.match(wxml, /aria-label="\{\{item\.removeFavoriteAriaLabel\}\}"/);
  assert.match(PilgrimageConfig.COPY.SEARCH_PAGE.DATA_SOURCE_NOTE, /CC BY-NC-SA 4\.0/);
  assert.match(PilgrimageConfig.COPY.MAP_PAGE.DATA_SOURCE_NOTE, /CC BY-NC-SA 4\.0/);
  assert.match(PilgrimageConfig.COPY.DETAIL_PAGE.DATA_SOURCE_NOTE, /CC BY-NC-SA 4\.0/);
  assert.strictEqual(PilgrimageConfig.COPY.DETAIL_PAGE.COPY_SOURCE, '复制来源链接');

  const resultIndex = wxml.indexOf('result-section result-section--active');
  const favoriteIndex = wxml.indexOf('wx:if="{{favorites.length}}"');
  assert.ok(resultIndex >= 0 && resultIndex < favoriteIndex, '搜索结果应紧跟搜索框展示');

  const searchBoxRule = wxss.match(/\.search-box\s*\{([\s\S]*?)\}/);
  assert.ok(searchBoxRule, '应存在搜索条布局样式');
  assert.match(searchBoxRule[1], /display:\s*flex/);
  assert.doesNotMatch(searchBoxRule[1], /margin:\s*-/, '搜索条不得再用负边距覆盖顶部图片');

  const submitRule = wxss.match(/\.search-box__submit\s*\{([\s\S]*?)\}/);
  assert.ok(submitRule, '应存在独立搜索按钮样式');
  assert.match(submitRule[1], /flex:\s*0\s+0\s+132rpx/, '搜索按钮必须保持紧凑固定宽度');
  assert.match(submitRule[1], /background:\s*var\(--td-brand-color\)/, '搜索按钮应使用页面品牌色');
}

function testPilgrimageResponsiveImageMarkup() {
  const mapMarkup = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-map.wxml'),
    'utf8'
  );
  const detailMarkup = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/spot-detail.wxml'),
    'utf8'
  );
  const mapStyles = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-map.wxss'),
    'utf8'
  );

  assert.match(mapMarkup, /bind:error="onPointImageError"/);
  assert.doesNotMatch(mapMarkup, /bind:action-click="onPlaceSearchSubmit"/);
  assert.match(mapStyles, /\.map-toolbar\s*\{[\s\S]*?flex-direction:\s*column/);
  assert.match(detailMarkup, /bind:error="onSameEpisodeImageError"/);
  assert.match(detailMarkup, /icon="map-navigation"[\s\S]*?content="\{\{copy\.OPEN_NAVIGATION\}\}"/);
  assert.doesNotMatch(detailMarkup, /<t-button[^>]*>\s*<t-icon[^>]*name="map-navigation"/);
}

function testPilgrimageDoesNotRequestUserLocation() {
  const mapScript = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-map.js'),
    'utf8'
  );
  const mapMarkup = fs.readFileSync(
    require.resolve('../miniprogram/packageFeatures/pages/pilgrimage/pilgrimage-map.wxml'),
    'utf8'
  );
  const appConfig = JSON.parse(fs.readFileSync(
    require.resolve('../miniprogram/app.json'),
    'utf8'
  ));
  const privateInfos = Array.isArray(appConfig.requiredPrivateInfos)
    ? appConfig.requiredPrivateInfos
    : [];

  assert.doesNotMatch(mapScript, /wx\.getLocation|\bonLocate\b/);
  assert.doesNotMatch(mapMarkup, /show-location|\bonLocate\b|定位我/);
  assert.ok(!privateInfos.includes('getLocation'));
  assert.ok(!(appConfig.permission && appConfig.permission['scope.userLocation']));
}

async function testMapReadyInteractions() {
  const apiCalls = [];
  const recentSubjects = [];
  const refreshedFavorites = [];
  const toasts = [];
  let mapContextCreates = 0;
  let clusterInitializations = 0;

  await withPage(MAP_PAGE, {
    wx: baseWx({
      showToast(options) {
        toasts.push(options.title);
      },
      createMapContext() {
        mapContextCreates += 1;
        return {
          includePoints() {},
          initMarkerCluster() {
            clusterInitializations += 1;
          },
        };
      },
    }),
    patches: [
      [PilgrimageApi, 'getSubjectSummary', async (id) => {
        apiCalls.push(['summary', id]);
        return { ok: true, data: SUMMARY };
      }],
      [PilgrimageApi, 'getSubjectPoints', async (id) => {
        apiCalls.push(['points', id]);
        return {
          ok: true,
          data: { points: POINTS, returnedCount: POINTS.length },
        };
      }],
      [PilgrimageStorage, 'recordRecentSubject', (subject) => {
        recentSubjects.push(subject);
        return [subject];
      }],
      [PilgrimageStorage, 'isFavoriteSubject', () => true],
      [PilgrimageStorage, 'saveFavoriteSubject', (subject) => {
        refreshedFavorites.push(subject);
        return [subject];
      }],
      [PilgrimageStorage, 'toggleFavoriteSubject', () => ({
        ok: false,
        isFavorite: false,
        items: [],
      })],
    ],
  }, async (page) => {
    const entryCover = 'https://assets.anixplayer.net/pilgrimage-test.jpg';
    page.onLoad({
      bgmSubjectId: String(SUMMARY.id),
      sourceId: '14360',
      name: encodeURIComponent('巡礼测试番剧'),
      cover: encodeURIComponent(entryCover),
    });
    await waitUntil('地图页进入 ready', () => page.data.state === 'ready');

    assert.deepStrictEqual(apiCalls, [
      ['summary', SUMMARY.id],
      ['points', SUMMARY.id],
    ]);
    assert.strictEqual(recentSubjects.length, 1);
    assert.strictEqual(refreshedFavorites.length, 1);
    assert.strictEqual(refreshedFavorites[0].cover, entryCover, '存量收藏应刷新为当前可用封面');
    assert.strictEqual(page.data.coverUrl, entryCover, '地图页应优先使用搜索入口的国内封面');
    page.onSubjectCoverError({ currentTarget: { dataset: { coverurl: entryCover } } });
    assert.strictEqual(page.data.coverUrl, SUMMARY.cover, '入口封面失败后再尝试 Anitabi 封面');
    page.onSubjectCoverError({ currentTarget: { dataset: { coverurl: entryCover } } });
    assert.strictEqual(page.data.coverError, false, '旧 image 的延迟 error 不应污染当前封面');
    page.onSubjectCoverError({ currentTarget: { dataset: { coverurl: SUMMARY.cover } } });
    assert.strictEqual(page.data.coverError, true);
    assert.strictEqual(page.data.filteredPoints.length, POINTS.length);
    assert.strictEqual(page.data.isPartial, true);
    assert.strictEqual(
      page.data.countText,
      PilgrimageConfig.COPY.MAP_PAGE.PARTIAL_COUNT(POINTS.length, SUMMARY.pointsLength)
    );

    page.onPlaceSearchChange({ detail: { value: '宇治' } });
    assert.deepStrictEqual(page.data.filteredPoints.map((item) => item.id), ['bridge']);

    page.onPlaceSearchClear();
    page.onEpisodeTap({ currentTarget: { dataset: { key: 'episode:1' } } });
    assert.deepStrictEqual(
      page.data.filteredPoints.map((item) => item.id),
      ['station', 'crossing']
    );

    page.onMapUpdated();
    assert.strictEqual(clusterInitializations, 1);
    page.onViewModeTap({ currentTarget: { dataset: { mode: 'list' } } });
    assert.strictEqual(page._mapContext, null);
    assert.strictEqual(page._clusterInitialized, false);
    page.onViewModeTap({ currentTarget: { dataset: { mode: 'map' } } });
    assert.strictEqual(mapContextCreates, 2, '重建 map 后应创建新 context');
    page.onMapUpdated();
    assert.strictEqual(clusterInitializations, 2, '重建 map 后应重新初始化聚合');

    const firstMarkerId = page.data.markers[0].id;
    page.onMarkerTap({ detail: { markerId: firstMarkerId } });
    assert.strictEqual(page.data.selectedPoint.id, 'station');
    assert.strictEqual(page.data.mapScale, PilgrimageConfig.THRESHOLD.MAP_FOCUS_SCALE);
    const selectedKey = page.data.selectedPoint.key;
    page.onPointImageError({ currentTarget: { dataset: { pointkey: selectedKey } } });
    assert.strictEqual(page.data.pointImageErrors[selectedKey], true);

    page.onToggleFavorite();
    assert.strictEqual(page.data.isFavorite, false);
    assert.strictEqual(toasts[toasts.length - 1], PilgrimageConfig.COPY.MAP_PAGE.FAVORITE_FAIL);
    page.onUnload();
  });
}

async function testMapZeroSummarySkipsPoints() {
  const apiCalls = [];
  await withPage(MAP_PAGE, {
    wx: baseWx(),
    patches: [
      [PilgrimageApi, 'getSubjectSummary', async (id) => {
        apiCalls.push(['summary', id]);
        return { ok: true, data: Object.assign({}, SUMMARY, { pointsLength: 0 }) };
      }],
      [PilgrimageApi, 'getSubjectPoints', async (id) => {
        apiCalls.push(['points', id]);
        return { ok: true, data: { points: POINTS, returnedCount: POINTS.length } };
      }],
    ],
  }, async (page) => {
    page.onLoad({ bgmSubjectId: String(SUMMARY.id) });
    await waitUntil('摘要0点进入空态', () => page.data.state === 'empty');
    assert.deepStrictEqual(apiCalls, [['summary', SUMMARY.id]]);
    assert.strictEqual(page.data.emptyMessage, PilgrimageConfig.COPY.EMPTY.NO_POINTS);
    page.onUnload();
  });
}

async function testMapCountAndZoomNormalization() {
  const scenarios = [
    {
      zoom: 99,
      truncated: false,
      expectedScale: PilgrimageConfig.THRESHOLD.MAP_MAX_SCALE,
      expectedPartial: false,
      expectedCount: PilgrimageConfig.COPY.MAP_PAGE.COUNT(POINTS.length),
    },
    {
      zoom: -4,
      truncated: true,
      expectedScale: PilgrimageConfig.THRESHOLD.MAP_MIN_SCALE,
      expectedPartial: true,
      expectedCount: PilgrimageConfig.COPY.MAP_PAGE.TRUNCATED_COUNT(POINTS.length),
    },
  ];

  for (const scenario of scenarios) {
    await withPage(MAP_PAGE, {
      wx: baseWx(),
      patches: [
        [PilgrimageApi, 'getSubjectSummary', async () => ({
          ok: true,
          data: Object.assign({}, SUMMARY, { pointsLength: 2, zoom: scenario.zoom }),
        })],
        [PilgrimageApi, 'getSubjectPoints', async () => ({
          ok: true,
          data: {
            points: POINTS,
            returnedCount: POINTS.length,
            truncated: scenario.truncated,
          },
        })],
      ],
    }, async (page) => {
      page.onLoad({ bgmSubjectId: String(SUMMARY.id) });
      await waitUntil('地图页数量场景进入 ready', () => page.data.state === 'ready');
      assert.strictEqual(page.data.mapScale, scenario.expectedScale);
      assert.strictEqual(page.data.isPartial, scenario.expectedPartial);
      assert.strictEqual(page.data.countText, scenario.expectedCount);
      page.onUnload();
    });
  }
}

async function testMapPointsWithoutCoordinatesUseList() {
  const pointsWithoutCoordinates = POINTS.map((item) => Object.assign({}, item, { geo: null }));
  await withPage(MAP_PAGE, {
    wx: baseWx(),
    patches: [
      [PilgrimageApi, 'getSubjectSummary', async () => ({
        ok: true,
        data: Object.assign({}, SUMMARY, { pointsLength: pointsWithoutCoordinates.length }),
      })],
      [PilgrimageApi, 'getSubjectPoints', async () => ({
        ok: true,
        data: { points: pointsWithoutCoordinates, returnedCount: pointsWithoutCoordinates.length },
      })],
    ],
  }, async (page) => {
    page.onLoad({ bgmSubjectId: String(SUMMARY.id) });
    await waitUntil('无坐标地点进入 ready', () => page.data.state === 'ready');
    assert.strictEqual(page.data.filteredPoints.length, pointsWithoutCoordinates.length);
    assert.strictEqual(page.data.markers.length, 0);
    assert.strictEqual(page.data.viewMode, 'list');
    page.onViewModeTap({ currentTarget: { dataset: { mode: 'map' } } });
    assert.strictEqual(page.data.viewMode, 'list', '无 marker 时不进入空白地图');
    page.onUnload();
  });
}

async function testMapUnmappedSkipsApi() {
  let calls = 0;
  await withPage(MAP_PAGE, {
    wx: baseWx(),
    patches: [
      [PilgrimageApi, 'getSubjectSummary', async () => {
        calls += 1;
        return { ok: false };
      }],
      [PilgrimageApi, 'getSubjectPoints', async () => {
        calls += 1;
        return { ok: false };
      }],
    ],
  }, async (page) => {
    page.onLoad({ sourceId: '14360', unmapped: '1', name: '未映射作品' });
    assert.strictEqual(page.data.state, 'empty');
    assert.strictEqual(page.data.emptyMessage, PilgrimageConfig.COPY.EMPTY.NO_MAPPING);
    assert.strictEqual(page.data.bgmSubjectId, null);
    assert.strictEqual(calls, 0);
    page.onUnload();
  });
}

async function testDetailSelectionAndNavigation() {
  const titles = [];
  const scrolls = [];
  const openedLocations = [];
  const previewedImages = [];
  const toasts = [];

  await withPage(DETAIL_PAGE, {
    wx: baseWx({
      setNavigationBarTitle(options) {
        titles.push(options.title);
      },
      pageScrollTo(options) {
        scrolls.push(options);
      },
      openLocation(options) {
        openedLocations.push(options);
      },
      previewImage(options) {
        previewedImages.push(options.current);
        options.fail();
      },
      showToast(options) {
        toasts.push(options);
      },
    }),
    getCurrentPages: () => [{ route: 'map' }, { route: 'detail' }],
    patches: [
      [PilgrimageApi, 'getSubjectSummary', async () => ({ ok: true, data: SUMMARY })],
      [PilgrimageApi, 'getSubjectPoints', async () => ({
        ok: true,
        data: { points: POINTS, returnedCount: POINTS.length },
      })],
    ],
  }, async (page) => {
    page.onLoad({
      bgmSubjectId: String(SUMMARY.id),
      pointId: 'station',
      sourceId: '14360',
      name: encodeURIComponent(SUMMARY.cn),
    });
    await waitUntil('详情页进入 content', () => page.data.state === 'content');

    assert.strictEqual(page.data.point.id, 'station');
    assert.deepStrictEqual(page.data.sameEpisodePoints.map((item) => item.id), ['crossing']);
    assert.strictEqual(page.data.showBackFallback, false, '正常页面栈不重复展示返回地图大按钮');
    assert.strictEqual(page.data.displayImageUrl, POINTS[0].imagePreview);
    assert.strictEqual(page.data.imageState, 'loading');

    page.onImageError({
      currentTarget: { dataset: { pointid: 'station', url: POINTS[0].imagePreview } },
    });
    assert.strictEqual(page.data.displayImageUrl, POINTS[0].imageThumb, '大图失败后应尝试缩略图');
    page.onImageLoad({
      currentTarget: { dataset: { pointid: 'station', url: POINTS[0].imageThumb } },
    });
    assert.strictEqual(page.data.imageState, 'ready');
    page.onPreviewImage();
    assert.deepStrictEqual(previewedImages, [POINTS[0].imageThumb]);
    assert.strictEqual(toasts[toasts.length - 1].title, PilgrimageConfig.COPY.DETAIL_PAGE.PREVIEW_FAIL);

    page.onSameEpisodeTap({ currentTarget: { dataset: { pointid: 'crossing' } } });
    assert.strictEqual(page.data.pointId, 'crossing');
    assert.strictEqual(page.data.point.id, 'crossing');
    assert.deepStrictEqual(page.data.sameEpisodePoints.map((item) => item.id), ['station']);
    assert.deepStrictEqual(scrolls[0], { scrollTop: 0, duration: 0 });
    assert.strictEqual(titles[titles.length - 1], '上海路口');
    assert.strictEqual(page.data.imageState, 'missing');
    page.onImageError({
      currentTarget: { dataset: { pointid: 'station', url: POINTS[0].imageThumb } },
    });
    assert.strictEqual(page.data.imageState, 'missing', '旧地点的延迟 error 不应污染新地点');

    const sameEpisodePoint = page.data.sameEpisodePoints[0];
    page.onSameEpisodeImageError({
      currentTarget: {
        dataset: { pointkey: sameEpisodePoint.key, url: sameEpisodePoint.imageThumb },
      },
    });
    assert.strictEqual(page.data.sameEpisodeImageErrors[sameEpisodePoint.key], true);

    page.onOpenLocation();
    assert.strictEqual(openedLocations.length, 1);
    const expectedCoordinate = PilgrimageGeo.wgs84ToGcj02(POINTS[1].geo);
    assert.ok(Math.abs(openedLocations[0].latitude - expectedCoordinate.latitude) < 1e-10);
    assert.ok(Math.abs(openedLocations[0].longitude - expectedCoordinate.longitude) < 1e-10);
    assert.strictEqual(openedLocations[0].scale, PilgrimageConfig.THRESHOLD.MAP_FOCUS_SCALE);
    assert.strictEqual(openedLocations[0].name, '上海路口');
    assert.ok(openedLocations[0].address.includes(SUMMARY.cn));
    page.onUnload();
  });
}

async function testDetailZeroPointsSkipsPointsRequest() {
  let summaryCalls = 0;
  let pointsCalls = 0;
  await withPage(DETAIL_PAGE, {
    wx: baseWx(),
    patches: [
      [PilgrimageApi, 'getSubjectSummary', async () => {
        summaryCalls += 1;
        return { ok: true, data: Object.assign({}, SUMMARY, { pointsLength: 0 }) };
      }],
      [PilgrimageApi, 'getSubjectPoints', async () => {
        pointsCalls += 1;
        throw new Error('摘要明确为零时不应请求地点接口');
      }],
    ],
  }, async (page) => {
    page.onLoad({
      bgmSubjectId: String(SUMMARY.id),
      pointId: 'station',
      sourceId: '14360',
      name: encodeURIComponent(SUMMARY.cn),
    });
    await waitUntil('详情页进入零地点空态', () => page.data.state === 'empty');
    assert.strictEqual(summaryCalls, 1);
    assert.strictEqual(pointsCalls, 0);
    assert.strictEqual(page.data.stateMessage, PilgrimageConfig.COPY.EMPTY.NO_POINTS);
    page.onUnload();
  });
}

const TESTS = [
  ['搜索页缺映射导航空态参数', testSearchUnmappedNavigation],
  ['搜索输入变化清理旧结果并阻止过期详情导航', testSearchInputInvalidatesPendingDetail],
  ['搜索页收藏删除成功与失败反馈', testSearchFavoriteRemovalFeedback],
  ['搜索页收藏与最近浏览去重且封面失败互不污染', testSearchSavedSubjectDedupeAndCoverErrors],
  ['搜索页输入上限、无障碍语义与许可文案', testSearchAccessibilityMarkupAndLicenseCopy],
  ['巡礼页面窄屏布局与图片失败标记', testPilgrimageResponsiveImageMarkup],
  ['巡礼功能不申请用户位置权限', testPilgrimageDoesNotRequestUserLocation],
  ['地图页成功加载、筛选与选点', testMapReadyInteractions],
  ['地图页摘要0点直接空态', testMapZeroSummarySkipsPoints],
  ['地图页数量不倒挂并钳制缩放', testMapCountAndZoomNormalization],
  ['地图页无坐标地点自动用列表', testMapPointsWithoutCoordinatesUseList],
  ['地图页无映射不请求 API', testMapUnmappedSkipsApi],
  ['详情页地点选择、同集切换与导航坐标', testDetailSelectionAndNavigation],
  ['详情页摘要零地点时直接空态且不请求地点接口', testDetailZeroPointsSkipsPointsRequest],
];

async function run() {
  const failures = [];
  let passed = 0;
  for (const [name, test] of TESTS) {
    try {
      await test();
      passed += 1;
    } catch (error) {
      failures.push(`  ❌ ${name}\n     ${error && error.stack ? error.stack : error}`);
    }
  }

  console.log('\n圣地巡礼页面测试');
  console.log('─'.repeat(40));
  if (failures.length) {
    console.log(failures.join('\n'));
    console.log('─'.repeat(40));
  }
  console.log(`通过 ${passed} / 失败 ${failures.length}`);
  process.exitCode = failures.length ? 1 : 0;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
