const { CACHE } = require('./constants');

function createCacheStore(db, options) {
  const opts = options || {};
  const now = opts.now || Date.now;
  const logger = opts.logger || console;

  async function read(kind, key) {
    try {
      // collection() 也放进 try：即使 SDK/数据库初始化瞬时异常，仍可降级请求上游。
      const response = await db.collection(CACHE.COLLECTION).doc(`${kind}:${key}`).get();
      const record = response && response.data;
      if (!record || !record.payload || typeof record.expireAt !== 'number') return null;
      const current = now();
      if (record.expireAt > current) return { state: 'fresh', payload: record.payload };
      if (typeof record.staleUntil === 'number' && record.staleUntil > current) {
        return { state: 'stale', payload: record.payload };
      }
    } catch (error) {
      // 未命中与数据库瞬时失败都降级为请求上游，缓存不能成为功能单点。
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[pilgrimageData] 读取缓存失败，继续请求上游', {
          kind,
          message: String((error && error.message) || error),
        });
      }
    }
    return null;
  }

  async function write(kind, key, payload) {
    try {
      const current = now();
      await db.collection(CACHE.COLLECTION).doc(`${kind}:${key}`).set({
        data: {
          kind,
          key: String(key),
          payload,
          updatedAt: current,
          expireAt: current + CACHE.TTL_MS,
          staleUntil: current + CACHE.STALE_TTL_MS,
        },
      });
      return true;
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[pilgrimageData] 写缓存失败，本次结果仍正常返回', {
          kind,
          message: String((error && error.message) || error),
        });
      }
      return false;
    }
  }

  return { read, write };
}

module.exports = { createCacheStore };
