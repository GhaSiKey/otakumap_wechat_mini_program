// 云函数：deleteItem —— 软删除 / 恢复番剧条目
//
// 绝不物理删（PRD §8.2）：A 移出 B 正在追的番，B 的进度不能凭空蒸发，对方可一键恢复。
// deleted=true 移出，deleted=false 恢复，移出/恢复共用一函数。

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

    const { itemId } = event || {};
    if (!itemId) return fail(C.ERR.INVALID_PARAM);
    const deleted = event.deleted === undefined ? true : !!event.deleted;

    const doc = (await db.collection(C.COLLECTION.ITEM).doc(itemId).get().catch(() => null)) || null;
    const item = doc && doc.data;
    if (!item) return fail(C.ERR.ITEM_NOT_FOUND);
    // 成员校验查 board（权威），不依赖 item.memberOpenids 是否已回填最新
    const boardDoc = (await db.collection(C.COLLECTION.BOARD).doc(item.boardId).get().catch(() => null)) || null;
    const board = boardDoc && boardDoc.data;
    if (!board || !(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    const now = db.serverDate();
    await db
      .collection(C.COLLECTION.ITEM)
      .doc(itemId)
      .update({
        data: {
          deleted,
          deletedBy: deleted ? OPENID : '',
          deletedAt: deleted ? now : null,
          updateTime: now,
        },
      });

    return ok({ itemId, deleted });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
