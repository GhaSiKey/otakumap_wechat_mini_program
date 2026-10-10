// 板间搬番页 —— 把成员相同的其他板里的番，连同双方进度搬进当前板
//
// 入口：当前板加番面板「从其他板搬来」，query 带 boardId（目标板）。
// 流程：选来源板 → 按分区勾选番（不默认勾选）→ 确认 → moveItems → 返回板页（板页 onShow 会自动重拉）。
// 筛板、分组、判重都在 transform（可测），本页只管交互与云调用。
const api = require('../../utils/shared-board/cloud-api');
const T = require('../../utils/shared-board/transform');
const {
  MOVE_COPY,
  MOVE_ITEMS_MAX,
  BOARD_ITEM_MAX,
  ITEM_POSTER_COPY,
} = require('../../utils/shared-board/config');

// 占位符插值：回调式 replace，番名/板名含 $& 等不会被当特殊模式（与其他页同一约定）
function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// 单番 VM → 列表行（只留 wxml 需要的字段；状态由分区标题表达，行内不重复）
function toRow(vm) {
  const { mine, peer } = vm.pair;
  return {
    itemId: vm.itemId,
    name: vm.name,
    cover: vm.cover,
    coverFallback: vm.coverFallback,
    mineEpText: ITEM_POSTER_COPY.ME_EP_PREFIX + mine.ep,
    peerEpText: peer ? ITEM_POSTER_COPY.PEER_EP_PREFIX + peer.ep : ITEM_POSTER_COPY.PEER_UNSET,
    peerUnset: !peer,
    checked: false,
  };
}

function toSection(group) {
  return {
    sectionKey: group.sectionKey,
    title: group.title,
    rows: group.items.map(toRow),
    checkedCount: 0,
  };
}

Page({
  data: {
    copy: MOVE_COPY,
    loading: true,
    loadFailed: false,
    canMove: false,
    headerTarget: '',
    sources: [], // [{ boardId, name, countText }]
    sourceBoardId: '',
    itemsLoading: false,
    itemsFailed: false,
    sections: [], // [{ sectionKey, title, rows, checkedCount }]
    duplicates: [], // 当前板已有的番（不可勾选，沉底展示）
    checkedCount: 0,
    selectedText: '',
    moving: false,
    coverErr: {}, // {itemId: true} 封面加载失败 → 首字色块
  },

  onLoad(query) {
    this._targetId = (query && query.boardId) || '';
    this._init();
  },

  onRetry() {
    this._init();
  },

  // 目标板详情（判重用）+ 我的板列表（筛来源板）+ openid（区分我/TA）并行拉取
  async _init() {
    this.setData({ loading: true, loadFailed: false });
    const [me, target, list] = await Promise.all([
      api.getMyOpenid(),
      api.getBoardDetail(this._targetId),
      api.listMyBoards(),
    ]);
    if (!(me.ok && me.data && me.data.openid) || !target.ok || !list.ok) {
      this.setData({ loading: false, loadFailed: true });
      return;
    }
    const board = target.data.board;
    this._myOpenid = me.data.openid;
    this._peerOpenid = T.resolvePeer(board.members || [], this._myOpenid);
    this._targetItems = target.data.items || [];
    this._targetName = board.name || '';
    const sources = T.pickMoveSourceBoards(list.data.boards || [], board).map((s) => Object.assign(s, {
      countText: fillTemplate(MOVE_COPY.BOARD_ITEM_COUNT, { n: s.itemCount }),
    }));
    this.setData({
      loading: false,
      canMove: T.canMoveInto(board),
      headerTarget: fillTemplate(MOVE_COPY.HEADER_TARGET, { board: this._targetName }),
      sources,
    });
    // 默认选中第一个来源板（listMyBoards 按最近活跃排序，通常就是上一季的板），少点一下
    const keep = sources.find((s) => s.boardId === this.data.sourceBoardId);
    if (sources.length) this._selectSource((keep || sources[0]).boardId);
  },

  onSourceTap(e) {
    const { boardId } = e.currentTarget.dataset;
    if (!boardId || boardId === this.data.sourceBoardId || this.data.moving) return;
    this._selectSource(boardId);
  },

  onItemsRetry() {
    this._selectSource(this.data.sourceBoardId);
  },

  async _selectSource(boardId) {
    const seq = (this._sourceSeq || 0) + 1;
    this._sourceSeq = seq; // 连点切板时只认最后一次的回包
    this.setData({ sourceBoardId: boardId, itemsLoading: true, itemsFailed: false, sections: [], duplicates: [] });
    this._refreshSelected(0);
    const r = await api.getBoardDetail(boardId);
    if (seq !== this._sourceSeq) return;
    if (!r.ok) {
      this.setData({ itemsLoading: false, itemsFailed: true });
      return;
    }
    const grouped = T.buildMoveSections(r.data.items || [], this._targetItems, this._myOpenid, this._peerOpenid);
    this.setData({
      itemsLoading: false,
      sections: grouped.sections.map(toSection),
      duplicates: grouped.duplicates.map(toRow),
    });
  },

  _refreshSelected(checkedCount) {
    this.setData({
      checkedCount,
      selectedText: checkedCount ? fillTemplate(MOVE_COPY.SELECTED_COUNT, { n: checkedCount }) : MOVE_COPY.SELECTED_NONE,
    });
  },

  _toastLimit() {
    wx.showToast({ title: fillTemplate(MOVE_COPY.SELECT_LIMIT, { max: MOVE_ITEMS_MAX }), icon: 'none' });
  },

  // 单行勾选：只更新这一行与计数（路径式 setData，长番单不整表重刷）
  onToggleItem(e) {
    if (this.data.moving) return;
    const s = Number(e.currentTarget.dataset.section);
    const i = Number(e.currentTarget.dataset.index);
    const section = this.data.sections[s];
    const row = section && section.rows[i];
    if (!row) return;
    if (!row.checked && this.data.checkedCount >= MOVE_ITEMS_MAX) {
      this._toastLimit();
      return;
    }
    const delta = row.checked ? -1 : 1;
    this.setData({
      [`sections[${s}].rows[${i}].checked`]: !row.checked,
      [`sections[${s}].checkedCount`]: section.checkedCount + delta,
    });
    this._refreshSelected(this.data.checkedCount + delta);
  },

  // 分区全选 / 取消全选：本分区已全选则全部取消，否则在单次上限内尽量勾满
  onToggleSection(e) {
    if (this.data.moving) return;
    const s = Number(e.currentTarget.dataset.section);
    const section = this.data.sections[s];
    if (!section) return;
    const allChecked = section.checkedCount === section.rows.length;
    let left = MOVE_ITEMS_MAX - (this.data.checkedCount - section.checkedCount);
    const rows = section.rows.map((row) => {
      const checked = allChecked ? false : left > 0;
      if (checked) left -= 1;
      return Object.assign({}, row, { checked });
    });
    const sectionChecked = rows.filter((row) => row.checked).length;
    if (!allChecked && sectionChecked < rows.length) this._toastLimit();
    this.setData({
      [`sections[${s}].rows`]: rows,
      [`sections[${s}].checkedCount`]: sectionChecked,
    });
    this._refreshSelected(this.data.checkedCount - section.checkedCount + sectionChecked);
  },

  onClear() {
    if (this.data.moving || !this.data.checkedCount) return;
    const sections = this.data.sections.map((section) => Object.assign({}, section, {
      checkedCount: 0,
      rows: section.rows.map((row) => Object.assign({}, row, { checked: false })),
    }));
    this.setData({ sections });
    this._refreshSelected(0);
  },

  onCoverError(e) {
    const { itemId } = e.currentTarget.dataset;
    if (itemId) this.setData({ [`coverErr.${itemId}`]: true });
  },

  onSubmit() {
    if (this.data.moving || !this.data.checkedCount) return;
    const source = this.data.sources.find((s) => s.boardId === this.data.sourceBoardId);
    wx.showModal({
      title: fillTemplate(MOVE_COPY.CONFIRM_TITLE, { n: this.data.checkedCount, to: this._targetName }),
      content: fillTemplate(MOVE_COPY.CONFIRM_CONTENT, { from: source ? source.name : '' }),
      confirmText: MOVE_COPY.CONFIRM_OK,
      success: (res) => { if (res.confirm) this._doMove(); },
    });
  },

  async _doMove() {
    const itemIds = [];
    this.data.sections.forEach((section) => section.rows.forEach((row) => { if (row.checked) itemIds.push(row.itemId); }));
    this.setData({ moving: true });
    wx.showLoading({ title: MOVE_COPY.MOVING, mask: true });
    const r = await api.moveItems(this.data.sourceBoardId, this._targetId, itemIds);
    wx.hideLoading();
    this.setData({ moving: false });
    if (!r.ok) {
      const msg = MOVE_COPY.ERR[r.code] || MOVE_COPY.ERR._default;
      wx.showToast({ title: fillTemplate(msg, { max: BOARD_ITEM_MAX }), icon: 'none' });
      return;
    }
    const moved = r.data.moved || [];
    const skipped = r.data.skipped || [];
    if (!skipped.length) {
      // toast 是全局的，返回板页后仍可见；板页 onShow 会重拉番单
      wx.navigateBack();
      wx.showToast({ title: fillTemplate(MOVE_COPY.SUCCESS, { n: moved.length }), icon: 'success' });
      return;
    }
    const lines = skipped.map((s) => fillTemplate(MOVE_COPY.RESULT_LINE, {
      name: s.name,
      reason: MOVE_COPY.SKIP_REASON[s.reason] || '',
    }));
    if (moved.length) lines.unshift(fillTemplate(MOVE_COPY.RESULT_MOVED, { n: moved.length }));
    wx.showModal({
      title: fillTemplate(MOVE_COPY.RESULT_TITLE, { n: skipped.length }),
      content: lines.join('\n'),
      showCancel: false,
      confirmText: MOVE_COPY.RESULT_OK,
      success: () => {
        if (moved.length) wx.navigateBack();
        else this._init(); // 一部没搬成：留在本页，连同目标板一起按最新数据重算
      },
    });
  },
});
