const { ACTION, CACHE, ERR } = require('./constants');
const { PilgrimageError, isPilgrimageError } = require('./errors');
const { parsePositiveInteger, buildSummaryDto, buildPointsDto } = require('./transform');

const ok = (data, code) => ({ ok: true, code: code || ERR.OK, data });
const fail = (code, message) => ({ ok: false, code, data: null, msg: message || code });

const STALE_ON_ERROR_CODES = new Set([
  ERR.UPSTREAM_TIMEOUT,
  ERR.UPSTREAM_FORBIDDEN,
  ERR.UPSTREAM_HTTP,
  ERR.UPSTREAM_NON_JSON,
  ERR.UPSTREAM_NETWORK,
  ERR.UPSTREAM_RESPONSE_TOO_LARGE,
]);

function actionConfig(action) {
  if (action === ACTION.GET_SUBJECT_SUMMARY) {
    return { cacheKind: CACHE.KIND_SUMMARY, transform: buildSummaryDto };
  }
  if (action === ACTION.GET_SUBJECT_POINTS) {
    return { cacheKind: CACHE.KIND_POINTS, transform: buildPointsDto };
  }
  return null;
}

function hasUniquePointIds(points) {
  if (!Array.isArray(points)) return false;
  const ids = new Set();
  for (const point of points) {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
    const id = typeof point.id === 'string' ? point.id.trim() : '';
    if (!id || id !== point.id || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

function validCachedPayload(action, subjectId, payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (action === ACTION.GET_SUBJECT_SUMMARY) {
    return payload.id === subjectId && hasUniquePointIds(payload.previewPoints);
  }
  return payload.subjectId === subjectId && hasUniquePointIds(payload.points)
    && payload.returnedCount === payload.points.length;
}

function createPilgrimageService(options) {
  const opts = options || {};
  const cache = opts.cache;
  const requestJson = opts.requestJson;
  const logger = opts.logger || console;
  if (!cache || typeof cache.read !== 'function' || typeof cache.write !== 'function') {
    throw new Error('pilgrimageData service 缺少 cache');
  }
  if (typeof requestJson !== 'function') throw new Error('pilgrimageData service 缺少 requestJson');

  async function handle(event) {
    const action = event && event.action;
    const config = actionConfig(action);
    if (!config) return fail(ERR.INVALID_PARAM, `未知 action: ${String(action || '')}`);

    const subjectId = parsePositiveInteger(event && event.bgmSubjectId);
    if (subjectId === null) return fail(ERR.INVALID_PARAM, 'bgmSubjectId 必须是正整数');

    let cached = null;
    try {
      cached = await cache.read(config.cacheKind, String(subjectId));
    } catch (error) {
      // 自定义/替换缓存实现也不能阻断上游。
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[pilgrimageData] 缓存读取异常，继续请求上游');
      }
    }
    if (cached && !validCachedPayload(action, subjectId, cached.payload)) cached = null;
    if (cached && cached.state === 'fresh') return ok(cached.payload);

    try {
      const raw = await requestJson(action, subjectId);
      const data = config.transform(raw, subjectId);
      if (!data) throw new PilgrimageError(ERR.NO_DATA, 'Anitabi 未返回该作品的巡礼数据');

      try {
        await cache.write(config.cacheKind, String(subjectId), data);
      } catch (error) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[pilgrimageData] 缓存写入异常，本次结果仍正常返回');
        }
      }
      return ok(data);
    } catch (error) {
      const normalized = isPilgrimageError(error)
        ? error
        : new PilgrimageError(ERR.INTERNAL, String((error && error.message) || error));
      if (cached && cached.state === 'stale' && STALE_ON_ERROR_CODES.has(normalized.code)) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn('[pilgrimageData] 上游失败，返回过期缓存', {
            action,
            bgmSubjectId: subjectId,
            upstreamCode: normalized.code,
          });
        }
        return ok(cached.payload, ERR.OK_STALE_CACHE);
      }
      if (logger && typeof logger.error === 'function') {
        logger.error('[pilgrimageData] 请求失败', {
          action,
          bgmSubjectId: subjectId,
          code: normalized.code,
          message: normalized.message,
        });
      }
      return fail(normalized.code, normalized.message);
    }
  }

  return { handle };
}

module.exports = {
  ok,
  fail,
  actionConfig,
  validCachedPayload,
  createPilgrimageService,
};
