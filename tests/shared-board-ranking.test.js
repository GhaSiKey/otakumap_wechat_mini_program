const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../miniprogram/packageFeatures/utils/shared-board/ranking');
const Model = require('../miniprogram/packageFeatures/utils/hang-to-la/ranking-model');

assert.strictEqual(R, Model, '共享追番板应复用公共从夯到拉模型');

assert.strictEqual(R.RANKING_POSTER_CONFIG.scale, 2);
assert.ok(R.RANKING_POSTER_CONFIG.footerTitle.includes('OtakuMap'));
assert.strictEqual(Object.prototype.hasOwnProperty.call(R.RANKING_TIERS[0], 'note'), false);
assert.ok(R.RANKING_UI_CONFIG.dragHitSlop > 0);
assert.ok(R.RANKING_UI_CONFIG.scrollHintThreshold > 0);

const source = [
  { _id: 'a', name: '葬送的芙莉莲', cover: 'https://example.com/a.jpg' },
  { id: 'b', title: '孤独摇滚', cover: '', coverFallback: { color: '#123456', char: '孤' } },
  { _id: 'deleted', name: '已删除', deleted: true },
];
const saved = [{ id: 'a', tierId: 'hang' }, { id: 'missing', tierId: 'la' }];
const items = R.normalizeItems(source, saved);
assert.deepStrictEqual(items.map((item) => item.id), ['a', 'b']);
assert.strictEqual(items[1].name, '孤独摇滚');
assert.deepStrictEqual(items[1].coverFallback, { color: '#123456', char: '孤' });
assert.strictEqual(items[0].tierId, 'hang');
assert.strictEqual(items[1].tierId, null);
assert.strictEqual(R.moveItem(items, 'b', 'top')[1].tierId, 'top');
assert.strictEqual(R.moveItem(items, 'b', null)[1].tierId, null);
assert.strictEqual(R.getTierItems(items, 'hang').length, 1);
assert.deepStrictEqual(R.deserialize(R.serialize(items)).map((item) => item.id), ['a', 'b']);
assert.strictEqual(R.getRankingStorageKey('shared-board', 'board-a'), 'otakumap:ranking:v1:shared-board:board-a');
assert.strictEqual(R.getRankingStorageKey('anime-checklist', 'local', 'title'), 'otakumap:ranking:v1:anime-checklist:local:title');

const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../miniprogram/app.json'), 'utf8'));
const pages = app.subpackages.find((item) => item.root === 'packageFeatures').pages;
assert.ok(pages.includes('pages/shared-board/ranking'), '共享板排行页应注册到功能分包');
assert.ok(pages.includes('pages/hang-to-la/hang-to-la'), '公共从夯到拉页应注册到功能分包');
assert.ok(app.permission && app.permission['scope.writePhotosAlbum'], '正式版保存排行图应声明相册写入权限');
assert.ok(app.permission['scope.writePhotosAlbum'].desc, '相册写入权限应配置用途说明');
const featuresRoot = path.join(__dirname, '../miniprogram/packageFeatures');
const rankingPage = fs.readFileSync(path.join(featuresRoot, 'pages/hang-to-la/hang-to-la.js'), 'utf8');
const component = fs.readFileSync(path.join(featuresRoot, 'components/hang-to-la-board/hang-to-la-board.js'), 'utf8');
const rankingWxml = fs.readFileSync(path.join(featuresRoot, 'components/hang-to-la-board/hang-to-la-board.wxml'), 'utf8');
const poster = fs.readFileSync(path.join(featuresRoot, 'utils/hang-to-la/poster.js'), 'utf8');
const oldPage = fs.readFileSync(path.join(featuresRoot, 'pages/shared-board/ranking.js'), 'utf8');
const pageConfig = JSON.parse(fs.readFileSync(path.join(featuresRoot, 'pages/hang-to-la/hang-to-la.json'), 'utf8'));
assert.ok(Object.values(pageConfig.usingComponents).some((value) => value.includes('/components/hang-to-la-board/hang-to-la-board')), '公共排行页应注册共用榜单组件');
assert.ok(oldPage.includes('redirectTo') && oldPage.includes('rankingUrl') && oldPage.includes('SOURCES.SHARED_BOARD'), '旧共享板排行地址应兼容跳转到公共页');
assert.ok(rankingPage.includes('snapshotTiers.reduce'), '导出只应读取已入榜档位的封面');
assert.ok(rankingPage.includes('canvas.width = Math.round(CANVAS_WIDTH * scale)'), '导出应使用可降级的高清实际画布');
assert.ok(rankingPage.includes('fallbackScale'), '大画布导出失败时应降级重试');
assert.ok(rankingPage.includes('loadCanvasImages'), '导出封面应限制并发加载');
assert.ok(rankingPage.includes('_ensurePhotoAlbumAuthorization'), '保存前应检查相册权限');
assert.ok(rankingPage.includes('ranking image save failed'), '保存失败应记录正式版诊断信息');
assert.ok(poster.includes('footerTitle') && poster.includes('footerCopy'), '导出图应包含品牌推广文案');
assert.ok(component.includes('rankedCount') && component.includes('selectedTierLabel'), '共用榜单组件应提供进度和当前档位状态');
assert.ok(component.includes('dragHitSlop') && component.includes('onDragCancel'), '拖动应限制命中范围并支持取消');
assert.ok(rankingWxml.includes('pool-card--over') && rankingWxml.includes('picker-option--selected'), '排行页应提供拖回待排和当前档位反馈');
assert.ok(rankingWxml.includes('scroll-x="{{!dragItemId}}"') && rankingWxml.includes('左右滑动'), '横向列表应在拖动时锁定并提供滑动提示');
console.log('shared-board ranking tests: passed');
