/**
 * storage.js — 巡礼番剧收藏与最近浏览
 *
 * Storage 使用带 version 的信封；读时去重、写时限量。createPilgrimageStorage 可注入
 * { get, set, remove } 或微信 getStorageSync/setStorageSync/removeStorageSync 适配器，
 * 方便纯 Node 测试，不把 wx 依赖带进数据规则。
 */

const C = require('./config');

function positiveInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function subjectIdOf(subjectOrId) {
  if (subjectOrId && typeof subjectOrId === 'object') {
    return positiveInteger(subjectOrId.bgmSubjectId != null ? subjectOrId.bgmSubjectId : subjectOrId.id);
  }
  return positiveInteger(subjectOrId);
}

function normalizeSubject(subject, timestampField, fallbackTimestamp) {
  if (!subject || typeof subject !== 'object') return null;
  const bgmSubjectId = subjectIdOf(subject);
  if (!bgmSubjectId) return null;
  const cn = cleanText(subject.cn);
  const title = cleanText(subject.title);
  const name = cleanText(subject.name) || cn || title;
  const existingTimestamp = subject[timestampField];
  const timestamp = typeof existingTimestamp === 'number' && Number.isFinite(existingTimestamp)
    ? existingTimestamp
    : fallbackTimestamp;
  const normalized = {
    bgmSubjectId,
    name,
    cn,
    title,
    cover: cleanText(subject.cover),
    city: cleanText(subject.city),
    pointsLength: nonNegativeInteger(subject.pointsLength),
    imagesLength: nonNegativeInteger(subject.imagesLength),
    [timestampField]: timestamp,
  };
  const sourceId = positiveInteger(subject.sourceId);
  if (sourceId) normalized.sourceId = sourceId;
  return normalized;
}

function normalizeAdapter(adapter) {
  const source = adapter || {};
  const get = typeof source.get === 'function'
    ? (key) => source.get(key)
    : typeof source.getStorageSync === 'function'
      ? (key) => source.getStorageSync(key)
      : () => undefined;
  const set = typeof source.set === 'function'
    ? (key, value) => source.set(key, value)
    : typeof source.setStorageSync === 'function'
      ? (key, value) => source.setStorageSync(key, value)
      : () => false;
  const remove = typeof source.remove === 'function'
    ? (key) => source.remove(key)
    : typeof source.removeStorageSync === 'function'
      ? (key) => source.removeStorageSync(key)
      : () => false;
  return { get, set, remove };
}

function parseStoredValue(value) {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

function createPilgrimageStorage(adapter, options) {
  const storage = normalizeAdapter(adapter);
  const settings = options || {};
  const now = typeof settings.now === 'function' ? settings.now : Date.now;

  function readItems(key, timestampField, limit) {
    let envelope;
    try {
      envelope = parseStoredValue(storage.get(key));
    } catch (e) {
      return [];
    }
    if (!envelope || envelope.version !== C.STORAGE_VERSION || !Array.isArray(envelope.items)) return [];

    const seen = new Set();
    const result = [];
    for (const raw of envelope.items) {
      const item = normalizeSubject(raw, timestampField, 0);
      if (!item || seen.has(item.bgmSubjectId)) continue;
      seen.add(item.bgmSubjectId);
      result.push(item);
      if (result.length >= limit) break;
    }
    return result;
  }

  function writeItems(key, items) {
    try {
      return storage.set(key, { version: C.STORAGE_VERSION, items }) !== false;
    } catch (e) {
      return false;
    }
  }

  function clearItems(key) {
    try {
      return storage.remove(key) !== false;
    } catch (e) {
      return false;
    }
  }

  function getFavoriteSubjects() {
    return readItems(
      C.STORAGE_KEY.FAVORITE_SUBJECTS,
      'savedAt',
      C.STORAGE_LIMIT.FAVORITE_SUBJECTS
    );
  }

  function isFavoriteSubject(subjectOrId) {
    const id = subjectIdOf(subjectOrId);
    return !!id && getFavoriteSubjects().some((item) => item.bgmSubjectId === id);
  }

  function saveFavoriteSubject(subject) {
    const before = getFavoriteSubjects();
    const item = normalizeSubject(subject, 'savedAt', now());
    if (!item) return before;
    // 主动再次收藏视为置顶，但保留首次收藏时间，避免“查看”悄悄改收藏日期。
    const existing = before.find((entry) => entry.bgmSubjectId === item.bgmSubjectId);
    if (existing) item.savedAt = existing.savedAt;
    const next = [item, ...before.filter((entry) => entry.bgmSubjectId !== item.bgmSubjectId)]
      .slice(0, C.STORAGE_LIMIT.FAVORITE_SUBJECTS);
    return writeItems(C.STORAGE_KEY.FAVORITE_SUBJECTS, next) ? next : before;
  }

  function removeFavoriteSubject(subjectOrId) {
    const before = getFavoriteSubjects();
    const id = subjectIdOf(subjectOrId);
    if (!id) return before;
    const next = before.filter((entry) => entry.bgmSubjectId !== id);
    if (next.length === before.length) return before;
    return writeItems(C.STORAGE_KEY.FAVORITE_SUBJECTS, next) ? next : before;
  }

  function toggleFavoriteSubject(subject) {
    const id = subjectIdOf(subject);
    if (!id) return { ok: false, isFavorite: false, items: getFavoriteSubjects() };
    if (isFavoriteSubject(id)) {
      const items = removeFavoriteSubject(id);
      const isFavorite = items.some((item) => item.bgmSubjectId === id);
      return { ok: !isFavorite, isFavorite, items };
    }
    const items = saveFavoriteSubject(subject);
    const isFavorite = items.some((item) => item.bgmSubjectId === id);
    return { ok: isFavorite, isFavorite, items };
  }

  function getRecentSubjects() {
    return readItems(
      C.STORAGE_KEY.RECENT_SUBJECTS,
      'viewedAt',
      C.STORAGE_LIMIT.RECENT_SUBJECTS
    );
  }

  function recordRecentSubject(subject) {
    const before = getRecentSubjects();
    const viewedAt = now();
    const item = normalizeSubject(subject, 'viewedAt', viewedAt);
    if (!item) return before;
    // 最近浏览每次都更新时间并移到最前，同一番永远只保留一条。
    item.viewedAt = viewedAt;
    const next = [item, ...before.filter((entry) => entry.bgmSubjectId !== item.bgmSubjectId)]
      .slice(0, C.STORAGE_LIMIT.RECENT_SUBJECTS);
    return writeItems(C.STORAGE_KEY.RECENT_SUBJECTS, next) ? next : before;
  }

  function clearRecentSubjects() {
    return clearItems(C.STORAGE_KEY.RECENT_SUBJECTS);
  }

  return {
    getFavoriteSubjects,
    isFavoriteSubject,
    saveFavoriteSubject,
    removeFavoriteSubject,
    toggleFavoriteSubject,
    getRecentSubjects,
    recordRecentSubject,
    clearRecentSubjects,
  };
}

// 延迟读取全局 wx：Node require 本模块不会报错，页面调用时才访问小程序 Storage。
const runtimeAdapter = {
  getStorageSync(key) {
    return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function'
      ? wx.getStorageSync(key)
      : undefined;
  },
  setStorageSync(key, value) {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') throw new Error('Storage unavailable');
    return wx.setStorageSync(key, value);
  },
  removeStorageSync(key) {
    if (typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') throw new Error('Storage unavailable');
    return wx.removeStorageSync(key);
  },
};

const defaultStorage = createPilgrimageStorage(runtimeAdapter);

module.exports = {
  subjectIdOf,
  normalizeSubject,
  createPilgrimageStorage,
  defaultStorage,
  getFavoriteSubjects: (...args) => defaultStorage.getFavoriteSubjects(...args),
  isFavoriteSubject: (...args) => defaultStorage.isFavoriteSubject(...args),
  saveFavoriteSubject: (...args) => defaultStorage.saveFavoriteSubject(...args),
  removeFavoriteSubject: (...args) => defaultStorage.removeFavoriteSubject(...args),
  toggleFavoriteSubject: (...args) => defaultStorage.toggleFavoriteSubject(...args),
  getRecentSubjects: (...args) => defaultStorage.getRecentSubjects(...args),
  recordRecentSubject: (...args) => defaultStorage.recordRecentSubject(...args),
  clearRecentSubjects: (...args) => defaultStorage.clearRecentSubjects(...args),
};
