/**
 * constants.js — animeMeta 云函数常量
 *
 * 职责：集中弹弹play 开放平台的接入配置与本函数的返回信封约定。
 * 密钥（AppId/AppSecret）不在此文件，走云函数环境变量 process.env（见 index.js）。
 *
 * 与 shared-board 的 constants 相互独立：本功能是「番剧元数据查询」，
 * 不涉及共享板的集合/权限，故不复用那份服务端子集。
 */

// ── 弹弹play 开放平台 ──
const DDP = {
  BASE_URL: 'https://api.dandanplay.net',
  // 签名参与计算的 path（不含协议/域名/查询参数），官方要求全小写、不 URL 编码
  PATH_SEARCH: '/api/v2/search/anime',
  PATH_DETAIL: '/api/v2/bangumi', // 详情实际路径为 /api/v2/bangumi/{animeId}
  // 请求头字段名（签名模式）
  HEADER_APPID: 'X-AppId',
  HEADER_TIMESTAMP: 'X-Timestamp',
  HEADER_SIGNATURE: 'X-Signature',
  TIMEOUT_MS: 8000, // 单次请求超时，避免云函数被第三方拖死
};

// ── 缓存 ──
// 弹弹play 要求缓存 2-6h 减少重复请求。搜索结果与详情分别缓存。
const CACHE = {
  COLLECTION: 'anime_meta_cache',
  TTL_MS: 6 * 60 * 60 * 1000, // 6 小时
  KIND_SEARCH: 'search', // 缓存文档区分种类，避免 keyword 与 animeId 撞 key
  KIND_DETAIL: 'detail',
  KIND_COVER_UPGRADE_LOCK: 'cover_upgrade_lock',
};

// 存量 small 封面升级会在 animeMeta 内直接读写共享板集合：复用本函数已有 DDP 凭证与详情缓存，
// 避免新建一个持有同一密钥的云函数。升级是元数据维护，不改 item/board updateTime、不写历史事件。
const COLLECTION = {
  BOARD: 'shared_boards',
  ITEM: 'shared_board_items',
};

// ── 入参约束 / 裁剪上限 ──
const LIMIT = {
  KEYWORD_MAX: 40, // 番名关键词长度上限，超长直接拒（防滥用/无意义查询）
  RESULT_MAX: 20, // 搜索结果最多回传条数（弹弹play 可能返回一堆，截断）
  TAG_MAX: 12, // 详情标签最多回传数（上游可能几十个，截断避免噪音+瘦身返回体）
  RELATED_MAX: 12, // 相关作品最多回传数
  SIMILAR_MAX: 12, // 相似推荐最多回传数
  BOARD_ITEM_SCAN_MAX: 200, // 与 getBoardDetail 当前上限一致
  COVER_UPGRADE_MAX: 8, // 单次最多补 8 张，避免一次进板突发大量上游请求
  COVER_UPGRADE_CONCURRENCY: 3, // 8 条最多三批，兼顾 DDP 配额与 30 秒云函数超时
  COVER_UPGRADE_COOLDOWN_MS: 60 * 1000, // 同一板 60 秒只允许一个升级任务，防多人并发放大 DDP 请求
};

// ── 返回信封（与 shared-board 云函数统一 { ok, code, data }）──
const ERR = {
  OK: 'OK',
  UNAUTHENTICATED: 'ERR_UNAUTHENTICATED',
  INVALID_PARAM: 'ERR_INVALID_PARAM',
  BOARD_NOT_FOUND: 'ERR_BOARD_NOT_FOUND',
  NOT_MEMBER: 'ERR_NOT_MEMBER',
  UPSTREAM_UNAVAILABLE: 'ERR_UPSTREAM_UNAVAILABLE', // 第三方 403/空体/超时/网络错
  UPSTREAM_ERROR: 'ERR_UPSTREAM_ERROR', // 第三方返回 success:false
  MISCONFIGURED: 'ERR_MISCONFIGURED', // 环境变量未配置
  INTERNAL: 'ERR_INTERNAL',
};

module.exports = { DDP, CACHE, COLLECTION, LIMIT, ERR };
