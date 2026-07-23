// 云函数：createBoard —— 创建共享追番板
//
// 建者即 owner 占第一坑，生成一次性配对 token（供分享卡片携带，见 joinBoard）。
// 身份取自可信上下文 OPENID，忽略客户端传入的任何 openid。

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }); // 自动用当前云环境，不硬编码环境 ID
const db = cloud.database();

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });
const genToken = () => 'p_' + crypto.randomBytes(16).toString('hex');

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { name, profile } = event || {};
    const boardName = (typeof name === 'string' && name.trim() ? name.trim() : C.DEFAULT_BOARD_NAME).slice(
      0,
      C.BOARD_NAME_MAX
    );

    const now = db.serverDate();
    const owner = {
      openid: OPENID,
      nickname: (profile && profile.nickname) || '',
      avatar: (profile && profile.avatar) || '',
      role: C.MEMBER_ROLE.OWNER,
      joinAt: now,
    };
    const token = genToken();
    const expireAt = new Date(Date.now() + C.PAIR_TOKEN_TTL_MS);

    const res = await db.collection(C.COLLECTION.BOARD).add({
      data: {
        name: boardName,
        members: [owner],
        memberOpenids: [OPENID],
        status: C.BOARD_STATUS.ACTIVE,
        pairing: { token, expireAt, used: false },
        createTime: now,
        updateTime: now,
      },
    });

    return ok({ boardId: res._id, token });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
