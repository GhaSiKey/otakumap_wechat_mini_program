// 云函数：getMyOpenid
//
// 职责：返回调用者的 openid（微信为「用户×小程序」签发的唯一身份 ID）。
// openid 由微信在云端上下文注入，客户端无法伪造，是后续「区分你 vs TA」的可信身份来源。
//
// 类比 Android：相当于一个只读的后端接口 GET /me/id，从可信的服务端会话里取当前用户 ID。

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }); // 自动使用当前所在云环境，不硬编码环境 ID

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();
  // 统一返回信封 { ok, code, data }，与其余云函数一致，前端封装才能通吃
  return {
    ok: true,
    code: 'OK',
    data: {
      openid: OPENID, // 当前调用者身份
      appid: APPID,
      unionid: UNIONID, // 通常为空（未绑定开放平台时）
    },
  };
};
