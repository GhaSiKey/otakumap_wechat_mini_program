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
      {
        id: 'worldcup',
        title: '世界杯赔率',
        desc: '2026 FIFA 世界杯赔率、赛程与赛事详情',
        emoji: '🏆',
        path: '/packageFeatures/pages/worldcup/worldcup',
      },
      {
        id: 'shared-board',
        title: '共享追番板',
        desc: '和 TA 共享一份番单，一起追番、同步进度',
        emoji: '👫',
        path: '/packageFeatures/pages/shared-board/board-list',
      },
      // 弹弹play 番剧搜索已接入共享板加番/补绑流程（搜索页 pick 模式），
      // 首页验收入口已撤除；anime-search（normal 模式）+ anime-detail 页面代码保留，
      // 未来做「番剧图鉴/独立检索」可直接复用。
    ],
  },

  onNavigate(e) {
    const { path } = e.currentTarget.dataset;
    wx.navigateTo({ url: path });
  },
});
