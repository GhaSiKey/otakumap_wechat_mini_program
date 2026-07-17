/**
 * 世界杯赔率页
 *
 * 纯静态展示：数据为打包进分包的快照（worldcup-data.js），不联网、不计算。
 * 所有渲染用的派生结构由 transform.js 预处理（色温/矩阵/分组等），页面只负责状态与交互。
 */
const WC_DATA = require('../../utils/worldcup/data/worldcup-data');
const T = require('../../utils/worldcup/transform');

Page({
  data: {
    meta: null,        // 页头元信息（赔率截止时间、免责声明）
    calendar: null,    // 赛程日历视图模型
    groups: [],        // 按日期分组的卡片列表
    calView: 'strip',  // 日历视图：strip 日期条 / grid 月历

    flashAnchor: '',   // 被点击日历后高亮闪烁的分组锚点
    logoFailed: {},    // 队徽加载失败的 url 集合（url -> true），失败则降级为 emoji
    stripLeft: 0,      // 日期条横向滚动位置（首次进入定位今日居中）
    showBackTop: false, // 下滑一定距离后显示"返回顶部"按钮

    theme: 'blue',     // 当前背景色系（调试切换用）
    themeName: '深蓝黑', // 当前色系中文名（显示在切换按钮上）
  },

  // 可选背景色系：循环切换。key 对应 wxss 的 .theme-{key}
  THEMES: [
    { key: 'blue', name: '深蓝黑' },
    { key: 'green', name: '焰绿球场' },
    { key: 'wine', name: '酒红贵气' },
    { key: 'purple', name: '午夜紫' },
    { key: 'black', name: '黑金厄丽特' },
  ],

  onLoad() {
    const page = T.buildPageModel(WC_DATA);
    this.setData({
      meta: page.meta,
      calendar: page.calendar,
      groups: page.groups,
    }, () => {
      // 默认把"今天"那一格滚到日期条水平正中
      if (this.data.calView === 'strip') this._centerStripToday();
    });
  },

  // ── 日历 ──

  /** 切换日历两版视图。 */
  onSwitchCalView(e) {
    const cv = e.currentTarget.dataset.cv;
    if (cv === this.data.calView) return;
    this.setData({ calView: cv }, () => {
      if (cv === 'strip') this._centerStripToday();
    });
  },

  /** 把"今天"那一格滚到日期条水平正中；今天不在赛程内则不滚动。
   *  宽度已正常，用 selectorQuery 测量后精确计算 scroll-left。 */
  _centerStripToday() {
    if (!this.data.calendar) return;
    const idx = this.data.calendar.strip.findIndex((c) => c.isToday);
    if (idx < 0) return;
    setTimeout(() => {
      const q = wx.createSelectorQuery().in(this);
      q.select('.cal-strip').boundingClientRect();
      q.selectAll('.cal-cell').boundingClientRect();
      q.exec((res) => {
        const strip = res[0];
        const cells = res[1];
        if (!strip || !cells || !cells[idx]) return;
        const cell = cells[idx];
        // 今日格中心相对内容起点的偏移 - 可视区一半 = 居中所需 scrollLeft
        const cellCenterInContent = (cell.left - strip.left) + cell.width / 2;
        const left = cellCenterInContent - strip.width / 2;
        this.setData({ stripLeft: Math.max(0, Math.round(left)) });
      });
    }, 150);
  },

  /** 点击日历某天：滚动到列表对应分组并高亮；无赔率列表则无反馈数据变化（靠 hasList 控制可点性）。 */
  onTapCalDay(e) {
    const { date, haslist } = e.currentTarget.dataset;
    if (!haslist) {
      // 该天无赔率列表：抖动反馈
      this.setData({ flashAnchor: '' });
      wx.showToast({ title: '该日赔率未开放', icon: 'none', duration: 1200 });
      return;
    }
    this._scrollToDay(date);
  },

  /** 平滑滚动到某日期分组，并触发高亮闪烁。 */
  _scrollToDay(anchor) {
    const query = wx.createSelectorQuery();
    query.select(`#day-${anchor}`).boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const rect = res[0];
      const scroll = res[1];
      if (!rect) return;
      wx.pageScrollTo({
        scrollTop: scroll.scrollTop + rect.top - 16,
        duration: 300,
      });
      this.setData({ flashAnchor: anchor });
      setTimeout(() => {
        if (this.data.flashAnchor === anchor) this.setData({ flashAnchor: '' });
      }, 1500);
    });
  },

  // ── 详情 ──

  /** 打开比赛详情：跳转到独立详情页（天然支持安卓返回键/微信返回/侧滑）。 */
  onOpenDetail(e) {
    const mid = Number(e.currentTarget.dataset.mid);
    wx.navigateTo({ url: `./detail/detail?mid=${mid}` });
  },

  // ── 返回顶部 ──

  /** 页面滚动：超过一屏（约 600rpx）显示返回顶部按钮。 */
  onPageScroll(e) {
    const show = e.scrollTop > 300;
    if (show !== this.data.showBackTop) {
      this.setData({ showBackTop: show });
    }
  },

  /** 点击返回顶部。 */
  onBackTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  /** 循环切换背景色系（调试用）。 */
  onSwitchTheme() {
    const list = this.THEMES;
    const i = list.findIndex((t) => t.key === this.data.theme);
    const next = list[(i + 1) % list.length];
    this.setData({ theme: next.key, themeName: next.name });
  },

  /** 队徽加载失败 -> 记录该 url，wxml 据此降级为占位 emoji。
   *  注意：url 含 "." 和 "/"，不能用 setData({['logoFailed.'+url]:true}) ——
   *  小程序会把它当数据路径拆分。必须整体替换对象，用完整 url 作字面键。 */
  onLogoError(e) {
    const url = e.currentTarget.dataset.url;
    if (!url || this.data.logoFailed[url]) return;
    this.setData({ logoFailed: { ...this.data.logoFailed, [url]: true } });
  },
});
