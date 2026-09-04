/**
 * config.js — 圣地巡礼前端配置层
 *
 * 页面文案、云函数动作名、页面路径、Storage key 与规则阈值都集中在这里。
 * 纯逻辑模块只消费这些配置，不在实现中散落业务字面量与魔法数字。
 */

const CLOUD_FUNCTION = 'pilgrimageData';

const ACTION = Object.freeze({
  GET_SUBJECT_SUMMARY: 'getSubjectSummary',
  GET_SUBJECT_POINTS: 'getSubjectPoints',
});

const PAGE_PATH = Object.freeze({
  SEARCH: '/packageFeatures/pages/pilgrimage/pilgrimage-search',
  MAP: '/packageFeatures/pages/pilgrimage/pilgrimage-map',
  SPOT_DETAIL: '/packageFeatures/pages/pilgrimage/spot-detail',
});

const STORAGE_KEY = Object.freeze({
  FAVORITE_SUBJECTS: 'otakumap:pilgrimage:favorite-subjects',
  RECENT_SUBJECTS: 'otakumap:pilgrimage:recent-subjects',
});

const STORAGE_VERSION = 1;

const STORAGE_LIMIT = Object.freeze({
  FAVORITE_SUBJECTS: 50,
  RECENT_SUBJECTS: 20,
});

const THRESHOLD = Object.freeze({
  SEARCH_KEYWORD_MAX: 40,
  SAME_EPISODE_POINTS_MAX: 20,
  MARKER_ID_START: 1,
  MAP_MIN_SCALE: 3,
  MAP_MAX_SCALE: 20,
  MAP_DEFAULT_SCALE: 5,
  MAP_FOCUS_SCALE: 16,
  MARKER_WIDTH_PX: 32,
  MARKER_HEIGHT_PX: 40,
});

const ASSET = Object.freeze({
  MAP_MARKER: '/packageFeatures/assets/pilgrimage/marker.png',
});

const EPISODE = Object.freeze({
  ALL_KEY: '__all__',
  UNKNOWN_KEY: 'other',
  NUMERIC_PREFIX: 'episode:',
  SPECIAL_PREFIX: 'special:',
  // episodeKey 由云端归一；这里仅识别常见空值别名，让残缺缓存仍能安全降级。
  UNKNOWN_ALIASES: Object.freeze(['', 'null', 'unknown', 'other', '__other__']),
});

const ERR_CODE = Object.freeze({
  INVALID_PARAM: 'ERR_INVALID_PARAM',
  FUNCTION_TIMEOUT: 'ERR_FUNCTION_TIMEOUT',
  UPSTREAM_UNAVAILABLE: 'ERR_UPSTREAM_UNAVAILABLE',
  NO_DATA: 'ERR_NO_DATA',
  UPSTREAM_TIMEOUT: 'ERR_UPSTREAM_TIMEOUT',
  UPSTREAM_FORBIDDEN: 'ERR_UPSTREAM_FORBIDDEN',
  UPSTREAM_HTTP: 'ERR_UPSTREAM_HTTP',
  UPSTREAM_NON_JSON: 'ERR_UPSTREAM_NON_JSON',
  UPSTREAM_NETWORK: 'ERR_UPSTREAM_NETWORK',
  UPSTREAM_RESPONSE_TOO_LARGE: 'ERR_UPSTREAM_RESPONSE_TOO_LARGE',
  SUBJECT_UNMAPPED: 'ERR_SUBJECT_UNMAPPED',
  SUBJECT_NOT_FOUND: 'ERR_SUBJECT_NOT_FOUND',
  INTERNAL: 'ERR_INTERNAL',
});

const ERR_MESSAGES = Object.freeze({
  ERR_INVALID_PARAM: '番剧信息不完整，请重新选择',
  ERR_FUNCTION_TIMEOUT: '巡礼数据加载超时，请稍后重试',
  ERR_UPSTREAM_UNAVAILABLE: '巡礼数据服务暂时不可用，请稍后重试',
  ERR_NO_DATA: 'Anitabi 暂未收录这部作品的巡礼信息',
  ERR_UPSTREAM_TIMEOUT: 'Anitabi 响应超时，请稍后重试',
  ERR_UPSTREAM_FORBIDDEN: 'Anitabi 暂时拒绝访问，请稍后重试',
  ERR_UPSTREAM_HTTP: 'Anitabi 服务暂时异常，请稍后重试',
  ERR_UPSTREAM_NON_JSON: '巡礼数据格式暂时异常，请稍后重试',
  ERR_UPSTREAM_NETWORK: '无法连接 Anitabi，请检查网络后重试',
  ERR_UPSTREAM_RESPONSE_TOO_LARGE: '巡礼地点过多，暂时无法加载',
  ERR_SUBJECT_UNMAPPED: '这部番暂未关联巡礼数据',
  ERR_SUBJECT_NOT_FOUND: 'Anitabi 暂未收录这部作品的巡礼信息',
  ERR_INTERNAL: '出了点小问题，请稍后重试',
  DEFAULT: '巡礼数据加载失败，请稍后重试',
});

const COPY = Object.freeze({
  PAGE_TITLE: Object.freeze({
    SEARCH: '圣地巡礼',
    MAP: '巡礼地图',
    SPOT_DETAIL: '地点详情',
  }),
  SEARCH: Object.freeze({
    PLACEHOLDER: '搜索番剧或地点',
    NO_RESULT: '没有找到匹配的地点',
  }),
  EMPTY: Object.freeze({
    NO_MAPPING: '这部番暂未关联巡礼数据',
    NO_POINTS: 'Anitabi 暂未收录这部作品的巡礼地点',
    NO_FAVORITES: '还没有收藏巡礼番剧',
    NO_RECENTS: '还没有最近浏览记录',
  }),
  ACTION: Object.freeze({
    RETRY: '重新加载',
    FAVORITE: '收藏',
    UNFAVORITE: '取消收藏',
    VIEW_MAP: '查看地图',
  }),
  ALL_EPISODES: '全部',
  UNKNOWN_EPISODE: '其他',
  EPISODE_PREFIX: '第',
  EPISODE_SUFFIX: '集',
  UNNAMED_SPOT: '未命名地点',
  META_SEPARATOR: ' · ',
  NETWORK_ERROR: '网络错误',
  MALFORMED_RESPONSE: '返回格式异常',
  SEARCH_PAGE: Object.freeze({
    HERO_TITLE: '从动画出发，去见真实的风景',
    HERO_SUBTITLE: '搜索作品，发现取景地与镜头里的城市',
    SEARCH_PLACEHOLDER: '输入番名，如 葬送的芙莉莲',
    SEARCH_ACTION: '搜索',
    FAVORITES_TITLE: '我的收藏',
    FAVORITES_CAPTION: '保存在本机的巡礼番剧',
    RECENTS_TITLE: '最近浏览',
    RECENTS_CAPTION: '继续上一次的旅程',
    RESULT_TITLE: '搜索结果',
    RESULT_CAPTION: '选择作品后查询巡礼地点',
    DISCOVER_TITLE: '发现圣地',
    DISCOVER_CAPTION: '从一部喜欢的动画开始',
    CACHE_LABEL: '已使用缓存',
    SEARCHING: '正在搜索番剧…',
    INITIAL_TITLE: '搜索一部动画',
    INITIAL_DESC: '选中作品后，我们会自动查找已公开的圣地巡礼地点',
    EP_SUFFIX: '集',
    RESULT_ACTION_HINT: '查看巡礼地点',
    DATA_SOURCE_NOTE: '作品信息来自弹弹play · 巡礼数据来自 Anitabi（CC BY-NC-SA 4.0）',
    NO_RESULT: '没有找到匹配的番剧，换个关键词试试',
    SPOT_COUNT: (count) => `${count} 个地点`,
    SEARCH_ARIA_LABEL: '搜索巡礼番剧',
    OPEN_SUBJECT_ARIA_LABEL: (name) => `查看${name || '这部番剧'}的巡礼地点`,
    REMOVE_FAVORITE_ARIA_LABEL: (name) => `取消收藏${name || '这部番剧'}`,
    REMOVE_FAVORITE_SUCCESS: '已取消收藏',
    REMOVE_FAVORITE_FAIL: '取消收藏失败，请稍后重试',
  }),
  MAP_PAGE: Object.freeze({
    LOADING: '正在加载巡礼地图…',
    BACK_SEARCH: '返回搜索',
    RETRY: '重新加载',
    PLACE_SEARCH_PLACEHOLDER: '搜索地点、集数或来源',
    VIEW_SWITCH_LABEL: '切换地图或列表视图',
    MAP_TAB: '地图',
    LIST_TAB: '列表',
    COPY_FULL_MAP: '复制完整地图链接',
    NO_PLACE_RESULT: '当前筛选下没有匹配地点',
    RESET_FILTER: '清除筛选',
    FIT_ALL: '查看全部',
    VIEW_DETAIL: '详情',
    MAP_TIP: '点击地图标记查看地点摘要',
    DATA_SOURCE_NOTE: '巡礼地点来自 Anitabi · CC BY-NC-SA 4.0，现场请遵守当地规则',
    FAVORITED: '已收藏到本机',
    UNFAVORITED: '已取消收藏',
    FAVORITE_FAIL: '收藏保存失败，请稍后重试',
    COPY_SUCCESS: '完整地图链接已复制',
    COPY_FAIL: '复制失败，请稍后重试',
    COUNT: (count) => `${count} 处巡礼地点`,
    FILTER_COUNT: (count) => `当前 ${count} 处`,
    PARTIAL_COUNT: (returned, total) => `可浏览 ${returned} 处 · Anitabi 共 ${total} 处`,
    TRUNCATED_COUNT: (returned) => `当前展示 ${returned} 处 · 更多见 Anitabi`,
  }),
  DETAIL_PAGE: Object.freeze({
    LOADING: '正在加载地点详情…',
    RETRY: '重新加载',
    BACK_MAP: '返回地图',
    NO_IMAGE: '这个地点暂时没有参考图',
    IMAGE_UNAVAILABLE: '参考图暂时无法加载',
    PREVIEW_IMAGE: '查看大图',
    PREVIEW_FAIL: '图片预览失败，请稍后重试',
    SOURCE_LABEL: '图片与地点来源',
    SOURCE_FALLBACK: 'Anitabi 社区贡献',
    COPY_SOURCE: '复制来源链接',
    COPY_SUCCESS: '来源链接已复制',
    COPY_FAIL: '复制失败，请稍后重试',
    OPEN_NAVIGATION: '打开微信地图导航',
    NAVIGATION_UNAVAILABLE: '这个地点缺少可用坐标',
    NAVIGATION_FAIL: '暂时无法打开地图',
    ETIQUETTE_TITLE: '巡礼礼仪',
    ETIQUETTE_TEXT: '请遵守现场规则，不进入私人区域，不影响当地居民与正常营业。',
    SAME_EPISODE_TITLE: '同集更多地点',
    DATA_SOURCE_NOTE: '地点与参考图来自 Anitabi · CC BY-NC-SA 4.0 · 请尊重原作者署名与许可',
    POINT_NOT_FOUND: '没有找到这个巡礼地点',
    COORDINATE_UNKNOWN: '坐标暂缺',
    COORDINATE: (latitude, longitude) => `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
  }),
});

const URL = Object.freeze({
  anitabiSubjectMap(bgmSubjectId) {
    const id = Number(bgmSubjectId);
    return Number.isSafeInteger(id) && id > 0
      ? `https://anitabi.cn/map?bangumiId=${id}`
      : '';
  },
});

const MAP = Object.freeze({
  // 摘要无中心点时回退到日本中部；正常作品优先使用 summary.center / summary.zoom。
  DEFAULT_CENTER: Object.freeze({ latitude: 36.2048, longitude: 138.2529 }),
});

// GCJ-02 只应用于中国大陆。经典矩形判断会把京都等日本西部误判在范围内，
// 因而额外排除与中国经纬度矩形重叠的日本、韩国、台湾区域。
const GCJ02 = Object.freeze({
  MAINLAND_BOUNDS: Object.freeze({
    MIN_LATITUDE: 0.8293,
    MAX_LATITUDE: 55.8271,
    MIN_LONGITUDE: 72.004,
    MAX_LONGITUDE: 137.8347,
  }),
  EXCLUDED_BOUNDS: Object.freeze([
    Object.freeze({ minLatitude: 24, maxLatitude: 31.5, minLongitude: 122.2, maxLongitude: 132 }),
    Object.freeze({ minLatitude: 30, maxLatitude: 38.8, minLongitude: 128, maxLongitude: 137.8347 }),
    Object.freeze({ minLatitude: 33, maxLatitude: 39.6, minLongitude: 125.5, maxLongitude: 131 }),
    Object.freeze({ minLatitude: 21.5, maxLatitude: 25.6, minLongitude: 119, maxLongitude: 122.2 }),
  ]),
  SEMI_MAJOR_AXIS: 6378245,
  ECCENTRICITY_SQUARED: 0.00669342162296594323,
});

module.exports = {
  CLOUD_FUNCTION,
  ACTION,
  PAGE_PATH,
  STORAGE_KEY,
  STORAGE_VERSION,
  STORAGE_LIMIT,
  THRESHOLD,
  ASSET,
  EPISODE,
  ERR_CODE,
  ERR_MESSAGES,
  COPY,
  URL,
  MAP,
  GCJ02,
};
