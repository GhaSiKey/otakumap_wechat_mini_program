/**
 * geo.js — 圣地巡礼坐标纯函数
 *
 * Anitabi 地点坐标按 WGS84 消费；微信地图在中国大陆使用 GCJ-02，故 marker
 * 入图前需转换。境外（尤其日本）必须保持原坐标，否则巡礼点会产生肉眼可见偏移。
 */

const C = require('./config');

function normalizeCoordinate(latitudeOrCoordinate, longitude) {
  const candidate = latitudeOrCoordinate && typeof latitudeOrCoordinate === 'object'
    ? latitudeOrCoordinate
    : { latitude: latitudeOrCoordinate, longitude };
  const latitude = candidate && candidate.latitude;
  const normalizedLongitude = candidate && candidate.longitude;
  if (
    typeof latitude !== 'number'
    || typeof normalizedLongitude !== 'number'
    || !Number.isFinite(latitude)
    || !Number.isFinite(normalizedLongitude)
    || latitude < -90
    || latitude > 90
    || normalizedLongitude < -180
    || normalizedLongitude > 180
  ) {
    return null;
  }
  return { latitude, longitude: normalizedLongitude };
}

function isValidCoordinate(latitudeOrCoordinate, longitude) {
  return !!normalizeCoordinate(latitudeOrCoordinate, longitude);
}

function isWithinBounds(coordinate, bounds) {
  return coordinate.latitude >= bounds.minLatitude
    && coordinate.latitude <= bounds.maxLatitude
    && coordinate.longitude >= bounds.minLongitude
    && coordinate.longitude <= bounds.maxLongitude;
}

/** 是否位于需要 GCJ-02 偏移的中国大陆区域（对重叠的日本/韩国/台湾做排除）。 */
function isInGcj02Region(latitudeOrCoordinate, longitude) {
  const coordinate = normalizeCoordinate(latitudeOrCoordinate, longitude);
  if (!coordinate) return false;
  const bounds = C.GCJ02.MAINLAND_BOUNDS;
  if (
    coordinate.latitude < bounds.MIN_LATITUDE
    || coordinate.latitude > bounds.MAX_LATITUDE
    || coordinate.longitude < bounds.MIN_LONGITUDE
    || coordinate.longitude > bounds.MAX_LONGITUDE
  ) {
    return false;
  }
  return !C.GCJ02.EXCLUDED_BOUNDS.some((excluded) => isWithinBounds(coordinate, excluded));
}

function transformLatitude(x, y) {
  let result = -100 + (2 * x) + (3 * y) + (0.2 * y * y) + (0.1 * x * y) + (0.2 * Math.sqrt(Math.abs(x)));
  result += ((20 * Math.sin(6 * x * Math.PI)) + (20 * Math.sin(2 * x * Math.PI))) * 2 / 3;
  result += ((20 * Math.sin(y * Math.PI)) + (40 * Math.sin(y / 3 * Math.PI))) * 2 / 3;
  result += ((160 * Math.sin(y / 12 * Math.PI)) + (320 * Math.sin(y * Math.PI / 30))) * 2 / 3;
  return result;
}

function transformLongitude(x, y) {
  let result = 300 + x + (2 * y) + (0.1 * x * x) + (0.1 * x * y) + (0.1 * Math.sqrt(Math.abs(x)));
  result += ((20 * Math.sin(6 * x * Math.PI)) + (20 * Math.sin(2 * x * Math.PI))) * 2 / 3;
  result += ((20 * Math.sin(x * Math.PI)) + (40 * Math.sin(x / 3 * Math.PI))) * 2 / 3;
  result += ((150 * Math.sin(x / 12 * Math.PI)) + (300 * Math.sin(x / 30 * Math.PI))) * 2 / 3;
  return result;
}

/** WGS84 → GCJ-02；非法坐标返回 null，境外返回等值的新对象。 */
function wgs84ToGcj02(latitudeOrCoordinate, longitude) {
  const coordinate = normalizeCoordinate(latitudeOrCoordinate, longitude);
  if (!coordinate) return null;
  if (!isInGcj02Region(coordinate)) return { ...coordinate };

  const latitude = coordinate.latitude;
  const normalizedLongitude = coordinate.longitude;
  let deltaLatitude = transformLatitude(normalizedLongitude - 105, latitude - 35);
  let deltaLongitude = transformLongitude(normalizedLongitude - 105, latitude - 35);
  const radLatitude = latitude / 180 * Math.PI;
  let magic = Math.sin(radLatitude);
  magic = 1 - (C.GCJ02.ECCENTRICITY_SQUARED * magic * magic);
  const sqrtMagic = Math.sqrt(magic);
  deltaLatitude = (deltaLatitude * 180) / (
    (C.GCJ02.SEMI_MAJOR_AXIS * (1 - C.GCJ02.ECCENTRICITY_SQUARED))
    / (magic * sqrtMagic)
    * Math.PI
  );
  deltaLongitude = (deltaLongitude * 180) / (
    C.GCJ02.SEMI_MAJOR_AXIS / sqrtMagic * Math.cos(radLatitude) * Math.PI
  );
  return {
    latitude: latitude + deltaLatitude,
    longitude: normalizedLongitude + deltaLongitude,
  };
}

module.exports = {
  normalizeCoordinate,
  isValidCoordinate,
  isInGcj02Region,
  wgs84ToGcj02,
};
