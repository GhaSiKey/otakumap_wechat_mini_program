// 云函数：moveItems —— 板间搬番（把番整部从来源板搬到目标板）
//
// 不新建番剧文档：直接改 item.boardId。进度（按 openid 内嵌）、封面、弹play 绑定、
// 「一起看」标记、排序值都随番走，搬完在目标板直接接着追。
// 前提：两个板成员完全相同（同样两个人）。旧历史事件不迁移，两个板各追加一条汇总事件。
// 详见 docs/shared-board-move-items.md。

const cloud = require('wx-server-sdk');
const C = require('./constants');
const { appendEvent } = require('./event-log');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** 成员集合是否完全相同（与顺序无关；与前端 transform.sameMembers 同口径）。 */
function sameMembers(a, b) {
  const x = Array.isArray(a) ? a.slice().sort() : [];
  const y = Array.isArray(b) ? b.slice().sort() : [];
  return x.length === y.length && x.every((openid, i) => openid === y[i]);
}

async function getBoard(boardId) {
  const doc = await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null);
  return (doc && doc.data) || null;
}

// 判重口径：同名，或绑定的是同一个弹弹play条目（与前端 transform.buildMoveSections 同口径）
function hasSourceId(item) {
  return Number.isInteger(item.sourceId) && item.sourceId > 0;
}

function createDuplicateIndex(items) {
  const index = { names: new Set(), sourceIds: new Set() };
  items.forEach((it) => addToIndex(index, it));
  return index;
}

function addToIndex(index, item) {
  if (item.name) index.names.add(item.name);
  if (hasSourceId(item)) index.sourceIds.add(item.sourceId);
}

function isDuplicate(index, item) {
  return index.names.has(item.name) || (hasSourceId(item) && index.sourceIds.has(item.sourceId));
}

const brief = (item) => ({ itemId: item._id, name: item.name || '' });

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { fromBoardId, toBoardId, itemIds } = event || {};
    if (!isNonEmptyString(fromBoardId) || !isNonEmptyString(toBoardId) || fromBoardId === toBoardId) {
      return fail(C.ERR.INVALID_PARAM);
    }
    if (!Array.isArray(itemIds)) return fail(C.ERR.INVALID_PARAM);
    const ids = Array.from(new Set(itemIds.filter(isNonEmptyString)));
    if (!ids.length || ids.length > C.MOVE_ITEMS_MAX) return fail(C.ERR.INVALID_PARAM);

    // ── 板级校验：任一不过整次拒绝，不写库 ──
    const [from, to] = await Promise.all([getBoard(fromBoardId), getBoard(toBoardId)]);
    if (!from || !to) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(from.memberOpenids || []).includes(OPENID) || !(to.memberOpenids || []).includes(OPENID)) {
      return fail(C.ERR.NOT_MEMBER);
    }
    if (from.status === C.BOARD_STATUS.ARCHIVED || to.status === C.BOARD_STATUS.ARCHIVED) {
      return fail(C.ERR.BOARD_ARCHIVED);
    }
    if (to.memberOpenids.length !== C.BOARD_MEMBER_LIMIT || !sameMembers(from.memberOpenids, to.memberOpenids)) {
      return fail(C.ERR.MOVE_MEMBERS_MISMATCH);
    }

    // ① 分类：只在这两个板里查，别的板的番即使猜中 _id 也拿不到番名
    const foundRes = await db
      .collection(C.COLLECTION.ITEM)
      .where({ _id: _.in(ids), boardId: _.in([fromBoardId, toBoardId]) })
      .field({ boardId: true, name: true, sourceId: true, deleted: true })
      .limit(ids.length)
      .get();
    const byId = {};
    (foundRes.data || []).forEach((it) => { byId[it._id] = it; });

    const alreadyMoved = []; // 重试：上次已搬到目标板，算成功、不再写
    const candidates = [];
    const skipped = [];
    ids.forEach((id) => {
      const it = byId[id];
      if (it && !it.deleted && it.boardId === toBoardId) alreadyMoved.push(it);
      else if (it && !it.deleted && it.boardId === fromBoardId) candidates.push(it);
      else skipped.push({ itemId: id, name: (it && it.name) || '', reason: C.MOVE_SKIP_REASON.NOT_IN_SOURCE });
    });

    // ② 查重：与目标板现有未删番比，本次接受的番也加入索引（防来源板内同条目的两部一起搬）
    const targetQuery = db.collection(C.COLLECTION.ITEM).where({ boardId: toBoardId, deleted: false });
    const [targetCountRes, targetItemsRes] = await Promise.all([
      targetQuery.count(),
      targetQuery.field({ name: true, sourceId: true }).limit(C.BOARD_ITEM_MAX).get(),
    ]);
    const index = createDuplicateIndex(targetItemsRes.data || []);
    const movable = [];
    candidates.forEach((it) => {
      if (isDuplicate(index, it)) {
        skipped.push(Object.assign(brief(it), { reason: C.MOVE_SKIP_REASON.DUPLICATE }));
        return;
      }
      movable.push(it);
      addToIndex(index, it);
    });
    if (targetCountRes.total + movable.length > C.BOARD_ITEM_MAX) return fail(C.ERR.MOVE_TARGET_FULL);

    // ③ 批量条件更新：boardId 仍是来源板 + 未删才改。对方同时搬走/移出的番不会被重复处理。
    let landed = [];
    if (movable.length) {
      const movableIds = movable.map((it) => it._id);
      const now = db.serverDate();
      await db
        .collection(C.COLLECTION.ITEM)
        .where({ _id: _.in(movableIds), boardId: fromBoardId, deleted: false })
        .update({ data: { boardId: toBoardId, memberOpenids: to.memberOpenids, movedAt: now, updateTime: now } });

      // ④ 回查：以实际落到目标板的为准，没落地的计为已不在原板
      const landedRes = await db
        .collection(C.COLLECTION.ITEM)
        .where({ _id: _.in(movableIds), boardId: toBoardId })
        .field({ _id: true })
        .limit(movableIds.length)
        .get();
      const landedIds = new Set((landedRes.data || []).map((it) => it._id));
      landed = movable.filter((it) => landedIds.has(it._id));
      movable
        .filter((it) => !landedIds.has(it._id))
        .forEach((it) => skipped.push(Object.assign(brief(it), { reason: C.MOVE_SKIP_REASON.NOT_IN_SOURCE })));

      // ⑤ 收尾：主写已成功，收尾失败只记日志、不改变返回结果
      if (landed.length) {
        const items = landed.map(brief);
        await Promise.all(
          [fromBoardId, toBoardId].map((boardId) => db
            .collection(C.COLLECTION.BOARD)
            .doc(boardId)
            .update({ data: { updateTime: now } }) // 双方板列表红点感知到变化
            .catch((e) => console.error('[moveItems] bump board 失败', { boardId, message: (e && e.message) || String(e) })))
        );
        await Promise.all([
          appendEvent(db, C, {
            boardId: fromBoardId,
            memberOpenids: from.memberOpenids,
            actor: OPENID,
            type: C.EVENT_TYPE.ITEMS_MOVE_OUT,
            payload: { board: to.name || '', items },
          }),
          appendEvent(db, C, {
            boardId: toBoardId,
            memberOpenids: to.memberOpenids,
            actor: OPENID,
            type: C.EVENT_TYPE.ITEMS_MOVE_IN,
            payload: { board: from.name || '', items },
          }),
        ]);
      }
    }

    return ok({ moved: alreadyMoved.concat(landed).map(brief), skipped });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
