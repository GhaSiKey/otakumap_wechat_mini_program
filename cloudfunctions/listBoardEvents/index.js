// 云函数：listBoardEvents —— 返回一个板的改动历史事件（倒序分页）
//
// 历史页数据源：按 createTime 倒序拉事件，游标分页（before = 上一页最后一条的 createTime）。
// 成员校验：非成员不给读（与权限规则双保险）。
// 折叠（连续 +1 合并）在前端 transform.foldEvents 做，云函数只负责原始倒序流。

const cloud = require('wx-server-sdk');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

// 单页上限兜底：默认 30，最多 100（防一次拉爆）
const PAGE_DEFAULT = 30;
const PAGE_MAX = 100;

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { boardId, limit, before } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    const boardRes = await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null);
    const board = boardRes && boardRes.data;
    if (!board) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    const pageSize = Math.min(Math.max(1, Number(limit) || PAGE_DEFAULT), PAGE_MAX);

    // 游标：before 为上一页最后一条的 createTime（毫秒时间戳），只取更早的
    const where = { boardId };
    if (before) {
      const beforeTs = Number(before);
      if (!Number.isNaN(beforeTs) && beforeTs > 0) {
        where.createTime = _.lt(new Date(beforeTs));
      }
    }

    const res = await db
      .collection(C.COLLECTION.EVENT)
      .where(where)
      .orderBy('createTime', 'desc')
      .limit(pageSize)
      .get();

    const events = res.data || [];
    // hasMore：本页取满即认为可能还有下一页（游标续拉）
    const hasMore = events.length === pageSize;

    return ok({ events, hasMore });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
