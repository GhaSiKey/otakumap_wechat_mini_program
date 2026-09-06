/**
 * 番剧追踪数据规则：负责旧数据迁移、字段归一化与进度派生。
 * 纯函数模块，不依赖 wx，页面和 Node 测试都可以复用。
 */

const VERSION = 2;
const STATUSES = ['want', 'watching', 'caught_up', 'paused', 'done', 'dropped'];
const STATUS_LABELS = {
  want: '想看',
  watching: '在追',
  caught_up: '追平待更',
  paused: '暂缓',
  done: '看完',
  dropped: '弃番',
};
const AIR_STATUSES = ['airing', 'finished', 'unknown'];
const TOTAL_EP_MAX = 9999;
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function positiveId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function totalEpOf(value) {
  if (value === null || value === '' || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isInteger(n) && n > 0 && n <= TOTAL_EP_MAX ? n : null;
}

function currentEpOf(value, totalEp) {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(n, totalEp || TOTAL_EP_MAX);
}

function statusOf(item) {
  if (item && STATUSES.includes(item.status)) return item.status;
  return item && item.watched ? 'done' : 'want';
}

function airStatusOf(item) {
  if (item && AIR_STATUSES.includes(item.airStatus)) return item.airStatus;
  if (item && typeof item.isOnAir === 'boolean') return item.isOnAir ? 'airing' : 'finished';
  return 'unknown';
}

function normalizeItem(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name) || text(raw.title);
  if (!name) return null;
  const id = text(raw.id) || `anime_${now}_${Math.random().toString(36).slice(2, 11)}`;
  const totalEp = totalEpOf(raw.totalEp);
  const status = statusOf(raw);
  const currentEp = status === 'done' && raw.currentEp == null
    ? (totalEp || 0)
    : currentEpOf(raw.currentEp == null ? raw.episode : raw.currentEp, totalEp);
  const airDay = Number.isInteger(raw.airDay) && raw.airDay >= 0 && raw.airDay <= 6 ? raw.airDay : null;
  const createTime = Number.isFinite(raw.createTime) ? raw.createTime : now;
  const updateTime = Number.isFinite(raw.updateTime) ? raw.updateTime : createTime;
  return {
    id,
    name,
    initial: name.slice(0, 1),
    sourceId: positiveId(raw.sourceId),
    bgmSubjectId: positiveId(raw.bgmSubjectId),
    cover: text(raw.cover),
    coverError: !!raw.coverError,
    typeDesc: text(raw.typeDesc),
    year: text(raw.year),
    startDate: text(raw.startDate),
    rating: typeof raw.rating === 'number' && Number.isFinite(raw.rating) ? raw.rating : 0,
    totalEp,
    currentEp,
    status,
    // 保留 watched 是为了兼容旧模板和分享数据，状态字段是唯一写入来源。
    watched: status === 'done',
    airStatus: airStatusOf(raw),
    airDay,
    createTime,
    updateTime,
    metaSyncedAt: Number.isFinite(raw.metaSyncedAt) ? raw.metaSyncedAt : 0,
  };
}

function migrateStoredValue(value, now) {
  const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const rawItems = envelope && Array.isArray(envelope.items)
    ? envelope.items
    : Array.isArray(value) ? value : [];
  const seen = new Set();
  const seenNames = new Set();
  const items = [];
  rawItems.forEach((raw) => {
    const item = normalizeItem(raw, now);
    const nameKey = item && item.name.toLowerCase();
    if (!item || seen.has(item.id) || seenNames.has(nameKey)) return;
    seen.add(item.id);
    seenNames.add(nameKey);
    items.push(item);
  });
  return { version: VERSION, items };
}

function progressPercent(item) {
  if (!item) return 0;
  if (item.status === 'done') return 100;
  if (!item.totalEp) return item.currentEp > 0 ? null : 0;
  return Math.min(100, Math.round((item.currentEp / item.totalEp) * 100));
}

function decorateItem(item) {
  const totalEp = totalEpOf(item.totalEp);
  const currentEp = currentEpOf(item.currentEp, totalEp);
  const status = statusOf(item);
  return {
    ...item,
    totalEp,
    currentEp,
    status,
    watched: status === 'done',
    statusLabel: STATUS_LABELS[status] || STATUS_LABELS.want,
    progressPercent: progressPercent({ ...item, totalEp, currentEp, status }),
    progress: progressPercent({ ...item, totalEp, currentEp, status }) || 0,
    initial: Array.from(item.name || '?')[0] || '?',
    coverError: false,
    airLabel: item.airStatus === 'airing' ? '放送中' : item.airStatus === 'finished' ? '已完结' : '',
    airDayLabel: item.airStatus === 'airing' && Number.isInteger(item.airDay)
      ? `每${WEEKDAY_LABELS[item.airDay]}更新`
      : '',
  };
}

function splitLists(items) {
  const list = (items || []).map(decorateItem);
  return {
    animeList: list,
    unwatchedList: list.filter((item) => item.status !== 'done'),
    watchedList: list.filter((item) => item.status === 'done'),
    watchedCount: list.filter((item) => item.status === 'done').length,
    totalCount: list.length,
  };
}

module.exports = {
  VERSION,
  STATUSES,
  STATUS_LABELS,
  TOTAL_EP_MAX,
  positiveId,
  totalEpOf,
  currentEpOf,
  normalizeItem,
  migrateStoredValue,
  decorateItem,
  splitLists,
  progressPercent,
};
