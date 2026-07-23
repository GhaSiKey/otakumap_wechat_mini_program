// 云函数：updateMemberProfile —— 更新当前成员在板内的头像昵称快照
//
// 微信头像昵称无法自动读取（getUserProfile 已废弃），由用户主动 chooseAvatar + 填昵称，
// 头像已在前端上传云存储得到 fileID。此函数只改「我」那条 members 的 nickname/avatar，
// 身份取可信 OPENID，绝不允许改别人那条。

const cloud = require('wx-server-sdk');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { boardId, nickname, avatar } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    const boardDoc = (await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null)) || null;
    const board = boardDoc && boardDoc.data;
    if (!board) return fail(C.ERR.BOARD_NOT_FOUND);

    const members = board.members || [];
    const idx = members.findIndex((m) => m && m.openid === OPENID);
    if (idx < 0) return fail(C.ERR.NOT_MEMBER);

    // 只改自己那条的昵称/头像；传了才改（允许只改其一）
    const patched = Object.assign({}, members[idx]);
    if (typeof nickname === 'string') patched.nickname = nickname.slice(0, 20);
    if (typeof avatar === 'string') patched.avatar = avatar;
    members[idx] = patched;

    await db
      .collection(C.COLLECTION.BOARD)
      .doc(boardId)
      .update({ data: { members, updateTime: db.serverDate() } });

    return ok({ nickname: patched.nickname, avatar: patched.avatar });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
