/**
 * config.js — 番剧元数据（弹弹play 接入）前端配置层
 *
 * 职责：集中前端展示相关的文案与语义映射。接口域名/密钥/缓存时长等
 * 服务端配置在云函数 constants.js，不在此处（前端够不着也不该知道密钥）。
 *
 * 禁止硬编码：周几文案、放送状态映射、错误提示、占位文案一律收在此处。
 */

// 云函数返回的错误码 → 用户可读提示（与 cloudfunctions/animeMeta/constants.js 的 ERR 对应）
const ERR_MESSAGES = {
  ERR_INVALID_PARAM: '搜索内容不太对，换个关键词试试',
  ERR_UPSTREAM_UNAVAILABLE: '番剧数据服务暂时不可用，稍后再试',
  ERR_UPSTREAM_ERROR: '没查到这部番，换个名字试试',
  ERR_MISCONFIGURED: '服务未配置好，请联系开发者',
  ERR_INTERNAL: '出了点小问题，稍后再试',
  DEFAULT: '查询失败，稍后再试',
};

// airDay 语义映射：弹弹play 返回 0-6。实测「芙莉莲 airDay:5=周五、命运石之门 airDay:4」，
// 推断为 ISO 星期：0=周日，1-6=周一到周六。若日后发现偏移，只改此表。
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 放送状态展示文案（isOnAir 布尔 → 文案）。留 unknown 兜底（airDay/isOnAir 缺失时）。
const AIR_STATUS_DISPLAY = {
  airing: '连载中',
  finished: '已完结',
  unknown: '放送状态未知',
};

// isOnAir(布尔) → airStatus(三态字符串)。与共享板 AIR_STATUS 语义对齐，便于将来接入加番。
function airStatusOf(isOnAir) {
  if (isOnAir === true) return 'airing';
  if (isOnAir === false) return 'finished';
  return 'unknown';
}

// airDay(0-6) →「每周X更新」文案；非在播或无 airDay 时返回空串（不显示）。
function airDayLabel(airDay, isOnAir) {
  if (!isOnAir) return ''; // 已完结的番不显示「每周几更新」
  if (typeof airDay !== 'number' || airDay < 0 || airDay > 6) return '';
  return `每${WEEKDAY_LABELS[airDay]}更新`;
}

// 首播日期：ISO 串（"2022-10-12T00:00:00"）→「2022年10月12日首播」。
// 非法/空返回空串（不显示）。只信标准 ISO 前缀，不做时区换算（上游已是当地日期）。
function airDateLabel(startDate) {
  if (!startDate || typeof startDate !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${y}年${parseInt(mo, 10)}月${parseInt(d, 10)}日首播`;
}

// 搜索结果空态文案
const EMPTY = {
  INITIAL: '输入番名，找找看',
  NO_RESULT: '没找到这部番，换个名字或简称试试',
  SEARCHING: '搜索中…',
};

// 集数展示：totalEp 为 0（上游无正片集数，如连载新番/剧场版占位）时的兜底文案
const EP_UNKNOWN_LABEL = '集数待定';

// 搜索页交互模式：normal=验收/查看（点条目进详情页）；pick=选择（点条目直接回带来源页）。
// 由来源页 navigateTo 的 query.mode 决定。发起方与搜索页共用此常量，禁两处各写 'pick' 字面量。
const SEARCH_MODE = {
  NORMAL: 'normal',
  PICK: 'pick',
};

// EventChannel 事件名：pick 模式下搜索页选中番剧后，emit 此事件把选中数据回传给来源页。
const PICK_EVENT = 'pickAnime';

// pick 模式（从加番/补绑跳入）的引导文案：告诉用户点条目=选中带回，而非进详情页。
const PICK_COPY = {
  TOP_HINT: '点选一部，自动带回番名·封面·集数',
  ACTION: '选择', // 列表项右侧动作标签（取代 normal 模式的 › 箭头）
};

// 大图预览 URL：当前弹弹play 图源只有 small(141×200) 一个尺寸，无更大原图，
// 故预览用的就是原封面 URL（诚实：全屏是「看得更大 + 可缩放」，非更高清）。
// 留此 helper 是为将来接到有大图变体的图源时，只改此处即可让预览取高清、缩略仍用小图。
function previewCoverUrl(cover) {
  return cover || '';
}

// 详情页分区标题（禁硬编码：标题文案统一收此处）
const SECTION_TITLES = {
  INTRO: '制作信息',
  TAGS: '标签',
  SUMMARY: '简介',
  EPISODES: '分集',
  RELATEDS: '相关作品',
  SIMILARS: '相似推荐',
};

// 详情页分集预览上限：长番（如凡人 100+ 话）不全列，先展示前 N 话 + 折叠提示
const EPISODE_PREVIEW_MAX = 12;

// 分集列表折叠提示文案生成：剩余话数 → 「共 N 话，仅展示前 M 话」
function episodeMoreLabel(total, shown) {
  if (total <= shown) return '';
  return `共 ${total} 个分集条目，仅展示前 ${shown} 话`;
}

module.exports = {
  ERR_MESSAGES,
  WEEKDAY_LABELS,
  AIR_STATUS_DISPLAY,
  airStatusOf,
  airDayLabel,
  airDateLabel,
  EMPTY,
  EP_UNKNOWN_LABEL,
  SEARCH_MODE,
  PICK_EVENT,
  PICK_COPY,
  previewCoverUrl,
  SECTION_TITLES,
  EPISODE_PREVIEW_MAX,
  episodeMoreLabel,
};
