const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../miniprogram/packageFeatures/utils/shared-board/ranking');

assert.strictEqual(R.RANKING_POSTER_CONFIG.scale, 2);
assert.ok(R.RANKING_POSTER_CONFIG.footerTitle.includes('OtakuMap'));
assert.strictEqual(Object.prototype.hasOwnProperty.call(R.RANKING_TIERS[0], 'note'), false);
assert.ok(R.RANKING_UI_CONFIG.dragHitSlop > 0);
assert.ok(R.RANKING_UI_CONFIG.scrollHintThreshold > 0);

const source = [
  { _id: 'a', name: '葬送的芙莉莲', cover: 'https://example.com/a.jpg' },
  { _id: 'b', name: '孤独摇滚', cover: '' },
  { _id: 'deleted', name: '已删除', deleted: true },
];
const saved = [{ id: 'a', tierId: 'hang' }, { id: 'missing', tierId: 'la' }];
const items = R.normalizeItems(source, saved);
assert.deepStrictEqual(items.map((item) => item.id), ['a', 'b']);
assert.strictEqual(items[0].tierId, 'hang');
assert.strictEqual(items[1].tierId, null);
assert.strictEqual(R.moveItem(items, 'b', 'top')[1].tierId, 'top');
assert.strictEqual(R.moveItem(items, 'b', null)[1].tierId, null);
assert.strictEqual(R.getTierItems(items, 'hang').length, 1);
assert.deepStrictEqual(R.deserialize(R.serialize(items)).map((item) => item.id), ['a', 'b']);

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
const pages = app.subpackages.find((item) => item.root === 'packageFeatures').pages;
assert.ok(pages.includes('pages/shared-board/ranking'), '共享板排行页应注册到功能分包');
assert.ok(fs.existsSync(path.join(__dirname, '../miniprogram/packageFeatures/pages/shared-board/ranking.wxml')));
assert.ok(fs.existsSync(path.join(__dirname, '../miniprogram/packageFeatures/pages/shared-board/ranking.wxss')));
const rankingPage = fs.readFileSync(path.join(__dirname, '../miniprogram/packageFeatures/pages/shared-board/ranking.js'), 'utf8');
const rankingWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/packageFeatures/pages/shared-board/ranking.wxml'), 'utf8');
assert.ok(rankingPage.includes('snapshotTiers.reduce'), '导出只应读取已入榜档位的封面');
assert.ok(rankingPage.includes('canvas.width = CANVAS_WIDTH * POSTER.scale'), '导出应使用高清实际画布');
assert.ok(rankingPage.includes('footerTitle') && rankingPage.includes('footerCopy'), '导出图应包含品牌推广文案');
assert.ok(rankingPage.includes('rankedCount') && rankingPage.includes('selectedTierLabel'), '排行页应提供进度和当前档位状态');
assert.ok(rankingPage.includes('dragHitSlop') && rankingPage.includes('onDragCancel'), '拖动应限制命中范围并支持取消');
assert.ok(rankingWxml.includes('pool-card--over') && rankingWxml.includes('picker-option--selected'), '排行页应提供拖回待排和当前档位反馈');
assert.ok(rankingWxml.includes('scroll-x="{{!dragItemId}}"') && rankingWxml.includes('左右滑动'), '横向列表应在拖动时锁定并提供滑动提示');
console.log('shared-board ranking tests: passed');
