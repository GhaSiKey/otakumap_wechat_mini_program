/**
 * transform.js — 圣地巡礼地点数据预处理
 *
 * 输入只接受 pilgrimageData 已归一的 Point DTO：
 * { id, cn, name, imageThumb, imagePreview, epRaw, episodeKey,
 *   episodeLabel, seconds, timeLabel, geo:{latitude,longitude}, origin, originUrl }
 * 本层不再猜测 Anitabi 原始 ep/s/geo 结构，避免前后端出现两套契约。
 */

const C = require('./config');
const Geo = require('./geo');

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchText(value) {
  const text = String(value == null ? '' : value).trim();
  const compatible = typeof text.normalize === 'function' ? text.normalize('NFKC') : text;
  return compatible.toLocaleLowerCase().replace(/\s+/g, '');
}

function normalizeSearchKeyword(keyword) {
  return normalizeSearchText(keyword).slice(0, C.THRESHOLD.SEARCH_KEYWORD_MAX);
}

function validPoints(points) {
  return Array.isArray(points) ? points.filter((point) => point && typeof point === 'object') : [];
}

function normalizeEpisodeKey(value) {
  const key = cleanText(value);
  if (C.EPISODE.UNKNOWN_ALIASES.includes(key.toLocaleLowerCase())) return C.EPISODE.UNKNOWN_KEY;
  return key;
}

function episodeKeyOf(point) {
  return normalizeEpisodeKey(point && point.episodeKey);
}

function formatEpisodeFromRaw(epRaw) {
  const raw = String(epRaw == null ? '' : epRaw).trim();
  if (!raw) return '';
  return /^\d+(?:\.\d+)?$/.test(raw)
    ? `${C.COPY.EPISODE_PREFIX}${raw}${C.COPY.EPISODE_SUFFIX}`
    : raw;
}

function episodeLabelOf(point) {
  const label = cleanText(point && point.episodeLabel);
  if (label) return label;
  const key = episodeKeyOf(point);
  if (key === C.EPISODE.UNKNOWN_KEY) return C.COPY.UNKNOWN_EPISODE;
  const rawLabel = formatEpisodeFromRaw(point && point.epRaw);
  if (rawLabel) return rawLabel;
  if (key.startsWith(C.EPISODE.NUMERIC_PREFIX)) {
    return formatEpisodeFromRaw(key.slice(C.EPISODE.NUMERIC_PREFIX.length));
  }
  if (key.startsWith(C.EPISODE.SPECIAL_PREFIX)) {
    return key.slice(C.EPISODE.SPECIAL_PREFIX.length);
  }
  return formatEpisodeFromRaw(key) || C.COPY.UNKNOWN_EPISODE;
}

function secondsOf(point) {
  const value = point && point.seconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function timeLabelOf(point) {
  return cleanText(point && point.timeLabel) || formatSeconds(secondsOf(point));
}

function displayNameOf(point) {
  return cleanText(point && point.cn) || cleanText(point && point.name) || C.COPY.UNNAMED_SPOT;
}

function secondaryNameOf(point) {
  const primary = displayNameOf(point);
  const original = cleanText(point && point.name);
  return original && original !== primary ? original : '';
}

function pointIdOf(point) {
  const id = point && point.id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return cleanText(id);
}

function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function episodeSortMeta(point) {
  const key = episodeKeyOf(point);
  if (key === C.EPISODE.UNKNOWN_KEY) return { rank: 2, number: Number.POSITIVE_INFINITY, key };
  const numericKey = key.startsWith(C.EPISODE.NUMERIC_PREFIX)
    ? key.slice(C.EPISODE.NUMERIC_PREFIX.length)
    : key;
  if (/^\d+(?:\.\d+)?$/.test(numericKey)) return { rank: 0, number: Number(numericKey), key };
  return { rank: 1, number: Number.POSITIVE_INFINITY, key };
}

function comparePoints(a, b) {
  const episodeA = episodeSortMeta(a);
  const episodeB = episodeSortMeta(b);
  if (episodeA.rank !== episodeB.rank) return episodeA.rank - episodeB.rank;
  if (episodeA.rank === 0 && episodeA.number !== episodeB.number) return episodeA.number - episodeB.number;
  if (episodeA.rank === 1) {
    const byEpisode = compareText(episodeLabelOf(a), episodeLabelOf(b));
    if (byEpisode) return byEpisode;
  }

  const secondsA = secondsOf(a);
  const secondsB = secondsOf(b);
  const sortableSecondsA = secondsA == null ? Number.POSITIVE_INFINITY : secondsA;
  const sortableSecondsB = secondsB == null ? Number.POSITIVE_INFINITY : secondsB;
  if (sortableSecondsA !== sortableSecondsB) return sortableSecondsA - sortableSecondsB;

  const byName = compareText(displayNameOf(a), displayNameOf(b));
  if (byName) return byName;
  return compareText(pointIdOf(a), pointIdOf(b));
}

/** 装饰原索引后排序，确保比较字段完全相同时仍保持输入顺序。 */
function sortPoints(points) {
  return validPoints(points)
    .map((point, index) => ({ point, index }))
    .sort((a, b) => comparePoints(a.point, b.point) || (a.index - b.index))
    .map((entry) => entry.point);
}

function pointMatchesKeyword(point, normalizedKeyword) {
  if (!normalizedKeyword) return true;
  const searchable = [
    point && point.cn,
    point && point.name,
    point && point.episodeLabel,
    point && point.origin,
  ].map(normalizeSearchText);
  return searchable.some((text) => text.includes(normalizedKeyword));
}

function searchPoints(points, keyword) {
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  return sortPoints(validPoints(points).filter((point) => pointMatchesKeyword(point, normalizedKeyword)));
}

function filterPointsByEpisode(points, episodeKey) {
  const requestedKey = cleanText(episodeKey) || C.EPISODE.ALL_KEY;
  if (requestedKey === C.EPISODE.ALL_KEY) return sortPoints(points);
  const normalizedKey = normalizeEpisodeKey(requestedKey);
  return sortPoints(validPoints(points).filter((point) => episodeKeyOf(point) === normalizedKey));
}

function deriveVisiblePoints(points, filters) {
  const options = filters || {};
  return filterPointsByEpisode(searchPoints(points, options.keyword), options.episodeKey);
}

function buildEpisodeOptions(points) {
  const sorted = sortPoints(points);
  const buckets = new Map();
  sorted.forEach((point) => {
    const key = episodeKeyOf(point);
    const current = buckets.get(key);
    if (current) {
      current.count += 1;
      return;
    }
    buckets.set(key, { key, label: episodeLabelOf(point), count: 1, isAll: false });
  });
  return [
    { key: C.EPISODE.ALL_KEY, label: C.COPY.ALL_EPISODES, count: sorted.length, isAll: true },
    ...buckets.values(),
  ];
}

function buildMetaLabel(point) {
  return [episodeLabelOf(point), timeLabelOf(point)].filter(Boolean).join(C.COPY.META_SEPARATOR);
}

function buildPointViewModel(point, index) {
  const pointId = pointIdOf(point);
  const coordinate = Geo.normalizeCoordinate(point && point.geo);
  const imageThumb = cleanText(point && point.imageThumb) || cleanText(point && point.imagePreview);
  const imagePreview = cleanText(point && point.imagePreview) || imageThumb;
  return {
    key: `point:${pointId || index}`,
    id: pointId,
    displayName: displayNameOf(point),
    secondaryName: secondaryNameOf(point),
    imageThumb,
    imagePreview,
    hasImage: !!imageThumb,
    epRaw: point && point.epRaw != null ? String(point.epRaw) : '',
    episodeKey: episodeKeyOf(point),
    episodeLabel: episodeLabelOf(point),
    seconds: secondsOf(point),
    timeLabel: timeLabelOf(point),
    metaLabel: buildMetaLabel(point),
    geo: coordinate,
    hasCoordinate: !!coordinate,
    origin: cleanText(point && point.origin),
    originUrl: cleanText(point && point.originUrl),
  };
}

function buildPointList(points, filters) {
  return deriveVisiblePoints(points, filters).map(buildPointViewModel);
}

/**
 * 微信 map marker id 必须是 number。先稳定排序，再从配置起点顺序分配，
 * 因而同一批地点无论原输入顺序如何都不会撞 id。
 */
function buildMarkers(points, filters) {
  const list = buildPointList(points, filters).filter((point) => point.hasCoordinate);
  return list.map((point, index) => {
    const gcj = Geo.wgs84ToGcj02(point.geo);
    return {
      id: C.THRESHOLD.MARKER_ID_START + index,
      latitude: gcj.latitude,
      longitude: gcj.longitude,
      iconPath: C.ASSET.MAP_MARKER,
      width: C.THRESHOLD.MARKER_WIDTH_PX,
      height: C.THRESHOLD.MARKER_HEIGHT_PX,
      anchor: { x: 0.5, y: 1 },
      title: point.displayName,
    };
  });
}

function resolvePoint(points, selected) {
  if (selected && typeof selected === 'object') return selected;
  const selectedId = String(selected == null ? '' : selected);
  return validPoints(points).find((point) => pointIdOf(point) === selectedId) || null;
}

function normalizeSameEpisodeLimit(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return C.THRESHOLD.SAME_EPISODE_POINTS_MAX;
  return Math.min(value, C.THRESHOLD.SAME_EPISODE_POINTS_MAX);
}

/** 返回同集原始 DTO；默认排除当前地点，未知集数不误当作“同一集”。 */
function findSameEpisodePoints(points, selected, options) {
  const current = resolvePoint(points, selected);
  if (!current) return [];
  const episodeKey = episodeKeyOf(current);
  if (episodeKey === C.EPISODE.UNKNOWN_KEY) return [];
  const settings = options || {};
  const currentId = pointIdOf(current);
  const limit = normalizeSameEpisodeLimit(settings.limit);
  return sortPoints(points)
    .filter((point) => episodeKeyOf(point) === episodeKey)
    .filter((point) => settings.includeCurrent || pointIdOf(point) !== currentId)
    .slice(0, limit);
}

function buildSameEpisodePointList(points, selected, options) {
  return findSameEpisodePoints(points, selected, options).map(buildPointViewModel);
}

module.exports = {
  normalizeSearchKeyword,
  normalizeEpisodeKey,
  episodeKeyOf,
  episodeLabelOf,
  timeLabelOf,
  displayNameOf,
  sortPoints,
  searchPoints,
  filterPointsByEpisode,
  deriveVisiblePoints,
  buildEpisodeOptions,
  buildPointViewModel,
  buildPointList,
  buildMarkers,
  findSameEpisodePoints,
  buildSameEpisodePointList,
};
