// 云函数：getBoardReport —— 一次算全「追番小结/周报」数据
//
// 方案 C（搬 transform 进云函数）：算法逻辑单一实现，复用前端同构纯模块 transform.js
//   （逐字拷贝，drift-guard 守一致），云函数只负责「取数 + 调纯函数」，本身逻辑极薄。
//
// 取数：
//   - 全历史 progress 相关事件（时间下界 REPORT.LOOKBACK_DAYS，防老板拉爆；倒序）
//   - 未删番单（快照类指标：累计/个人小结）
// 算法：transform.buildReportModel(...) 一次算完，服务端不重写 streak/环比/爆肝逻辑。
//
// ⚠️ nowMs 由前端传入（客户端 Date.now()），服务端不自己取时钟——
//    buildReportModel 需判「今天」做 streak 宽限，服务端云机房时钟/时区一旦与用户不一致会误判。
//    时区偏移走 config.REPORT.TZ_OFFSET_MINUTES（固定 UTC+8），与 nowMs 配合把 UTC 归本地日。

const cloud = require('wx-server-sdk');
const C = require('./config');
const T = require('./transform');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

// 事件取全上限兜底：LOOKBACK_DAYS 窗口内理论条数有限，再加硬上限防极端刷屏板拉爆
const EVENT_HARD_LIMIT = 1000;
const ITEM_LIMIT = 200;

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { boardId } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    // nowMs 前端传入（客户端时钟）；缺省兜底服务端时间（降级，可能有时区偏差）
    const nowMs = typeof event.nowMs === 'number' && event.nowMs > 0 ? event.nowMs : Date.now();

    const boardRes = await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null);
    const board = boardRes && boardRes.data;
    if (!board) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    // 未删番单（快照指标）
    const itemsRes = await db
      .collection(C.COLLECTION.ITEM)
      .where({ boardId, deleted: false })
      .limit(ITEM_LIMIT)
      .get();
    const items = itemsRes.data || [];

    // 时间下界：只取近 LOOKBACK_DAYS 的事件（含 streak 纪录/爆肝的回溯深度）
    const sinceMs = nowMs - C.REPORT.LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const eventsRes = await db
      .collection(C.COLLECTION.EVENT)
      .where({ boardId, createTime: _.gte(new Date(sinceMs)) })
      .orderBy('createTime', 'desc')
      .limit(EVENT_HARD_LIMIT)
      .get();
    const events = eventsRes.data || [];

    // commonCount 复用 buildBoardViewModel（避免在报告里重算「能一起聊」逻辑）
    const vm = T.buildBoardViewModel(board, items, OPENID);

    const report = T.buildReportModel({
      board,
      items,
      events,
      myOpenid: OPENID,
      nowMs,
      commonCount: vm.commonCount,
    });

    // 附带头部渲染要用的成员信息（昵称/身份色由前端 config.MEMBER_COLORS 定，这里只给昵称）
    return ok({ report, me: vm.me, peer: vm.peer, name: vm.name });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
