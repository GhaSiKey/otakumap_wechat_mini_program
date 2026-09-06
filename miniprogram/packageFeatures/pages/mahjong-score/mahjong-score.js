/**
 * 日麻点数计算器页面 - 重构版
 */

const mahjong = require('../../utils/mahjong/index');

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

// 花色名称
const SUIT_NAMES = { m: '万', p: '筒', s: '索', z: '字' };

// 副露类型
const MELD_TYPES = [
  { value: 'chi', label: '吃' },
  { value: 'pon', label: '碰' },
  { value: 'kan', label: '明杠' },
  { value: 'ankan', label: '暗杠' },
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
    isHoutei: false,

    // 手牌（门前）
    handTiles: [],
    agariTile: null,

    // 副露
    melds: [], // { type: 'chi'|'pon'|'kan'|'ankan', tiles: [] }

    // 宝牌
    doraIndicators: [],
    uraIndicators: [],

    // UI状态
    currentSuit: 'm',
    selectorMode: 'hand', // 'hand' | 'agari' | 'dora' | 'ura' | 'meld'
    expandedPanel: '',
    showTilePicker: true,
    errorMessage: '',

    // 副露编辑状态
    showMeldEditor: false,
    editingMeldType: 'pon',
    editingMeldTiles: [],
    meldSuit: 'm', // 副露选择器当前花色

    // 计算结果
    result: null,
    showResult: false,

    // 配置
    windOptions: WIND_OPTIONS,
    honorNames: HONOR_NAMES,
    meldTypes: MELD_TYPES,
  },

  onLoad() {
    this.syncNavigationTheme();
    this._themeChangeHandler = () => this.syncNavigationTheme();
    if (wx.onThemeChange) wx.onThemeChange(this._themeChangeHandler);
  },

  onShow() {
    this.syncNavigationTheme();
  },

  onUnload() {
    if (this._themeChangeHandler && wx.offThemeChange) {
      wx.offThemeChange(this._themeChangeHandler);
    }
  },

  syncNavigationTheme() {
    wx.setNavigationBarColor({
      frontColor: '#000000',
      backgroundColor: '#FAF9F5',
      animation: { duration: 180, timingFunc: 'easeIn' },
    });
    if (wx.setBackgroundColor) {
      wx.setBackgroundColor({
        backgroundColor: '#FAF9F5',
        backgroundColorTop: '#FAF9F5',
        backgroundColorBottom: '#FAF9F5',
      });
    }
  },

  // ==================== 场况设置 ====================

  onBakazeChange(e) {
    this.setData({ bakaze: e.currentTarget.dataset.value });
  },

  onJikazeChange(e) {
    this.setData({ jikaze: e.currentTarget.dataset.value });
  },

  onTsumoChange(e) {
    const isTsumo = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    const updates = { isTsumo };
    if (isTsumo) {
      updates.isChankan = false;
      updates.isHoutei = false;
    } else {
      updates.isRinshan = false;
      updates.isHaitei = false;
    }
    this.setData(updates);
  },

  onHonbaChange(e) {
    const value = Math.max(0, parseInt(e.currentTarget.dataset.value) || 0);
    this.setData({ honba: value });
  },

  onKyoutakuChange(e) {
    const value = Math.max(0, parseInt(e.currentTarget.dataset.value) || 0);
    this.setData({ kyoutaku: value });
  },

  // ==================== 立直设置 ====================

  onRiichiChange(e) {
    const isRiichi = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    // 有副露时不能立直（暗杠除外）
    const hasOpenMeld = this.data.melds.some(m => m.type !== 'ankan');
    if (isRiichi && hasOpenMeld) {
      wx.showToast({ title: '有副露不能立直', icon: 'none' });
      return;
    }
    const updates = { isRiichi };
    if (isRiichi) {
      updates.isDoubleRiichi = false;
    } else {
      updates.isIppatsu = false;
    }
    this.setData(updates);
  },

  onDoubleRiichiChange(e) {
    const isDoubleRiichi = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    const hasOpenMeld = this.data.melds.some(m => m.type !== 'ankan');
    if (isDoubleRiichi && hasOpenMeld) {
      wx.showToast({ title: '有副露不能立直', icon: 'none' });
      return;
    }
    const updates = { isDoubleRiichi };
    if (isDoubleRiichi) {
      updates.isRiichi = false;
    } else {
      updates.isIppatsu = false;
    }
    this.setData(updates);
  },

  onIppatsuChange(e) {
    if (!this.data.isRiichi && !this.data.isDoubleRiichi) return;
    const isIppatsu = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    this.setData({ isIppatsu });
  },

  // ==================== 特殊状态 ====================

  onRinshanChange(e) {
    const isRinshan = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    this.setData({ isRinshan });
  },

  onChankanChange(e) {
    const isChankan = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    this.setData({ isChankan });
  },

  onHaiteiChange(e) {
    if (!this.data.isTsumo) return;
    const isHaitei = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    this.setData({ isHaitei });
  },

  onHouteiChange(e) {
    if (this.data.isTsumo) return;
    const isHoutei = e.currentTarget.dataset.value === 'true' || e.currentTarget.dataset.value === true;
    this.setData({ isHoutei });
  },

  // ==================== 折叠面板 ====================

  togglePanel(e) {
    const panel = e.currentTarget.dataset.panel;
    this.setData({
      expandedPanel: this.data.expandedPanel === panel ? '' : panel,
    });
  },

  toggleTilePicker() {
    this.setData({ showTilePicker: !this.data.showTilePicker });
  },

  // ==================== 牌选择器 ====================

  onSuitChange(e) {
    this.setData({ currentSuit: e.currentTarget.dataset.suit });
  },

  onSelectTile(e) {
    const { suit, value, red } = e.currentTarget.dataset;
    const tile = {
      suit,
      value: parseInt(value),
      isRed: red === 'true' || red === true,
    };

    const { selectorMode, handTiles, doraIndicators, uraIndicators } = this.data;

    if (selectorMode === 'hand' || selectorMode === 'agari') {
      if (tile.isRed && this.getExactTileCount(tile) >= 1) {
        wx.showToast({ title: '每种花色最多一张赤五', icon: 'none' });
        return;
      }
      if (this.getHandTileCount(tile) >= 4) {
        wx.showToast({ title: '同一种牌最多4张', icon: 'none' });
        return;
      }
    }

    switch (selectorMode) {
      case 'hand':
        // 门前手牌数量 = 13 - 副露面子数 × 3
        const maxHandTiles = 13 - this.data.melds.length * 3;
        if (handTiles.length >= maxHandTiles) {
          wx.showToast({ title: `手牌已满(${maxHandTiles}张)`, icon: 'none' });
          return;
        }
        this.setData({ handTiles: [...handTiles, tile] });
        break;

      case 'agari':
        this.setData({ agariTile: tile, selectorMode: 'hand' });
        break;

      case 'dora':
        if (doraIndicators.length >= 5) {
          wx.showToast({ title: '最多5张', icon: 'none' });
          return;
        }
        if (tile.isRed) return;
        this.setData({ doraIndicators: [...doraIndicators, tile], selectorMode: 'hand' });
        break;

      case 'ura':
        if (uraIndicators.length >= 5) {
          wx.showToast({ title: '最多5张', icon: 'none' });
          return;
        }
        if (tile.isRed) return;
        this.setData({ uraIndicators: [...uraIndicators, tile], selectorMode: 'hand' });
        break;
    }
  },

  // ==================== 手牌操作 ====================

  onRemoveHandTile(e) {
    const index = e.currentTarget.dataset.index;
    const handTiles = [...this.data.handTiles];
    handTiles.splice(index, 1);
    this.setData({ handTiles, errorMessage: '' });
  },

  onRemoveAgariTile() {
    this.setData({ agariTile: null, errorMessage: '' });
  },

  openAgariSelector() {
    if (this.data.agariTile) return;
    this.setData({ selectorMode: 'agari', showTilePicker: true });
    wx.showToast({ title: '请选择和牌张', icon: 'none', duration: 1500 });
  },

  openDoraSelector() {
    this.setData({ selectorMode: 'dora', showTilePicker: true });
    wx.showToast({ title: '请选择表宝牌', icon: 'none', duration: 1500 });
  },

  openUraSelector() {
    this.setData({ selectorMode: 'ura', showTilePicker: true });
    wx.showToast({ title: '请选择里宝牌', icon: 'none', duration: 1500 });
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

  cancelSelectorMode() {
    this.setData({ selectorMode: 'hand', showTilePicker: true });
  },

  // ==================== 副露操作 ====================

  openMeldEditor() {
    if (this.data.melds.length >= 4) {
      wx.showToast({ title: '最多4组副露', icon: 'none' });
      return;
    }
    this.setData({
      showMeldEditor: true,
      editingMeldType: 'pon',
      editingMeldTiles: [],
      meldSuit: 'm',
    });
  },

  onMeldSuitChange(e) {
    this.setData({ meldSuit: e.currentTarget.dataset.suit });
  },

  onSelectMeldTile(e) {
    const { suit, value, red } = e.currentTarget.dataset;
    const tile = {
      suit,
      value: parseInt(value),
      isRed: red === 'true' || red === true,
    };

    const { editingMeldTiles, editingMeldType } = this.data;
    const maxTiles = (editingMeldType === 'kan' || editingMeldType === 'ankan') ? 4 : 3;
    const usedInEditor = editingMeldTiles.filter((item) => item.suit === tile.suit && item.value === tile.value).length;
    if (tile.isRed && this.getExactTileCount(tile) >= 1) {
      wx.showToast({ title: '每种花色最多一张赤五', icon: 'none' });
      return;
    }
    if (this.getHandTileCount(tile) + usedInEditor >= 4) {
      wx.showToast({ title: '同一种牌最多4张', icon: 'none' });
      return;
    }

    if (editingMeldTiles.length >= maxTiles) {
      wx.showToast({ title: `最多${maxTiles}张`, icon: 'none' });
      return;
    }

    this.setData({ editingMeldTiles: [...editingMeldTiles, tile] });
  },

  onMeldTypeChange(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      editingMeldType: type,
      editingMeldTiles: [], // 切换类型时清空已选牌
    });
  },

  onRemoveEditingMeldTile(e) {
    const index = e.currentTarget.dataset.index;
    const editingMeldTiles = [...this.data.editingMeldTiles];
    editingMeldTiles.splice(index, 1);
    this.setData({ editingMeldTiles });
  },

  confirmMeld() {
    const { editingMeldType, editingMeldTiles, melds } = this.data;
    const requiredCount = (editingMeldType === 'kan' || editingMeldType === 'ankan') ? 4 : 3;

    if (editingMeldTiles.length !== requiredCount) {
      wx.showToast({ title: `请选择${requiredCount}张牌`, icon: 'none' });
      return;
    }

    // 验证牌的合法性
    if (editingMeldType === 'chi') {
      // 吃必须是顺子
      if (!this.isValidChi(editingMeldTiles)) {
        wx.showToast({ title: '吃必须是顺子', icon: 'none' });
        return;
      }
    } else {
      // 碰/杠必须是相同的牌
      if (!this.isValidPonKan(editingMeldTiles)) {
        wx.showToast({ title: '碰/杠必须是相同的牌', icon: 'none' });
        return;
      }
    }

    const newMeld = {
      type: editingMeldType,
      tiles: editingMeldTiles,
    };

    // 如果添加了明副露，取消立直状态
    if (editingMeldType !== 'ankan' && (this.data.isRiichi || this.data.isDoubleRiichi)) {
      this.setData({
        melds: [...melds, newMeld],
        showMeldEditor: false,
        editingMeldTiles: [],
        isRiichi: false,
        isDoubleRiichi: false,
        isIppatsu: false,
      });
    } else {
      this.setData({
        melds: [...melds, newMeld],
        showMeldEditor: false,
        editingMeldTiles: [],
      });
    }
  },

  cancelMeld() {
    this.setData({
      showMeldEditor: false,
      editingMeldTiles: [],
    });
  },

  onRemoveMeld(e) {
    const index = e.currentTarget.dataset.index;
    const melds = [...this.data.melds];
    melds.splice(index, 1);
    this.setData({ melds });
  },

  isValidChi(tiles) {
    if (tiles.length !== 3) return false;
    // 必须同花色且是数牌
    const suit = tiles[0].suit;
    if (suit === 'z') return false;
    if (!tiles.every(t => t.suit === suit)) return false;
    // 必须是连续的数字
    const values = tiles.map(t => t.value).sort((a, b) => a - b);
    return values[1] === values[0] + 1 && values[2] === values[1] + 1;
  },

  isValidPonKan(tiles) {
    if (tiles.length < 3) return false;
    // 必须是相同的牌（花色和数字都相同）
    const first = tiles[0];
    return tiles.every(t => t.suit === first.suit && t.value === first.value);
  },

  // ==================== 计算 ====================

  onCalculate() {
    this.setData({ errorMessage: '' });
    const {
      handTiles,
      agariTile,
      melds,
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
      isHoutei,
      doraIndicators,
      uraIndicators,
    } = this.data;

    // 计算需要的门前手牌数量
    // 每个副露占 1 个面子位（3张基础），杠虽然4张但只占1个面子位
    // 门前手牌 = 13 - 副露面子数 × 3
    const meldCount = melds.length;
    const requiredHandTiles = 13 - meldCount * 3;

    // 验证
    if (handTiles.length !== requiredHandTiles) {
      this.showValidationError(`还需要选择 ${requiredHandTiles - handTiles.length} 张手牌`);
      return;
    }

    if (!agariTile) {
      this.showValidationError('请选择和牌张');
      return;
    }

    // 转换副露格式（统一类型名称）
    const formattedMelds = melds.map(m => ({
      type: m.type, // chi, pon, kan, ankan
      tiles: m.tiles,
      isOpen: m.type !== 'ankan',
    }));

    // 构建输入
    const hand = {
      closed: handTiles,
      melds: formattedMelds,
      agariTile,
      isTsumo,
    };

    // 判断是否亲家（自风为东）
    const isParent = jikaze === 'east';

    const situation = {
      bakaze,
      jikaze,
      isParent,
      isRiichi,
      isDoubleRiichi,
      isIppatsu,
      isRinshan,
      isChankan,
      isHaitei,
      isHoutei,
      honba,
      kyoutaku,
    };

    // 宝牌（注意字段名：引擎期望 indicators，不是 doraIndicators）
    const dora = {
      indicators: doraIndicators,
      uraIndicators: isRiichi || isDoubleRiichi ? uraIndicators : [],
    };

    const validation = mahjong.validateHand(hand);
    if (!validation.valid) {
      this.showValidationError(validation.error || '手牌不合法');
      return;
    }

    const result = mahjong.calculate({ hand, situation, dora });

    if (!result.success) {
      this.showValidationError(result.error || '无法和牌');
      return;
    }

    this.setData({
      result,
      showResult: true,
      errorMessage: '',
    });
  },

  onCloseResult() {
    this.setData({ showResult: false });
  },

  showValidationError(message) {
    this.setData({ errorMessage: message });
    wx.showToast({ title: message, icon: 'none' });
  },

  preventMove() {},

  getHandTileCount(tile) {
    const all = [...this.data.handTiles];
    if (this.data.agariTile) all.push(this.data.agariTile);
    this.data.melds.forEach((meld) => all.push(...meld.tiles));
    return all.filter((item) => item.suit === tile.suit && item.value === tile.value).length;
  },

  getExactTileCount(tile) {
    const all = [...this.data.handTiles];
    if (this.data.agariTile) all.push(this.data.agariTile);
    this.data.melds.forEach((meld) => all.push(...meld.tiles));
    return all.filter((item) => item.suit === tile.suit && item.value === tile.value && !!item.isRed === !!tile.isRed).length;
  },

  getTileCountLabel() {
    const required = 13 - this.data.melds.length * 3;
    return `${this.data.handTiles.length}/${required}`;
  },

  getRiichiActive() {
    return this.data.isRiichi || this.data.isDoubleRiichi;
  },

  getResultLimitName(limitName) {
    const names = {
      满贯: '满贯',
      跳满: '跳满',
      倍满: '倍满',
      三倍满: '三倍满',
      役满: '役满',
      双倍役满: '双倍役满',
      MANGAN: '满贯',
      HANEMAN: '跳满',
      BAIMAN: '倍满',
      SANBAIMAN: '三倍满',
      YAKUMAN: '役满',
      DOUBLE_YAKUMAN: '双倍役满',
    };
    return names[limitName] || limitName;
  },

  // ==================== 工具方法 ====================

  getTileSuitName(suit) {
    return SUIT_NAMES[suit];
  },

  getMeldTypeName(type) {
    const names = { chi: '吃', pon: '碰', kan: '明杠', ankan: '暗杠' };
    return names[type] || type;
  },
});
