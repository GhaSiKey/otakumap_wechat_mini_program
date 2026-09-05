const assert = require('assert');
const T = require('../miniprogram/packageFeatures/utils/anime-checklist/transform');

const migrated = T.migrateStoredValue([
  { id: 'old-1', name: '旧番', watched: true, createTime: 1 },
  { id: 'old-2', name: '新番', watched: false, createTime: 2, totalEp: 12, currentEp: 3 },
  { id: 'dup', name: '新番', watched: false },
], 100);
assert.strictEqual(migrated.version, 2);
assert.strictEqual(migrated.items.length, 2);
assert.strictEqual(migrated.items[0].status, 'done');
assert.strictEqual(migrated.items[1].currentEp, 3);

const normalized = T.normalizeItem({ name: '测试', sourceId: '123', totalEp: 12, currentEp: 99, airDay: 8 }, 100);
assert.strictEqual(normalized.sourceId, 123);
assert.strictEqual(normalized.currentEp, 12);
assert.strictEqual(normalized.airDay, null);
assert.strictEqual(T.progressPercent(normalized), 100);
assert.strictEqual(T.progressPercent({ ...normalized, status: 'done' }), 100);

console.log('anime-checklist tests: passed');
