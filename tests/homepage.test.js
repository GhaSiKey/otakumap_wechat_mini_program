/**
 * 首页入口回归测试。
 *
 * 首页属于主包，测试重点是入口数量、路由和本地素材引用，避免把已下线的
 * 世界杯入口或分包路径误带回首屏；动效装饰素材也必须显式纳入主包。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf8')
);

const pagePath = require.resolve('../miniprogram/pages/index/index.js');
const previousPage = global.Page;
const previousWx = global.wx;
let definition;
let navigatedTo = null;
let viewportHeight = 720;

try {
  global.Page = (page) => {
    definition = page;
  };
  global.wx = {
    navigateTo(options) {
      navigatedTo = options;
    },
    getWindowInfo() {
      return { windowHeight: viewportHeight };
    },
    getMenuButtonBoundingClientRect() {
      return { top: 26, height: 32, bottom: 58, left: 280, right: 368 };
    },
  };
  delete require.cache[pagePath];
  require(pagePath);

  assert.ok(definition, '首页应注册 Page');
  const pageContext = {
    data: Object.assign({}, definition.data),
    _syncViewport: definition._syncViewport,
    setData(next) {
      Object.assign(this.data, next);
    },
  };
  definition.onLoad.call(pageContext);
  assert.strictEqual(pageContext.data.viewportClass, 'page--compact', '短屏应切换紧凑布局');
  assert.strictEqual(
    pageContext.data.viewportStyle,
    'height:720px;padding-top:64px;--index-navbar-height:64px;',
    '应按窗口高度和自定义导航栏高度锁定页面尺寸'
  );
  viewportHeight = 600;
  definition.onShow.call(pageContext);
  assert.strictEqual(pageContext.data.viewportClass, 'page--tiny', '更短屏应切换超紧凑布局');
  viewportHeight = 720;
  assert.strictEqual(definition.data.gridFeatures.length, 4, '首页应有四张双列工具卡');
  assert.strictEqual(definition.data.wideFeatures.length, 1, '首页应有一张共享板横向卡');
  assert.deepStrictEqual(
    definition.data.gridFeatures.map((item) => item.id),
    ['lenticular', 'anime-checklist', 'pilgrimage', 'mahjong-score']
  );
  assert.deepStrictEqual(definition.data.wideFeatures.map((item) => item.id), ['shared-board']);
  assert.ok(
    definition.data.features.every((item) => item.id !== 'worldcup'),
    '世界杯不应再作为首页入口'
  );

  definition.onNavigate({ currentTarget: { dataset: { path: '/demo' } } });
  assert.deepStrictEqual(navigatedTo, { url: '/demo' }, '卡片点击应沿用 navigateTo');
  navigatedTo = null;
  definition.onNavigate({ currentTarget: { dataset: {} } });
  assert.strictEqual(navigatedTo, null, '缺少路由时不应发起导航');

  const wxmlPath = path.join(__dirname, '../miniprogram/pages/index/index.wxml');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const pageConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.json'), 'utf8')
  );
  assert.strictEqual(pageConfig.navigationStyle, 'custom', '首页应使用透明自定义导航栏');
  assert.ok(wxml.includes('index-navbar__title'), '首页应保留自绘导航标题');
  assert.ok(wxml.includes('feature-media'), '入口卡应保留图片区域');
  assert.ok(wxml.includes('feature-title'), '入口卡应保留标题');
  assert.ok(wxml.includes('feature-desc'), '入口卡应保留说明');
  assert.ok(wxml.includes('feature-arrow__chevron'), '入口卡应保留圆形跳转按钮');
  assert.ok(wxml.includes('feature-card__motion'), '入口卡应有独立动效内层，避免覆盖按压缩放');
  assert.ok(!wxml.includes('worldcup'), '首页模板不应出现世界杯入口');
  assert.ok(!wxml.includes('feature-dots'), '首页不应包含三点装饰');
  assert.ok(!wxml.includes('lazy-load'), '首页静态插画不应依赖懒加载');
  assert.ok(!wxml.includes('.webp'), '首页本地素材不能使用 DevTools 不纳入白名单的 WebP');
  [
    'otakumap-wordmark.png',
    'lenticular.png',
    'anime-tracker.png',
    'pilgrimage.png',
    'mahjong.png',
    'shared-board.png',
    'header-paper-banner.png',
  ].forEach((filename) => {
    assert.ok(wxml.includes(`/pages/index/assets/${filename}`), `WXML 应静态声明 ${filename}`);
  });

  const wxssPath = path.join(__dirname, '../miniprogram/pages/index/index.wxss');
  const wxss = fs.readFileSync(wxssPath, 'utf8');
  assert.ok(/^page\s*\{[\s\S]*overflow:\s*hidden/m.test(wxss), '页面根节点应关闭滚动');
  assert.ok(
    /@media\s*\(prefers-color-scheme:\s*dark\)[\s\S]*page,\s*\.page\s*\{[\s\S]*background-color:\s*#181818/m.test(wxss),
    '夜间首页背景应与小程序深色导航栏保持一致'
  );
  assert.ok(wxss.includes('.page.page--compact'), '短屏应提供紧凑布局');
  assert.ok(wxss.includes('.page.page--tiny'), '超短屏应提供超紧凑布局');
  assert.ok(
    /\.header-ambient\s*\{[\s\S]*height:\s*calc\(500rpx\s*\+\s*var\(--index-navbar-height/.test(wxss),
    '标题背景应连续覆盖导航栏和大字标区域'
  );

  const assetDir = path.join(__dirname, '../miniprogram/pages/index/assets');
  definition.data.features.forEach((item) => {
    const assetPath = path.join(assetDir, path.basename(item.image));
    assert.ok(fs.existsSync(assetPath), `${item.id} 本地插画素材应存在`);
    assert.ok(
      fs.statSync(assetPath).size <= 200 * 1024,
      `${item.id} 素材应控制在 200 KB 以内`
    );
  });
  const wordmarkPath = path.join(assetDir, 'otakumap-wordmark.png');
  assert.ok(fs.existsSync(wordmarkPath), '品牌字标素材应存在');
  assert.ok(fs.statSync(wordmarkPath).size <= 200 * 1024, '品牌字标素材应控制在 200 KB 以内');
  const headerBannerPath = path.join(assetDir, 'header-paper-banner.png');
  assert.ok(fs.existsSync(headerBannerPath), '顶部连续背景素材应存在');
  assert.ok(fs.statSync(headerBannerPath).size <= 200 * 1024, '顶部连续背景素材应控制在 200 KB 以内');
  const expectedAssetFiles = [
    'otakumap-wordmark.png',
    'lenticular.png',
    'anime-tracker.png',
    'pilgrimage.png',
    'mahjong.png',
    'shared-board.png',
    'header-paper-banner.png',
  ].map((filename) => `pages/index/assets/${filename}`);
  const includedAssetFiles = projectConfig.packOptions.include
    .filter((entry) => entry.type === 'file' && entry.value.startsWith('pages/index/assets/'))
    .map((entry) => entry.value);
  assert.deepStrictEqual(
    includedAssetFiles.sort(),
    expectedAssetFiles.sort(),
    '首页应逐文件纳入 PNG 素材，避免目录规则误带入旧 WebP'
  );
  assert.ok(
    !projectConfig.packOptions.include.some(
      (entry) => entry.type === 'folder' && entry.value === 'pages/index/assets'
    ),
    '首页素材不应使用目录级 include 规则'
  );
  assert.ok(
    !projectConfig.packOptions.include.some(
      (entry) => /pages\/index\/assets\/.*\.webp$/i.test(entry.value || '')
    ),
    '预览/上传包不应显式纳入 WebP 素材'
  );
  assert.ok(wxss.includes('@keyframes indexStickerLeft'), '顶部左侧贴纸应有循环抖动');
  assert.ok(wxss.includes('@keyframes indexStickerRight'), '顶部右侧贴纸应有循环抖动');
  assert.ok(wxss.includes('@keyframes indexSparkTwinkle'), '顶部星星应有呼吸闪烁');
  assert.ok(wxss.includes('@keyframes indexCardRiseIn'), '入口卡片应有上浮入场动效');
  assert.ok(wxss.includes('.feature-card--enter-5'), '共享追番板应有独立入场节奏');
  assert.ok(
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*feature-card__motion[\s\S]*animation:\s*none/m.test(wxss),
    '首页应尊重系统减少动态偏好'
  );

  console.log('\n首页入口回归测试');
  console.log('─'.repeat(40));
  console.log('入口结构、路由和本地素材检查通过');
} finally {
  delete require.cache[pagePath];
  if (previousPage === undefined) delete global.Page;
  else global.Page = previousPage;
  if (previousWx === undefined) delete global.wx;
  else global.wx = previousWx;
}
