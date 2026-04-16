const { applyLowPassFilter, createEngine } = require('../../utils/lenticular-engine');

const app = getApp();

/** 滤波平滑系数（越大越灵敏，越小越平滑） */
const FILTER_ALPHA = 0.35;
/** 调试小球的映射范围 (rpx) */
const DEBUG_BALL_RANGE = 80;

/** 条纹数量：垂直感应用竖条纹，水平感应用横条纹 */
const STRIP_COUNT_VERTICAL = 24;
const STRIP_COUNT_HORIZONTAL = 36;

/** 渐进扫过的扩散范围：值越大，条纹变化从一侧到另一侧的渐进跨度越大 */
var SWEEP_SPREAD = 0.4;

/**
 * 根据 fraction 和感应轴生成 CSS mask 样式
 *
 * 设计要点：
 * 1. 硬切边缘 — 所有条纹统一用 6-stop 格式，确保边界锐利
 * 2. 渐进扫过 — 第 i 条条纹的缝隙宽度 = f(fraction, i/N)
 *    靠前的条纹先出缝隙，靠后的后出缝隙，像百叶窗逐条翻转
 *    缝隙宽度从一侧到另一侧严格线性递增
 */
function buildMaskStyle(fraction, sensingAxis) {
  if (fraction <= 0) return '';

  var isVertical = sensingAxis === 'vertical';
  // 条纹方向与倾斜方向垂直：前后倾→横条纹，左右倾→竖条纹
  var stripCount = isVertical ? STRIP_COUNT_HORIZONTAL : STRIP_COUNT_VERTICAL;
  var direction = isVertical ? 'to bottom' : 'to right';

  var stripWidth = 100 / stripCount;
  var stops = [];

  for (var i = 0; i < stripCount; i++) {
    // 条纹归一化位置 [0, 1]，第 0 条=0，最后一条≈1
    var t = i / (stripCount - 1);

    // localFraction：线性映射，前端(t=0)的条纹先变化
    // fraction=0 时全部 localFraction=0（无缝隙）
    // fraction=1 时全部 localFraction=1（全透明）
    // 中间态：t 小的条纹 localFraction 更大
    var localFraction = fraction * (1 + SWEEP_SPREAD) - t * SWEEP_SPREAD;
    localFraction = Math.max(0, Math.min(1, localFraction));

    // 缝隙占条纹宽度的比例 = localFraction
    var gapRatio = localFraction;
    var solidRatio = 1 - gapRatio;

    var base = i * stripWidth;
    var halfGap = stripWidth * gapRatio / 2;
    var solidWidth = stripWidth * solidRatio;

    // 统一 6-stop 格式：transparent | black | transparent
    var solidStart = base + halfGap;
    var solidEnd = solidStart + solidWidth;

    stops.push('transparent ' + base + '%');
    stops.push('transparent ' + solidStart + '%');
    stops.push('black ' + solidStart + '%');
    stops.push('black ' + solidEnd + '%');
    stops.push('transparent ' + solidEnd + '%');
    stops.push('transparent ' + (base + stripWidth) + '%');
  }

  var mask = 'linear-gradient(' + direction + ', ' + stops.join(', ') + ')';
  return '-webkit-mask-image:' + mask + '; mask-image:' + mask + ';';
}

Page({
  data: {
    images: [],
    sensingAxis: 'vertical',
    degreesPerImage: 8,
    showDebug: true,
    displayIndex: 0,
    nextIndex: 0,
    maskStyle: '',
    filteredPitch: '0.0',
    filteredRoll: '0.0',
    debugBallX: 0,
    debugBallY: 0,

    // F: 拖拽排序
    dragging: false,
    dragIndex: -1,
    dragTargetIndex: -1,
    dragGhostX: 0,
    dragGhostY: 0,
    dragGhostSrc: '',
  },

  /** @type {ReturnType<typeof createEngine>} */
  _engine: null,
  _filteredPitch: 0,
  _filteredRoll: 0,
  _sensing: false,
  _boundOnMotion: null,

  // 拖拽内部状态（不触发渲染）
  _gridRects: [],
  _dragStartX: 0,
  _dragStartY: 0,
  _dragOffsetX: 0,
  _dragOffsetY: 0,

  onLoad() {
    this._engine = createEngine();
    this._boundOnMotion = this._onMotion.bind(this);
  },

  onShow() {
    this._startSensing();
  },

  onHide() {
    this._stopSensing();
  },

  onUnload() {
    this._stopSensing();
  },

  // ─── 图片管理 ───────────────────────────────

  onChooseImages() {
    const remaining = 9 - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: '最多9张图片', icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        const newPaths = res.tempFiles.map((f) => f.tempFilePath);
        this.setData({
          images: [...this.data.images, ...newPaths],
        });
        this._engine.reset();
      },
    });
  },

  onDeleteImage(e) {
    if (this.data.dragging) return;
    const { index } = e.currentTarget.dataset;
    const images = [...this.data.images];
    images.splice(index, 1);

    const displayIndex = Math.min(this.data.displayIndex, Math.max(0, images.length - 1));
    this.setData({ images, displayIndex });
    this._engine.reset();
  },

  // ─── F: 拖拽排序 ───────────────────────────

  onDragStart(e) {
    const { index } = e.currentTarget.dataset;
    const touch = e.touches[0];

    this._cacheGridRects(() => {
      const rect = this._gridRects[index];
      if (!rect) return;

      this._dragOffsetX = touch.clientX - rect.left - rect.width / 2;
      this._dragOffsetY = touch.clientY - rect.top - rect.height / 2;

      wx.vibrateShort({ type: 'medium' });

      this.setData({
        dragging: true,
        dragIndex: index,
        dragTargetIndex: index,
        dragGhostSrc: this.data.images[index],
        dragGhostX: touch.clientX - this._dragOffsetX,
        dragGhostY: touch.clientY - this._dragOffsetY,
      });
    });
  },

  onDragMove(e) {
    if (!this.data.dragging) return;
    const touch = e.touches[0];
    const x = touch.clientX - this._dragOffsetX;
    const y = touch.clientY - this._dragOffsetY;

    let targetIndex = this.data.dragTargetIndex;
    for (let i = 0; i < this._gridRects.length; i++) {
      const r = this._gridRects[i];
      if (!r) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (Math.abs(touch.clientX - cx) < r.width / 2 && Math.abs(touch.clientY - cy) < r.height / 2) {
        targetIndex = i;
        break;
      }
    }

    const updates = { dragGhostX: x, dragGhostY: y };
    if (targetIndex !== this.data.dragTargetIndex) {
      updates.dragTargetIndex = targetIndex;
    }
    this.setData(updates);
  },

  onDragEnd() {
    if (!this.data.dragging) return;
    const { dragIndex, dragTargetIndex, images } = this.data;

    if (dragIndex !== dragTargetIndex && dragIndex >= 0 && dragTargetIndex >= 0) {
      const newImages = [...images];
      const [moved] = newImages.splice(dragIndex, 1);
      newImages.splice(dragTargetIndex, 0, moved);

      this.setData({
        images: newImages,
        dragging: false,
        dragIndex: -1,
        dragTargetIndex: -1,
      });
      this._engine.reset();
    } else {
      this.setData({
        dragging: false,
        dragIndex: -1,
        dragTargetIndex: -1,
      });
    }
  },

  _cacheGridRects(cb) {
    const query = this.createSelectorQuery();
    query.selectAll('.grid-item-wrap').boundingClientRect((rects) => {
      this._gridRects = rects || [];
      cb && cb();
    }).exec();
  },

  // ─── 参数设置 ───────────────────────────────

  onAxisChange(e) {
    this.setData({ sensingAxis: e.detail.value });
    this._engine.reset();
  },

  onSensitivityChange(e) {
    this.setData({ degreesPerImage: e.detail.value });
    this._engine.reset();
  },

  onToggleDebug(e) {
    this.setData({ showDebug: e.detail.value });
  },

  // ─── 预览导航 ───────────────────────────────

  onPreview() {
    if (this.data.images.length < 2) return;

    app.globalData = app.globalData || {};
    app.globalData.lenticularData = {
      images: this.data.images,
      sensingAxis: this.data.sensingAxis,
      degreesPerImage: this.data.degreesPerImage,
      showDebug: this.data.showDebug,
    };

    wx.navigateTo({ url: './lenticular-preview' });
  },

  // ─── 传感器 ─────────────────────────────────

  _startSensing() {
    if (this._sensing) return;
    this._sensing = true;

    wx.startDeviceMotionListening({
      interval: 'game',
      fail: (err) => {
        console.warn('[LenticularEdit] 传感器启动失败:', err);
      },
    });

    wx.onDeviceMotionChange(this._boundOnMotion);
  },

  _stopSensing() {
    if (!this._sensing) return;
    this._sensing = false;
    wx.offDeviceMotionChange(this._boundOnMotion);
    wx.stopDeviceMotionListening();
  },

  _onMotion(res) {
    const pitch = res.beta || 0;
    const roll = res.gamma || 0;

    this._filteredPitch = applyLowPassFilter(pitch, this._filteredPitch, FILTER_ALPHA);
    this._filteredRoll = applyLowPassFilter(roll, this._filteredRoll, FILTER_ALPHA);

    const angle = this.data.sensingAxis === 'vertical'
      ? this._filteredPitch
      : this._filteredRoll;

    const { images, degreesPerImage, sensingAxis } = this.data;
    if (images.length === 0) return;

    const result = this._engine.update(angle, images.length, degreesPerImage);

    const updates = {
      displayIndex: result.displayIndex,
      nextIndex: result.nextIndex,
      maskStyle: buildMaskStyle(result.fraction, sensingAxis),
    };

    if (this.data.showDebug) {
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      updates.filteredPitch = this._filteredPitch.toFixed(1);
      updates.filteredRoll = this._filteredRoll.toFixed(1);
      updates.debugBallX = clamp(this._filteredRoll / 45 * DEBUG_BALL_RANGE, -DEBUG_BALL_RANGE, DEBUG_BALL_RANGE);
      updates.debugBallY = clamp(this._filteredPitch / 45 * DEBUG_BALL_RANGE, -DEBUG_BALL_RANGE, DEBUG_BALL_RANGE);
    }

    this.setData(updates);
  },
});
