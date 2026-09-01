/**
 * togetherWatch 云函数测试。
 *
 * 使用内存事务 mock 验证鉴权、持久子集、双方单调推进、rev、封顶、幂等与事务冲突重试。
 * 不访问真实 CloudBase。
 */
const Module = require('module');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${JSON.stringify(actual)}\n     期望: ${JSON.stringify(expected)}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = clone(value);
}

function applyUpdate(doc, data) {
  Object.keys(data).forEach((path) => setPath(doc, path, data[path]));
}

function defaultState(overrides) {
  const state = {
    shared_boards: {
      'board-1': {
        _id: 'board-1',
        status: 'full',
        memberOpenids: ['me', 'peer'],
        updateTime: 1,
      },
    },
    shared_board_items: {
      'item-1': {
        _id: 'item-1',
        boardId: 'board-1',
        deleted: false,
        totalEp: 12,
        progress: {
          me: { ep: 3, status: 'want', rev: 2, updateTime: 1 },
          peer: { ep: 5, status: 'paused', updateTime: 1 },
        },
        updateTime: 1,
      },
    },
    shared_board_events: {},
  };
  return Object.assign(state, overrides || {});
}

function makeCollection(store, name, shouldFailUpdate) {
  return {
    doc(id) {
      return {
        async get() {
          const doc = store[name] && store[name][id];
          if (!doc) throw new Error('document not found');
          return { data: clone(doc) };
        },
        async update({ data }) {
          const doc = store[name] && store[name][id];
          if (!doc) throw new Error('document not found');
          if (shouldFailUpdate && shouldFailUpdate(name, id)) throw new Error('injected update failure');
          applyUpdate(doc, data);
          return { stats: { updated: 1 } };
        },
        async set({ data }) {
          if (!store[name]) store[name] = {};
          if (shouldFailUpdate && shouldFailUpdate(name, id)) throw new Error('injected set failure');
          store[name][id] = Object.assign({ _id: id }, clone(data));
          return { _id: id };
        },
      };
    },
  };
}

async function run() {
  const fixedNow = 1_800_000_000_000;
  let committed = defaultState();
  let currentOpenid = 'me';
  let conflictOnce = false;
  let failBoardUpdateOnce = false;
  let transactionRuns = 0;

  const db = {
    serverDate: () => fixedNow,
    collection(name) {
      return makeCollection(committed, name);
    },
    async runTransaction(callback) {
      // wx-server-sdk 2.6.3 会在事务冲突时重跑 callback；这里用丢弃 draft 模拟。
      for (;;) {
        transactionRuns++;
        const draft = clone(committed);
        const transaction = {
          collection: (name) =>
            makeCollection(draft, name, (collectionName) => {
              if (failBoardUpdateOnce && collectionName === 'shared_boards') {
                failBoardUpdateOnce = false;
                return true;
              }
              return false;
            }),
        };
        const result = await callback(transaction);
        if (conflictOnce) {
          conflictOnce = false;
          continue;
        }
        committed = draft;
        return result;
      }
    },
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: currentOpenid }),
  };
  const originalLoad = Module._load;
  const indexPath = require.resolve('../cloudfunctions/togetherWatch/index');

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    const fn = require(indexPath);

    // set：缺失视为 inactive；添加与重复添加都幂等。
    let result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: true });
    eq('set 添加成功', result, {
      ok: true,
      code: 'OK',
      data: { boardId: 'board-1', itemId: 'item-1', active: true, changed: true, version: 1 },
    });
    eq('set 持久化固定 togetherWatch 字段', committed.shared_board_items['item-1'].togetherWatch, {
      active: true,
      version: 1,
      updateTime: fixedNow,
    });
    eq('set 同时 bump item/board', {
      item: committed.shared_board_items['item-1'].updateTime,
      board: committed.shared_boards['board-1'].updateTime,
    }, { item: fixedNow, board: fixedNow });

    const afterFirstSet = clone(committed);
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: true });
    eq('重复 set 不增 version', result.data, {
      boardId: 'board-1', itemId: 'item-1', active: true, changed: false, version: 1,
    });
    eq('重复 set 零写入', committed, afterFirstSet);

    committed = defaultState();
    committed.shared_board_items['item-1'].togetherWatch = true;
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: false });
    eq('灰度 boolean 数据可移出并迁成固定结构', {
      ok: result.ok,
      togetherWatch: committed.shared_board_items['item-1'].togetherWatch,
    }, {
      ok: true,
      togetherWatch: { active: false, version: 1, updateTime: fixedNow },
    });
    committed = clone(afterFirstSet);

    // advance：targetEp 被 totalEp 封顶；两侧 max、不回退，状态和 rev 按规则变化。
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 20, requestId: 'req-1',
    });
    eq('advance 返回封顶后的权威结果', {
      ok: result.ok,
      duplicate: result.data.duplicate,
      requestedTargetEp: result.data.requestedTargetEp,
      targetEp: result.data.targetEp,
      clamped: result.data.clamped,
      version: result.data.version,
    }, {
      ok: true, duplicate: false, requestedTargetEp: 20, targetEp: 12, clamped: true, version: 2,
    });
    eq('advance 返回双方 changes（含 rev）', result.data.changes, [
      {
        openid: 'me', prevEp: 3, ep: 12, gain: 9,
        prevStatus: 'want', status: 'watching', prevRev: 2, rev: 3,
      },
      {
        openid: 'peer', prevEp: 5, ep: 12, gain: 7,
        prevStatus: 'paused', status: 'paused', prevRev: 0, rev: 1,
      },
    ]);
    eq('advance 原子持久化双方进度', committed.shared_board_items['item-1'].progress, {
      me: { ep: 12, status: 'watching', rev: 3, updateTime: fixedNow },
      peer: { ep: 12, status: 'paused', updateTime: fixedNow, rev: 1 },
    });
    const advanceEvents = Object.values(committed.shared_board_events);
    eq('advance 只写一条共同事件', advanceEvents.length, 1);
    eq('共同事件携带双方真实 changes', {
      type: advanceEvents[0].type,
      actor: advanceEvents[0].actor,
      targetEp: advanceEvents[0].payload.targetEp,
      changes: advanceEvents[0].payload.changes,
    }, {
      type: 'together_advance',
      actor: 'me',
      targetEp: 12,
      changes: result.data.changes,
    });

    // 即时重复 requestId 返回首个结果，不再次增加 rev/version。
    const afterAdvance = clone(committed);
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 20, requestId: 'req-1',
    });
    eq('重复 advance 命中幂等', {
      ok: result.ok, duplicate: result.data.duplicate, version: result.data.version,
    }, { ok: true, duplicate: true, version: 2 });
    eq('重复 advance 不再写/不加 rev', committed, afterAdvance);

    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 11, requestId: 'req-1',
    });
    eq('requestId 不可复用于不同 targetEp', { ok: result.ok, code: result.code }, {
      ok: false, code: 'ERR_INVALID_PARAM',
    });
    eq('错误复用 requestId 零写入', committed, afterAdvance);

    // A 成功丢回包后，即使 B 已经成为 lastAdvance，A 的迟到重试仍从持久事件回执取原结果。
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 12, requestId: 'req-2',
    });
    eq('后续 advance 成功覆盖 lastAdvance', {
      ok: result.ok,
      duplicate: result.data.duplicate,
      lastRequestId: committed.shared_board_items['item-1'].togetherWatch.lastAdvance.requestId,
      eventCount: Object.keys(committed.shared_board_events).length,
    }, { ok: true, duplicate: false, lastRequestId: 'req-2', eventCount: 2 });
    const afterSecondAdvance = clone(committed);
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 20, requestId: 'req-1',
    });
    eq('较早请求迟到重试仍命中持久回执', {
      ok: result.ok,
      duplicate: result.data.duplicate,
      requestedTargetEp: result.data.requestedTargetEp,
      targetEp: result.data.targetEp,
      version: result.data.version,
    }, { ok: true, duplicate: true, requestedTargetEp: 20, targetEp: 12, version: 3 });
    eq('较早请求迟到重试零写入', committed, afterSecondAdvance);

    // 移出清单保留 lastAdvance；丢回包重试仍能取得第一次结果。
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: false });
    eq('set 删除子集但保留 lastAdvance', {
      active: committed.shared_board_items['item-1'].togetherWatch.active,
      version: committed.shared_board_items['item-1'].togetherWatch.version,
      requestId: committed.shared_board_items['item-1'].togetherWatch.lastAdvance.requestId,
    }, { active: false, version: 4, requestId: 'req-2' });
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 20, requestId: 'req-1',
    });
    eq('移出后原请求重试仍幂等返回', {
      ok: result.ok, active: result.data.active, duplicate: result.data.duplicate, version: result.data.version,
    }, { ok: true, active: false, duplicate: true, version: 4 });
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 12, requestId: 'req-inactive',
    });
    eq('inactive 拒绝新 advance', { ok: result.ok, code: result.code }, {
      ok: false, code: 'ERR_INVALID_PARAM',
    });

    // 缺失进度会初始化为 watching；超前方只增 rev、不回退。
    committed = defaultState();
    committed.shared_board_items['item-1'].togetherWatch = { active: true, version: 4, updateTime: 1 };
    committed.shared_board_items['item-1'].totalEp = null;
    committed.shared_board_items['item-1'].progress = {
      me: { ep: 9, status: 'done', rev: 7, updateTime: 1 },
    };
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 7, requestId: 'req-3',
    });
    eq('超前方不回退且状态保留', result.data.changes[0], {
      openid: 'me', prevEp: 9, ep: 9, gain: 0,
      prevStatus: 'done', status: 'done', prevRev: 7, rev: 8,
    });
    eq('缺失侧初始化 watching/rev1', result.data.changes[1], {
      openid: 'peer', prevEp: 0, ep: 7, gain: 7,
      prevStatus: null, status: 'watching', prevRev: 0, rev: 1,
    });

    // 非成员、非 full、错板/软删除都不能写。
    let beforeDenied = clone(committed);
    currentOpenid = 'outsider';
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: false });
    eq('非成员拒绝', { ok: result.ok, code: result.code }, { ok: false, code: 'ERR_NOT_MEMBER' });
    eq('非成员零写入', committed, beforeDenied);

    currentOpenid = 'me';
    committed.shared_boards['board-1'].status = 'active';
    committed.shared_boards['board-1'].memberOpenids = ['me'];
    beforeDenied = clone(committed);
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: false });
    eq('未配对板拒绝', { ok: result.ok, code: result.code }, { ok: false, code: 'ERR_BOARD_FULL' });
    eq('未配对板零写入', committed, beforeDenied);

    committed = defaultState();
    committed.shared_board_items['item-1'].boardId = 'board-other';
    beforeDenied = clone(committed);
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: true });
    eq('item 错板按不存在拒绝', { ok: result.ok, code: result.code }, { ok: false, code: 'ERR_ITEM_NOT_FOUND' });
    eq('item 错板零写入', committed, beforeDenied);

    committed = defaultState();
    committed.shared_board_items['item-1'].deleted = true;
    beforeDenied = clone(committed);
    result = await fn.main({ action: 'set', boardId: 'board-1', itemId: 'item-1', active: true });
    eq('软删除 item 拒绝', { ok: result.ok, code: result.code }, { ok: false, code: 'ERR_ITEM_NOT_FOUND' });
    eq('软删除 item 零写入', committed, beforeDenied);

    // item 已更新但 board 更新失败时，整个事务 draft 必须回滚。
    committed = defaultState();
    committed.shared_board_items['item-1'].togetherWatch = { active: true, version: 0, updateTime: 1 };
    beforeDenied = clone(committed);
    failBoardUpdateOnce = true;
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 6, requestId: 'req-rollback',
    });
    eq('事务中途失败返回 INTERNAL', { ok: result.ok, code: result.code }, { ok: false, code: 'ERR_INTERNAL' });
    eq('事务中途失败不留下半边进度', committed, beforeDenied);

    // 事务 callback 冲突重入：第一次 draft 丢弃，最终只推进/加 rev 一次。
    committed = defaultState();
    committed.shared_board_items['item-1'].togetherWatch = { active: true, version: 0, updateTime: 1 };
    transactionRuns = 0;
    conflictOnce = true;
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 6, requestId: 'req-conflict',
    });
    eq('事务冲突重跑后成功', { ok: result.ok, transactionRuns }, { ok: true, transactionRuns: 2 });
    eq('事务冲突只提交一次双方 rev', {
      me: committed.shared_board_items['item-1'].progress.me.rev,
      peer: committed.shared_board_items['item-1'].progress.peer.rev,
      version: committed.shared_board_items['item-1'].togetherWatch.version,
    }, { me: 3, peer: 1, version: 1 });

    // 参数边界在进入事务前拒绝。
    const runsBeforeInvalid = transactionRuns;
    result = await fn.main({
      action: 'advance', boardId: 'board-1', itemId: 'item-1', targetEp: 0, requestId: 'req-invalid',
    });
    eq('targetEp 必须为正整数', { ok: result.ok, code: result.code }, { ok: false, code: 'ERR_INVALID_EP' });
    eq('非法参数不启动事务', transactionRuns, runsBeforeInvalid);
  } finally {
    Module._load = originalLoad;
    delete require.cache[indexPath];
  }
}

run()
  .catch((e) => {
    fail++;
    failures.push(`  ❌ 云函数测试异常\n     ${e && e.stack ? e.stack : e}`);
  })
  .finally(() => {
    console.log('\ntogetherWatch 云函数测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
