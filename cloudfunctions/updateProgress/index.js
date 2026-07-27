// 云函数：updateProgress —— 更新自己的进度
//
// 关键：只定位写 progress.<自己OPENID> 子键，物理上碰不到对方进度（私有性）。
// ep 收「绝对集数」而非自增：前端算好目标集数再传，重复提交幂等、重试安全。
// 服务端 clamp 后回传权威值，供前端乐观 UI 对账。

const cloud = require('wx-server-sdk');
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

    const { itemId, ep, status } = event || {};
    if (!itemId) return fail(C.ERR.INVALID_PARAM);
    if (!C.PROGRESS_STATUS.includes(status)) return fail(C.ERR.INVALID_STATUS);

    const doc = (await db.collection(C.COLLECTION.ITEM).doc(itemId).get().catch(() => null)) || null;
    const item = doc && doc.data;
    if (!item || item.deleted) return fail(C.ERR.ITEM_NOT_FOUND);
    // 成员校验查 board（权威），不依赖 item.memberOpenids 是否已回填最新——
    // 否则配对前建板方加的番，新成员会被误判 NOT_MEMBER
    const boardDoc = (await db.collection(C.COLLECTION.BOARD).doc(item.boardId).get().catch(() => null)) || null;
    const board = boardDoc && boardDoc.data;
    if (!board || !(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    const epFinal = clampEp(ep, item.totalEp);
    if (epFinal === null) return fail(C.ERR.INVALID_EP);

    const now = db.serverDate();
    await db
      .collection(C.COLLECTION.ITEM)
      .doc(itemId)
      .update({
        data: {
          [`progress.${OPENID}.ep`]: epFinal,
          [`progress.${OPENID}.status`]: status,
          [`progress.${OPENID}.updateTime`]: now,
          updateTime: now,
        },
      });

    // bump 所属板的 updateTime：P1 板列表红点判定 hasUnread = board.updateTime > 我的 lastViewedAt。
    // 改进度是最高频事件，不 bump 则对方追番时我在板列表看不到未读红点（红点形同虚设）。
    await db.collection(C.COLLECTION.BOARD).doc(item.boardId).update({ data: { updateTime: now } });

    // 回传服务端裁决后的权威值，供前端对账（被 clamp 时前端 snap 到此值）
    return ok({ itemId, mine: { ep: epFinal, status } });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
