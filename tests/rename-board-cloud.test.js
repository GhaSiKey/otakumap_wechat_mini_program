/**
 * renameBoard 云函数测试。
 *
 * 用内存版 wx-server-sdk 验证：成员校验、trim/截断/拒空、同名不写库、
 * 只写 name/updateTime/自己的 lastViewedAt（不整组覆盖 members），以及历史事件。
 * 不连接真实 CloudBase。
 */
const Module = require('module');
const C = require('../cloudfunctions/renameBoard/constants');

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

function defaultBoard() {
  return {
    _id: 'board-1',
    name: '我俩的番单',
    memberOpenids: ['me', 'peer'],
    members: [{ openid: 'me', nickname: '甲' }, { openid: 'peer', nickname: '乙' }],
    updateTime: 1,
  };
}

async function run() {
  const fixedNow = 1_800_000_000_000;
  let board;
  let updates;
  let events;
  let currentOpenid;

  const reset = () => {
    board = defaultBoard();
    updates = [];
    events = [];
    currentOpenid = 'me';
  };

  const db = {
    serverDate: () => fixedNow,
    collection(name) {
      if (name === C.COLLECTION.EVENT) {
        return {
          async add({ data }) {
            events.push(clone(data));
            return { _id: `event-${events.length}` };
          },
        };
      }
      return {
        doc(id) {
          return {
            async get() {
              if (name !== C.COLLECTION.BOARD || !board || id !== board._id) throw new Error('document not found');
              return { data: clone(board) };
            },
            async update({ data }) {
              updates.push(clone(data));
              Object.assign(board, clone(data));
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
    getWXContext: () => ({ OPENID: currentOpenid }),
  };
  const originalLoad = Module._load;
  const indexPath = require.resolve('../cloudfunctions/renameBoard/index');

  try {
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === 'wx-server-sdk') return cloudMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[indexPath];
    const fn = require(indexPath);

    // 正常改名：trim 后写入，只动三个字段
    reset();
    let r = await fn.main({ boardId: 'board-1', name: '  周末补番局  ' });
    eq('改名成功返回 trim 后的名字', r, { ok: true, code: C.ERR.OK, data: { boardId: 'board-1', name: '周末补番局' } });
    eq('只写 name/updateTime/自己的 lastViewedAt', updates, [
      { name: '周末补番局', updateTime: fixedNow, 'lastViewedAt.me': fixedNow },
    ]);
    eq('不改动 members', board.members, defaultBoard().members);
    eq('追加一条板改名事件', events.map((e) => [e.type, e.actor, e.itemId, e.payload]), [
      [C.EVENT_TYPE.BOARD_RENAME, 'me', '', { name: '周末补番局', prevName: '我俩的番单' }],
    ]);
    eq('事件冗余成员列表供读规则', events[0].memberOpenids, ['me', 'peer']);

    // 超长截断到 BOARD_NAME_MAX
    reset();
    r = await fn.main({ boardId: 'board-1', name: '长'.repeat(C.BOARD_NAME_MAX + 5) });
    eq('超长板名截断到上限', r.data.name.length, C.BOARD_NAME_MAX);

    // 对方也能改（板名双方共享）
    reset();
    currentOpenid = 'peer';
    r = await fn.main({ boardId: 'board-1', name: 'TA 起的名' });
    eq('对方成员可改名', r.ok, true);
    eq('对方改名只标记对方自己已读', Object.keys(updates[0]).sort(), ['lastViewedAt.peer', 'name', 'updateTime']);

    // 同名：不写库、不记历史
    reset();
    r = await fn.main({ boardId: 'board-1', name: ' 我俩的番单 ' });
    eq('同名直接成功', r.ok, true);
    eq('同名不写库', updates.length, 0);
    eq('同名不记历史', events.length, 0);

    // 拒绝路径
    reset();
    r = await fn.main({ boardId: 'board-1', name: '   ' });
    eq('空白板名拒绝', r.code, C.ERR.INVALID_PARAM);
    r = await fn.main({ boardId: 'board-1', name: 123 });
    eq('非字符串板名拒绝', r.code, C.ERR.INVALID_PARAM);
    r = await fn.main({ name: '新名' });
    eq('缺 boardId 拒绝', r.code, C.ERR.INVALID_PARAM);
    r = await fn.main({ boardId: 'missing', name: '新名' });
    eq('板不存在', r.code, C.ERR.BOARD_NOT_FOUND);
    currentOpenid = 'stranger';
    r = await fn.main({ boardId: 'board-1', name: '新名' });
    eq('非成员拒绝', r.code, C.ERR.NOT_MEMBER);
    currentOpenid = '';
    r = await fn.main({ boardId: 'board-1', name: '新名' });
    eq('无身份拒绝', r.code, C.ERR.UNAUTHENTICATED);
    eq('拒绝路径均不写库', updates.length, 0);
    eq('拒绝路径均不记历史', events.length, 0);

    // 副本守卫：本函数的 constants / event-log 必须与 _shared-board 权威源逐字一致
    const fs = require('fs');
    const path = require('path');
    const read = (dir, file) => fs.readFileSync(path.join(__dirname, '../cloudfunctions', dir, file), 'utf8');
    eq('renameBoard/constants.js 与权威源逐字一致', read('renameBoard', 'constants.js') === read('_shared-board', 'constants.js'), true);
    eq('renameBoard/event-log.js 与权威源逐字一致', read('renameBoard', 'event-log.js') === read('_shared-board', 'event-log.js'), true);
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
    console.log('\nrenameBoard 云函数测试');
    console.log('─'.repeat(40));
    if (failures.length) {
      console.log(failures.join('\n'));
      console.log('─'.repeat(40));
    }
    console.log(`通过 ${pass} / 失败 ${fail}`);
    process.exitCode = fail ? 1 : 0;
  });
