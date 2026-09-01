// 一起看 —— 双人共享的常驻清单。
//
// 页面只负责：读取当前板全部未删除番、维护 togetherWatch.active、发起一次双人共同目标进度。
// 不在前端乐观修改清单或双方进度；写成功后统一重拉 getBoardDetail，避免双端状态漂移。
const api = require('../../utils/shared-board/cloud-api');
const T = require('../../utils/shared-board/transform');
const {
  BOARD_STATUS,
  STATUS_LABELS,
  EP_MAX_WHEN_UNKNOWN,
  ERR,
} = require('../../utils/shared-board/config');

const PRESET_DELTAS = [1, 2, 3];
const DELTA_MAX = EP_MAX_WHEN_UNKNOWN;

function isTogetherWatchActive(item) {
  if (!item) return false;
  if (item.togetherWatch && typeof item.togetherWatch === 'object') {
    return item.togetherWatch.active === true;
  }
  // 兼容短期灰度数据；新数据以 togetherWatch.active 为权威。
  return item.togetherWatchActive === true || item.togetherWatch === true;
}

function statusText(status) {
  return STATUS_LABELS[status] || '未记录';
}

function requestId() {
  return `tw_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

Page({
  data: {
    boardId: '',
    boardName: '',
    loading: true,
    failed: false,
    errorText: '加载失败，请重试',
    refreshFailed: false,
    mode: '', // paired / waiting / archived
    readonly: false,
    meName: '我',
    peerName: 'TA',
    watchItems: [],
    candidates: [],
    coverErrorIds: {},

    // 清单增删共用串行锁。写成功前不改 watchItems/candidates。
    mutating: false,
    busyItemId: '',
    showAdd: false,

    // “一起看”确认层：预设 +1/+2/+3 或自定义正整数。
    showAdvance: false,
    advanceItem: null,
    presetDeltas: PRESET_DELTAS,
    selectedDelta: 1,
    customDelta: '',
    advancePreview: null,
    advancing: false,
  },

  onLoad(query) {
    this._unloaded = false;
    const boardId = (query && query.boardId) || '';
    if (!boardId) {
      this.setData({ loading: false, failed: true, errorText: '缺少板信息' });
      return;
    }
    this.setData({ boardId });
    this._load();
  },

  onShow() {
    // 首次 onShow 紧跟 onLoad，不重复打请求；从后台回来时静默同步 TA 的最新清单/进度。
    if (this._shown && this._loaded && this.data.boardId && !this.data.mutating && !this.data.advancing) {
      this._load({ background: true });
    }
    this._shown = true;
  },

  onUnload() {
    this._unloaded = true;
    this._loadSeq = (this._loadSeq || 0) + 1;
  },

  onPullDownRefresh() {
    if (!this.data.boardId) {
      wx.stopPullDownRefresh();
      return;
    }
    this._load({ background: true }).then(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this._load({ background: this._loaded });
  },

  async _load(options) {
    const opts = options || {};
    const seq = (this._loadSeq || 0) + 1;
    this._loadSeq = seq;
    const boardId = this.data.boardId;
    if (!opts.background) this.setData({ loading: true, failed: false });

    let meRes;
    let detailRes;
    try {
      [meRes, detailRes] = await Promise.all([
        api.getMyOpenid(),
        api.getBoardDetail(boardId),
      ]);
    } catch (e) {
      meRes = null;
      detailRes = null;
    }

    if (this._unloaded || seq !== this._loadSeq || boardId !== this.data.boardId) return false;
    const myOpenid = meRes && meRes.ok && meRes.data ? meRes.data.openid : '';
    if (!myOpenid || !detailRes || !detailRes.ok || !detailRes.data || !detailRes.data.board) {
      const errorText = !myOpenid ? '身份获取失败，请重试' : '清单加载失败，请重试';
      if (this._loaded) {
        this.setData({ loading: false, refreshFailed: true, errorText });
      } else {
        this.setData({ loading: false, failed: true, refreshFailed: false, errorText });
      }
      return false;
    }

    this._applyDetail(detailRes.data.board, detailRes.data.items || [], myOpenid);
    this._loaded = true;
    return true;
  },

  _applyDetail(board, items, myOpenid) {
    const members = Array.isArray(board.members) ? board.members : [];
    const peerOpenid = T.resolvePeer(members, myOpenid);
    const memberOf = (openid) => members.find((member) => member && member.openid === openid) || null;
    const me = memberOf(myOpenid);
    const peer = peerOpenid ? memberOf(peerOpenid) : null;
    const readonly = board.status === BOARD_STATUS.ARCHIVED;
    const mode = readonly ? 'archived' : (peerOpenid ? 'paired' : 'waiting');

    this._rawBoard = board;
    this._rawItems = (items || []).filter((item) => item && !item.deleted);
    this._myOpenid = myOpenid;
    this._peerOpenid = peerOpenid;

    // 保持 getBoardDetail 原始顺序。sortOrder/createTime 可能是 ISO 字符串或数据库时间对象，
    // 在页面用减法重排会得到 NaN；本页不另造排序语义。
    const views = this._rawItems.map((item) => this._toItemView(item, myOpenid, peerOpenid));
    const watchItems = views.filter((item) => item.active);
    const candidates = views.filter((item) => !item.active);

    const prevCoverById = this._coverById || {};
    const nextCoverById = {};
    const coverErrorIds = Object.assign({}, this.data.coverErrorIds);
    views.forEach((item) => {
      nextCoverById[item.itemId] = item.cover;
      if (Object.prototype.hasOwnProperty.call(prevCoverById, item.itemId)
        && prevCoverById[item.itemId] !== item.cover) {
        delete coverErrorIds[item.itemId];
      }
    });
    this._coverById = nextCoverById;

    const patch = {
      boardName: board.name || '',
      loading: false,
      failed: false,
      refreshFailed: false,
      mode,
      readonly,
      meName: (me && me.nickname) || '我',
      peerName: (peer && peer.nickname) || 'TA',
      watchItems,
      candidates,
      coverErrorIds,
    };
    if (mode !== 'paired') patch.showAdd = false;
    if (this.data.advanceItem) {
      const refreshedItem = watchItems.find((item) => item.itemId === this.data.advanceItem.itemId);
      const pending = this._advanceRequest;
      if (!refreshedItem || mode !== 'paired') {
        patch.showAdvance = false;
        patch.advanceItem = null;
        patch.advancePreview = null;
        this._advanceRequest = null;
      } else if (pending && pending.itemId === refreshedItem.itemId) {
        const reached = refreshedItem.mineEp >= pending.targetEp && refreshedItem.peerEp >= pending.targetEp;
        if (reached) {
          // 上一次回包虽未确认，但权威快照已经达到绝对目标；把它视为成功，避免重新按 +n 再推一次。
          patch.showAdvance = false;
          patch.advanceItem = null;
          patch.advancePreview = null;
          patch.customDelta = '';
          this._advanceRequest = null;
        } else {
          // 权威快照尚未到目标：保留原 requestId + 绝对 target，下一次确认继续幂等重试。
          patch.advanceItem = refreshedItem;
          patch.advancePreview = this._buildTargetPreview(refreshedItem, pending.targetEp);
        }
      } else {
        // 从后台回来/下拉时双方进度可能已变化；确认层必须用新权威值重算，不能展示旧预览。
        const delta = this.data.selectedDelta === 'custom'
          ? Number(this.data.customDelta)
          : Number(this.data.selectedDelta);
        patch.advanceItem = refreshedItem;
        patch.advancePreview = Number.isInteger(delta) && delta > 0
          ? this._buildAdvancePreview(refreshedItem, delta)
          : null;
      }
    }
    this.setData(patch);
  },

  _toItemView(item, myOpenid, peerOpenid) {
    const vm = T.buildItemViewModel(item, myOpenid, peerOpenid);
    const pair = vm.pair;
    const mine = pair.mine || { ep: 0, status: null };
    const peer = pair.peer || { ep: 0, status: null };
    return {
      itemId: vm.itemId,
      name: vm.name,
      cover: vm.cover,
      coverFallback: vm.coverFallback,
      subtitle: vm.subtitle,
      totalEp: vm.totalEp,
      active: isTogetherWatchActive(item),
      mineEp: mine.ep,
      mineStatus: statusText(mine.status),
      mineStatusKey: mine.status || 'unset',
      peerEp: peer.ep,
      peerStatus: statusText(peer.status),
      peerStatusKey: peer.status || 'unset',
      peerRecorded: pair.hasPeer,
    };
  },

  onCoverError(e) {
    const itemId = e.currentTarget.dataset.itemId;
    if (!itemId || this.data.coverErrorIds[itemId]) return;
    const coverErrorIds = Object.assign({}, this.data.coverErrorIds, { [itemId]: true });
    this.setData({ coverErrorIds });
  },

  _canEdit() {
    return this.data.mode === 'paired' && !this.data.readonly && !this.data.mutating && !this.data.advancing;
  },

  onOpenAdd() {
    if (this.data.readonly) {
      wx.showToast({ title: '归档板只能查看', icon: 'none' });
      return;
    }
    if (this.data.mode !== 'paired') {
      wx.showToast({ title: '等 TA 加入后再一起选', icon: 'none' });
      return;
    }
    if (this.data.mutating || this.data.advancing) return;
    this.setData({ showAdd: true });
  },

  onAddVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (this.data.mutating && !visible) return;
    this.setData({ showAdd: visible });
  },

  onAddItem(e) {
    const itemId = e.currentTarget.dataset.itemId;
    this._setActive(itemId, true);
  },

  onRemoveItem(e) {
    const itemId = e.currentTarget.dataset.itemId;
    this._setActive(itemId, false);
  },

  async _setActive(itemId, active) {
    if (!itemId || !this._canEdit()) return;
    const source = active ? this.data.candidates : this.data.watchItems;
    if (!source.some((item) => item.itemId === itemId)) return;

    this.setData({ mutating: true, busyItemId: itemId });
    try {
      const r = await api.togetherWatch({
        action: 'set',
        boardId: this.data.boardId,
        itemId,
        active,
      });
      if (this._unloaded) return;
      if (!r || !r.ok) {
        wx.showToast({ title: active ? '加入失败，请重试' : '移出失败，请重试', icon: 'none' });
        await this._load({ background: true });
        return;
      }
      wx.showToast({ title: active ? '已加入一起看清单' : '已移出清单', icon: 'success' });
      await this._load({ background: true });
    } catch (e) {
      if (!this._unloaded) wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    } finally {
      if (!this._unloaded) this.setData({ mutating: false, busyItemId: '' });
    }
  },

  onAdvanceTap(e) {
    if (!this._canEdit()) return;
    const itemId = e.currentTarget.dataset.itemId;
    const item = this.data.watchItems.find((entry) => entry.itemId === itemId);
    if (!item) return;
    this._advanceRequest = null;
    this.setData({
      showAdvance: true,
      advanceItem: item,
      selectedDelta: 1,
      customDelta: '',
      advancePreview: this._buildAdvancePreview(item, 1),
    });
  },

  onAdvanceVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (this.data.advancing && !visible) return;
    if (visible) {
      this.setData({ showAdvance: true });
      return;
    }
    this._advanceRequest = null;
    this.setData({
      showAdvance: false,
      advanceItem: null,
      advancePreview: null,
      customDelta: '',
    });
  },

  onSelectDelta(e) {
    if (this.data.advancing || !this.data.advanceItem) return;
    const delta = Number(e.currentTarget.dataset.delta);
    if (!Number.isInteger(delta) || delta < 1) return;
    this._advanceRequest = null;
    this.setData({
      selectedDelta: delta,
      customDelta: '',
      advancePreview: this._buildAdvancePreview(this.data.advanceItem, delta),
    });
  },

  onCustomDeltaFocus() {
    if (this.data.advancing || !this.data.advanceItem) return;
    this._advanceRequest = null;
    this.setData({ selectedDelta: 'custom' });
  },

  onCustomDeltaInput(e) {
    if (this.data.advancing || !this.data.advanceItem) return;
    const digits = String((e && e.detail && e.detail.value) || '').replace(/[^\d]/g, '').slice(0, 4);
    const parsed = Number(digits);
    const delta = Number.isInteger(parsed) && parsed >= 1 && parsed <= DELTA_MAX ? parsed : null;
    this._advanceRequest = null;
    this.setData({
      selectedDelta: 'custom',
      customDelta: digits,
      advancePreview: delta ? this._buildAdvancePreview(this.data.advanceItem, delta) : null,
    });
  },

  _buildAdvancePreview(item, delta) {
    if (!item || !Number.isInteger(delta) || delta < 1) return null;
    const mineEp = Number.isInteger(item.mineEp) ? item.mineEp : 0;
    const peerEp = Number.isInteger(item.peerEp) ? item.peerEp : 0;
    const baseEp = Math.max(mineEp, peerEp);
    const requestedTargetEp = Math.min(EP_MAX_WHEN_UNKNOWN, baseEp + delta);
    const targetEp = T.clampEp(requestedTargetEp, item.totalEp);
    return this._buildTargetPreview(item, targetEp, { delta, requestedTargetEp });
  },

  _buildTargetPreview(item, targetEp, options) {
    if (!item || !Number.isInteger(targetEp) || targetEp < 1) return null;
    const opts = options || {};
    const mineEp = Number.isInteger(item.mineEp) ? item.mineEp : 0;
    const peerEp = Number.isInteger(item.peerEp) ? item.peerEp : 0;
    const baseEp = Math.max(mineEp, peerEp);
    const requestedTargetEp = Number.isInteger(opts.requestedTargetEp) ? opts.requestedTargetEp : targetEp;
    const finalTargetEp = T.clampEp(targetEp, item.totalEp);
    if (finalTargetEp == null) return null;
    const mineDelta = Math.max(0, finalTargetEp - mineEp);
    const peerDelta = Math.max(0, finalTargetEp - peerEp);
    return {
      delta: Number.isInteger(opts.delta) ? opts.delta : Math.max(0, finalTargetEp - baseEp),
      baseEp,
      requestedTargetEp,
      targetEp: finalTargetEp,
      mineBefore: mineEp,
      mineAfter: Math.max(mineEp, finalTargetEp),
      mineDelta,
      mineDeltaText: mineDelta > 0 ? `+${mineDelta}` : '不变',
      peerBefore: peerEp,
      peerAfter: Math.max(peerEp, finalTargetEp),
      peerDelta,
      peerDeltaText: peerDelta > 0 ? `+${peerDelta}` : '不变',
      clamped: finalTargetEp < requestedTargetEp,
      canAdvance: mineDelta > 0 || peerDelta > 0,
    };
  },

  async onConfirmAdvance() {
    if (this.data.advancing || this.data.mutating || this.data.readonly) return;
    const item = this.data.advanceItem;
    const preview = this.data.advancePreview;
    if (!item || !preview || !preview.canAdvance) {
      wx.showToast({ title: '已经到最后一话啦', icon: 'none' });
      return;
    }

    const boardId = this.data.boardId;
    const itemId = item.itemId;
    const targetEp = preview.targetEp;
    // 网络超时不等于服务端失败：同一 item/target 的再次确认必须复用 requestId，
    // 让服务端 lastAdvance 幂等返回第一次结果，不能因“重试”再记一条共同事件。
    const pendingRequest = this._advanceRequest;
    const id = pendingRequest
      && pendingRequest.itemId === itemId
      && pendingRequest.targetEp === targetEp
      ? pendingRequest.requestId
      : requestId();
    this._advanceRequest = { itemId, targetEp, requestId: id };
    this.setData({ advancing: true });
    try {
      const r = await api.togetherWatch({
        action: 'advance',
        boardId,
        itemId,
        targetEp,
        requestId: id,
      });
      if (this._unloaded) return;
      if (!r || !r.ok) {
        if (r && r.code && r.code !== ERR.INTERNAL) {
          this._advanceRequest = null;
          this.setData({ showAdvance: false, advanceItem: null, advancePreview: null, customDelta: '' });
          wx.showToast({ title: '清单状态已变化，正在刷新', icon: 'none' });
          await this._load({ background: true });
          return;
        }
        wx.showToast({ title: '同步结果未确认，正在核对', icon: 'none' });
        await this._load({ background: true });
        return;
      }
      this._advanceRequest = null;
      this.setData({ showAdvance: false, advanceItem: null, advancePreview: null, customDelta: '' });
      const finalTarget = r.data && Number.isInteger(r.data.targetEp) ? r.data.targetEp : targetEp;
      wx.showToast({ title: `已一起看到第 ${finalTarget} 话`, icon: 'success' });
      await this._load({ background: true });
    } catch (e) {
      if (!this._unloaded) {
        wx.showToast({ title: '同步结果未确认，正在核对', icon: 'none' });
        await this._load({ background: true });
      }
    } finally {
      if (!this._unloaded) this.setData({ advancing: false });
    }
  },
});

module.exports = {
  isTogetherWatchActive,
};
