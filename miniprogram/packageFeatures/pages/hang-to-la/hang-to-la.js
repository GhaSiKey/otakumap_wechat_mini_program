const R = require('../../utils/hang-to-la/ranking-model');
const { SOURCES, isValidSource, loadSource, rankingUrl } = require('../../utils/hang-to-la/sources');
const { loadCanvasImages, loadCanvasImage, drawPoster } = require('../../utils/hang-to-la/poster');

const POSTER = R.RANKING_POSTER_CONFIG;
const CANVAS_WIDTH = POSTER.canvasWidth;
const PHOTO_ALBUM_SCOPE = 'scope.writePhotosAlbum';
const PHOTO_PERMISSION_ERROR_RE = /auth deny|auth denied|authorize no response|permission denied|privacy|writePhotosAlbum|need auth|auth required|not authorized/i;

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

function writeRealtimeError(message, details) {
  try {
    if (typeof wx.getRealtimeLogManager !== 'function') return;
    const logger = wx.getRealtimeLogManager();
    if (logger && typeof logger.error === 'function') logger.error(message, details);
  } catch (error) {
    console.warn('[hang-to-la] realtime log unavailable', error);
  }
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
      let stage = 'authorization';
      try {
        await this._ensurePhotoAlbumAuthorization();
        const info = result && result[0];
        if (!info || !info.node) {
          console.warn('[hang-to-la] ranking canvas unavailable', { source: this._source });
          throw new Error('canvas unavailable');
        }
        const rowHeights = snapshotTiers.map((tier) => {
          const lines = Math.max(1, Math.ceil(tier.items.length / config.rowColumns));
          return Math.max(config.rowMinHeight, config.rowContentPadding * 2 + lines * config.rowCoverHeight + (lines - 1) * config.rowCoverGapY);
        });
        const rowsHeight = rowHeights.reduce((sum, value) => sum + value, 0) + (snapshotTiers.length - 1) * config.rowGap;
        const height = config.topHeight + rowsHeight + config.footerGap + config.footerHeight + config.bottomPadding;
        const canvas = info.node;
        const coverErrorIds = detail.coverErrorIds || {};
        const imageItems = snapshotTiers.reduce((all, tier) => all.concat(tier.items), []).filter((item) => item.cover && !coverErrorIds[item.id]);
        const imageMap = await loadCanvasImages(canvas, imageItems, config.imageLoadConcurrency);
        const wordmark = await loadCanvasImage(canvas, config.wordmarkPath);
        if (this._disposed) { finish(); return; }
        const renderAndExport = (scale) => new Promise((resolve, reject) => {
          canvas.width = Math.round(CANVAS_WIDTH * scale);
          canvas.height = Math.round(height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('canvas context unavailable'));
          if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(scale, scale);
          drawPoster(ctx, height, imageMap, rowHeights, snapshotTiers, wordmark, rankedCount, detail.rankingTitle || this.data.rankingTitle, config);
          wx.canvasToTempFilePath({
            canvas,
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height,
            destWidth: canvas.width,
            destHeight: canvas.height,
            success: resolve,
            fail: reject,
          });
        });
        let response;
        let exportScale = config.scale;
        stage = 'render';
        try {
          response = await renderAndExport(exportScale);
        } catch (firstError) {
          console.warn('[hang-to-la] ranking canvas export failed', {
            errMsg: firstError && firstError.errMsg,
            width: CANVAS_WIDTH * config.scale,
            height: height * config.scale,
            rankedCount,
          });
          if (!(config.fallbackScale < config.scale)) throw firstError;
          exportScale = config.fallbackScale;
          response = await renderAndExport(exportScale);
        }
        if (!this._disposed) {
          stage = 'save';
          try {
            await this._saveExport(response.tempFilePath);
          } catch (saveError) {
            console.warn('[hang-to-la] ranking image save failed', {
              errMsg: saveError && (saveError.errMsg || saveError.message),
              filePath: response && response.tempFilePath,
              width: CANVAS_WIDTH * exportScale,
              height: height * exportScale,
              rankedCount,
            });
            if (this._isPhotoPermissionError(saveError)) throw saveError;
            if (!(config.fallbackScale < exportScale)) throw saveError;
            exportScale = config.fallbackScale;
            stage = 'render-retry';
            response = await renderAndExport(exportScale);
            stage = 'save-retry';
            await this._saveExport(response.tempFilePath);
          }
        }
        finish();
      } catch (error) {
        finish();
        console.warn('[hang-to-la] ranking export aborted', { errMsg: error && (error.errMsg || error.message), rankedCount });
        if (this._isPhotoPermissionError(error)) this._showPhotoAlbumPermission();
        else wx.showToast({ title: stage === 'save' || stage === 'save-retry' ? '保存失败，请重试' : '图片生成失败，请重试', icon: 'none' });
      }
    });
  },

  _ensurePhotoAlbumAuthorization() {
    const privacy = typeof wx.requirePrivacyAuthorize === 'function'
      ? new Promise((resolve, reject) => wx.requirePrivacyAuthorize({ success: resolve, fail: reject }))
      : Promise.resolve();
    return privacy.then(() => new Promise((resolve, reject) => {
      if (typeof wx.getSetting !== 'function') return resolve();
      wx.getSetting({
        success: (result) => {
          const authSetting = result && result.authSetting ? result.authSetting : {};
          const status = authSetting[PHOTO_ALBUM_SCOPE];
          if (status === true) return resolve();
          if (status === false || typeof wx.authorize !== 'function') return reject({ errMsg: 'authorize no response' });
          wx.authorize({ scope: PHOTO_ALBUM_SCOPE, success: resolve, fail: reject });
        },
        fail: resolve,
      });
    }));
  },

  _isPhotoPermissionError(error) {
    return PHOTO_PERMISSION_ERROR_RE.test(error && (error.errMsg || error.message) || '');
  },

  _showPhotoAlbumPermission() {
    if (!wx.showModal) {
      wx.showToast({ title: '需要相册权限', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '需要相册权限',
      content: '开启相册权限后才能保存排行图片',
      confirmText: '去设置',
      success: (res) => { if (res.confirm && wx.openSetting) wx.openSetting(); },
    });
  },

  _saveExport(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => { wx.showToast({ title: '已保存到相册', icon: 'success' }); resolve(); },
        fail: (error) => {
          writeRealtimeError('ranking image save failed', {
            source: this._source,
            boardId: this._boardId,
            filePath,
            errMsg: error && (error.errMsg || error.message) || '',
            errno: error && error.errno,
          });
          reject(error);
        },
      });
    });
  },

  onShareAppMessage() {
    // 排行仅存在当前设备，分享是工具入口，不声称能带出个人排名。
    return { title: (this.data.rankingTitle || POSTER.title) + '｜从夯到拉', path: rankingUrl(this._source, this._boardId) };
  },
});
