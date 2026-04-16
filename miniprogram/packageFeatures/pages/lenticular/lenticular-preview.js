const { applyLowPassFilter, createEngine } = require('../../utils/lenticular-engine');

const app = getApp();

/** 滤波平滑系数（越大越灵敏，越小越平滑） */
const FILTER_ALPHA = 0.35;
const DEBUG_BALL_RANGE = 80;

/** 条纹数量 */
const STRIP_COUNT_VERTICAL = 24;
const STRIP_COUNT_HORIZONTAL = 36;

/** 渐进扫过的扩散范围 */
var SWEEP_SPREAD = 0.4;

function buildMaskStyle(fraction, sensingAxis) {
  if (fraction <= 0) return '';

  var isVertical = sensingAxis === 'vertical';
  var stripCount = isVertical ? STRIP_COUNT_HORIZONTAL : STRIP_COUNT_VERTICAL;
  var direction = isVertical ? 'to bottom' : 'to right';

  var stripWidth = 100 / stripCount;
  var stops = [];

  for (var i = 0; i < stripCount; i++) {
    var t = i / (stripCount - 1);

    var localFraction = fraction * (1 + SWEEP_SPREAD) - t * SWEEP_SPREAD;
    localFraction = Math.max(0, Math.min(1, localFraction));

    var gapRatio = localFraction;
    var solidRatio = 1 - gapRatio;

    var base = i * stripWidth;
    var halfGap = stripWidth * gapRatio / 2;
    var solidWidth = stripWidth * solidRatio;

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
    degreesPerImage: 15,
    showDebug: false,
    displayIndex: 0,
    nextIndex: 0,
    maskStyle: '',
    filteredPitch: '0.0',
    filteredRoll: '0.0',
    debugBallX: 0,
    debugBallY: 0,
    navBarTop: 0,
  },

  _engine: null,
  _filteredPitch: 0,
  _filteredRoll: 0,
  _sensing: false,
  _boundOnMotion: null,
  _lastDisplayIndex: -1,

  onLoad() {
    this._engine = createEngine();
    this._boundOnMotion = this._onMotion.bind(this);

    const menuRect = wx.getMenuButtonBoundingClientRect();
    this.setData({ navBarTop: menuRect.top });

    const data = (app.globalData || {}).lenticularData;
    if (!data || !data.images || data.images.length < 2) {
      wx.showToast({ title: '数据异常', icon: 'none' });
      wx.navigateBack();
      return;
    }

    this.setData({
      images: data.images,
      sensingAxis: data.sensingAxis,
      degreesPerImage: data.degreesPerImage,
      showDebug: data.showDebug,
    });
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

  onBack() {
    wx.navigateBack();
  },

  // ─── 传感器 ─────────────────────────────────

  _startSensing() {
    if (this._sensing) return;
    this._sensing = true;

    wx.startDeviceMotionListening({
      interval: 'game',
      fail: (err) => {
        console.warn('[LenticularPreview] 传感器启动失败:', err);
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

    // 切换时触觉反馈
    if (result.displayIndex !== this._lastDisplayIndex && this._lastDisplayIndex >= 0) {
      wx.vibrateShort({ type: 'light' });
    }
    this._lastDisplayIndex = result.displayIndex;

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
