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

    // 各板未删番剧数 + 封面墙预览 + 未读判定（逐板查询，板数量少，可接受）。
    // 封面墙：取前 N 部番名（field 投影，不拉全字段），前端 pickCoverColor 生成首字色块；
    // count 与预览分两次查（count 拿准确总数供「N 部番」，预览带 limit 拿不到准数）。
    const withCount = await Promise.all(
      boards.map(async (b) => {
        const [c, preview] = await Promise.all([
          db.collection(C.COLLECTION.ITEM).where({ boardId: b._id, deleted: false }).count(),
          db
            .collection(C.COLLECTION.ITEM)
            .where({ boardId: b._id, deleted: false })
            .field({ name: true, cover: true })
            // 最近活跃在前：item.updateTime 每次 +1/改状态/加番都会 bump（addItem/updateProgress）。
            // 封面墙据此变成「你俩最近在追的番」，与卡片底部「X 前一起追」同一活跃叙事；
            // 换掉旧的 createTime asc（永远取最早 4 部、永不变化）。
            .orderBy('updateTime', 'desc')
            .limit(C.BOARD_PREVIEW_COVERS)
            .get(),
        ]);
        // 未读：板最近活跃时间 > 我上次查看时间（我从没看过也算未读）
        const myViewed = b.lastViewedAt && b.lastViewedAt[OPENID];
        const hasUnread = b.updateTime && (!myViewed || new Date(b.updateTime) > new Date(myViewed));
        const previewItems = (preview.data || []).map((it) => ({ name: it.name, cover: it.cover || '' }));
        return Object.assign({}, b, {
          itemCount: c.total,
          previewItems, // [{ name, cover }] 前 N 部，供封面墙
          hasUnread: !!hasUnread,
        });
      })
    );

    return ok({ boards: withCount });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
