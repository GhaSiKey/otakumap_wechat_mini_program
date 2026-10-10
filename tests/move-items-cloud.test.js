/**
 * moveItems 云函数测试（板间搬番）。
 *
 * 用内存版 wx-server-sdk（支持 where / _.in / field / limit / count / 批量 update）验证：
 * 板级校验、判重跳过、不在来源板、重试幂等、并发已搬走、只写约定字段、两条汇总事件，
 * 以及本函数 constants / event-log 副本与权威源逐字一致。不连接真实 CloudBase。
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');
const C = require('../cloudfunctions/moveItems/constants');

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

const clone = (value) => JSON.parse(JSON.stringify(value));
const NOW = 1_800_000_000_000;
const PAIR = ['me', 'pe'];

function progress(meEp, peEp) {
  return { me: { ep: meEp, status: 'watching', rev: 1, updateTime: 10 }, pe: { ep: peEp, status: 'watching', rev: 1, updateTime: 10 } };
}

function defaultState() {
  const board = (id, name, o) => Object.assign({ _id: id, name, status: 'full', memberOpenids: PAIR.slice(), updateTime: 1 }, o);
  const it = (id, boardId, name, o) => Object.assign({
    _id: id,
    boardId,
    name,
    sourceId: null,
    deleted: false,
    memberOpenids: PAIR.slice(),
    progress: progress(3, 5),
    sortOrder: { me: 7 },
    togetherWatch: { active: true, version: 2 },
    updateTime: 10,
  }, o);
  return {
    shared_boards: {
      jul: board('jul', '七月新番'),
      oct: board('oct', '十月新番'),
      solo: board('solo', '筹备板', { memberOpenids: ['me'] }),
      other: board('other', '和别人的板', { memberOpenids: ['me', 'x'] }),
      old: board('old', '归档板', { status: 'archived' }),
    },
    shared_board_items: {
      a: it('a', 'jul', '长期番A'),
      b: it('b', 'jul', '长期番B', { sourceId: 42 }),
      dupName: it('dupName', 'jul', '十月已有'),
      dupSource: it('dupSource', 'jul', '名字不同的同一部', { sourceId: 99 }),
      gone: it('gone', 'jul', '软删的', { deleted: true }),
      foreign: it('foreign', 'other', '别的板的番'),
      t1: it('t1', 'oct', '十月已有'),
      t2: it('t2', 'oct', '十月同条目', { sourceId: 99 }),
    },
    shared_board_events: [],
  };
}

// ── 极简查询匹配：普通值相等，或 _.in 标记 ──
const IN = Symbol('in');
const command = { in: (values) => ({ [IN]: values }) };
function matches(doc, where) {
  return Object.keys(where).every((key) => {
    const cond = where[key];
    if (cond && cond[IN]) return cond[IN].includes(doc[key]);
    return doc[key] === cond;
  });
}

async function run() {
  let state;
  let openid;
  let itemUpdates;
  let boardUpdates;
  let beforeItemUpdate; // 并发注入：批量 update 执行前改写状态

  const reset = () => {
    state = defaultState();
    openid = 'me';
    itemUpdates = [];
    boardUpdates = [];
    beforeItemUpdate = null;
  };

  function query(name, where) {
    const rows = () => Object.values(state[name]).filter((doc) => matches(doc, where));
    let fields = null;
    let limit = Infinity;
    const api = {
      field(f) { fields = f; return api; },
      limit(n) { limit = n; return api; },
      async get() {
        const data = rows().slice(0, limit).map((doc) => {
          if (!fields) return clone(doc);
          const picked = { _id: doc._id };
          Object.keys(fields).forEach((k) => { if (fields[k] && doc[k] !== undefined) picked[k] = clone(doc[k]); });
          return picked;
        });
        return { data };
      },
      async count() { return { total: rows().length }; },
      async update({ data }) {
        if (beforeItemUpdate) { beforeItemUpdate(state); beforeItemUpdate = null; }
        const hit = rows();
        itemUpdates.push({ where: Object.keys(where), ids: hit.map((d) => d._id), data: clone(data) });
        hit.forEach((doc) => Object.assign(doc, clone(data)));
        return { stats: { updated: hit.length } };
      },
    };
    return api;
  }

  const db = {
    command,
    serverDate: () => NOW,
    collection(name) {
      if (name === C.COLLECTION.EVENT) {
        return { async add({ data }) { state.shared_board_events.push(clone(data)); return { _id: 'e' }; } };
      }
      return {
        where: (where) => query(name, where),
        doc(id) {
          return {
            async get() {
              const doc = state[name][id];
              if (!doc) throw new Error('document not found');
              return { data: clone(doc) };
            },
            async update({ data }) {
              boardUpdates.push({ id, data: clone(data) });
              Object.assign(state[name][id], clone(data));
              return { stats: { updated: 1 } };
            },
          };
        },
      };
    },
  };

  const cloudMock = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => db,
    getWXContext: () => ({ OPENID: openid }),
  };
  const originalLoad = Module._load;
  const indexPath = require.resolve('../cloudfunctions/moveItems/index');
  const items = () => state.shared_board_items;
  const events = () => state.shared_board_events;

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    const fn = require(indexPath);
    const move = (ids, from = 'jul', to = 'oct') => fn.main({ fromBoardId: from, toBoardId: to, itemIds: ids });

    // ── 正常搬：进度/排序/一起看/弹play 绑定原样保留，只改约定字段 ──
    reset();
    let r = await move(['a', 'b']);
    eq('搬番成功', r.ok, true);
    eq('返回已搬列表', r.data.moved, [{ itemId: 'a', name: '长期番A' }, { itemId: 'b', name: '长期番B' }]);
    eq('无跳过', r.data.skipped, []);
    eq('番归属改到目标板', [items().a.boardId, items().b.boardId], ['oct', 'oct']);
    eq('批量更新带来源板条件', itemUpdates[0].where.sort(), ['_id', 'boardId', 'deleted']);
    eq('只写约定字段', Object.keys(itemUpdates[0].data).sort(), ['boardId', 'memberOpenids', 'movedAt', 'updateTime']);
    eq('写入 movedAt', items().a.movedAt, NOW);
    eq('双方进度原样保留', items().a.progress, progress(3, 5));
    eq('排序值与一起看标记原样保留', [items().b.sortOrder, items().b.togetherWatch, items().b.sourceId], [{ me: 7 }, { active: true, version: 2 }, 42]);
    eq('两个板都 bump updateTime', boardUpdates.map((u) => [u.id, u.data]), [['jul', { updateTime: NOW }], ['oct', { updateTime: NOW }]]);
    eq('两个板各记一条汇总事件', events().map((e) => [e.boardId, e.type, e.payload.board, e.payload.items.length, e.itemId]), [
      ['jul', C.EVENT_TYPE.ITEMS_MOVE_OUT, '十月新番', 2, ''],
      ['oct', C.EVENT_TYPE.ITEMS_MOVE_IN, '七月新番', 2, ''],
    ]);
    eq('事件冗余成员供读规则', events()[0].memberOpenids, PAIR);

    // ── 重试幂等：已在目标板的算成功，不再写、不重复记历史 ──
    itemUpdates = [];
    boardUpdates = [];
    r = await move(['a', 'b']);
    eq('重试仍返回成功', r.data.moved.map((m) => m.itemId), ['a', 'b']);
    eq('重试不再写番', itemUpdates.length, 0);
    eq('重试不 bump 板', boardUpdates.length, 0);
    eq('重试不重复记历史', events().length, 2);

    // ── 判重跳过：同名 / 同一弹弹play条目；其余照搬 ──
    reset();
    r = await move(['a', 'dupName', 'dupSource']);
    eq('只搬不重复的', r.data.moved.map((m) => m.itemId), ['a']);
    eq('重复番按原因跳过', r.data.skipped, [
      { itemId: 'dupName', name: '十月已有', reason: C.MOVE_SKIP_REASON.DUPLICATE },
      { itemId: 'dupSource', name: '名字不同的同一部', reason: C.MOVE_SKIP_REASON.DUPLICATE },
    ]);
    eq('重复番留在来源板', [items().dupName.boardId, items().dupSource.boardId], ['jul', 'jul']);

    // 本次一起搬的两部互相重复（同一弹play条目）：只搬第一部
    reset();
    items().b2 = Object.assign(clone(items().b), { _id: 'b2', name: '长期番B 另一个名字' });
    r = await move(['b', 'b2']);
    eq('同批次互相重复只搬第一部', [r.data.moved.map((m) => m.itemId), r.data.skipped.map((s) => s.itemId)], [['b'], ['b2']]);

    // ── 不在来源板：软删、别的板、不存在；别的板的番名不外泄 ──
    reset();
    r = await move(['gone', 'foreign', 'nope', 'a']);
    eq('不在来源板的跳过', r.data.skipped.map((s) => [s.itemId, s.reason]), [
      ['gone', C.MOVE_SKIP_REASON.NOT_IN_SOURCE],
      ['foreign', C.MOVE_SKIP_REASON.NOT_IN_SOURCE],
      ['nope', C.MOVE_SKIP_REASON.NOT_IN_SOURCE],
    ]);
    eq('别的板的番不回传番名', r.data.skipped.find((s) => s.itemId === 'foreign').name, '');
    eq('别的板的番不被改动', items().foreign.boardId, 'other');

    // ── 并发：分类后、写入前对方已把番搬走 → 条件更新不命中，计为已不在原板 ──
    reset();
    beforeItemUpdate = (s) => { s.shared_board_items.b.boardId = 'elsewhere'; };
    r = await move(['a', 'b']);
    eq('并发已搬走的不算成功', r.data.moved.map((m) => m.itemId), ['a']);
    eq('并发已搬走的计为已不在原板', r.data.skipped, [{ itemId: 'b', name: '长期番B', reason: C.MOVE_SKIP_REASON.NOT_IN_SOURCE }]);
    eq('汇总事件只含实际搬成功的', events()[0].payload.items.map((i) => i.itemId), ['a']);

    // 全部被跳过：不写板、不记历史
    reset();
    r = await move(['dupName']);
    eq('全部跳过仍返回成功', [r.ok, r.data.moved.length], [true, 0]);
    eq('全部跳过不写番不 bump 板', [itemUpdates.length, boardUpdates.length], [0, 0]);
    eq('全部跳过不记历史', events().length, 0);

    // ── 目标板上限：现有 + 本次可搬 超过 BOARD_ITEM_MAX 整次拒绝 ──
    reset();
    for (let i = 0; i < C.BOARD_ITEM_MAX - 3; i++) { // 目标板已有 t1、t2，再填到差 1 部满
      items()[`fill${i}`] = { _id: `fill${i}`, boardId: 'oct', name: `填充${i}`, deleted: false };
    }
    r = await move(['a']);
    eq('恰好到上限可以搬', r.ok, true);
    r = await move(['b']);
    eq('超过上限整次拒绝', r.code, C.ERR.MOVE_TARGET_FULL);
    eq('超限不写番', items().b.boardId, 'jul');

    // ── 拒绝路径：整次不写库 ──
    reset();
    const codeOf = async (args) => (await fn.main(args)).code;
    eq('无身份', await (async () => { openid = ''; const c = (await move(['a'])).code; openid = 'me'; return c; })(), C.ERR.UNAUTHENTICATED);
    eq('同一个板', await codeOf({ fromBoardId: 'oct', toBoardId: 'oct', itemIds: ['a'] }), C.ERR.INVALID_PARAM);
    eq('itemIds 不是数组', await codeOf({ fromBoardId: 'jul', toBoardId: 'oct', itemIds: 'a' }), C.ERR.INVALID_PARAM);
    eq('itemIds 为空', await codeOf({ fromBoardId: 'jul', toBoardId: 'oct', itemIds: [] }), C.ERR.INVALID_PARAM);
    eq(
      '超过单次上限',
      await codeOf({ fromBoardId: 'jul', toBoardId: 'oct', itemIds: Array.from({ length: C.MOVE_ITEMS_MAX + 1 }, (_, i) => `x${i}`) }),
      C.ERR.INVALID_PARAM
    );
    eq('板不存在', (await move(['a'], 'jul', 'missing')).code, C.ERR.BOARD_NOT_FOUND);
    eq('目标板筹备态（成员不一致）', (await move(['a'], 'jul', 'solo')).code, C.ERR.MOVE_MEMBERS_MISMATCH);
    eq('不是同样两个人', (await move(['foreign'], 'other', 'oct')).code, C.ERR.MOVE_MEMBERS_MISMATCH);
    eq('归档板', (await move(['a'], 'jul', 'old')).code, C.ERR.BOARD_ARCHIVED);
    openid = 'pe';
    eq('对方成员也可以搬', (await move(['a'])).ok, true);
    reset();
    openid = 'stranger';
    eq('非成员', (await move(['a'])).code, C.ERR.NOT_MEMBER);
    eq('拒绝路径不写番', itemUpdates.length, 0);
    eq('拒绝路径不记历史', events().length, 0);

    // ── 副本守卫：constants / event-log 与 _shared-board 权威源逐字一致 ──
    const read = (dir, file) => fs.readFileSync(path.join(__dirname, '../cloudfunctions', dir, file), 'utf8');
    eq('moveItems/constants.js 与权威源逐字一致', read('moveItems', 'constants.js') === read('_shared-board', 'constants.js'), true);
    eq('moveItems/event-log.js 与权威源逐字一致', read('moveItems', 'event-log.js') === read('_shared-board', 'event-log.js'), true);
  } finally {
    Module._load = originalLoad;
  }
}

run()
  .catch((e) => {
    fail++;
    failures.push(`  ❌ 云函数测试异常\n     ${e && e.stack ? e.stack : e}`);
  })
  .finally(() => {
    console.log('\nmoveItems 云函数测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
