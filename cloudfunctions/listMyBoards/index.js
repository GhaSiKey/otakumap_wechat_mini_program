// 云函数：listMyBoards —— 查询当前用户参与的所有共享板
//
// 允许一人加入多个板（PRD §5.4），P1 板列表页据此渲染。
// 每个板附带未删番剧数（itemCount），供列表摘要「N 部番」。
// 只返回自己是成员的板（memberOpenids 含 OPENID），配合权限规则双保险。

const cloud = require('wx-server-sdk');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    // 我参与的板，最近活跃在前
    const boardsRes = await db
      .collection(C.COLLECTION.BOARD)
      .where({ memberOpenids: OPENID })
      .orderBy('updateTime', 'desc')
      .limit(100)
      .get();
    const boards = boardsRes.data || [];

    // 各板未删番剧数 + 未读判定（逐板 count，板数量少，可接受）
    const withCount = await Promise.all(
      boards.map(async (b) => {
        const c = await db
          .collection(C.COLLECTION.ITEM)
          .where({ boardId: b._id, deleted: false })
          .count();
        // 未读：板最近活跃时间 > 我上次查看时间（我从没看过也算未读）
        const myViewed = b.lastViewedAt && b.lastViewedAt[OPENID];
        const hasUnread = b.updateTime && (!myViewed || new Date(b.updateTime) > new Date(myViewed));
        return Object.assign({}, b, { itemCount: c.total, hasUnread: !!hasUnread });
      })
    );

    return ok({ boards: withCount });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
