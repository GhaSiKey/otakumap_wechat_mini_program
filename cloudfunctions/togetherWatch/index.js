// 云函数：togetherWatch —— 维护“一起待看”子集，并原子推进板内两人的进度。
//
// item.togetherWatch 固定结构：
//   { active, version, updateTime, lastAdvance? }
// 缺失视为 inactive。advance 使用绝对 targetEp，并在同一事务里对双方取
// max(currentEp, targetEp)，所以超前者不回退；lastAdvance 承担最近一次请求幂等。

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const C = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ACTION = { SET: 'set', ADVANCE: 'advance' };
const REQUEST_ID_MAX = 128;

const ok = (data) => ({ ok: true, code: C.ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || '' });

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeVersion(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeEp(value) {
  return Number.isInteger(value) && value >= C.EP_MIN ? value : 0;
}

function normalizeRev(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizeStatus(value) {
  return typeof value === 'string' && value ? value : null;
}

function currentTogetherWatch(item) {
  const value = item && item.togetherWatch;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (value === true || (item && item.togetherWatchActive === true)) {
    return { active: true, version: 0 };
  }
  return {};
}

function currentMembers(board) {
  const members = board && board.memberOpenids;
  if (!Array.isArray(members)) return [];
  return members.filter((openid) => isNonEmptyString(openid));
}

function validateBoardForTogetherWatch(board, openid) {
  if (!board) return fail(C.ERR.BOARD_NOT_FOUND);

  const members = currentMembers(board);
  if (!members.includes(openid)) return fail(C.ERR.NOT_MEMBER);

  const uniqueMembers = Array.from(new Set(members));
  if (
    board.status !== C.BOARD_STATUS.FULL ||
    members.length !== C.BOARD_MEMBER_LIMIT ||
    uniqueMembers.length !== C.BOARD_MEMBER_LIMIT
  ) {
    return fail(C.ERR.BOARD_FULL, '一起待看仅支持已配对的双人共享板');
  }

  return { members: uniqueMembers };
}

function validateItem(item, boardId) {
  if (!item || item.deleted || item.boardId !== boardId) return fail(C.ERR.ITEM_NOT_FOUND);
  return null;
}

async function getDoc(ref) {
  try {
    const result = await ref.get();
    return (result && result.data) || null;
  } catch (e) {
    return null;
  }
}

function nextStatus(previousStatus, nextEp) {
  if (nextEp > 0 && (!previousStatus || previousStatus === C.PROGRESS_STATUS_DEFAULT)) return 'watching';
  return previousStatus || C.PROGRESS_STATUS_DEFAULT;
}

function advanceChange(item, openid, targetEp) {
  const previous = (item.progress && item.progress[openid]) || {};
  const prevEp = normalizeEp(previous.ep);
  const prevStatus = normalizeStatus(previous.status);
  const prevRev = normalizeRev(previous.rev);
  const ep = Math.max(prevEp, targetEp);
  const status = nextStatus(prevStatus, ep);

  return {
    openid,
    prevEp,
    ep,
    gain: ep - prevEp,
    prevStatus,
    status,
    prevRev,
    rev: prevRev + 1,
  };
}

function effectiveTargetEp(targetEp, totalEp) {
  const ceiling = Number.isInteger(totalEp) && totalEp > 0 ? totalEp : C.EP_MAX_WHEN_UNKNOWN;
  return Math.min(targetEp, ceiling);
}

function eventIdFor(boardId, itemId, requestId) {
  const digest = crypto.createHash('sha256').update(`${boardId}:${itemId}:${requestId}`).digest('hex');
  return `tw_${digest.slice(0, 40)}`;
}

async function runSet({ boardId, itemId, active, openid }) {
  return db.runTransaction(async (transaction) => {
    const boardRef = transaction.collection(C.COLLECTION.BOARD).doc(boardId);
    const itemRef = transaction.collection(C.COLLECTION.ITEM).doc(itemId);
    const board = await getDoc(boardRef);
    const boardCheck = validateBoardForTogetherWatch(board, openid);
    if (boardCheck.ok === false) return boardCheck;

    const item = await getDoc(itemRef);
    const itemError = validateItem(item, boardId);
    if (itemError) return itemError;
    const togetherWatch = currentTogetherWatch(item);
    const wasActive = togetherWatch.active === true;
    const version = normalizeVersion(togetherWatch.version);
    if (wasActive === active) {
      return ok({ boardId, itemId, active, changed: false, version });
    }

    const now = db.serverDate();
    const nextVersion = version + 1;
    await itemRef.update({
      data: {
        togetherWatch: Object.assign({}, togetherWatch, {
          active,
          version: nextVersion,
          updateTime: now,
        }),
        updateTime: now,
      },
    });
    await boardRef.update({ data: { updateTime: now } });

    return ok({ boardId, itemId, active, changed: true, version: nextVersion });
  });
}

async function runAdvance({ boardId, itemId, targetEp, requestId, openid }) {
  return db.runTransaction(async (transaction) => {
    const boardRef = transaction.collection(C.COLLECTION.BOARD).doc(boardId);
    const itemRef = transaction.collection(C.COLLECTION.ITEM).doc(itemId);
    const eventRef = transaction
      .collection(C.COLLECTION.EVENT)
      .doc(eventIdFor(boardId, itemId, requestId));
    const board = await getDoc(boardRef);
    const boardCheck = validateBoardForTogetherWatch(board, openid);
    if (boardCheck.ok === false) return boardCheck;

    const item = await getDoc(itemRef);
    const togetherWatch = currentTogetherWatch(item);
    // 每个 requestId 都有一份持久化的事务回执。不能只看 item.lastAdvance：
    // A 成功丢回包、B 又成功后，A 的迟到重试仍必须返回 A 的原结果，而不是再推进一次。
    const receipt = await getDoc(eventRef);
    if (receipt) {
      const receiptPayload = receipt.payload || {};
      if (receiptPayload.requestedTargetEp !== targetEp) {
        return fail(C.ERR.INVALID_PARAM, '同一 requestId 不能复用于不同 targetEp');
      }
      const receiptTarget = receiptPayload.targetEp;
      return ok({
        boardId,
        itemId,
        active: togetherWatch.active === true,
        duplicate: true,
        requestedTargetEp: receiptPayload.requestedTargetEp,
        targetEp: receiptTarget,
        clamped: receiptTarget !== receiptPayload.requestedTargetEp,
        version: normalizeVersion(togetherWatch.version),
        changes: Array.isArray(receiptPayload.changes) ? receiptPayload.changes : [],
      });
    }
    const itemError = validateItem(item, boardId);
    if (itemError) return itemError;
    const lastAdvance =
      togetherWatch.lastAdvance && typeof togetherWatch.lastAdvance === 'object'
        ? togetherWatch.lastAdvance
        : null;

    // 网络丢回包后的即时重试：先于 active 判断，确保原请求成功后即便条目被移出
    // “一起待看”，客户端仍能拿回第一次提交的权威结果。
    if (lastAdvance && lastAdvance.requestId === requestId) {
      if (lastAdvance.requestedTargetEp !== targetEp) {
        return fail(C.ERR.INVALID_PARAM, '同一 requestId 不能复用于不同 targetEp');
      }
      return ok({
        boardId,
        itemId,
        active: togetherWatch.active === true,
        duplicate: true,
        requestedTargetEp: lastAdvance.requestedTargetEp,
        targetEp: lastAdvance.targetEp,
        clamped: lastAdvance.targetEp !== lastAdvance.requestedTargetEp,
        // togetherWatch 可能在原 advance 后又被 set(false/true) 改过；返回当前版本，
        // 避免客户端用旧 advance 版本覆盖更新后的 active 状态。
        version: normalizeVersion(togetherWatch.version),
        changes: Array.isArray(lastAdvance.changes) ? lastAdvance.changes : [],
      });
    }

    if (togetherWatch.active !== true) {
      return fail(C.ERR.INVALID_PARAM, '该番不在一起待看清单中');
    }

    const targetFinal = effectiveTargetEp(targetEp, item.totalEp);
    const changes = boardCheck.members.map((memberOpenid) => advanceChange(item, memberOpenid, targetFinal));
    const now = db.serverDate();
    const nextVersion = normalizeVersion(togetherWatch.version) + 1;
    const data = {
      togetherWatch: Object.assign({}, togetherWatch, {
        active: true,
        version: nextVersion,
        updateTime: now,
        lastAdvance: {
          requestId,
          requestedTargetEp: targetEp,
          targetEp: targetFinal,
          version: nextVersion,
          changes,
          updateTime: now,
        },
      }),
      updateTime: now,
    };

    changes.forEach((change) => {
      data[`progress.${change.openid}.ep`] = change.ep;
      data[`progress.${change.openid}.status`] = change.status;
      data[`progress.${change.openid}.rev`] = change.rev;
      data[`progress.${change.openid}.updateTime`] = now;
    });

    await itemRef.update({ data });
    await boardRef.update({ data: { updateTime: now } });
    // 与双方进度放在同一事务写一条关系事件。确定性 _id 让事务回调重试和网络重试都不会重复记账；
    // 历史显示一次共同操作，报告按 payload.changes 分别归入两位成员。
    await eventRef.set({
      data: {
        boardId,
        memberOpenids: boardCheck.members,
        actor: openid,
        type: C.EVENT_TYPE.TOGETHER_ADVANCE,
        itemId,
        itemName: item.name || '',
        payload: {
          requestedTargetEp: targetEp,
          targetEp: targetFinal,
          changes,
        },
        createTime: now,
      },
    });

    return ok({
      boardId,
      itemId,
      active: true,
      duplicate: false,
      requestedTargetEp: targetEp,
      targetEp: targetFinal,
      clamped: targetFinal !== targetEp,
      version: nextVersion,
      changes,
    });
  });
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return fail(C.ERR.UNAUTHENTICATED);

    const payload = event || {};
    const { action, boardId, itemId } = payload;
    if (!isNonEmptyString(boardId) || !isNonEmptyString(itemId)) return fail(C.ERR.INVALID_PARAM);

    if (action === ACTION.SET) {
      if (typeof payload.active !== 'boolean') return fail(C.ERR.INVALID_PARAM);
      return await runSet({ boardId, itemId, active: payload.active, openid: OPENID });
    }

    if (action === ACTION.ADVANCE) {
      if (!Number.isInteger(payload.targetEp) || payload.targetEp <= C.EP_MIN) return fail(C.ERR.INVALID_EP);
      if (!isNonEmptyString(payload.requestId) || payload.requestId.length > REQUEST_ID_MAX) {
        return fail(C.ERR.INVALID_PARAM);
      }
      return await runAdvance({
        boardId,
        itemId,
        targetEp: payload.targetEp,
        requestId: payload.requestId,
        openid: OPENID,
      });
    }

    return fail(C.ERR.INVALID_PARAM);
  } catch (e) {
    return fail(C.ERR.INTERNAL, String((e && e.message) || e));
  }
};
