/**
 * 日麻点数计算器页面
 */

const mahjong = require('../../../utils/mahjong/index');

// 所有牌的定义
const ALL_TILES = {
  m: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  p: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  s: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  z: [1, 2, 3, 4, 5, 6, 7],
};

// 字牌显示名称
const HONOR_NAMES = {
  1: '东',
  2: '南',
  3: '西',
  4: '北',
  5: '白',
  6: '發',
  7: '中',
};

// 风牌选项
const WIND_OPTIONS = [
  { value: 'east', label: '东' },
  { value: 'south', label: '南' },
  { value: 'west', label: '西' },
  { value: 'north', label: '北' },
];

Page({
  data: {
    // 场况设置
    bakaze: 'east',
    jikaze: 'east',
    isTsumo: true,
    honba: 0,
    kyoutaku: 0,

    // 立直相关
    isRiichi: false,
    isDoubleRiichi: false,
    isIppatsu: false,

    // 特殊状态
    isRinshan: false,
    isChankan: false,
    isHaitei: false,

    // 手牌
    handTiles: [],
    agariTile: null,

    // 宝牌
    doraIndicators: [],
    uraIndicators: [],

    // UI状态
    showTileSelector: false,
    selectorMode: 'hand', // 'hand' | 'agari' | 'dora' | 'ura'
    selectorTitle: '选择手牌',

    // 计算结果
    result: null,
    showResult: false,

    // 配置
    windOptions: WIND_OPTIONS,
    allTiles: ALL_TILES,
    honorNames: HONOR_NAMES,
    theme: mahjong.THEME,
  },

  onLoad() {
    // 初始化
  },

  // ==================== 场况设置 ====================

  onBakazeChange(e) {
    this.setData({ bakaze: e.currentTarget.dataset.value });
  },

  onJikazeChange(e) {
    this.setData({ jikaze: e.currentTarget.dataset.value });
  },

  onTsumoChange(e) {
    this.setData({ isTsumo: e.currentTarget.dataset.value });
  },

  onHonbaChange(e) {
    const value = parseInt(e.currentTarget.dataset.value, 10) || 0;
    this.setData({ honba: Math.max(0, value) });
  },

  onKyoutakuChange(e) {
    const value = parseInt(e.currentTarget.dataset.value, 10) || 0;
    this.setData({ kyoutaku: Math.max(0, value) });
  },

  // ==================== 立直设置 ====================

  onRiichiChange(e) {
    const isRiichi = e.currentTarget.dataset.value;
    this.setData({
      isRiichi,
      isDoubleRiichi: isRiichi ? this.data.isDoubleRiichi : false,
      isIppatsu: isRiichi ? this.data.isIppatsu : false,
    });
  },

  onDoubleRiichiChange(e) {
    this.setData({ isDoubleRiichi: e.currentTarget.dataset.value });
  },

  onIppatsuChange(e) {
    this.setData({ isIppatsu: e.currentTarget.dataset.value });
  },

  // ==================== 特殊状态 ====================

  onRinshanChange(e) {
    this.setData({ isRinshan: e.currentTarget.dataset.value });
  },

  onChankanChange(e) {
    this.setData({ isChankan: e.currentTarget.dataset.value });
  },

  onHaiteiChange(e) {
    this.setData({ isHaitei: e.currentTarget.dataset.value });
  },

  // ==================== 牌选择器 ====================

  openTileSelector(mode, title) {
    this.setData({
      showTileSelector: true,
      selectorMode: mode,
      selectorTitle: title,
    });
  },

  closeTileSelector() {
    this.setData({ showTileSelector: false });
  },

  onAddHandTile() {
    this.openTileSelector('hand', '选择手牌');
  },

  onAddAgariTile() {
    this.openTileSelector('agari', '选择和牌张');
  },

  onAddDora() {
    this.openTileSelector('dora', '选择表宝牌指示牌');
  },

  onAddUraDora() {
    this.openTileSelector('ura', '选择里宝牌指示牌');
  },

  onSelectTile(e) {
    const { suit, value, isRed } = e.currentTarget.dataset;
    const tile = { suit, value: parseInt(value, 10), isRed: !!isRed };

    const { selectorMode, handTiles, doraIndicators, uraIndicators } = this.data;

    switch (selectorMode) {
      case 'hand':
        if (handTiles.length < 13) {
          this.setData({ handTiles: [...handTiles, tile] });
        }
        break;
      case 'agari':
        this.setData({ agariTile: tile, showTileSelector: false });
        break;
      case 'dora':
        if (doraIndicators.length < 5) {
          this.setData({ doraIndicators: [...doraIndicators, tile] });
        }
        break;
      case 'ura':
        if (uraIndicators.length < 5) {
          this.setData({ uraIndicators: [...uraIndicators, tile] });
        }
        break;
    }
  },

  onSelectRedTile(e) {
    const { suit } = e.currentTarget.dataset;
    const tile = { suit, value: 5, isRed: true };

    const { selectorMode, handTiles, doraIndicators, uraIndicators } = this.data;

    switch (selectorMode) {
      case 'hand':
        if (handTiles.length < 13) {
          this.setData({ handTiles: [...handTiles, tile] });
        }
        break;
      case 'agari':
        this.setData({ agariTile: tile, showTileSelector: false });
        break;
      case 'dora':
        if (doraIndicators.length < 5) {
          this.setData({ doraIndicators: [...doraIndicators, tile] });
        }
        break;
      case 'ura':
        if (uraIndicators.length < 5) {
          this.setData({ uraIndicators: [...uraIndicators, tile] });
        }
        break;
    }
  },

  // ==================== 删除牌 ====================

  onRemoveHandTile(e) {
    const index = e.currentTarget.dataset.index;
    const handTiles = [...this.data.handTiles];
    handTiles.splice(index, 1);
    this.setData({ handTiles });
  },

  onRemoveAgariTile() {
    this.setData({ agariTile: null });
  },

  onRemoveDora(e) {
    const index = e.currentTarget.dataset.index;
    const doraIndicators = [...this.data.doraIndicators];
    doraIndicators.splice(index, 1);
    this.setData({ doraIndicators });
  },

  onRemoveUraDora(e) {
    const index = e.currentTarget.dataset.index;
    const uraIndicators = [...this.data.uraIndicators];
    uraIndicators.splice(index, 1);
    this.setData({ uraIndicators });
  },

  onClearHand() {
    this.setData({
      handTiles: [],
      agariTile: null,
      result: null,
      showResult: false,
    });
  },

  // ==================== 计算 ====================

  onCalculate() {
    const {
      handTiles,
      agariTile,
      bakaze,
      jikaze,
      isTsumo,
      honba,
      kyoutaku,
      isRiichi,
      isDoubleRiichi,
      isIppatsu,
      isRinshan,
      isChankan,
      isHaitei,
      doraIndicators,
      uraIndicators,
    } = this.data;

    // 验证
    if (handTiles.length !== 13) {
      wx.showToast({ title: '请输入13张手牌', icon: 'none' });
      return;
    }

    if (!agariTile) {
      wx.showToast({ title: '请选择和牌张', icon: 'none' });
      return;
    }

    // 构建输入
    const hand = {
      closed: handTiles,
      melds: [],
      agariTile,
      isTsumo,
    };

    const situation = {
      bakaze,
      jikaze,
      isParent: jikaze === 'east',
      isTsumo,
      isRiichi,
      isDoubleRiichi,
      isIppatsu,
      isRinshan,
      isChankan,
      isHaitei,
      isHoutei: isHaitei && !isTsumo,
      honba,
      kyoutaku,
    };

    const dora = {
      indicators: doraIndicators,
      uraIndicators: isRiichi ? uraIndicators : [],
    };

    // 计算
    const result = mahjong.calculate({ hand, situation, dora });

    if (!result.success) {
      wx.showToast({ title: result.error, icon: 'none' });
      return;
    }

    this.setData({
      result,
      showResult: true,
    });
  },

  onCloseResult() {
    this.setData({ showResult: false });
  },

  // ==================== 工具方法 ====================

  getTileDisplay(tile) {
    if (tile.suit === 'z') {
      return HONOR_NAMES[tile.value];
    }
    return tile.isRed ? '赤' + tile.value : tile.value;
  },

  getTileSuitName(suit) {
    const names = { m: '万', p: '筒', s: '索', z: '字' };
    return names[suit];
  },
});
