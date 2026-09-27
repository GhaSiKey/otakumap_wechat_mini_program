const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

const pageRoot = path.join(__dirname, '../miniprogram/packageFeatures/pages/anime-checklist');
const checklistPage = fs.readFileSync(path.join(pageRoot, 'anime-checklist.js'), 'utf8');
const checklistWxml = fs.readFileSync(path.join(pageRoot, 'anime-checklist.wxml'), 'utf8');
const checklistConfig = require('../miniprogram/packageFeatures/utils/anime-checklist/config');
assert.ok(checklistWxml.includes('bind:tap="onOpenRanking"'), '番剧追踪应提供从夯到拉入口');
assert.ok(checklistWxml.includes('aria-label="{{copy.RANKING_TITLE}}"') && checklistWxml.includes('{{copy.RANKING_TITLE}}'), '入口应使用追踪页配置文案');
assert.ok(checklistConfig.COPY.RANKING_TITLE && checklistConfig.COPY.RANKING_HINT, '排行入口文案应集中在追踪页配置');
assert.ok(checklistPage.includes("wx.getStorageSync(STORAGE_KEY)"), '进入排行前应读取番剧追踪本地清单');
assert.ok(checklistPage.includes("/packageFeatures/pages/hang-to-la/hang-to-la"), '番剧追踪应跳转公共排行页');
assert.ok(checklistPage.includes('source=') && checklistPage.includes('anime-checklist'), '番剧追踪入口应标记数据来源');

console.log('anime-checklist tests: passed');
