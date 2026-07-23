// 云函数：joinBoard —— 配对入板（防抢坑 + 防并发）
//
// 分享卡片是广播（可转发甩群），只判「未满」会被第三者抢占第 2 坑。
// 故用一次性 token（可过期、用后即焚）+ 原子条件更新，保证只有持有有效 token 的
// 那一次点击能占坑，且两人同扫最多成 1 人。身份取可信 OPENID，忽略客户端传入。

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

    const { boardId, token, profile } = event || {};
    if (!boardId || !token) return fail(C.ERR.INVALID_PARAM);

    // 先读一次做友好报错（非原子，真正防线是下面的条件更新）
    const board = (await db.collection(C.COLLECTION.BOARD).doc(boardId).get().catch(() => null)) || null;
    const data = board && board.data;
    if (!data) return fail(C.ERR.BOARD_NOT_FOUND);
    if (data.status === C.BOARD_STATUS.ARCHIVED) return fail(C.ERR.BOARD_FULL);
    // 本人重复加入 → 幂等放行
    if (Array.isArray(data.memberOpenids) && data.memberOpenids.includes(OPENID)) {
      return ok({ boardId, rejoin: true });
    }
    const pairing = data.pairing || {};
    if (pairing.token !== token) return fail(C.ERR.TOKEN_INVALID);
    if (pairing.used) return fail(C.ERR.TOKEN_USED);
    if (pairing.expireAt && +new Date(pairing.expireAt) <= Date.now()) return fail(C.ERR.TOKEN_EXPIRED);
    if ((data.memberOpenids || []).length >= C.BOARD_MEMBER_LIMIT) return fail(C.ERR.BOARD_FULL);

    // ★原子闸门：仅当 token 仍未消费、未满、调用者未在成员内时才更新成功
    const guest = {
      openid: OPENID,
      nickname: (profile && profile.nickname) || '',
      avatar: (profile && profile.avatar) || '',
      role: C.MEMBER_ROLE.GUEST,
      joinAt: db.serverDate(),
    };
    const upd = await db
      .collection(C.COLLECTION.BOARD)
      .where({
        _id: boardId,
        status: C.BOARD_STATUS.ACTIVE,
        'pairing.used': false,
        'pairing.token': token,
        memberOpenids: _.nin([OPENID]),
      })
      .update({
        data: {
          members: _.push([guest]),
          memberOpenids: _.addToSet(OPENID),
          'pairing.used': true,
          status: C.BOARD_STATUS.FULL,
          updateTime: db.serverDate(),
        },
      });

    if (upd.stats.updated !== 1) return fail(C.ERR.BOARD_FULL); // 被抢先 / 竞态失败

    // 回填：把新成员 openid 补进该板所有已存在番的 memberOpenids。
    // 否则「配对前建板方加的番」item.memberOpenids 只有建板方，
    // 新成员改进度会被 item 级成员校验拒绝（NOT_MEMBER）。云函数端批量 update 不受单条限制。
    await db
      .collection(C.COLLECTION.ITEM)
      .where({ boardId, memberOpenids: _.nin([OPENID]) })
      .update({ data: { memberOpenids: _.addToSet(OPENID) } })
      .catch(() => {}); // 回填失败不阻断加入（下面 §校验兜底也已改成查 board）

    return ok({ boardId, rejoin: false });
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
