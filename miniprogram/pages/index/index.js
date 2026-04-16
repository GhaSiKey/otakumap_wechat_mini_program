// pages/index/index.js
Page({
  data: {
    features: [
      {
        id: 'lenticular',
        title: '光栅卡',
        desc: '选择多张图片，倾斜手机体验光栅卡切换效果',
        emoji: '🎴',
        path: '/packageFeatures/pages/lenticular/lenticular-edit',
      },
      {
        id: 'anime-checklist',
        title: '番剧追踪',
        desc: '记录你的追番清单，标记已看完的番剧',
        emoji: '📋',
        path: '/packageFeatures/pages/anime-checklist/anime-checklist',
      },
      {
        id: 'mahjong-score',
        title: '日麻点数计算',
        desc: '输入手牌自动计算符数、役种和点数',
        emoji: '🀄',
        path: '/packageFeatures/pages/mahjong-score/mahjong-score',
      },
    ],
  },

  onNavigate(e) {
    const { path } = e.currentTarget.dataset;
    wx.navigateTo({ url: path });
  },
});
