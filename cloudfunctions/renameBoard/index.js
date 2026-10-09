// 云函数：renameBoard —— 修改板名
//
// 板名是双方共享的：任一成员可改，改后追加历史事件让对方看见。
// 只写 name / updateTime / 自己的 lastViewedAt 三个字段，不读改写整组 members（避免并发覆盖）。

const cloud = require('wx-server-sdk');
const C = require('./constants');
const { appendEvent } = require('./event-log');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const { boardId, name } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    // 与 createBoard 同口径：trim 后截断到上限；改名场景不允许清空（清空没有「默认名」语义）
    const nextName = (typeof name === 'string' ? name.trim() : '').slice(0, C.BOARD_NAME_MAX);
    if (!nextName) return fail(C.ERR.INVALID_PARAM);

    const boardDoc = (await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null)) || null;
    const board = boardDoc && boardDoc.data;
    if (!board) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(board.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    const prevName = board.name || '';
    // 名字没变：不写库、不记历史、不触发对方红点
    if (nextName === prevName) return ok({ boardId, name: nextName });

    // updateTime 让对方 P1 红点亮起；同一时刻写自己的 lastViewedAt，
    // 否则改名的人回到列表页会看到自己这张卡也亮红点（未读判定是 updateTime > lastViewedAt）
    const now = db.serverDate();
    await db
      .collection(C.COLLECTION.BOARD)
      .doc(boardId)
      .update({ data: { name: nextName, updateTime: now, [`lastViewedAt.${OPENID}`]: now } });

    // 板级事件不挂番（itemId/itemName 留空），新旧板名放 payload
    await appendEvent(db, C, {
      boardId,
      memberOpenids: board.memberOpenids,
      actor: OPENID,
      type: C.EVENT_TYPE.BOARD_RENAME,
      payload: { name: nextName, prevName },
    });

    return ok({ boardId, name: nextName });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
