const api = require('../../utils/shared-board/cloud-api');
const R = require('../../utils/shared-board/ranking');

const STORAGE_PREFIX = 'otakumap:shared-board-ranking:v1:';
const POSTER = R.RANKING_POSTER_CONFIG;
const UI = R.RANKING_UI_CONFIG;
const CANVAS_WIDTH = POSTER.canvasWidth;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function canvasImage(canvas, path) {
  return new Promise((resolve) => {
    if (!path) return resolve(null);
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = path;
  });
}

function imageInfoPath(src, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('image load timeout')), timeoutMs);
    wx.getImageInfo({
      src,
      success: (result) => finish(resolve, result.path),
      fail: (error) => finish(reject, error),
    });
  });
}

async function loadCanvasImage(canvas, src) {
  if (!src) return null;
  try {
    const localPath = await imageInfoPath(src);
    return canvasImage(canvas, localPath);
  } catch (error) {
    return null;
  }
}

function drawImageAspectFill(ctx, image, x, y, width, height, radius) {
  if (!image) return false;
  const imageWidth = image.width || width;
  const imageHeight = image.height || height;
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  const sourceX = Math.max(0, (imageWidth - sourceWidth) / 2);
  const sourceY = Math.max(0, (imageHeight - sourceHeight) / 2);
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  ctx.restore();
  return true;
}

function drawImageContain(ctx, image, x, y, width, height) {
  if (!image) return false;
  const imageWidth = image.width || width;
  const imageHeight = image.height || height;
  const scale = Math.min(width / imageWidth, height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  return true;
}

function fittedTitle(ctx, text, maxWidth, maxSize, minSize) {
  let value = String(text || '').trim();
  let size = maxSize;
  ctx.font = `bold ${size}px sans-serif`;
  while (size > minSize && ctx.measureText(value).width > maxWidth) {
    size -= 2;
    ctx.font = `bold ${size}px sans-serif`;
  }
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 2 && ctx.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
  return value + '…';
}

Page({
  data: {
    boardId: '',
    boardName: '',
    rankingTitle: '我的番剧排行',
    ui: UI,
    loading: true,
    failed: false,
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
    selectedTierId: '',
    selectedTierLabel: '',
  },

  async onLoad(query) {
    const boardId = (query && query.boardId) || '';
    if (!boardId) {
      this.setData({ loading: false, failed: true });
      return;
    }
    this.setData({ boardId });
    const result = await api.getBoardDetail(boardId);
    if (!result.ok || !result.data) {
      this.setData({ loading: false, failed: true });
      wx.showToast({ title: '番单读取失败', icon: 'none' });
      return;
    }
    const saved = R.deserialize(wx.getStorageSync(STORAGE_PREFIX + boardId));
    const items = R.normalizeItems(result.data.items || [], saved);
    const storedTitle = wx.getStorageSync(STORAGE_PREFIX + boardId + ':title');
    this.setData({
      loading: false,
      boardName: (result.data.board && result.data.board.name) || '',
      rankingTitle: storedTitle || '我的番剧排行',
    });
    this._setItems(items);
  },

  _setItems(items) {
    const next = Array.isArray(items) ? items : [];
    const tiers = R.RANKING_TIERS.map((tier) => Object.assign({}, tier, { items: R.getTierItems(next, tier.id) }));
    const rankedCount = next.filter((item) => item.tierId).length;
    const totalCount = next.length;
    const progressPercent = totalCount ? Math.round((rankedCount / totalCount) * 100) : 0;
    this.setData({
      items: next,
      unrankedItems: next.filter((item) => !item.tierId),
      tiers,
      rankedCount,
      totalCount,
      progressPercent,
    });
    if (this.data.boardId) wx.setStorageSync(STORAGE_PREFIX + this.data.boardId, R.serialize(next));
  },

  onTitleInput(e) {
    const raw = e.detail.value || '';
    this.setData({ rankingTitle: raw });
    if (this.data.boardId) wx.setStorageSync(STORAGE_PREFIX + this.data.boardId + ':title', String(raw).trim() || '我的番剧排行');
  },

  onBack() { wx.navigateBack(); },

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
      selectedTierId: item.tierId || '__pool__',
      selectedTierLabel: selectedTier ? selectedTier.label : '待排区',
    });
  },

  onClosePicker() {
    this.setData({ selectedItem: null, selectedTierId: '', selectedTierLabel: '' });
  },

  preventTap() {},

  onChooseTier(e) {
    const selectedTierId = e.currentTarget.dataset.tierId || '__pool__';
    const tierId = selectedTierId === '__pool__' ? null : selectedTierId;
    const itemId = this.data.selectedItem && this.data.selectedItem.id;
    this.setData({ selectedItem: null, selectedTierId: '', selectedTierLabel: '' });
    if (itemId) this._setItems(R.moveItem(this.data.items, itemId, tierId));
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
        if (nextDistance < targetDistance) {
          target = index;
          targetDistance = nextDistance;
        }
      }
    });
    const tier = target === '' ? null : R.RANKING_TIERS[target];
    const nextTier = target === '' ? '' : (target === R.RANKING_TIERS.length ? '__pool__' : tier.id);
    if (nextTier !== this.data.dragOverTierId) {
      this.setData({ dragOverTierId: nextTier, dragHint: nextTier ? UI.dragHint : UI.dragOutsideHint });
    }
  },

  onDragEnd() {
    const itemId = this._dragItemId;
    const tierId = this.data.dragOverTierId === '__pool__' ? null : this.data.dragOverTierId;
    this._dragItemId = '';
    this._dropRects = [];
    this.setData({ dragItemId: '', dragOverTierId: '', dragHint: '' });
    if (itemId) {
      this._suppressTap = true;
      setTimeout(() => { this._suppressTap = false; }, 320);
    }
    if (itemId && tierId !== '') {
      this._setItems(R.moveItem(this.data.items, itemId, tierId));
    } else if (itemId) {
      wx.showToast({ title: UI.dragOutsideHint, icon: 'none' });
    }
  },

  onDragCancel() {
    if (!this._dragItemId) return;
    this._dragItemId = '';
    this._dropRects = [];
    this.setData({ dragItemId: '', dragOverTierId: '', dragHint: '' });
  },

  onPageScroll() {
    if (this._dragItemId) this.onDragCancel();
  },

  onHide() {
    this.onDragCancel();
  },

  onUnrank(e) {
    const id = e.currentTarget.dataset.id;
    if (id) this._setItems(R.moveItem(this.data.items, id, null));
  },

  onClear() {
    if (!this.data.items.some((item) => item.tierId)) return;
    wx.showModal({
      title: '清空档位',
      content: '番剧会回到待排区，确定继续吗？',
      confirmText: '清空',
      confirmColor: '#e34d59',
      success: (res) => {
        if (res.confirm) this._setItems(this.data.items.map((item) => Object.assign({}, item, { tierId: null })));
      },
    });
  },

  async onExport() {
    if (this._exporting) return;
    const snapshotTiers = this.data.tiers.map((tier) => Object.assign({}, tier, { items: tier.items.slice() }));
    const rankedCount = snapshotTiers.reduce((sum, tier) => sum + tier.items.length, 0);
    if (!rankedCount) {
      wx.showToast({ title: '先把至少一部番剧放入档位', icon: 'none' });
      return;
    }
    this._exporting = true;
    if (wx.showLoading) wx.showLoading({ title: '正在生成排行图', mask: true });
    const query = this.createSelectorQuery();
    query.select('#rankingCanvas').fields({ node: true, size: true });
    query.exec(async (result) => {
      const finish = () => {
        this._exporting = false;
        if (wx.hideLoading) wx.hideLoading();
      };
      try {
        const info = result && result[0];
        if (!info || !info.node) throw new Error('canvas unavailable');
        const rowHeights = snapshotTiers.map((tier) => {
          const lines = Math.max(1, Math.ceil(tier.items.length / POSTER.rowColumns));
          return Math.max(POSTER.rowMinHeight, POSTER.rowContentPadding * 2 + lines * POSTER.rowCoverHeight + (lines - 1) * POSTER.rowCoverGapY);
        });
        const rowsHeight = rowHeights.reduce((sum, value) => sum + value, 0) + (snapshotTiers.length - 1) * POSTER.rowGap;
        const footerY = POSTER.topHeight + rowsHeight + POSTER.footerGap;
        const height = footerY + POSTER.footerHeight + POSTER.bottomPadding;
        const canvas = info.node;
        canvas.width = CANVAS_WIDTH * POSTER.scale;
        canvas.height = height * POSTER.scale;
        const ctx = canvas.getContext('2d');
        if (ctx.setTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(POSTER.scale, POSTER.scale);
        const imageMap = {};
        const imageItems = snapshotTiers.reduce((all, tier) => all.concat(tier.items), []).filter((item) => item.cover && !this.data.coverErrorIds[item.id]);
        await Promise.all(imageItems.map(async (item) => {
          imageMap[item.id] = await loadCanvasImage(canvas, item.cover);
        }));
        const wordmark = await loadCanvasImage(canvas, POSTER.wordmarkPath);
        this._drawExport(ctx, height, imageMap, rowHeights, snapshotTiers, wordmark, rankedCount);
        setTimeout(() => wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
          destWidth: canvas.width,
          destHeight: canvas.height,
          success: (r) => { finish(); this._saveExport(r.tempFilePath); },
          fail: () => { finish(); wx.showToast({ title: '图片生成失败，请重试', icon: 'none' }); },
        }), 80);
      } catch (error) {
        finish();
        wx.showToast({ title: '图片生成失败，请重试', icon: 'none' });
      }
    });
  },

  _drawExport(ctx, height, imageMap, rowHeights, tiers, wordmark, rankedCount) {
    ctx.fillStyle = '#fffdf9';
    ctx.fillRect(0, 0, CANVAS_WIDTH, height);
    ctx.fillStyle = '#11295c';
    const title = fittedTitle(ctx, this.data.rankingTitle || POSTER.title, 460, POSTER.maxTitleSize, POSTER.minTitleSize);
    ctx.fillText(title, 44, 58);
    const previousTextAlign = ctx.textAlign;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#477bd9';
    ctx.font = 'bold 23px sans-serif';
    const rankedCountText = String(rankedCount);
    const rankedCountLabel = `${rankedCountText} 部`;
    ctx.fillText(rankedCountLabel, POSTER.contentRightX, 59);
    const rankedCountWidth = ctx.measureText(rankedCountLabel).width;
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#7b87a0';
    ctx.fillText('已入榜', POSTER.contentRightX - rankedCountWidth - 10, 59);
    ctx.fillStyle = '#dce7fb';
    ctx.fillRect(574, 76, POSTER.contentRightX - 574, 3);
    ctx.fillStyle = '#9ab5ed';
    ctx.beginPath();
    ctx.arc(564, 77.5, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = previousTextAlign || 'left';
    ctx.fillStyle = '#66708a';
    ctx.font = '24px sans-serif';
    ctx.fillText(POSTER.subtitle, 44, 91);
    ctx.fillStyle = '#8b93a5';
    ctx.font = '18px sans-serif';
    ctx.fillText(POSTER.rankingNote, 44, 119);
    ctx.fillStyle = '#f27670';
    ctx.fillRect(44, 136, 104, 6);
    ctx.fillStyle = '#f2b638';
    ctx.fillRect(162, 136, 56, 6);
    let y = POSTER.topHeight;
    tiers.forEach((tier, index) => {
      const tierHeight = rowHeights[index];
      ctx.fillStyle = tier.tint;
      roundedRect(ctx, POSTER.rowX, y, POSTER.rowWidth, tierHeight, 20);
      ctx.fill();
      ctx.fillStyle = tier.color;
      roundedRect(ctx, POSTER.rowX, y, POSTER.rowLabelWidth, tierHeight, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      const labelCenter = y + tierHeight / 2;
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(tier.label, POSTER.rowX + 10, labelCenter - 8);
      ctx.font = '22px sans-serif';
      ctx.fillText(tier.items.length + ' 部', POSTER.rowX + 11, labelCenter + 28);
      tier.items.forEach((item, itemIndex) => {
        const column = itemIndex % POSTER.rowColumns;
        const line = Math.floor(itemIndex / POSTER.rowColumns);
        const x = POSTER.coverStartX + column * (POSTER.rowCoverWidth + POSTER.rowCoverGap);
        const cardY = y + POSTER.rowContentPadding + line * (POSTER.rowCoverHeight + POSTER.rowCoverGapY);
        const image = imageMap[item.id];
        ctx.fillStyle = '#fff';
        roundedRect(ctx, x, cardY, POSTER.rowCoverWidth, POSTER.rowCoverHeight, 12);
        ctx.fill();
        if (image) {
          drawImageAspectFill(ctx, image, x + 4, cardY + 4, POSTER.rowCoverWidth - 8, POSTER.rowCoverHeight - 8, 9);
        } else {
          ctx.fillStyle = item.coverFallback && item.coverFallback.color ? item.coverFallback.color : '#477bd9';
          roundedRect(ctx, x + 4, cardY + 4, POSTER.rowCoverWidth - 8, POSTER.rowCoverHeight - 8, 9);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 26px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText((item.coverFallback && item.coverFallback.char) || '番', x + POSTER.rowCoverWidth / 2, cardY + 60);
          ctx.textAlign = 'left';
        }
      });
      y += tierHeight + POSTER.rowGap;
    });
    const footerY = y + POSTER.footerGap - POSTER.rowGap;
    ctx.strokeStyle = '#e7e3ed';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(44, footerY - 8);
    ctx.lineTo(POSTER.contentRightX, footerY - 8);
    ctx.stroke();
    drawImageContain(ctx, wordmark, 592, footerY + 4, 102, 34);
    ctx.fillStyle = '#11295c';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(POSTER.footerCopy, 44, footerY + 30);
    ctx.fillStyle = '#a2a9b8';
    ctx.font = '17px sans-serif';
    ctx.fillText(POSTER.footerTitle, 44, footerY + 60);
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
        } else {
          wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
      },
    });
  },

  onShareAppMessage() {
    return {
      title: (this.data.rankingTitle || '我的番剧排行') + '｜从夯到拉',
      path: '/packageFeatures/pages/shared-board/ranking?boardId=' + this.data.boardId,
    };
  },
});
