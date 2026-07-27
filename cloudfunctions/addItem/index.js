// 云函数：addItem —— 添加番剧条目（共享）
//
// 番剧条目是两人共享的单一实体（一人加、两人都看到）。加者默认自己进度为 E0/想看，
// 对方那侧显示「还没翻牌」。同板去重复用个人版思路，扩到共享番单。

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

    const { boardId, name, totalEp, airStatus, cover } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    const trimmed = (typeof name === 'string' ? name.trim() : '').slice(0, C.ITEM_NAME_MAX);
    if (!trimmed) return fail(C.ERR.INVALID_PARAM);

    // 总集数归一：只接受 [TOTAL_EP_MIN, TOTAL_EP_MAX] 内的整数，否则一律 null（视作未设）。
    // 前端选填空/非法（空串、NaN、小数、超上限）都落到 null，不写脏数据。
    const normTotalEp =
      Number.isInteger(totalEp) && totalEp >= C.TOTAL_EP_MIN && totalEp <= C.TOTAL_EP_MAX ? totalEp : null;
    // 放送状态归一：非枚举值一律回落 UNKNOWN
    const airValues = Object.values(C.AIR_STATUS);
    const normAirStatus = airValues.includes(airStatus) ? airStatus : C.AIR_STATUS.UNKNOWN;

    // 成员校验
    const board = (await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null)) || null;
    const bd = board && board.data;
    if (!bd) return fail(C.ERR.BOARD_NOT_FOUND);
    if (!(bd.memberOpenids || []).includes(OPENID)) return fail(C.ERR.NOT_MEMBER);

    // 同板去重（未删项同名）
    const dup = await db
      .collection(C.COLLECTION.ITEM)
      .where({ boardId, deleted: false, name: trimmed })
      .count();
    if (dup.total > 0) return fail(C.ERR.DUPLICATE_ITEM);

    const now = db.serverDate();
    const res = await db.collection(C.COLLECTION.ITEM).add({
      data: {
        boardId,
        memberOpenids: bd.memberOpenids, // 冗余，供 item 读规则（免 get()）
        name: trimmed,
        totalEp: normTotalEp,
        airStatus: normAirStatus,
        cover: cover || '',
        alias: [],
        addBy: OPENID,
        progress: { [OPENID]: { ep: 0, status: C.PROGRESS_STATUS_DEFAULT, updateTime: now } },
        sortOrder: { [OPENID]: Date.now() },
        deleted: false,
        deletedBy: '',
        deletedAt: null,
        createTime: now,
        updateTime: now,
      },
    });

    // 顺带 bump 板活跃时间
    await db.collection(C.COLLECTION.BOARD).doc(boardId).update({ data: { updateTime: now } });

    return ok({ itemId: res._id });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
