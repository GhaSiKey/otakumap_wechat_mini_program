/**
 * 弹弹play封面层级策略（纯函数，供云函数与 Node 测试复用）。
 *
 * 搜索接口通常返回 small，详情接口通常返回另一个 hash 的 medium。
 * 这里只识别和选择接口原样返回的 URL，绝不通过字符串替换构造大图。
 */
const SMALL_PATH = '/image/poster/small/';
const POSTER_ORIGIN = 'https://assets.anixplayer.net/image/poster';

function normalizeCoverUrl(cover) {
  return typeof cover === 'string' ? cover.trim() : '';
}

function isSearchThumbnailCover(cover) {
  return normalizeCoverUrl(cover).includes(SMALL_PATH);
}

function isValidSourceId(sourceId) {
  return Number.isInteger(sourceId) && sourceId > 0;
}

function isPosterForSource(cover, tier, sourceId) {
  if (!isValidSourceId(sourceId)) return false;
  const url = normalizeCoverUrl(cover);
  const prefix = `${POSTER_ORIGIN}/${tier}/${sourceId}-`;
  if (!url.startsWith(prefix)) return false;
  const file = url.slice(prefix.length).split('?')[0];
  return /^[a-z0-9]+\.(?:jpe?g|png|webp)$/i.test(file);
}

function isSearchThumbnailForSource(cover, sourceId) {
  return isPosterForSource(cover, 'small', sourceId);
}

function isMediumCoverForSource(cover, sourceId) {
  return isPosterForSource(cover, 'medium', sourceId);
}

function needsDetailCover(item) {
  if (!item || !isValidSourceId(item.sourceId)) return false;
  return isSearchThumbnailForSource(item.cover, item.sourceId);
}

function preferDetailCover(currentCover, detailCover) {
  return normalizeCoverUrl(detailCover) || normalizeCoverUrl(currentCover);
}

function selectUpgradeCandidates(items, max) {
  const limit = Number.isInteger(max) && max >= 0 ? max : 0;
  return (Array.isArray(items) ? items : []).filter(needsDetailCover).slice(0, limit);
}

module.exports = {
  SMALL_PATH,
  normalizeCoverUrl,
  isSearchThumbnailCover,
  isValidSourceId,
  isSearchThumbnailForSource,
  isMediumCoverForSource,
  needsDetailCover,
  preferDetailCover,
  selectUpgradeCandidates,
};
