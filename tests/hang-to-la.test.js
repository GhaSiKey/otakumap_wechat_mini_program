const assert = require('assert');
const api = require('../miniprogram/packageFeatures/utils/shared-board/cloud-api');
const R = require('../miniprogram/packageFeatures/utils/hang-to-la/ranking-model');
const { drawPoster } = require('../miniprogram/packageFeatures/utils/hang-to-la/poster');

const pagePath = require.resolve('../miniprogram/packageFeatures/pages/hang-to-la/hang-to-la');
const componentPath = require.resolve('../miniprogram/packageFeatures/components/hang-to-la-board/hang-to-la-board');
const originals = { Page: global.Page, Component: global.Component, wx: global.wx, getBoardDetail: api.getBoardDetail };
const CHECKLIST_KEY = 'anime_checklist_data';
const OLD_PREFIX = 'otakumap:shared-board-ranking:v1:';
const clone = (value) => value === undefined ? value : JSON.parse(JSON.stringify(value));
const key = (source, id, suffix) => R.getRankingStorageKey(source, id, suffix);
const event = (dataset) => ({ currentTarget: { dataset } });
let pageDefinition;
let componentDefinition;
let environment;

function setup(initialStorage, boards) {
  const storage = new Map(Object.entries(clone(initialStorage || {})));
  const state = { storage, writes: [], reads: [], toasts: [], modals: [], images: [], saved: [] };
  state.getBoardDetail = async (boardId) => {
    const result = boards && boards[boardId];
    return result ? clone(result) : { ok: false, code: 'ERR_NOT_FOUND' };
  };
  environment = state;
  global.wx = {
    getStorageSync(storageKey) { return storage.has(storageKey) ? clone(storage.get(storageKey)) : ''; },
    setStorageSync(storageKey, value) { state.writes.push({ key: storageKey, value: clone(value) }); storage.set(storageKey, clone(value)); },
    showToast(options) { state.toasts.push(options); },
    showModal(options) { state.modals.push(options); },
    vibrateShort() {},
    showLoading() {},
    hideLoading() {},
    getImageInfo(options) { state.images.push(options.src); options.success({ path: options.src }); },
    canvasToTempFilePath(options) { state.canvasExport = options; options.success({ tempFilePath: '/tmp/ranking-test.png' }); },
    saveImageToPhotosAlbum(options) {
      state.saved.push(options.filePath);
      options.success();
      if (state.onSaved) state.onSaved();
    },
  };
  return state;
}

function makePage() {
  const page = Object.assign({}, pageDefinition, { data: clone(pageDefinition.data) });
  page.setData = (patch) => Object.assign(page.data, patch);
  page._load = (...args) => {
    page.pendingLoad = pageDefinition._load.apply(page, args);
    return page.pendingLoad;
  };
  return page;
}

async function openPage(query) {
  const page = makePage();
  page.onLoad(query);
  await page.pendingLoad;
  return page;
}

function board(items, name = '测试共享板') {
  return { ok: true, data: { board: { name }, items } };
}

function makeComponent(items, title = '我的定制榜单') {
  const properties = Object.fromEntries(Object.entries(componentDefinition.properties).map(([name, config]) => [name, clone(config.value)]));
  properties.sourceItems = clone(items);
  properties.initialTitle = title;
  const component = Object.assign({}, componentDefinition.methods, {
    properties,
    data: Object.assign(clone(componentDefinition.data), properties),
    events: [],
    rects: R.RANKING_TIERS.concat({ id: '__pool__' }).map((tier, index) => ({ left: 20, top: 100 * index, width: 300, height: 70 })),
  });
  component.setData = (patch) => Object.assign(component.data, patch);
  component.triggerEvent = (name, detail) => component.events.push({ name, detail: clone(detail) });
  component.createSelectorQuery = () => {
    const query = {
      selectAll() { return query; },
      boundingClientRect(callback) { query.callback = callback; return query; },
      exec() { query.callback(component.rects); },
    };
    return query;
  };
  componentDefinition.lifetimes.attached.call(component);
  return component;
}

function mockCanvas() {
  const text = [];
  const ctx = {
    text,
    fillText(value) { text.push(value); },
    measureText(value) { return { width: String(value).length * 15 }; },
  };
  ['beginPath', 'moveTo', 'arcTo', 'closePath', 'save', 'clip', 'drawImage', 'restore', 'fillRect', 'arc', 'fill', 'lineTo', 'stroke', 'scale', 'setTransform'].forEach((method) => { ctx[method] = () => {}; });
  const canvas = {
    getContext() { return ctx; },
    createImage() { return { width: 100, height: 150, set src(value) { this.onload(); } }; },
  };
  return { ctx, canvas };
}

const cases = [];
function test(name, run) { cases.push({ name, run }); }

test('checklist loads all watch statuses without writing source data and refreshes on return', async () => {
  const originalList = { version: 2, items: [
    { id: 'want', name: '想看的番', status: 'want', totalEp: 12, currentEp: 0 },
    { id: 'done', name: '看完的番', status: 'done', totalEp: 24, currentEp: 24 },
    { id: 'dropped', name: '弃掉的番', status: 'dropped', totalEp: 12, currentEp: 3 },
  ] };
  const state = setup({ [CHECKLIST_KEY]: originalList });
  const page = await openPage({ source: 'anime-checklist' });
  assert.strictEqual(page.data.failed, false);
  assert.strictEqual(page.data.loading, false);
  assert.deepStrictEqual(page.data.items.map((item) => item.id), ['want', 'done', 'dropped']);
  assert.deepStrictEqual(state.reads, [], '追踪来源不能读取云端共享板');
  page.onItemsChange({ detail: { items: R.moveItem(page.data.items, 'dropped', 'hang') } });
  page.onTitleChange({ detail: { title: '我的追踪排行' } });
  assert.deepStrictEqual(state.storage.get(CHECKLIST_KEY), originalList, '排行操作不能修改番剧状态或进度');
  assert.ok(state.writes.every((write) => write.key !== CHECKLIST_KEY));
  state.storage.set(CHECKLIST_KEY, { version: 2, items: originalList.items.slice(1).concat({ id: 'new', name: '后来加入', status: 'watching' }) });
  page.onShow();
  await page.pendingLoad;
  assert.deepStrictEqual(page.data.items.map((item) => item.id), ['done', 'dropped', 'new']);
  assert.strictEqual(page.data.items.find((item) => item.id === 'dropped').tierId, 'hang');
  assert.strictEqual(page.data.items.find((item) => item.id === 'new').tierId, null);
  assert.strictEqual(page.data.rankingTitle, '我的追踪排行');
});

test('ranking and title storage stay isolated across boards and checklist', async () => {
  const state = setup({ [CHECKLIST_KEY]: [{ id: 'same', name: '本地番', status: 'want' }] }, {
    'board-a': board([{ _id: 'same', name: '板 A 的番' }], '板 A'),
    'board-b': board([{ _id: 'same', name: '板 B 的番' }], '板 B'),
  });
  for (const [query, tierId, title] of [
    [{ source: 'shared-board', boardId: 'board-a' }, 'hang', 'A 榜'],
    [{ source: 'shared-board', boardId: 'board-b' }, 'la', 'B 榜'],
    [{ source: 'anime-checklist' }, 'top', '本地榜'],
  ]) {
    const page = await openPage(query);
    assert.strictEqual(page.data.items[0].tierId, null);
    page.onItemsChange({ detail: { items: R.moveItem(page.data.items, 'same', tierId) } });
    page.onTitleChange({ detail: { title } });
  }
  for (const [source, id, tierId, title] of [
    ['shared-board', 'board-a', 'hang', 'A 榜'],
    ['shared-board', 'board-b', 'la', 'B 榜'],
    ['anime-checklist', 'default', 'top', '本地榜'],
  ]) {
    assert.deepStrictEqual(R.deserialize(state.storage.get(key(source, id))), [{ id: 'same', tierId }]);
    assert.strictEqual(state.storage.get(key(source, id, 'title')), title);
    const reopened = await openPage({ source, boardId: source === 'shared-board' ? id : undefined });
    assert.strictEqual(reopened.data.items[0].tierId, tierId);
    assert.strictEqual(reopened.data.rankingTitle, title);
  }
});

test('legacy board ranking and title migrate without resurrecting deleted entries', async () => {
  const oldRankingKey = OLD_PREFIX + 'legacy';
  const state = setup({
    [oldRankingKey]: JSON.stringify([{ id: 'kept', tierId: 'human' }, { id: 'deleted', tierId: 'hang' }, { id: 'missing', tierId: 'la' }]),
    [oldRankingKey + ':title']: '旧榜标题',
  }, { legacy: board([{ _id: 'kept', name: '保留', cover: 'https://example.com/new.jpg' }, { _id: 'deleted', name: '已删除', deleted: true }]) });
  const page = await openPage({ source: 'shared-board', boardId: 'legacy' });
  assert.deepStrictEqual(page.data.items.map((item) => [item.id, item.tierId]), [['kept', 'human']]);
  assert.strictEqual(page.data.items[0].cover, 'https://example.com/new.jpg');
  assert.strictEqual(page.data.rankingTitle, '旧榜标题');
  assert.deepStrictEqual(R.deserialize(state.storage.get(key('shared-board', 'legacy'))), [{ id: 'kept', tierId: 'human' }]);
  assert.strictEqual(state.storage.get(key('shared-board', 'legacy', 'title')), '旧榜标题');
  state.storage.delete(oldRankingKey);
  state.storage.delete(oldRankingKey + ':title');
  const reopened = await openPage({ source: 'shared-board', boardId: 'legacy' });
  assert.strictEqual(reopened.data.items[0].tierId, 'human');
  assert.strictEqual(reopened.data.rankingTitle, '旧榜标题');
});

test('new saved values take precedence over legacy fallback even when ranking is empty', async () => {
  setup({
    [OLD_PREFIX + 'legacy']: JSON.stringify([{ id: 'a', tierId: 'hang' }]),
    [OLD_PREFIX + 'legacy:title']: '旧标题',
    [key('shared-board', 'legacy')]: '[]',
    [key('shared-board', 'legacy', 'title')]: '新标题',
  }, { legacy: board([{ _id: 'a', name: '番剧' }]) });
  const page = await openPage({ source: 'shared-board', boardId: 'legacy' });
  assert.strictEqual(page.data.items[0].tierId, null);
  assert.strictEqual(page.data.rankingTitle, '新标题');
});

test('invalid source and missing board fail before cloud reads or persistence', async () => {
  for (const query of [{ source: 'unknown', boardId: 'valid' }, { source: 'shared-board' }]) {
    const state = setup({}, { valid: board([{ _id: 'a', name: '不应读取' }]) });
    const page = await openPage(query);
    assert.strictEqual(page.data.failed, true, JSON.stringify(query));
    assert.strictEqual(page.data.loading, false);
    assert.deepStrictEqual(page.data.items, []);
    assert.deepStrictEqual(state.reads, []);
    assert.deepStrictEqual(state.writes, []);
  }
});

test('unavailable board does not overwrite a saved local ranking', async () => {
  const storageKey = key('shared-board', 'missing');
  const saved = JSON.stringify([{ id: 'saved', tierId: 'hang' }]);
  const state = setup({ [storageKey]: saved });
  const page = await openPage({ source: 'shared-board', boardId: 'missing' });
  assert.strictEqual(page.data.failed, true);
  assert.strictEqual(page.data.loading, false);
  assert.deepStrictEqual(state.reads, ['missing']);
  assert.strictEqual(state.storage.get(storageKey), saved);
  assert.deepStrictEqual(state.writes, []);
  assert.ok(state.toasts.length);
});

test('component uses separate input and derived items and handles choosing a tier', () => {
  setup();
  assert.ok(componentDefinition.properties.sourceItems, '输入列表需要独立属性，避免 items observer/setData 循环');
  assert.strictEqual(componentDefinition.properties.items, undefined);
  const input = R.normalizeItems([{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]);
  const component = makeComponent(input);
  assert.strictEqual(component.data.totalCount, 2);
  component.onRankedItemTap(event({ id: 'a' }));
  assert.strictEqual(component.data.selectedTierLabel, '待排区');
  component.onChooseTier(event({ tierId: 'top' }));
  assert.strictEqual(component.data.items[0].tierId, 'top');
  assert.strictEqual(component.data.rankedCount, 1);
  assert.strictEqual(component.data.progressPercent, 50);
  assert.strictEqual(component.data.selectedItem, null);
  assert.strictEqual(component.events[0].name, 'change');
  assert.strictEqual(input[0].tierId, null, '组件不能原地修改来源列表');
  component.onRankedItemTap(event({ id: 'a' }));
  assert.strictEqual(component.data.selectedTierLabel, '顶级');
  component.onChooseTier(event({ tierId: '__pool__' }));
  assert.strictEqual(component.data.rankedCount, 0);
  assert.strictEqual(component.data.unrankedItems.length, 2);
  componentDefinition.observers.sourceItems.call(component, R.moveItem(input, 'b', 'hang'));
  assert.strictEqual(component.data.tiers[0].items[0].id, 'b');
  assert.strictEqual(component.events.length, 2, '同步父页面输入不应反向再发 change');
});

test('clear cancellation preserves tiers and confirmed clear preserves title', () => {
  const state = setup();
  const component = makeComponent(R.normalizeItems([{ id: 'a', name: '甲' }], [{ id: 'a', tierId: 'hang' }]));
  component.onTitleInput({ detail: { value: '自定义标题' } });
  const initialEvents = component.events.length;
  component.onClear();
  state.modals[0].success({ confirm: false, cancel: true });
  assert.strictEqual(component.data.items[0].tierId, 'hang');
  assert.strictEqual(component.events.length, initialEvents);
  component.onClear();
  state.modals[1].success({ confirm: true });
  assert.strictEqual(component.data.items[0].tierId, null);
  assert.strictEqual(component.data.unrankedItems.length, 1);
  assert.strictEqual(component.data.rankingTitle, '自定义标题');
  assert.strictEqual(component.events.at(-1).name, 'change');
  component.onClear();
  assert.strictEqual(state.modals.length, 2, '已经清空时无需重复弹窗');
});

test('drag hit testing allows near-edge targets and return to pool', () => {
  setup();
  const component = makeComponent(R.normalizeItems([{ id: 'a', name: '甲' }]));
  component.onDragStart(event({ id: 'a' }));
  component.onDragMove({ touches: [{ clientX: 20 - R.RANKING_UI_CONFIG.dragHitSlop, clientY: 35 }] });
  assert.strictEqual(component.data.dragOverTierId, 'hang');
  component.onDragEnd();
  assert.strictEqual(component.data.items[0].tierId, 'hang');
  assert.strictEqual(component.data.dragItemId, '');
  component.onDragStart(event({ id: 'a' }));
  component.onDragMove({ touches: [{ pageX: 60, pageY: R.RANKING_TIERS.length * 100 + 35 }] });
  assert.strictEqual(component.data.dragOverTierId, '__pool__');
  component.onDragEnd();
  assert.strictEqual(component.data.items[0].tierId, null);
});

test('moving out of all targets or canceling drag never changes the item tier', () => {
  const state = setup();
  const component = makeComponent(R.normalizeItems([{ id: 'a', name: '甲' }], [{ id: 'a', tierId: 'la' }]));
  component.onDragStart(event({ id: 'a' }));
  component.onDragMove({ touches: [{ clientX: 60, clientY: 35 }] });
  assert.strictEqual(component.data.dragOverTierId, 'hang');
  component.onDragMove({ touches: [{ clientX: 1000, clientY: 35 }] });
  assert.strictEqual(component.data.dragOverTierId, '');
  component.onDragEnd();
  assert.strictEqual(component.data.items[0].tierId, 'la');
  assert.deepStrictEqual(component.events, []);
  assert.strictEqual(state.toasts.at(-1).title, R.RANKING_UI_CONFIG.dragOutsideHint);
  component.onDragStart(event({ id: 'a' }));
  component.onDragMove({ touches: [{ clientX: 60, clientY: 135 }] });
  component.onDragCancel();
  component.onDragEnd();
  assert.strictEqual(component.data.items[0].tierId, 'la');
  assert.strictEqual(component.data.dragItemId, '');
  assert.strictEqual(component.data.dragOverTierId, '');
  assert.deepStrictEqual(component.events, []);
});

test('component export includes ranked tiers and rejects empty rankings', () => {
  const state = setup();
  const input = R.normalizeItems([{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]);
  const component = makeComponent(input);
  component.onExport();
  assert.deepStrictEqual(component.events, []);
  assert.ok(state.toasts.length);
  componentDefinition.observers.sourceItems.call(component, R.moveItem(input, 'a', 'hang'));
  component.onExport();
  const exported = component.events.at(-1);
  assert.strictEqual(exported.name, 'export');
  assert.strictEqual(exported.detail.rankedCount, 1);
  assert.deepStrictEqual(exported.detail.tiers.flatMap((tier) => tier.items).map((item) => item.id), ['a']);
  assert.strictEqual(exported.detail.rankingTitle, '我的定制榜单');
});

test('poster renderer draws the supplied source subtitle and branding', () => {
  const tiers = R.RANKING_TIERS.map((tier) => Object.assign({}, tier, { items: [] }));
  for (const subtitle of ['番剧追踪 · 从夯到拉', '共享追番板 · 从夯到拉']) {
    const { ctx } = mockCanvas();
    drawPoster(ctx, 900, {}, tiers.map(() => 120), tiers, null, 0, '我的标题', Object.assign({}, R.RANKING_POSTER_CONFIG, { subtitle }));
    assert.ok(ctx.text.includes(subtitle));
    assert.ok(ctx.text.includes('我的标题'));
    assert.ok(ctx.text.includes(R.RANKING_POSTER_CONFIG.footerTitle));
    assert.ok(ctx.text.includes(R.RANKING_POSTER_CONFIG.footerCopy));
  }
});

test('page export carries source subtitle, uses high resolution, and loads only ranked covers', async () => {
  for (const [source, subtitle] of [['anime-checklist', '番剧追踪 · 从夯到拉'], ['shared-board', '共享追番板 · 从夯到拉']]) {
    const rawItems = [{ id: 'a', name: '甲', cover: 'https://example.com/a.jpg' }, { id: 'b', name: '乙', cover: 'https://example.com/b.jpg' }];
    const state = setup({ [CHECKLIST_KEY]: rawItems }, { export: board(rawItems) });
    const page = await openPage({ source, boardId: 'export' });
    const { ctx, canvas } = mockCanvas();
    page.createSelectorQuery = () => {
      const query = { select() { return query; }, fields() { return query; }, exec(callback) { callback([{ node: canvas }]); } };
      return query;
    };
    const saved = new Promise((resolve) => { state.onSaved = resolve; });
    const items = R.moveItem(page.data.items, 'a', 'hang');
    const tiers = R.RANKING_TIERS.map((tier) => Object.assign({}, tier, { items: R.getTierItems(items, tier.id) }));
    await page.onExport({ detail: { tiers, rankedCount: 1, rankingTitle: '导出标题' } });
    await saved;
    assert.ok(ctx.text.includes(subtitle));
    assert.ok(ctx.text.includes('导出标题'));
    assert.strictEqual(canvas.width, R.RANKING_POSTER_CONFIG.canvasWidth * R.RANKING_POSTER_CONFIG.scale);
    assert.strictEqual(state.canvasExport.destWidth, canvas.width);
    assert.strictEqual(state.canvasExport.destHeight, canvas.height);
    assert.ok(state.images.includes(rawItems[0].cover));
    assert.ok(!state.images.includes(rawItems[1].cover), '待排区封面不应进入导出图片读取');
    assert.strictEqual(page._exporting, false);
  }
});

async function run() {
  global.Page = (definition) => { pageDefinition = definition; };
  global.Component = (definition) => { componentDefinition = definition; };
  api.getBoardDetail = async (boardId) => {
    environment.reads.push(boardId);
    return environment.getBoardDetail(boardId);
  };
  delete require.cache[pagePath];
  delete require.cache[componentPath];
  require(pagePath);
  require(componentPath);
  let failures = 0;
  for (const { name, run: runCase } of cases) {
    try { await runCase(); } catch (error) {
      failures += 1;
      console.error('FAIL: ' + name);
      console.error(error.stack);
    }
  }
  assert.strictEqual(failures, 0, `${failures} hang-to-la regression case(s) failed`);
  console.log(`hang-to-la tests: passed (${cases.length} cases)`);
}

run().catch((error) => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  global.Page = originals.Page;
  global.Component = originals.Component;
  global.wx = originals.wx;
  api.getBoardDetail = originals.getBoardDetail;
  delete require.cache[pagePath];
  delete require.cache[componentPath];
});
