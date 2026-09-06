const { searchAnime, getAnimeDetail } = require('../../utils/anime-meta/cloud-api');
const { SEARCH_MODE, PICK_EVENT, preferDetailCover, airStatusOf } = require('../../utils/anime-meta/config');
const T = require('../../utils/anime-checklist/transform');
const { COPY, FILTERS } = require('../../utils/anime-checklist/config');

const STORAGE_KEY = 'anime_checklist_data';
const ANIME_SEARCH_URL = '/packageFeatures/pages/anime-search/anime-search';
const ANIM = { PHASE1: 400, PHASE2: 350, PHASE3: 400 };

function generateId() { return `anime_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`; }

Page({
  data: {
    inputValue: '', animeList: [], unwatchedList: [], watchedList: [], filteredList: [],
    watchedCount: 0, totalCount: 0, isEditMode: false,
    activeFilter: 'all', filters: [],
    summary: { total: 0, watched: 0, watching: 0, done: 0, progress: 0 },
    copy: COPY,
    showAdd: false, showSearch: false, adding: false, newItemName: '', newItemTotalEp: '',
    newItemPicked: false, newItemCover: '', newItemCoverError: false, pickedAnime: null,
    metaLoading: false, metaError: '', searchKeyword: '', searchResults: [], searchLoading: false, searched: false, searchHint: COPY.SEARCH_INITIAL,
    coverErrors: {},
    statusOptions: T.STATUSES.map((value) => ({ value, label: T.STATUS_LABELS[value] })),
    animatingId: '', animPhase: '', animDirection: '',
  },

  onLoad() { this._unloaded = false; this._pickedMeta = null; this._airMetaWait = null; this._searchRequestId = 0; this._loadStored(); },
  onShow() { if (this._loadedOnce) this._loadStored(); },
  onUnload() { this._unloaded = true; this._pickedMeta = null; this._airMetaWait = null; },

  _loadStored() {
    let saved; try { saved = wx.getStorageSync(STORAGE_KEY); } catch (e) { saved = []; }
    const migrated = T.migrateStoredValue(saved, Date.now()); this._loadedOnce = true;
    this._setLists(migrated.items, false);
    if (!saved || Array.isArray(saved) || saved.version !== T.VERSION) this._saveData(migrated.items);
  },

  _setLists(items, save = true) {
    const vm = T.splitLists(items); const filter = this.data.activeFilter || 'all';
    const filteredList = filter === 'all' ? vm.animeList : vm.animeList.filter((it) => filter === 'watching' ? ['watching', 'caught_up'].includes(it.status) : it.status === filter);
    const coverErrors = this.data.coverErrors || {};
    vm.animeList.forEach((item) => { item.coverError = !!coverErrors[item.id]; });
    const watching = vm.animeList.filter((it) => it.status === 'watching' || it.status === 'caught_up').length;
    const progressItems = vm.animeList.filter((it) => typeof it.progressPercent === 'number');
    const summary = { total: vm.totalCount, watched: vm.watchedCount, done: vm.watchedCount, watching, progress: progressItems.length ? Math.round(progressItems.reduce((sum, it) => sum + it.progressPercent, 0) / progressItems.length) : 0 };
    const countOf = (key) => key === 'all' ? vm.totalCount : key === 'watching' ? watching : vm.animeList.filter((it) => it.status === key).length;
    const filters = FILTERS.map((item) => ({ ...item, count: countOf(item.key) }));
    this.setData({ ...vm, filteredList, summary, filters, activeFilter: filter }); if (save) this._saveData(vm.animeList);
  },
  // 旧页面/调试脚本仍可能调用此名称，保留别名避免迁移期间断链。
  _updateLists(items) { this._setLists(items); },
  _saveData(items) { try { wx.setStorageSync(STORAGE_KEY, { version: T.VERSION, items }); } catch (e) {} },

  onInputChange(e) { this.setData({ inputValue: (e.detail && (e.detail.value ?? e.detail)) || '' }); },
  onOpenSearch() {
    // 每次打开都开启一轮全新的搜索会话，避免上一次关闭前的请求迟到回写。
    this._searchRequestId += 1;
    this.setData({ showSearch: true, searchKeyword: '', searchResults: [], searchLoading: false, searched: false, searchHint: COPY.SEARCH_INITIAL });
  },
  onCloseSearch() {
    // 关闭只影响展示状态；递增请求序号，让已关闭弹层的迟到结果失效。
    this._searchRequestId += 1;
    this.setData({ showSearch: false });
  },
  noop() {},
  onSearchChange(e) { this.setData({ searchKeyword: (e.detail && (e.detail.value ?? e.detail)) || '' }); },
  async onSearch() {
    if (this.data.searchLoading) return;
    const keyword = String(this.data.searchKeyword || '').trim(); if (!keyword) return;
    const requestId = ++this._searchRequestId;
    this.setData({ searchLoading: true, searched: true, searchResults: [], searchHint: COPY.SEARCHING });
    const result = await searchAnime(keyword);
    if (this._unloaded || requestId !== this._searchRequestId) return;
    if (!result || !result.ok) { this.setData({ searchLoading: false, searchHint: COPY.SEARCH_ERROR }); return; }
    const searchResults = ((result.data && result.data.animes) || []).map((item) => ({ ...item, initial: (item.name || '?').slice(0, 1), added: this.data.animeList.some((entry) => (item.sourceId && entry.sourceId === item.sourceId) || entry.name === item.name) }));
    this.setData({ searchLoading: false, searchResults, searchHint: searchResults.length ? '' : COPY.SEARCH_EMPTY });
  },
  onPickAnime(e) {
    const item = this.data.searchResults[e.currentTarget.dataset.index];
    // 选中即加入，但保留搜索弹层，方便继续查看和添加其他番剧。
    if (item && !item.added) this._onPickedForAdd(item);
  },
  onAddTap() { this._pickedMeta = null; this._airMetaWait = null; this.setData({ showAdd: true, newItemName: '', newItemTotalEp: '', newItemPicked: false, newItemCover: '', newItemCoverError: false, metaError: '' }); },
  onAddVisibleChange(e) { if (this.data.adding && !(e.detail && e.detail.visible)) return; this.setData({ showAdd: !!(e.detail && e.detail.visible) }); },

  onAddSearchTap() {
    if (this.data.adding) return;
    wx.navigateTo({ url: `${ANIME_SEARCH_URL}?mode=${SEARCH_MODE.PICK}`, events: { [PICK_EVENT]: (picked) => this._onPickedForAdd(picked) } });
  },
  _onPickedForAdd(picked) {
    if (!picked) return;
    const sourceId = T.positiveId(picked.sourceId); const name = String(picked.name || '').trim(); const cover = String(picked.cover || '').trim(); const totalEp = T.totalEpOf(picked.totalEp);
    this._pickedMeta = { sourceId, cover };
    this.setData({ newItemName: name || this.data.newItemName, newItemTotalEp: totalEp ? String(totalEp) : this.data.newItemTotalEp, newItemCover: cover, newItemCoverError: false, newItemPicked: true, pickedAnime: picked, metaLoading: !!sourceId, metaError: '' });
    this._airMetaWait = sourceId ? this._fetchDetailMeta(sourceId, this._pickedMeta) : Promise.resolve();
    this._commitPickedAnime(name, totalEp, this._pickedMeta, picked);
  },
  async _commitPickedAnime(name, totalEp, pickedMeta, picked) {
    if (this.data.animeList.some((item) => item.name === name)) {
      this._markSearchResultAdded(picked);
      this._pickedMeta = null;
      this._airMetaWait = null;
      this.setData({ newItemPicked: false, metaLoading: false, metaError: '' });
      wx.showToast({ title: '已经添加过了', icon: 'none' });
      return;
    }
    const now = Date.now();
    const item = T.normalizeItem({ id: generateId(), name, totalEp, ...(pickedMeta || {}), typeDesc: picked.typeDesc, year: picked.year, startDate: picked.startDate, rating: picked.rating, createTime: now, updateTime: now, status: 'want', watched: false }, now);
    this._setLists([item, ...this.data.animeList]);
    this._markSearchResultAdded(picked);
    this.setData({ adding: false, newItemPicked: false });
    wx.showToast({ title: '已加入追踪', icon: 'success' });

    // 详情请求在后台补齐高清封面和放送信息，弹窗保持可用，不阻塞继续浏览。
    const detailWait = this._airMetaWait;
    await (detailWait ? detailWait.catch(() => {}) : Promise.resolve());
    if (this._unloaded || this._pickedMeta !== pickedMeta) return;
    const enriched = T.normalizeItem({ ...this.data.animeList.find((entry) => entry.id === item.id), ...pickedMeta }, now);
    this._setLists(this.data.animeList.map((entry) => entry.id === item.id ? enriched : entry));
    this._pickedMeta = null;
    this._airMetaWait = null;
  },
  _markSearchResultAdded(picked) {
    const sourceId = T.positiveId(picked && picked.sourceId);
    const name = String((picked && picked.name) || '').trim();
    this.setData({ searchResults: this.data.searchResults.map((item) => sourceId && T.positiveId(item.sourceId) === sourceId || (!sourceId && item.name === name) ? { ...item, added: true } : item) });
  },
  async _fetchDetailMeta(sourceId, pickedMeta) {
    const r = await getAnimeDetail(sourceId);
    if (this._unloaded || this._pickedMeta !== pickedMeta || !pickedMeta || pickedMeta.sourceId !== sourceId) return;
    if (!r || !r.ok || !r.data || !r.data.bangumi) { this.setData({ metaLoading: false, metaError: '详情暂时不可用，仍可使用搜索结果添加' }); return; }
    const b = r.data.bangumi; pickedMeta.cover = preferDetailCover(pickedMeta.cover, b.cover); pickedMeta.bgmSubjectId = T.positiveId(b.bgmSubjectId); pickedMeta.airDay = Number.isInteger(b.airDay) ? b.airDay : null; pickedMeta.airStatus = airStatusOf(b.isOnAir);
    this.setData({ newItemCover: pickedMeta.cover, newItemCoverError: false, metaLoading: false, metaError: '' });
  },
  onReselectAnime() { if (this.data.adding) return; this._pickedMeta = null; this._airMetaWait = null; this.setData({ newItemPicked: false, newItemCover: '', newItemCoverError: false, metaLoading: false, metaError: '' }); this.onAddSearchTap(); },
  onAddCoverError() { this.setData({ newItemCoverError: true }); },
  onCoverError(e) { const id = e.currentTarget.dataset.id; const coverErrors = { ...(this.data.coverErrors || {}), [id]: true }; const animeList = this.data.animeList.map((item) => item.id === id ? { ...item, coverError: true } : item); this.setData({ coverErrors, animeList, filteredList: this.data.filteredList.map((item) => item.id === id ? { ...item, coverError: true } : item) }); },
  onItemNameInput(e) { if (!this.data.adding) this.setData({ newItemName: e.detail.value }); },
  onAddTotalEpInput(e) { if (!this.data.adding) this.setData({ newItemTotalEp: String(e.detail.value || '').replace(/[^\d]/g, '') }); },

  async onConfirmAdd() {
    if (this.data.adding) return;
    const name = String(this.data.newItemPicked ? this.data.newItemName : this.data.inputValue || this.data.newItemName).trim();
    if (!name) { wx.showToast({ title: '输入番剧名称', icon: 'none' }); return; }
    if (this.data.animeList.some((item) => item.name === name)) { wx.showToast({ title: '已经添加过了', icon: 'none' }); return; }
    const pickedMeta = this._pickedMeta; this.setData({ adding: true });
    try {
      if (this._airMetaWait) await Promise.race([this._airMetaWait.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
      const now = Date.now(); const item = T.normalizeItem({ id: generateId(), name, totalEp: T.totalEpOf(this.data.newItemTotalEp), ...(pickedMeta || {}), createTime: now, updateTime: now, status: 'want', watched: false }, now);
      this._setLists([item, ...this.data.animeList]); this._pickedMeta = null; this._airMetaWait = null;
      this.setData({ showAdd: false, inputValue: '', newItemName: '', newItemTotalEp: '', newItemPicked: false, newItemCover: '' }); wx.showToast({ title: '已添加', icon: 'success' });
    } finally { if (!this._unloaded) this.setData({ adding: false }); }
  },
  onAddAnime() {
    const name = String(this.data.inputValue || '').trim(); if (!name) return;
    if (this.data.animeList.some((item) => item.name === name)) { wx.showToast({ title: '已经添加过了', icon: 'none' }); return; }
    const now = Date.now(); this._setLists([T.normalizeItem({ id: generateId(), name, createTime: now, updateTime: now, status: 'want' }, now), ...this.data.animeList]); this.setData({ inputValue: '' }); wx.showToast({ title: '已添加', icon: 'success' });
  },

  onToggleWatched(e) {
    if (this.data.isEditMode) return;
    const id = e.currentTarget.dataset.id; const target = this.data.animeList.find((item) => item.id === id); if (!target || this.data.animatingId) return;
    const status = target.status === 'done' ? 'watching' : 'done'; const updated = this.data.animeList.map((item) => item.id === id ? { ...item, status, watched: status === 'done', currentEp: status === 'done' ? (item.totalEp || item.currentEp) : item.currentEp, updateTime: Date.now() } : item);
    const direction = status === 'done' ? 'check' : 'uncheck'; const source = status === 'done' ? this.data.unwatchedList : this.data.watchedList;
    this.setData({ animeList: updated, watchedCount: updated.filter((item) => item.status === 'done').length, animatingId: id, animPhase: 'phase1', animDirection: direction });
    if (source.length <= 1) { setTimeout(() => this._finishAnimation(updated), ANIM.PHASE1); return; }
    setTimeout(() => { if (!this._unloaded) this.setData({ animPhase: 'phase2' }); }, ANIM.PHASE1);
    setTimeout(() => { if (!this._unloaded) { this._setLists(updated); this.setData({ animatingId: id, animPhase: 'phase3', animDirection: direction }); } }, ANIM.PHASE1 + ANIM.PHASE2);
    setTimeout(() => { if (!this._unloaded) this.setData({ animatingId: '', animPhase: '', animDirection: '' }); }, ANIM.PHASE1 + ANIM.PHASE2 + ANIM.PHASE3);
  },
  _finishAnimation(items) { if (this._unloaded) return; this._setLists(items); this.setData({ animatingId: '', animPhase: '', animDirection: '' }); },
  onSetStatus(e) { this._updateItemStatus(e.currentTarget.dataset.id, e.currentTarget.dataset.status); },
  _updateItemStatus(id, status) { if (!T.STATUSES.includes(status)) return; this._setLists(this.data.animeList.map((item) => item.id === id ? { ...item, status, watched: status === 'done', currentEp: status === 'done' ? (item.totalEp || item.currentEp) : item.currentEp, updateTime: Date.now() } : item)); },
  onProgressInput(e) { const id = e.currentTarget.dataset.id; const item = this.data.animeList.find((it) => it.id === id); if (item) this._updateProgress(id, T.currentEpOf(e.detail.value, item.totalEp)); },
  onAdjustProgress(e) { const id = e.currentTarget.dataset.id; const item = this.data.animeList.find((it) => it.id === id); if (item) this._updateProgress(id, T.currentEpOf(item.currentEp + Number(e.currentTarget.dataset.delta || 0), item.totalEp)); },
  onDecreaseEp(e) { this.onAdjustProgress({ currentTarget: { dataset: { id: e.currentTarget.dataset.id, delta: -1 } } }); },
  onIncreaseEp(e) { this.onAdjustProgress({ currentTarget: { dataset: { id: e.currentTarget.dataset.id, delta: 1 } } }); },
  onAdvanceEp(e) { const id = e.currentTarget.dataset.id; const item = this.data.animeList.find((it) => it.id === id); if (!item || item.status === 'done') return; if (item.totalEp && item.currentEp + 1 >= item.totalEp) this._updateProgress(id, item.totalEp); else this.onIncreaseEp(e); },
  _updateProgress(id, currentEp) { this._setLists(this.data.animeList.map((item) => { if (item.id !== id) return item; const done = item.totalEp && currentEp >= item.totalEp; return { ...item, currentEp, status: done ? 'done' : (item.status === 'want' || item.status === 'done' ? 'watching' : item.status), watched: !!done, updateTime: Date.now() }; })); },

  onDeleteAnime(e) { const id = e.currentTarget.dataset.id; const target = this.data.animeList.find((item) => item.id === id); if (!target) return; wx.showModal({ title: '确认删除', content: `确定要删除「${target.name}」吗？`, confirmText: '删除', confirmColor: '#e34d59', success: (res) => { if (res.confirm) { this._setLists(this.data.animeList.filter((item) => item.id !== id)); wx.showToast({ title: '已删除', icon: 'success' }); } } }); },
  onToggleEditMode() { this.setData({ isEditMode: !this.data.isEditMode }); },
  onMoveUp(e) { this._move(e.currentTarget.dataset.id, -1); }, onMoveDown(e) { this._move(e.currentTarget.dataset.id, 1); },
  _move(id, delta) { const index = this.data.animeList.findIndex((item) => item.id === id); const next = index + delta; if (index < 0 || next < 0 || next >= this.data.animeList.length) return; const items = [...this.data.animeList]; [items[index], items[next]] = [items[next], items[index]]; this._setLists(items); },
  onFilterChange(e) { const activeFilter = e.currentTarget.dataset.filter || (e.detail && e.detail.value) || 'all'; this.setData({ activeFilter }, () => this._setLists(this.data.animeList, false)); },
  onShareAppMessage() { return { title: '我的番剧追踪清单', path: '/packageFeatures/pages/anime-checklist/anime-checklist' }; },
});
