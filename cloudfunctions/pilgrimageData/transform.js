const { LIMIT } = require('./constants');

function parsePositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegativeInteger(value, fallback) {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function text(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, maxLength || LIMIT.TEXT_MAX);
}

function httpUrl(value) {
  const candidate = text(value, LIMIT.URL_MAX);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return candidate;
  } catch (e) {
    return '';
  }
}

// 官方开放 API 文档只声明 https://image.anitabi.cn 为图片 API。图片会被小程序
// 直接加载，因此只接受该精确 HTTPS 主机；originURL 仍使用上面的通用 httpUrl，
// 以保留 Google Maps 等第三方署名来源链接。
function trustedImageUrl(value) {
  const candidate = text(value, LIMIT.URL_MAX);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    const allowed = parsed.protocol === 'https:'
      && parsed.hostname === 'image.anitabi.cn'
      && parsed.port === ''
      && !parsed.username
      && !parsed.password;
    return allowed ? candidate : '';
  } catch (e) {
    return '';
  }
}

// 部分旧数据或第三方导入可能把 image 包在对象/数组里；只读出可信图片 URL，不请求它。
function imageUrl(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = imageUrl(item);
      if (candidate) return candidate;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    return imageUrl(value.url || value.src || value.image || value.thumbnail || '');
  }
  return trustedImageUrl(value);
}

// 保持协议、域名、路径和其他 query 原样，仅把明确的 plan=h160 改为 h360。
function previewImageUrl(value) {
  const thumbnail = imageUrl(value);
  if (!thumbnail) return '';
  return thumbnail.replace(/([?&]plan=)h160(?=(&|#|$))/i, '$1h360');
}

function coordinatePair(value) {
  let latitude;
  let longitude;

  if (Array.isArray(value)) {
    [latitude, longitude] = value;
  } else if (value && typeof value === 'object') {
    latitude = value.latitude !== undefined ? value.latitude : value.lat;
    longitude = value.longitude !== undefined
      ? value.longitude
      : (value.lng !== undefined ? value.lng : value.lon);
  } else if (typeof value === 'string') {
    const parts = value.trim().split(/[,，\s]+/).filter(Boolean);
    if (parts.length >= 2) [latitude, longitude] = parts;
  }

  const lat = finiteNumber(latitude);
  const lng = finiteNumber(longitude);
  return {
    latitude: lat !== null && lat >= -90 && lat <= 90 ? lat : null,
    longitude: lng !== null && lng >= -180 && lng <= 180 ? lng : null,
  };
}

function scalar(value, keys) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of keys || []) {
    if (value[key] !== undefined) return scalar(value[key], keys);
  }
  return null;
}

function canonicalNumericText(value) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return '';
  return String(parsed);
}

function normalizeEpisode(value) {
  const rawValue = scalar(value, ['value', 'episode', 'ep']);
  const epRaw = typeof rawValue === 'number'
    ? (Number.isFinite(rawValue) ? rawValue : null)
    : (typeof rawValue === 'string' ? rawValue.slice(0, LIMIT.EPISODE_MAX) : null);
  const normalized = epRaw === null ? '' : String(epRaw).trim();

  if (!normalized || /^(null|undefined|unknown|-)$/i.test(normalized)) {
    return { epRaw, episodeKey: 'other', episodeLabel: '其他' };
  }

  const numeric = canonicalNumericText(normalized);
  if (numeric) {
    return {
      epRaw,
      episodeKey: `episode:${numeric}`,
      episodeLabel: `第${numeric}集`,
    };
  }

  return {
    epRaw,
    episodeKey: `special:${normalized.toLowerCase()}`,
    episodeLabel: normalized,
  };
}

function parseSeconds(value) {
  const raw = scalar(value, ['seconds', 'second', 'value', 'time', 's']);
  const direct = finiteNumber(raw);
  if (direct !== null && direct >= 0) return Math.floor(direct);
  if (typeof raw !== 'string') return null;

  const normalized = raw.trim().replace(/：/g, ':');
  if (!/^\d+:\d{1,2}(?::\d{1,2})?$/.test(normalized)) return null;
  const parts = normalized.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts[parts.length - 1] >= 60) return null;
  if (parts.length === 3 && parts[1] >= 60) return null;
  return parts.length === 2
    ? parts[0] * 60 + parts[1]
    : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function formatTime(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return '';
  const sec = seconds % 60;
  const totalMinutes = Math.floor(seconds / 60);
  const min = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (number) => String(number).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(min)}:${pad(sec)}` : `${pad(totalMinutes)}:${pad(sec)}`;
}

function normalizePoint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = text(raw.id, LIMIT.POINT_ID_MAX);
  if (!id) return null;
  const episode = normalizeEpisode(raw.ep);
  const seconds = parseSeconds(raw.s);
  const imageThumb = imageUrl(raw.image);
  const point = {
    id,
    cn: text(raw.cn, LIMIT.TEXT_MAX),
    name: text(raw.name, LIMIT.TEXT_MAX),
    imageThumb,
    imagePreview: previewImageUrl(imageThumb),
    epRaw: episode.epRaw,
    episodeKey: episode.episodeKey,
    episodeLabel: episode.episodeLabel,
    seconds,
    timeLabel: formatTime(seconds),
    geo: coordinatePair(raw.geo),
    origin: text(raw.origin, LIMIT.ORIGIN_MAX),
    originUrl: httpUrl(raw.originURL !== undefined ? raw.originURL : raw.originUrl),
  };

  return point;
}

function collectNormalizedPoints(rawPoints, maxCount, scanAll) {
  if (!Array.isArray(rawPoints)) return { points: [], uniqueCount: 0 };
  const limit = Math.max(0, Math.min(maxCount, LIMIT.POINTS_MAX));
  const points = [];
  const seenIds = new Set();
  for (const raw of rawPoints) {
    const point = normalizePoint(raw);
    if (!point || seenIds.has(point.id)) continue;
    seenIds.add(point.id);
    if (points.length < limit) points.push(point);
    if (!scanAll && points.length >= limit) break;
  }
  return { points, uniqueCount: seenIds.size };
}

function normalizePoints(rawPoints, maxCount) {
  return collectNormalizedPoints(rawPoints, maxCount, false).points;
}

function buildSummaryDto(raw, requestedSubjectId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = parsePositiveInteger(raw.id);
  if (id === null || id !== requestedSubjectId) return null;

  return {
    id,
    cn: text(raw.cn, LIMIT.TEXT_MAX),
    title: text(raw.title, LIMIT.TEXT_MAX),
    city: text(raw.city, LIMIT.TEXT_MAX),
    cover: imageUrl(raw.cover),
    color: text(raw.color, 32),
    center: coordinatePair(raw.geo),
    zoom: finiteNumber(raw.zoom),
    modified: nonNegativeInteger(raw.modified, null),
    // 缺失时保留 null；0 只代表上游明确声明为 0，不能把“未知总数”误报为完整。
    pointsLength: nonNegativeInteger(raw.pointsLength, null),
    imagesLength: nonNegativeInteger(raw.imagesLength, 0),
    previewPoints: normalizePoints(raw.litePoints, LIMIT.PREVIEW_POINTS_MAX),
  };
}

function buildPointsDto(raw, requestedSubjectId) {
  // 当前公开端点直接返回数组；兼容未来仅增加一层 points 包装的非破坏性变化。
  const source = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.points) ? raw.points : null);
  if (!source || source.length === 0) return null;
  const normalized = collectNormalizedPoints(source, LIMIT.POINTS_MAX, true);
  const points = normalized.points;
  if (points.length === 0) return null;
  return {
    subjectId: requestedSubjectId,
    points,
    returnedCount: points.length,
    sourceCount: source.length,
    truncated: normalized.uniqueCount > points.length,
  };
}

module.exports = {
  parsePositiveInteger,
  imageUrl,
  previewImageUrl,
  coordinatePair,
  normalizeEpisode,
  parseSeconds,
  formatTime,
  normalizePoint,
  normalizePoints,
  buildSummaryDto,
  buildPointsDto,
};
