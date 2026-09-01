const assert = require('assert');
const fs = require('fs');
const path = require('path');

const api = require('../miniprogram/packageFeatures/utils/shared-board/cloud-api');
const pagePath = require.resolve('../miniprogram/packageFeatures/pages/together-watch/together-watch');

const originals = {
  Page: global.Page,
  wx: global.wx,
  getMyOpenid: api.getMyOpenid,
  getBoardDetail: api.getBoardDetail,
  togetherWatch: api.togetherWatch,
};

let pageDefinition;
const toasts = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makePage() {
  const page = Object.assign({}, pageDefinition);
  page.data = clone(pageDefinition.data);
  page.setData = (patch) => Object.assign(page.data, patch);
  page._unloaded = false;
  return page;
}

function eventWithItem(itemId) {
  return { currentTarget: { dataset: { itemId } } };
}

function item(id, active, mineEp, peerEp, extra) {
  const togetherWatch = active == null ? undefined : { active, version: 1 };
  return Object.assign({
    _id: id,
    boardId: 'board-1',
    name: `番-${id}`,
    deleted: false,
    totalEp: 12,
    togetherWatch,
    progress: {
      me: { ep: mineEp, status: mineEp ? 'watching' : 'want' },
      peer: { ep: peerEp, status: peerEp ? 'watching' : 'want' },
    },
    sortOrder: { me: id === 'active' ? 1 : 2 },
  }, extra || {});
}

const board = {
  _id: 'board-1',
  name: '测试板',
  status: 'full',
  members: [
    { openid: 'me', nickname: '小明' },
    { openid: 'peer', nickname: '小红' },
  ],
};

async function run() {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../miniprogram/packageFeatures/pages/together-watch/together-watch.wxml'),
    'utf8'
  );
  assert.match(
    wxml,
    /<scroll-view wx:if="\{\{candidates\.length\}\}" class="candidate-list"/,
    '候选列表的 wx:if 属性必须完整闭合，避免 WXML 编译失败'
  );

  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    showToast(options) { toasts.push(options); },
    stopPullDownRefresh() {},
  };
  delete require.cache[pagePath];
  require(pagePath);

  // active 主字段、灰度兼容字段、未删除过滤及双方状态展示。
  const page = makePage();
  page.data.boardId = board._id;
  const active = item('active', true, 2, 5);
  const inactive = item('inactive', false, 1, 1);
  const legacy = item('legacy', null, 3, 4, { togetherWatchActive: true });
  const removed = item('removed', true, 1, 1, { deleted: true });
  page._applyDetail(board, [inactive, removed, legacy, active], 'me');
  assert.strictEqual(page.data.mode, 'paired');
  assert.deepStrictEqual(page.data.watchItems.map((entry) => entry.itemId), ['legacy', 'active']);
  assert.deepStrictEqual(page.data.candidates.map((entry) => entry.itemId), ['inactive']);
  const activeView = page.data.watchItems.find((entry) => entry.itemId === 'active');
  assert.strictEqual(activeView.mineStatus, '在追');
  assert.strictEqual(activeView.peerStatus, '在追');

  // max(双方 ep)+n：落后方实际变化更大；总集数会截断，预览必须如实呈现。
  const preview = page._buildAdvancePreview(activeView, 3);
  assert.strictEqual(preview.targetEp, 8);
  assert.strictEqual(preview.mineDelta, 6);
  assert.strictEqual(preview.peerDelta, 3);
  const capped = page._buildAdvancePreview(Object.assign({}, activeView, {
    mineEp: 11,
    peerEp: 12,
    totalEp: 12,
  }), 3);
  assert.strictEqual(capped.targetEp, 12);
  assert.strictEqual(capped.mineDelta, 1);
  assert.strictEqual(capped.peerDelta, 0);
  assert.strictEqual(capped.clamped, true);

  // 确认层打开期间刷新到 TA 的新进度，应重算预览而不是继续提交旧快照。
  const refreshPreviewPage = makePage();
  refreshPreviewPage._applyDetail(board, [active, inactive], 'me');
  refreshPreviewPage.onAdvanceTap(eventWithItem('active'));
  refreshPreviewPage._applyDetail(board, [item('active', true, 7, 7), inactive], 'me');
  assert.strictEqual(refreshPreviewPage.data.advanceItem.mineEp, 7);
  assert.strictEqual(refreshPreviewPage.data.advancePreview.targetEp, 8);

  // set 失败不乐观挪动条目；成功后才通过详情刷新进入 active 清单。
  page.data.mode = 'paired';
  let resolveSet;
  api.togetherWatch = () => new Promise((resolve) => { resolveSet = resolve; });
  const failedSet = page._setActive('inactive', true);
  assert.deepStrictEqual(page.data.watchItems.map((entry) => entry.itemId), ['legacy', 'active']);
  resolveSet({ ok: false, code: 'ERR_INTERNAL' });
  await failedSet;
  assert.deepStrictEqual(page.data.watchItems.map((entry) => entry.itemId), ['legacy', 'active']);

  let setPayload;
  api.getMyOpenid = async () => ({ ok: true, data: { openid: 'me' } });
  api.getBoardDetail = async () => ({
    ok: true,
    data: { board, items: [active, legacy, item('inactive', true, 1, 1)] },
  });
  api.togetherWatch = async (payload) => {
    setPayload = payload;
    return { ok: true };
  };
  await page._setActive('inactive', true);
  assert.deepStrictEqual(setPayload, {
    action: 'set',
    boardId: 'board-1',
    itemId: 'inactive',
    active: true,
  });
  assert.deepStrictEqual(page.data.watchItems.map((entry) => entry.itemId), ['active', 'legacy', 'inactive']);

  // advance 提交目标而非两次个人增量；服务端成功前页面进度保持原值，成功后仍留 active。
  page.onAdvanceTap(eventWithItem('active'));
  page.onSelectDelta({ currentTarget: { dataset: { delta: 3 } } });
  let advancePayload;
  let resolveAdvance;
  api.togetherWatch = (payload) => {
    advancePayload = payload;
    return new Promise((resolve) => { resolveAdvance = resolve; });
  };
  api.getBoardDetail = async () => ({
    ok: true,
    data: { board, items: [item('active', true, 8, 8), legacy, item('inactive', true, 1, 1)] },
  });
  const advancePromise = page.onConfirmAdvance();
  assert.strictEqual(page.data.watchItems.find((entry) => entry.itemId === 'active').mineEp, 2);
  assert.strictEqual(advancePayload.action, 'advance');
  assert.strictEqual(advancePayload.boardId, 'board-1');
  assert.strictEqual(advancePayload.itemId, 'active');
  assert.strictEqual(advancePayload.targetEp, 8);
  assert.match(advancePayload.requestId, /^tw_\d+_[a-z0-9]+$/);
  resolveAdvance({ ok: true });
  await advancePromise;
  const refreshed = page.data.watchItems.find((entry) => entry.itemId === 'active');
  assert.strictEqual(refreshed.mineEp, 8);
  assert.strictEqual(refreshed.peerEp, 8);
  assert.strictEqual(page.data.watchItems.some((entry) => entry.itemId === 'active'), true);

  // 回包丢失后的同目标重试复用 requestId；换增量才生成新的幂等键。
  page.onAdvanceTap(eventWithItem('active'));
  const retryIds = [];
  api.togetherWatch = async (payload) => {
    retryIds.push(payload.requestId);
    return { ok: false, code: 'ERR_INTERNAL' };
  };
  await page.onConfirmAdvance();
  await page.onConfirmAdvance();
  assert.strictEqual(retryIds[0], retryIds[1]);
  assert.strictEqual(page._advanceRequest.requestId, retryIds[0]);
  page.onSelectDelta({ currentTarget: { dataset: { delta: 2 } } });
  await page.onConfirmAdvance();
  assert.notStrictEqual(retryIds[1], retryIds[2]);

  // 超时后刷新若已看到原绝对目标，直接收口为成功，不再按 +n 生成第二次推进。
  const reconciledPage = makePage();
  reconciledPage.data.boardId = board._id;
  reconciledPage._applyDetail(board, [active], 'me');
  reconciledPage.onAdvanceTap(eventWithItem('active'));
  api.togetherWatch = async () => ({ ok: false, code: 'ERR_INTERNAL' });
  api.getBoardDetail = async () => ({
    ok: true,
    data: { board, items: [item('active', true, 6, 6)] },
  });
  await reconciledPage.onConfirmAdvance();
  assert.strictEqual(reconciledPage._advanceRequest, null);
  assert.strictEqual(reconciledPage.data.showAdvance, false);
  assert.strictEqual(reconciledPage.data.watchItems[0].mineEp, 6);

  // TA 并发移出/删番等确定性业务错误要丢弃旧请求并拉权威快照，不能无限提示重试。
  const stalePage = makePage();
  stalePage.data.boardId = board._id;
  stalePage._applyDetail(board, [active], 'me');
  stalePage.onAdvanceTap(eventWithItem('active'));
  api.togetherWatch = async () => ({ ok: false, code: 'ERR_ITEM_NOT_FOUND' });
  api.getBoardDetail = async () => ({ ok: true, data: { board, items: [] } });
  await stalePage.onConfirmAdvance();
  assert.strictEqual(stalePage._advanceRequest, null);
  assert.strictEqual(stalePage.data.showAdvance, false);
  assert.strictEqual(stalePage.data.watchItems.length, 0);

  // 归档板仍展示 active，但所有写入口进入只读态。
  const archivedPage = makePage();
  archivedPage._applyDetail(Object.assign({}, board, { status: 'archived' }), [active], 'me');
  assert.strictEqual(archivedPage.data.mode, 'archived');
  assert.strictEqual(archivedPage.data.readonly, true);
  assert.strictEqual(archivedPage.data.watchItems.length, 1);

  console.log('together-watch page tests: passed');
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    api.getMyOpenid = originals.getMyOpenid;
    if (originals.getBoardDetail === undefined) delete api.getBoardDetail;
    else api.getBoardDetail = originals.getBoardDetail;
    if (originals.togetherWatch === undefined) delete api.togetherWatch;
    else api.togetherWatch = originals.togetherWatch;
    delete require.cache[pagePath];
    if (originals.Page === undefined) delete global.Page;
    else global.Page = originals.Page;
    if (originals.wx === undefined) delete global.wx;
    else global.wx = originals.wx;
  });
