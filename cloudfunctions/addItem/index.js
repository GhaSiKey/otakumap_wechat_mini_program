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

    const { boardId, name, totalEp, airStatus, cover, sourceId, airDay, isOnAir } = event || {};
    if (!boardId) return fail(C.ERR.INVALID_PARAM);

    const trimmed = (typeof name === 'string' ? name.trim() : '').slice(0, C.ITEM_NAME_MAX);
    if (!trimmed) return fail(C.ERR.INVALID_PARAM);

    // 总集数归一：只接受 [TOTAL_EP_MIN, TOTAL_EP_MAX] 内的整数，否则一律 null（视作未设）。
    // 前端选填空/非法（空串、NaN、小数、超上限）都落到 null，不写脏数据。
    const normTotalEp =
      Number.isInteger(totalEp) && totalEp >= C.TOTAL_EP_MIN && totalEp <= C.TOTAL_EP_MAX ? totalEp : null;
    // 放送状态归一：非枚举值一律回落 UNKNOWN
    const airValues = Object.values(C.AIR_STATUS);
    let normAirStatus = airValues.includes(airStatus) ? airStatus : C.AIR_STATUS.UNKNOWN;
    // isOnAir 校准放送状态：客户端未显式给出有效 airStatus 时（加番走搜索，搜索结果无此字段），
    // 用详情接口的 isOnAir 推导——true→放送中、false→已完结。客户端显式传了 airStatus 则以它为准。
    if (!airValues.includes(airStatus) && typeof isOnAir === 'boolean') {
      normAirStatus = isOnAir ? C.AIR_STATUS.AIRING : C.AIR_STATUS.FINISHED;
    }
    // 更新日归一：0-6 整数才存（周几更新），否则 null（手动番/详情没拉到都视作未知）
    const normAirDay = Number.isInteger(airDay) && airDay >= 0 && airDay <= 6 ? airDay : null;
    // 弹play animeId 归一：正整数才存（标记「绑过弹play」），否则 null（手动番无 sourceId）
    const normSourceId = Number.isInteger(sourceId) && sourceId > 0 ? sourceId : null;

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
        airDay: normAirDay, // 周几更新（0-6），仅弹play 详情带回；手动番为 null
        cover: cover || '',
        sourceId: normSourceId,
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
