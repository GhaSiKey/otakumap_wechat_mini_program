/**
 * updateProgress 云函数事务 / 乐观锁测试。
 *
 * 用内存版 wx-server-sdk 验证 expectedRev、事务写边界和拒绝路径；
 * 不连接真实 CloudBase。
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

function defaultState() {
  return {
    shared_boards: {
      'board-1': {
        _id: 'board-1',
        memberOpenids: ['me', 'peer'],
        updateTime: 1,
      },
    },
    shared_board_items: {
      'item-1': {
        _id: 'item-1',
        boardId: 'board-1',
        name: '测试番',
        deleted: false,
        totalEp: 12,
        progress: {
          me: { ep: 3, status: 'watching', rev: 2, updateTime: 1 },
          peer: { ep: 5, status: 'watching', rev: 4, updateTime: 1 },
        },
        updateTime: 1,
      },
    },
    shared_board_events: {},
  };
}

function makeDocCollection(store, name, onUpdate) {
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
          if (onUpdate) onUpdate(name, id, clone(data));
          applyUpdate(doc, data);
          return { stats: { updated: 1 } };
        },
        async set({ data }) {
          if (onUpdate) onUpdate(name, id, clone(data));
          if (!store[name]) store[name] = {};
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
  let transactionUpdates = [];
  let directCoreUpdates = [];
  let events = [];
  let failEventSetOnce = false;

  const db = {
    serverDate: () => fixedNow,
    collection(name) {
      if (name === 'shared_board_events') {
        return {
          async add({ data }) {
            events.push(clone(data));
            return { _id: `event-${events.length}` };
          },
        };
      }
      return makeDocCollection(committed, name, (collection, id, data) => {
        // item / board 主写如果绕过 transaction，测试应能直接看到。
        directCoreUpdates.push({ collection, id, data });
      });
    },
    async runTransaction(callback) {
      const draft = clone(committed);
      const updates = [];
      const transaction = {
        collection(name) {
          return makeDocCollection(draft, name, (collection, id, data) => {
            if (failEventSetOnce && collection === 'shared_board_events') {
              failEventSetOnce = false;
              throw new Error('injected event failure');
            }
            updates.push({ collection, id, data });
          });
        },
      };
      const result = await callback(transaction);
      committed = draft;
      events = Object.values(committed.shared_board_events);
      transactionUpdates.push(...updates);
      return result;
    },
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: currentOpenid }),
  };
  const originalLoad = Module._load;
  const indexPath = require.resolve('../cloudfunctions/updateProgress/index');

  const reset = () => {
    committed = defaultState();
    currentOpenid = 'me';
    transactionUpdates = [];
    directCoreUpdates = [];
    events = [];
    failEventSetOnce = false;
  };

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    const fn = require(indexPath);

    // expectedRev 匹配：写本人进度并且 revision +1。
    let result = await fn.main({ itemId: 'item-1', ep: 4, status: 'watching', expectedRev: 2 });
    eq('expectedRev 匹配返回权威 rev+1', result, {
      ok: true,
      code: 'OK',
      data: { itemId: 'item-1', mine: { ep: 4, status: 'watching', rev: 3 } },
    });
    eq('成功提交持久化本人进度/rev', committed.shared_board_items['item-1'].progress.me, {
      ep: 4, status: 'watching', rev: 3, updateTime: fixedNow,
    });
    eq('成功提交不碰对方进度', committed.shared_board_items['item-1'].progress.peer, {
      ep: 5, status: 'watching', rev: 4, updateTime: 1,
    });
    eq('item、board 与历史都在一个事务中写入', transactionUpdates.map((entry) => entry.collection), [
      'shared_board_items', 'shared_boards', 'shared_board_events',
    ]);
    eq('主写未绕过事务', directCoreUpdates, []);
    eq('事务同时 bump item/board 时间', {
      item: committed.shared_board_items['item-1'].updateTime,
      board: committed.shared_boards['board-1'].updateTime,
    }, { item: fixedNow, board: fixedNow });
    eq('真变化追加一条进度事件', {
      count: events.length,
      type: events[0] && events[0].type,
      payload: events[0] && events[0].payload,
    }, {
      count: 1,
      type: 'progress',
      payload: { prevEp: 3, ep: 4, prevStatus: 'watching', status: 'watching' },
    });

    // 兼容窗口：旧版小程序不传 expectedRev，仍能按事务内最新快照更新。
    reset();
    result = await fn.main({ itemId: 'item-1', ep: 4, status: 'watching' });
    eq('旧客户端缺 expectedRev 仍可更新', {
      ok: result.ok,
      mine: result.data && result.data.mine,
      eventCount: events.length,
    }, {
      ok: true,
      mine: { ep: 4, status: 'watching', rev: 3 },
      eventCount: 1,
    });

    // 历史写失败必须让整个事务回滚，不能出现进度成功但报告永久漏数。
    reset();
    const beforeEventFailure = clone(committed);
    failEventSetOnce = true;
    result = await fn.main({ itemId: 'item-1', ep: 4, status: 'watching', expectedRev: 2 });
    eq('历史写失败返回 INTERNAL', { ok: result.ok, code: result.code }, {
      ok: false, code: 'ERR_INTERNAL',
    });
    eq('历史写失败回滚进度/板时间', {
      state: committed,
      transactionUpdates,
      events,
    }, {
      state: beforeEventFailure,
      transactionUpdates: [],
      events: [],
    });

    // expectedRev 冲突：不能更新 item/board，也不能留历史。
    reset();
    const beforeConflict = clone(committed);
    result = await fn.main({ itemId: 'item-1', ep: 4, status: 'watching', expectedRev: 1 });
    eq('expectedRev 冲突返回专用错误', { ok: result.ok, code: result.code }, {
      ok: false, code: 'ERR_CONFLICT',
    });
    eq('rev 冲突零写入', {
      state: committed,
      transactionUpdates,
      directCoreUpdates,
      events,
    }, {
      state: beforeConflict,
      transactionUpdates: [],
      directCoreUpdates: [],
      events: [],
    });

    // 同值重提：revision，item/board 时间和历史都不变。
    reset();
    const beforeSame = clone(committed);
    result = await fn.main({ itemId: 'item-1', ep: 3, status: 'watching', expectedRev: 2 });
    eq('同值重提返回原 revision', result.data && result.data.mine, {
      ep: 3, status: 'watching', rev: 2,
    });
    eq('同值重提零写/不 bump', {
      state: committed,
      transactionUpdates,
      directCoreUpdates,
      events,
    }, {
      state: beforeSame,
      transactionUpdates: [],
      directCoreUpdates: [],
      events: [],
    });

    // 非成员与软删除 item 都必须在事务内读后拒绝，不能落任何写。
    reset();
    currentOpenid = 'outsider';
    let beforeDenied = clone(committed);
    result = await fn.main({ itemId: 'item-1', ep: 4, status: 'watching', expectedRev: 0 });
    eq('非成员拒绝', { ok: result.ok, code: result.code }, {
      ok: false, code: 'ERR_NOT_MEMBER',
    });
    eq('非成员零写入', { state: committed, transactionUpdates, events }, {
      state: beforeDenied, transactionUpdates: [], events: [],
    });

    reset();
    committed.shared_board_items['item-1'].deleted = true;
    beforeDenied = clone(committed);
    result = await fn.main({ itemId: 'item-1', ep: 4, status: 'watching', expectedRev: 2 });
    eq('软删除 item 按不存在拒绝', { ok: result.ok, code: result.code }, {
      ok: false, code: 'ERR_ITEM_NOT_FOUND',
    });
    eq('软删除 item 零写入', { state: committed, transactionUpdates, events }, {
      state: beforeDenied, transactionUpdates: [], events: [],
    });
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
    console.log('\nupdateProgress 云函数事务 / CAS 测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
