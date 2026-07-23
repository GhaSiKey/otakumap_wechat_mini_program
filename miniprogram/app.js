// app.js
const { CLOUD_ENV } = require('./config/cloud');

App({
  onLaunch: function () {
    this.globalData = {
      lenticularData: null, // 光栅卡编辑页 -> 预览页的图片数据传递
    };

    // 初始化云开发（供「共享追番板」使用；其余功能不依赖云，此处失败不影响它们）
    // 类比 Android：相当于 Application.onCreate() 里初始化一个后端 SDK
    if (!wx.cloud) {
      // 基础库过低（<2.2.3）的兜底：不 init，云功能不可用，本地功能照常
      console.warn('[cloud] 当前基础库不支持云开发，共享追番板将不可用');
      return;
    }
    wx.cloud.init({
      env: CLOUD_ENV.DEFAULT,
      traceUser: true, // 在云开发控制台「用户管理」记录访问用户，便于排查
    });
  },
});
