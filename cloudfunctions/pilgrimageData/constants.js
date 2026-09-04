/**
 * pilgrimageData 云函数常量。
 *
 * Anitabi 只作为按已知 Bangumi subject id 查询的上游；本函数不提供标题搜索，
 * 也不接受客户端传入 URL，避免演变成任意 URL 代理。
 */

const ACTION = {
  GET_SUBJECT_SUMMARY: 'getSubjectSummary',
  GET_SUBJECT_POINTS: 'getSubjectPoints',
};

const ANITABI = {
  ORIGIN: 'https://api.anitabi.cn',
  HOSTNAME: 'api.anitabi.cn',
  TIMEOUT_MS: 8000,
  USER_AGENT: 'OtakumapMiniProgram/1.0 (Anitabi public API client)',
};

const CACHE = {
  COLLECTION: 'pilgrimage_cache',
  // 公开数据不是实时交互数据，6 小时新鲜缓存可显著减少对 Anitabi 的重复请求。
  TTL_MS: 6 * 60 * 60 * 1000,
  // 瞬时网络/Cloudflare 故障时最多使用 7 天内的旧数据，不拿旧数据掩盖“无数据”。
  STALE_TTL_MS: 7 * 24 * 60 * 60 * 1000,
  KIND_SUMMARY: 'subject_summary',
  KIND_POINTS: 'subject_points',
};

const LIMIT = {
  PREVIEW_POINTS_MAX: 10,
  POINTS_MAX: 500,
  UPSTREAM_BODY_MAX_BYTES: 2 * 1024 * 1024,
  TEXT_MAX: 300,
  POINT_ID_MAX: 120,
  EPISODE_MAX: 80,
  ORIGIN_MAX: 300,
  URL_MAX: 2048,
};

const ERR = {
  OK: 'OK',
  OK_STALE_CACHE: 'OK_STALE_CACHE',
  INVALID_PARAM: 'ERR_INVALID_PARAM',
  NO_DATA: 'ERR_NO_DATA',
  UPSTREAM_TIMEOUT: 'ERR_UPSTREAM_TIMEOUT',
  UPSTREAM_FORBIDDEN: 'ERR_UPSTREAM_FORBIDDEN',
  UPSTREAM_HTTP: 'ERR_UPSTREAM_HTTP',
  UPSTREAM_NON_JSON: 'ERR_UPSTREAM_NON_JSON',
  UPSTREAM_NETWORK: 'ERR_UPSTREAM_NETWORK',
  UPSTREAM_RESPONSE_TOO_LARGE: 'ERR_UPSTREAM_RESPONSE_TOO_LARGE',
  INTERNAL: 'ERR_INTERNAL',
};

module.exports = { ACTION, ANITABI, CACHE, LIMIT, ERR };
