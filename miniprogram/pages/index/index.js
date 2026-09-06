// pages/index/index.js
// 首页插画使用透明 PNG：部分微信开发者工具版本的本地资源白名单不包含 WebP。

const FEATURES = [
  {
    id: 'lenticular',
    title: '光栅卡',
    desc: '选择多张图片，体验光栅卡效果',
    tone: 'blue',
    layout: 'grid',
    motion: 1,
    image: '/pages/index/assets/lenticular.png',
    path: '/packageFeatures/pages/lenticular/lenticular-edit',
  },
  {
    id: 'anime-checklist',
    title: '番剧追踪',
    desc: '记录追番清单，标记观看进度',
    tone: 'coral',
    layout: 'grid',
    motion: 2,
    image: '/pages/index/assets/anime-tracker.png',
    path: '/packageFeatures/pages/anime-checklist/anime-checklist',
  },
  {
    id: 'pilgrimage',
    title: '圣地巡礼',
    desc: '搜索动画取景地，收藏巡礼地点',
    tone: 'yellow',
    layout: 'grid',
    motion: 3,
    image: '/pages/index/assets/pilgrimage.png',
    path: '/packageFeatures/pages/pilgrimage/pilgrimage-search',
  },
  {
    id: 'mahjong-score',
    title: '日麻点数计算',
    desc: '输入手牌，计算符数与点数',
    tone: 'mint',
    layout: 'grid',
    motion: 4,
    image: '/pages/index/assets/mahjong.png',
    path: '/packageFeatures/pages/mahjong-score/mahjong-score',
  },
  {
    id: 'shared-board',
    title: '共享追番板',
    desc: '和 TA 共享番单，一起追番同步进度',
    tone: 'blue',
    layout: 'wide',
    motion: 5,
    image: '/pages/index/assets/shared-board.png',
    path: '/packageFeatures/pages/shared-board/board-list',
  },
  // 弹弹play 番剧搜索已接入共享板加番/补绑流程（搜索页 pick 模式），
  // 首页验收入口已撤除；anime-search（normal 模式）+ anime-detail 页面代码保留，
  // 未来做「番剧图鉴/独立检索」可直接复用。世界杯页仍保留在分包中，方便旧链接访问，
  // 但不再作为首页入口展示。
];

const GRID_FEATURES = FEATURES.slice(0, 4);
const WIDE_FEATURES = FEATURES.slice(4);

function getViewportInfo() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo();
    }
    if (typeof wx !== 'undefined' && typeof wx.getSystemInfoSync === 'function') {
      return wx.getSystemInfoSync();
    }
  } catch (error) {
    // 低版本基础库或测试环境没有窗口信息时，交给 CSS 默认尺寸处理。
  }
  return {};
}

const DEFAULT_STATUS_BAR_HEIGHT = 20;
const DEFAULT_MENU_TOP_GAP = 8;
const DEFAULT_MENU_HEIGHT = 32;

function getMenuButtonInfo() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getMenuButtonBoundingClientRect === 'function') {
      const rect = wx.getMenuButtonBoundingClientRect();
      const top = Number(rect && rect.top);
      const height = Number(rect && rect.height);
      if (Number.isFinite(top) && top >= 0 && Number.isFinite(height) && height > 0) {
        return rect;
      }
    }
  } catch (error) {
    // 自定义导航栏信息获取失败时使用兼容默认值，避免首页内容被顶到胶囊下方。
  }
  return null;
}

function getNavigationMetrics(info, menuRect) {
  const rawStatusBarHeight = Number(info && info.statusBarHeight);
  const statusBarHeight = Number.isFinite(rawStatusBarHeight) && rawStatusBarHeight >= 0
    ? rawStatusBarHeight
    : DEFAULT_STATUS_BAR_HEIGHT;
  const menu = menuRect || getMenuButtonInfo();
  const menuTop = Number(menu && menu.top);
  const menuHeight = Number(menu && menu.height);

  if (!Number.isFinite(menuTop) || menuTop < statusBarHeight
    || !Number.isFinite(menuHeight) || menuHeight <= 0) {
    const titleTop = statusBarHeight + DEFAULT_MENU_TOP_GAP;
    const navHeight = statusBarHeight + DEFAULT_MENU_HEIGHT + DEFAULT_MENU_TOP_GAP * 2;
    return {
      statusBarHeight,
      navHeight,
      titleTop,
      titleHeight: DEFAULT_MENU_HEIGHT,
    };
  }

  // 胶囊上下留白保持一致，导航栏高度覆盖状态栏、胶囊和下方安全间距。
  const menuTopGap = Math.max(4, menuTop - statusBarHeight);
  return {
    statusBarHeight,
    navHeight: statusBarHeight + menuHeight + menuTopGap * 2,
    titleTop: menuTop,
    titleHeight: menuHeight,
  };
}

function getViewportClass(height, navHeight) {
  const contentHeight = Math.max(0, height - Math.max(0, Number(navHeight) || 0));
  if (contentHeight <= 620) return 'page--tiny';
  if (contentHeight <= 760) return 'page--compact';
  return '';
}

function getViewportStyle(height, navHeight) {
  const styles = [];
  if (height > 0) styles.push(`height:${Math.round(height)}px;`);
  if (navHeight > 0) {
    const roundedNavHeight = Math.round(navHeight);
    styles.push(`padding-top:${roundedNavHeight}px;`);
    styles.push(`--index-navbar-height:${roundedNavHeight}px;`);
  }
  return styles.join('');
}

function getNavbarStyle(navHeight) {
  return navHeight > 0 ? `height:${Math.round(navHeight)}px;` : '';
}

function getNavbarTitleStyle(metrics) {
  if (!metrics || metrics.titleHeight <= 0) return '';
  const top = Math.round(metrics.titleTop);
  const height = Math.round(metrics.titleHeight);
  return `top:${top}px;height:${height}px;line-height:${height}px;`;
}

const INITIAL_VIEWPORT_INFO = getViewportInfo();
const INITIAL_VIEWPORT_HEIGHT = Number(INITIAL_VIEWPORT_INFO.windowHeight);
const INITIAL_VIEWPORT_HEIGHT_VALID = Number.isFinite(INITIAL_VIEWPORT_HEIGHT)
  && INITIAL_VIEWPORT_HEIGHT > 0;
const INITIAL_NAVIGATION = getNavigationMetrics(INITIAL_VIEWPORT_INFO);

Page({
  data: {
    features: FEATURES,
    gridFeatures: GRID_FEATURES,
    wideFeatures: WIDE_FEATURES,
    wordmark: '/pages/index/assets/otakumap-wordmark.png',
    // 首帧就带上窗口尺寸，避免短屏先按默认布局绘制一帧再跳动。
    viewportClass: INITIAL_VIEWPORT_HEIGHT_VALID
      ? getViewportClass(INITIAL_VIEWPORT_HEIGHT, INITIAL_NAVIGATION.navHeight)
      : '',
    viewportStyle: getViewportStyle(
      INITIAL_VIEWPORT_HEIGHT_VALID ? INITIAL_VIEWPORT_HEIGHT : 0,
      INITIAL_NAVIGATION.navHeight
    ),
    navbarStyle: getNavbarStyle(INITIAL_NAVIGATION.navHeight),
    navbarTitleStyle: getNavbarTitleStyle(INITIAL_NAVIGATION),
    navbarHeight: INITIAL_NAVIGATION.navHeight,
  },

  onLoad() {
    this._syncViewport();
  },

  onShow() {
    // 横竖屏切换或系统窗口尺寸变化后重新计算，避免恢复页面时出现滚动层。
    this._syncViewport();
  },

  _syncViewport() {
    const info = getViewportInfo();
    const height = Number(info.windowHeight);
    if (!Number.isFinite(height) || height <= 0) return;

    const navigation = getNavigationMetrics(info);
    const viewportClass = getViewportClass(height, navigation.navHeight);
    const viewportStyle = getViewportStyle(height, navigation.navHeight);
    const navbarStyle = getNavbarStyle(navigation.navHeight);
    const navbarTitleStyle = getNavbarTitleStyle(navigation);
    if (this.data.viewportClass === viewportClass
      && this.data.viewportStyle === viewportStyle
      && this.data.navbarStyle === navbarStyle
      && this.data.navbarTitleStyle === navbarTitleStyle) return;
    this.setData({
      viewportClass,
      viewportStyle,
      navbarStyle,
      navbarTitleStyle,
      navbarHeight: navigation.navHeight,
    });
  },

  onNavigate(e) {
    const path = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.path;
    if (!path) return;
    wx.navigateTo({ url: path });
  },

  onAssetLoad(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.assetId;
    if (id) console.info('[index] asset loaded', id);
  },

  onAssetError(e) {
    const target = e.currentTarget || {};
    const dataset = target.dataset || {};
    console.warn('[index] asset load failed', {
      id: dataset.assetId || '',
      src: dataset.src || '',
      error: e.detail && e.detail.errMsg ? e.detail.errMsg : 'unknown',
    });
  },
});
