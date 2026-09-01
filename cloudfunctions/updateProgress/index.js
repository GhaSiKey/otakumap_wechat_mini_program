// 云函数：updateProgress —— 更新自己的进度
//
// 关键：只定位写 progress.<自己OPENID> 子键，物理上碰不到对方进度（私有性）。
// ep 收绝对集数；新客户端携带 expectedRev 做乐观锁，旧客户端走兼容路径。
// 事务内重读 item/board 后才写，防止个人旧请求覆盖「一起待看」刚完成的双人推进，
// 也防新客户端连点乱序导致集数倒退。

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

// 与 transform.clampEp 同规则：非整/负 → null；有分母截到 totalEp，否则截到兜底上限
function clampEp(ep, totalEp) {
  if (typeof ep !== 'number' || !Number.isInteger(ep) || ep < C.EP_MIN) return null;
  const ceiling = totalEp != null && totalEp > 0 ? totalEp : C.EP_MAX_WHEN_UNKNOWN;
  return Math.min(ep, ceiling);
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { itemId, ep, status, expectedRev } = event || {};
    if (!itemId) return fail(C.ERR.INVALID_PARAM);
    if (!C.PROGRESS_STATUS.includes(status)) return fail(C.ERR.INVALID_STATUS);
    // 兼容已发布的旧小程序包：旧端没有 expectedRev，仍按事务内最新快照执行；
    // 新端携带 revision 时启用 CAS，避免旧请求覆盖共同推进或连点乱序。
    const hasExpectedRev = expectedRev !== undefined && expectedRev !== null;
    if (hasExpectedRev && (!Number.isInteger(expectedRev) || expectedRev < 0)) {
      return fail(C.ERR.INVALID_PARAM);
    }

    let committed = null;
    // 事务冲突会重跑 callback；事件 id 必须在 callback 外生成，保证只落一条。
    const eventId = `progress_${crypto.randomBytes(20).toString('hex')}`;
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.collection(C.COLLECTION.ITEM).doc(itemId).get().catch(() => null);
      const item = doc && doc.data;
      if (!item || item.deleted) {
        committed = { failure: fail(C.ERR.ITEM_NOT_FOUND) };
        return;
      }

      // 成员校验查 board（权威），不依赖 item.memberOpenids 是否已回填最新。
      const boardDoc = await transaction.collection(C.COLLECTION.BOARD).doc(item.boardId).get().catch(() => null);
      const board = boardDoc && boardDoc.data;
      if (!board || !(board.memberOpenids || []).includes(OPENID)) {
        committed = { failure: fail(C.ERR.NOT_MEMBER) };
        return;
      }

      const epFinal = clampEp(ep, item.totalEp);
      if (epFinal === null) {
        committed = { failure: fail(C.ERR.INVALID_EP) };
        return;
      }
      const prev = (item.progress && item.progress[OPENID]) || {};
      const prevEp = typeof prev.ep === 'number' ? prev.ep : 0;
      const prevStatus = prev.status || null;
      const prevRev = Number.isInteger(prev.rev) && prev.rev >= 0 ? prev.rev : 0;
      if (hasExpectedRev && expectedRev !== prevRev) {
        committed = { failure: fail(C.ERR.CONFLICT) };
        return;
      }

      // 无变化提交保持真正幂等：不 bump revision、板时间或历史。
      if (epFinal === prevEp && status === prevStatus) {
        committed = { item, board, changed: false, prevEp, prevStatus, epFinal, rev: prevRev };
        return;
      }

      const now = db.serverDate();
      const rev = prevRev + 1;
      await transaction.collection(C.COLLECTION.ITEM).doc(itemId).update({
        data: {
          [`progress.${OPENID}.ep`]: epFinal,
          [`progress.${OPENID}.status`]: status,
          [`progress.${OPENID}.rev`]: rev,
          [`progress.${OPENID}.updateTime`]: now,
          updateTime: now,
        },
      });
      // 同一事务 bump 板时间，避免 item 已写、板未写的半成功状态。
      await transaction.collection(C.COLLECTION.BOARD).doc(item.boardId).update({ data: { updateTime: now } });
      // 进度、板时间与历史是一个原子结果：任何一步失败都整体回滚，报告不会永久漏记。
      await transaction.collection(C.COLLECTION.EVENT).doc(eventId).set({
        data: {
          boardId: item.boardId,
          memberOpenids: Array.isArray(board.memberOpenids) ? board.memberOpenids : [],
          actor: OPENID,
          type: C.EVENT_TYPE.PROGRESS,
          itemId,
          itemName: item.name || '',
          payload: { prevEp, ep: epFinal, prevStatus, status },
          createTime: now,
        },
      });
      committed = { item, board, changed: true, prevEp, prevStatus, epFinal, rev };
    });

    if (committed && committed.failure) return committed.failure;

    const { epFinal, rev } = committed;

    // 回传服务端裁决后的权威值，供前端对账（被 clamp 时前端 snap 到此值）
    return ok({ itemId, mine: { ep: epFinal, status, rev } });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
