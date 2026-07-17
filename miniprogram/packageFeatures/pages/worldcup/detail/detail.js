/**
 * 比赛详情页
 *
 * 独立页面：由 worldcup 列表页通过 wx.navigateTo 传入 mid 打开。
 * 数据同样来自打包快照 worldcup-data.js，视图模型由 transform.buildDetail 构建。
 * 作为独立页面，天然支持安卓返回键 / 微信返回箭头 / 侧滑返回。
 */
const WC_DATA = require('../../../utils/worldcup/data/worldcup-data');
const T = require('../../../utils/worldcup/transform');

Page({
  data: {
    detail: null,    // 详情视图模型
    logoFailed: {},  // 队徽加载失败的 url 集合（url -> true），失败则降级为 emoji
  },

  onLoad(query) {
    const mid = Number(query.mid);
    const m = WC_DATA.matches.find((x) => x.mid === mid);
    if (!m) {
      wx.showToast({ title: '比赛不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const detail = T.buildDetail(m);
    this.setData({ detail });
    // 导航栏标题改为对阵双方
    if (detail.home && detail.away) {
      wx.setNavigationBarTitle({ title: `${detail.home.name} vs ${detail.away.name}` });
    }
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
