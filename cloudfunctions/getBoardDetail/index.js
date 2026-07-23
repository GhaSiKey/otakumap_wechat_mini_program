// 云函数：getBoardDetail —— 返回一个板及其未删番单
//
// 供 P2 门面一次拉全（board + items），前端 buildBoardViewModel 直接消费。
// 成员校验：非成员不给读（与权限规则双保险）。

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

    const boardRes = await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null);
    const board = boardRes && boardRes.data;
    if (!board) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    // 未删番单（数量少，一次取全；上限兜底 200）
    const itemsRes = await db
      .collection(C.COLLECTION.ITEM)
      .where({ boardId, deleted: false })
      .limit(200)
      .get();

    return ok({ board, items: itemsRes.data || [] });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
