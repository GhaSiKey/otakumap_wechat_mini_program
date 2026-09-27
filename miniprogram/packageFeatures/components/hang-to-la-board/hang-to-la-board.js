const R = require('../../utils/hang-to-la/ranking-model');

const UI = R.RANKING_UI_CONFIG;

Component({
  properties: {
    heading: { type: String, value: '番剧排行' },
    subtitle: { type: String, value: '从夯到拉 · 点封面可换档' },
    initialTitle: { type: String, value: R.RANKING_POSTER_CONFIG.title },
    sourceItems: { type: Array, value: [] },
  },

  data: {
    ui: UI,
    rankingTitle: R.RANKING_POSTER_CONFIG.title,
    items: [],
    unrankedItems: [],
    tiers: R.RANKING_TIERS.map((tier) => Object.assign({}, tier, { items: [] })),
    rankedCount: 0,
    totalCount: 0,
    progressPercent: 0,
    dragItemId: '',
    dragOverTierId: '',
    dragHint: '',
    coverErrorIds: {},
    selectedItem: null,
    selectedTierLabel: '',
  },

  observers: {
    sourceItems(next) { this._syncItems(next); },
    initialTitle(next) {
      if (next && !this._titleEdited) this.setData({ rankingTitle: next });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ rankingTitle: this.properties.initialTitle || R.RANKING_POSTER_CONFIG.title });
      this._syncItems(this.properties.sourceItems || []);
    },
    detached() {
      this._detached = true;
      clearTimeout(this._tapTimer);
      this._dragItemId = '';
      this._dropRects = [];
    },
  },

  pageLifetimes: {
    hide() { this._cancelDrag(); },
  },

  methods: {
    _syncItems(source) {
      const next = (Array.isArray(source) ? source : []).map((item) => Object.assign({}, item));
      this._refresh(next, false);
    },

    _refresh(items, emit) {
      const next = Array.isArray(items) ? items : [];
      const tiers = R.RANKING_TIERS.map((tier) => Object.assign({}, tier, { items: R.getTierItems(next, tier.id) }));
      const rankedCount = next.filter((item) => item.tierId).length;
      const totalCount = next.length;
      this.setData({
        items: next,
        unrankedItems: next.filter((item) => !item.tierId),
        tiers,
        rankedCount,
        totalCount,
        progressPercent: totalCount ? Math.round((rankedCount / totalCount) * 100) : 0,
      });
      if (emit) this.triggerEvent('change', { items: next });
    },

    onTitleInput(e) {
      const value = e.detail && e.detail.value ? e.detail.value : '';
      this._titleEdited = true;
      this.setData({ rankingTitle: value });
      this.triggerEvent('titlechange', { title: String(value).trim() || R.RANKING_POSTER_CONFIG.title });
    },

    onCoverError(e) {
      const id = e.currentTarget.dataset.id;
      if (id && !this.data.coverErrorIds[id]) this.setData({ ['coverErrorIds.' + id]: true });
    },

    onRankedItemTap(e) {
      if (this._suppressTap) return;
      const id = e.currentTarget.dataset.id;
      const item = this.data.items.find((entry) => entry.id === id);
      if (!item) return;
      const selectedTier = item.tierId ? R.RANKING_TIERS.find((tier) => tier.id === item.tierId) : null;
      this.setData({
        selectedItem: item,
        selectedTierLabel: selectedTier ? selectedTier.label : '待排区',
      });
    },

    onClosePicker() { this.setData({ selectedItem: null, selectedTierLabel: '' }); },
    preventTap() {},

    onChooseTier(e) {
      const selectedTierId = e.currentTarget.dataset.tierId || '__pool__';
      const tierId = selectedTierId === '__pool__' ? null : selectedTierId;
      const itemId = this.data.selectedItem && this.data.selectedItem.id;
      this.setData({ selectedItem: null, selectedTierLabel: '' });
      if (itemId) this._refresh(R.moveItem(this.data.items, itemId, tierId), true);
    },

    onDragStart(e) {
      const id = e.currentTarget.dataset.id;
      if (!id) return;
      this._dragItemId = id;
      this.setData({ dragItemId: id, dragOverTierId: '', dragHint: UI.dragHint });
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
      this.createSelectorQuery().selectAll('.ranking-drop-zone').boundingClientRect((rects) => {
        if (this._dragItemId === id) this._dropRects = rects || [];
      }).exec();
    },

    onDragMove(e) {
      if (!this._dragItemId || !this._dropRects || !this._dropRects.length) return;
      const touch = e.touches && e.touches[0];
      const fingerX = touch && (typeof touch.clientX === 'number' ? touch.clientX : touch.pageX);
      const fingerY = touch && (typeof touch.clientY === 'number' ? touch.clientY : touch.pageY);
      if (typeof fingerX !== 'number' || typeof fingerY !== 'number') return;
      let target = '';
      let targetDistance = Infinity;
      this._dropRects.forEach((rect, index) => {
        if (!rect) return;
        const left = rect.left - UI.dragHitSlop;
        const right = rect.left + rect.width + UI.dragHitSlop;
        const top = rect.top - UI.dragHitSlop;
        const bottom = rect.top + rect.height + UI.dragHitSlop;
        if (fingerX >= left && fingerX <= right && fingerY >= top && fingerY <= bottom) {
          const nextDistance = Math.abs(fingerY - (rect.top + rect.height / 2));
          if (nextDistance < targetDistance) { target = index; targetDistance = nextDistance; }
        }
      });
      const tier = target === '' ? null : R.RANKING_TIERS[target];
      const nextTier = target === '' ? '' : (target === R.RANKING_TIERS.length ? '__pool__' : tier.id);
      if (nextTier !== this.data.dragOverTierId) this.setData({ dragOverTierId: nextTier, dragHint: nextTier ? UI.dragHint : UI.dragOutsideHint });
    },

    onDragEnd() {
      const itemId = this._dragItemId;
      const tierId = this.data.dragOverTierId === '__pool__' ? null : this.data.dragOverTierId;
      this._cancelDrag();
      if (itemId) {
        this._suppressTap = true;
        clearTimeout(this._tapTimer);
        this._tapTimer = setTimeout(() => { this._suppressTap = false; }, UI.tapSuppressMs);
      }
      if (itemId && tierId !== '') this._refresh(R.moveItem(this.data.items, itemId, tierId), true);
      else if (itemId) wx.showToast({ title: UI.dragOutsideHint, icon: 'none' });
    },

    onDragCancel() { this._cancelDrag(); },

    _cancelDrag() {
      this._dragItemId = '';
      this._dropRects = [];
      if (this.data.dragItemId || this.data.dragOverTierId || this.data.dragHint) this.setData({ dragItemId: '', dragOverTierId: '', dragHint: '' });
    },

    onClear() {
      if (!this.data.items.some((item) => item.tierId)) return;
      wx.showModal({
        title: '清空档位',
        content: '番剧会回到待排区，确定继续吗？',
        confirmText: '清空',
        confirmColor: '#e34d59',
        success: (res) => {
          if (res.confirm && !this._detached) this._refresh(this.data.items.map((item) => Object.assign({}, item, { tierId: null })), true);
        },
      });
    },

    onExport() {
      const tiers = this.data.tiers.map((tier) => Object.assign({}, tier, { items: tier.items.slice() }));
      const rankedCount = tiers.reduce((sum, tier) => sum + tier.items.length, 0);
      if (!rankedCount) {
        wx.showToast({ title: '先把至少一部番剧放入档位', icon: 'none' });
        return;
      }
      this.triggerEvent('export', { tiers, rankedCount, rankingTitle: this.data.rankingTitle, coverErrorIds: this.data.coverErrorIds });
    },
  },
});
