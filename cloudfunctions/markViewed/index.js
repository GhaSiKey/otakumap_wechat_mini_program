// 云函数：markViewed —— 记录当前用户查看该板的时间
//
// 未读红点判定用：板列表比较「board.updateTime > 我的 lastViewedAt」→ 有未读。
// 进板时调本函数，把 lastViewedAt.<我的openid> 更新为当前时间，红点即消。
// 动态 key 只写自己那格，不碰对方（与 progress 私有写同理）。

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

    const { boardId } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    // 成员校验：非成员不记
    const boardDoc = (await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null)) || null;
    const board = boardDoc && boardDoc.data;
    if (!board) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    // ★只写自己那格 lastViewedAt（动态 key），不 bump board.updateTime（那是内容更新时间）
    await db
      .collection(C.COLLECTION.BOARD)
      .doc(boardId)
      .update({ data: { [`lastViewedAt.${OPENID}`]: db.serverDate() } });

    return ok({ boardId });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
