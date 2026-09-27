// 兼容已经分享出去的旧入口，排行界面只在公共页面维护一份。
const { rankingUrl, SOURCES } = require('../../utils/hang-to-la/sources');

Page({
  onLoad(query) {
    wx.redirectTo({ url: rankingUrl(SOURCES.SHARED_BOARD, (query && query.boardId) || '') });
  },
});
