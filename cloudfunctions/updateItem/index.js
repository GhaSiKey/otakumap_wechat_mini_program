// 云函数：updateItem —— 修改番剧共享字段
//
// 只允许改 ITEM_SHARED_FIELDS 白名单内的共享字段（番名/总集数/放送状态/封面）。
// progress / sortOrder / deleted 等私有或受控字段一律剔除，防越权。改名时同板去重。

const cloud = require('wx-server-sdk');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { itemId, patch } = event || {};
    if (!itemId || !patch || typeof patch !== 'object') return fail(C.ERR.INVALID_PARAM);

    const doc = (await db.collection(C.COLLECTION.ITEM).doc(itemId).get().catch(() => null)) || null;
    const item = doc && doc.data;
    if (!item || item.deleted) return fail(C.ERR.ITEM_NOT_FOUND);
    // 成员校验查 board（权威），不依赖 item.memberOpenids 是否已回填最新
    const boardDoc = (await db.collection(C.COLLECTION.BOARD).doc(item.boardId).get().catch(() => null)) || null;
    const board = boardDoc && boardDoc.data;
    if (!board || !(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    // 白名单过滤
    const allow = {};
    C.ITEM_SHARED_FIELDS.forEach((k) => {
      if (patch[k] !== undefined) allow[k] = patch[k];
    });
    if (Object.keys(allow).length === 0) return fail(C.ERR.INVALID_PARAM);

    // 改名：trim + 非空 + 同板去重（排除自身）
    if (allow.name !== undefined) {
      const t = (typeof allow.name === 'string' ? allow.name.trim() : '').slice(0, C.ITEM_NAME_MAX);
      if (!t) return fail(C.ERR.INVALID_PARAM);
      const dup = await db
        .collection(C.COLLECTION.ITEM)
        .where({ boardId: item.boardId, deleted: false, name: t, _id: _.neq(itemId) })
        .count();
      if (dup.total > 0) return fail(C.ERR.DUPLICATE_ITEM);
      allow.name = t;
    }

    await db
      .collection(C.COLLECTION.ITEM)
      .doc(itemId)
      .update({ data: Object.assign({}, allow, { updateTime: db.serverDate() }) });

    return ok({ itemId });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
