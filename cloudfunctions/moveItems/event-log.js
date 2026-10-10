/**
 * event-log.js — 板改动历史事件追加（云函数侧共享模块）
 *
 * 每个「会改变板状态」的写操作（加番/改进度/改信息/移出恢复）在**主写成功后**
 * 调 appendEvent 追加一条历史事件，供历史页与周报消费。
 *
 * 设计要点：
 *  - 权威源就是本文件；与 constants.js 同样走「复制到各云函数目录 + 测试守卫」纪律。
 *    部署前：cp cloudfunctions/_shared-board/event-log.js cloudfunctions/<fn>/event-log.js
 *  - **绝不让记日志失败拖垮用户操作**：整体 try/catch 吞异常，只 console.error。
 *    历史是次要产物，用户的「+1」「加番」必须已经成功返回，日志写不写另说。
 *  - 事件不可变、只追加（append-only）：不更新、不删除历史条目。
 *  - itemName 存**快照**：番改名/移出后，历史仍能显示当时的番名。
 *
 * 事件文档结构（集合 COLLECTION.EVENT = shared_board_events）：
 *   { boardId, memberOpenids, actor, type, itemId, itemName, payload, createTime }
 * 其中 memberOpenids 冗余存一份，供读规则 auth.openid in doc.memberOpenids（方案 A，免 get()）。
 */

/**
 * 追加一条历史事件。失败只记日志、不抛。
 * @param {*} db     cloud.database() 实例
 * @param {*} C      constants（取 COLLECTION.EVENT）
 * @param {object} e {
 *   boardId, memberOpenids, actor, type,   // 必填
 *   itemId, itemName,                       // 番相关事件填
 *   payload                                 // 按 type 携带 prev/新值等，选填
 * }
 * @returns {Promise<void>}
 */
async function appendEvent(db, C, e) {
  try {
    if (!db || !C || !e || !e.boardId || !e.actor || !e.type) return;
    await db.collection(C.COLLECTION.EVENT).add({
      data: {
        boardId: e.boardId,
        memberOpenids: Array.isArray(e.memberOpenids) ? e.memberOpenids : [],
        actor: e.actor,
        type: e.type,
        itemId: e.itemId || '',
        itemName: e.itemName || '',
        payload: e.payload || {},
        createTime: db.serverDate(),
      },
    });
  } catch (err) {
    // 历史记录失败不影响主流程；仅打日志便于排查
    console.error('[event-log] appendEvent 失败', {
      type: e && e.type,
      boardId: e && e.boardId,
      message: (err && err.message) || String(err),
    });
  }
}

module.exports = { appendEvent };
