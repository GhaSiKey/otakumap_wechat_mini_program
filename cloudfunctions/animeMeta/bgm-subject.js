/**
 * 从弹弹play详情中的 Bangumi 页面链接提取 bgm.tv subject ID。
 *
 * 弹弹play的 bangumiId 是其自有“作品 ID（新）”，不是 Bangumi.tv subject ID，
 * 因此这里只信任官方详情返回的页面 URL，不读取 bangumiId，也不按标题猜测映射。
 */
const SUBJECT_HOSTS = new Set(['bgm.tv', 'bangumi.tv']);
const SUBJECT_PATH_RE = /^\/subject\/([1-9]\d*)$/;

function normalizeBgmSubjectId(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// 只接受完整、无查询参数/锚点的 canonical 页面地址。
// 手工拆分 authority 与 path，避免 URL 解析器把 /foo/../subject/1 归一后误判为合法。
function parseBgmSubjectId(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const value = rawUrl.trim();
  const schemeEnd = value.indexOf('://');
  if (schemeEnd <= 0) return null;

  const scheme = value.slice(0, schemeEnd).toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return null;

  const remainder = value.slice(schemeEnd + 3);
  const pathStart = remainder.indexOf('/');
  if (pathStart <= 0) return null;

  // authority 必须就是两个官方域名之一；端口、凭证、子域名和伪后缀都会被拒绝。
  const host = remainder.slice(0, pathStart).toLowerCase();
  if (!SUBJECT_HOSTS.has(host)) return null;

  const path = remainder.slice(pathStart);
  const match = SUBJECT_PATH_RE.exec(path);
  if (!match) return null;

  return normalizeBgmSubjectId(Number(match[1]));
}

function extractBgmSubjectId(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;

  const candidates = [];
  const direct = parseBgmSubjectId(detail.bangumiUrl);
  if (direct !== null) candidates.push(direct);

  if (Array.isArray(detail.onlineDatabases)) {
    for (const database of detail.onlineDatabases) {
      const fallback = parseBgmSubjectId(database && database.url);
      if (fallback !== null) candidates.push(fallback);
    }
  }

  // 多个来源若给出不同 subject，宁可空态也不能把一部作品导向另一部作品。
  // 重复指向同一 ID 则视为一致证据。
  const distinct = Array.from(new Set(candidates));
  return distinct.length === 1 ? distinct[0] : null;
}

module.exports = {
  normalizeBgmSubjectId,
  parseBgmSubjectId,
  extractBgmSubjectId,
};
