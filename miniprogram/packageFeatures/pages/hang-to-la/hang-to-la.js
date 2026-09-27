const R = require('../../utils/hang-to-la/ranking-model');
const { SOURCES, isValidSource, loadSource, rankingUrl } = require('../../utils/hang-to-la/sources');
const { loadCanvasImage, drawPoster } = require('../../utils/hang-to-la/poster');

const POSTER = R.RANKING_POSTER_CONFIG;
const CANVAS_WIDTH = POSTER.canvasWidth;

function readStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value === null || value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  try { wx.setStorageSync(key, value); } catch (error) {}
}

Page({
  data: {
    source: '',
    boardId: '',
    heading: '番剧排行',
    subtitle: '',
    rankingTitle: POSTER.title,
    items: [],
    loading: true,
    failed: false,
  },

  onLoad(query) {
    this._disposed = false;
    this._source = (query && query.source) || SOURCES.SHARED_BOARD;
    this._boardId = (query && query.boardId) || '';
    this._loading = false;
    this.setData({ source: this._source, boardId: this._boardId });
    return this._load();
  },

  onShow() {
    if (this._loaded && this._source === SOURCES.CHECKLIST && !this._loading && !this._exporting) return this._load();
  },

  onPageScroll() {
    const board = this.selectComponent('#rankingBoard');
    if (board) board.onDragCancel();
  },

  onHide() { this.onPageScroll(); },

  onUnload() { this._disposed = true; },

  async _load() {
    if (this._loading) return;
    if (!isValidSource(this._source, this._boardId)) {
      this.setData({ loading: false, failed: true });
      return;
    }
    this._loading = true;
    this.setData({ loading: true, failed: false });
    try {
      const config = await loadSource(this._source, this._boardId);
      if (this._disposed) return;
      const { rankingKey, titleKey, legacyKey: oldKey } = config;
      const saved = R.deserialize(readStorage(rankingKey, oldKey ? readStorage(oldKey, '') : ''));
      const items = R.normalizeItems(config.items, saved);
      const oldTitleKey = oldKey ? oldKey + ':title' : '';
      const rankingTitle = readStorage(titleKey, oldTitleKey ? readStorage(oldTitleKey, POSTER.title) : POSTER.title);
      this._rankingKey = rankingKey;
      this._titleKey = titleKey;
      this._posterSubtitle = config.posterSubtitle;
      this.setData({
        loading: false,
        failed: false,
        heading: config.heading,
        subtitle: config.subtitle,
        posterSubtitle: config.posterSubtitle,
        rankingTitle,
        items,
      });
      this._loaded = true;
      writeStorage(rankingKey, R.serialize(items));
      writeStorage(titleKey, rankingTitle);
    } catch (error) {
      if (this._disposed) return;
      this.setData({ loading: false, failed: true });
      wx.showToast({ title: '番单读取失败，请返回重试', icon: 'none' });
    } finally {
      this._loading = false;
    }
  },

  onItemsChange(e) {
    const items = e.detail && Array.isArray(e.detail.items) ? e.detail.items : [];
    this.setData({ items });
    if (this._rankingKey) writeStorage(this._rankingKey, R.serialize(items));
  },

  onTitleChange(e) {
    const title = e.detail && e.detail.title ? e.detail.title : POSTER.title;
    this.setData({ rankingTitle: title });
    if (this._titleKey) writeStorage(this._titleKey, title);
  },

  async onExport(e) {
    if (this._exporting) return;
    const detail = e.detail || {};
    const snapshotTiers = (detail.tiers || []).map((tier) => Object.assign({}, tier, { items: tier.items.slice() }));
    const rankedCount = Number(detail.rankedCount || 0);
    if (!rankedCount) return;
    this._exporting = true;
    if (wx.showLoading) wx.showLoading({ title: '正在生成排行图', mask: true });
    const config = Object.assign({}, POSTER, { subtitle: this._posterSubtitle || POSTER.subtitle });
    const query = this.createSelectorQuery();
    query.select('#rankingCanvas').fields({ node: true, size: true });
    query.exec(async (result) => {
      const finish = () => { this._exporting = false; if (wx.hideLoading) wx.hideLoading(); };
      try {
        const info = result && result[0];
        if (!info || !info.node) throw new Error('canvas unavailable');
        const rowHeights = snapshotTiers.map((tier) => {
          const lines = Math.max(1, Math.ceil(tier.items.length / config.rowColumns));
          return Math.max(config.rowMinHeight, config.rowContentPadding * 2 + lines * config.rowCoverHeight + (lines - 1) * config.rowCoverGapY);
        });
        const rowsHeight = rowHeights.reduce((sum, value) => sum + value, 0) + (snapshotTiers.length - 1) * config.rowGap;
        const height = config.topHeight + rowsHeight + config.footerGap + config.footerHeight + config.bottomPadding;
        const canvas = info.node;
        canvas.width = CANVAS_WIDTH * config.scale;
        canvas.height = height * config.scale;
        const ctx = canvas.getContext('2d');
        if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(config.scale, config.scale);
        const imageMap = {};
        const coverErrorIds = detail.coverErrorIds || {};
        const imageItems = snapshotTiers.reduce((all, tier) => all.concat(tier.items), []).filter((item) => item.cover && !coverErrorIds[item.id]);
        await Promise.all(imageItems.map(async (item) => { imageMap[item.id] = await loadCanvasImage(canvas, item.cover); }));
        const wordmark = await loadCanvasImage(canvas, config.wordmarkPath);
        if (this._disposed) { finish(); return; }
        drawPoster(ctx, height, imageMap, rowHeights, snapshotTiers, wordmark, rankedCount, detail.rankingTitle || this.data.rankingTitle, config);
        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
          destWidth: canvas.width,
          destHeight: canvas.height,
          success: (response) => { finish(); if (!this._disposed) this._saveExport(response.tempFilePath); },
          fail: () => { finish(); wx.showToast({ title: '图片生成失败，请重试', icon: 'none' }); },
        });
      } catch (error) {
        finish();
        wx.showToast({ title: '图片生成失败，请重试', icon: 'none' });
      }
    });
  },

  _saveExport(filePath) {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: (error) => {
        if (error && /auth deny|auth denied|authorize no response/i.test(error.errMsg || '')) {
          wx.showModal({
            title: '需要相册权限',
            content: '开启权限后才能保存排行图片',
            confirmText: '去设置',
            success: (res) => { if (res.confirm) wx.openSetting(); },
          });
        } else wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      },
    });
  },

  onShareAppMessage() {
    // 排行仅存在当前设备，分享是工具入口，不声称能带出个人排名。
    return { title: (this.data.rankingTitle || POSTER.title) + '｜从夯到拉', path: rankingUrl(this._source, this._boardId) };
  },
});
