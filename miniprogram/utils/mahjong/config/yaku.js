/**
 * 役种配置
 * 包含所有役种的定义、翻数、条件等
 */

// 役种类型
const YAKU_TYPE = {
  NORMAL: 'normal',
  YAKUMAN: 'yakuman',
  DOUBLE_YAKUMAN: 'double_yakuman',
};

/**
 * 役种配置表
 * han: 翻数
 * hanOpen: 副露时的翻数 (undefined 表示不可副露)
 * isMenzenOnly: 是否门前限定
 * isSpecial: 是否需要特殊状态判定 (如立直、一发等)
 * type: 役种类型
 */
const YAKU_LIST = {
  // ========== 1翻役 ==========
  riichi: {
    id: 'riichi',
    name: '立直',
    nameJp: 'リーチ',
    han: 1,
    isMenzenOnly: true,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },
  ippatsu: {
    id: 'ippatsu',
    name: '一发',
    nameJp: '一発',
    han: 1,
    isMenzenOnly: true,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },
  tsumo: {
    id: 'tsumo',
    name: '门前清自摸和',
    nameJp: '門前清自摸和',
    han: 1,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  pinfu: {
    id: 'pinfu',
    name: '平和',
    nameJp: '平和',
    han: 1,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  tanyao: {
    id: 'tanyao',
    name: '断幺九',
    nameJp: '断幺九',
    han: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  iipeikou: {
    id: 'iipeikou',
    name: '一盃口',
    nameJp: '一盃口',
    han: 1,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  yakuhaiHaku: {
    id: 'yakuhaiHaku',
    name: '役牌 白',
    nameJp: '役牌 白',
    han: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  yakuhaiHatsu: {
    id: 'yakuhaiHatsu',
    name: '役牌 發',
    nameJp: '役牌 發',
    han: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  yakuhaiChun: {
    id: 'yakuhaiChun',
    name: '役牌 中',
    nameJp: '役牌 中',
    han: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  yakuhaiBakaze: {
    id: 'yakuhaiBakaze',
    name: '役牌 场风',
    nameJp: '役牌 場風',
    han: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  yakuhaiJikaze: {
    id: 'yakuhaiJikaze',
    name: '役牌 自风',
    nameJp: '役牌 自風',
    han: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  rinshan: {
    id: 'rinshan',
    name: '岭上开花',
    nameJp: '嶺上開花',
    han: 1,
    isMenzenOnly: false,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },
  chankan: {
    id: 'chankan',
    name: '抢杠',
    nameJp: '槍槓',
    han: 1,
    isMenzenOnly: false,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },
  haitei: {
    id: 'haitei',
    name: '海底摸月',
    nameJp: '海底摸月',
    han: 1,
    isMenzenOnly: false,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },
  houtei: {
    id: 'houtei',
    name: '河底捞鱼',
    nameJp: '河底撈魚',
    han: 1,
    isMenzenOnly: false,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },

  // ========== 2翻役 ==========
  doubleRiichi: {
    id: 'doubleRiichi',
    name: '双立直',
    nameJp: 'ダブル立直',
    han: 2,
    isMenzenOnly: true,
    isSpecial: true,
    type: YAKU_TYPE.NORMAL,
  },
  chiitoitsu: {
    id: 'chiitoitsu',
    name: '七对子',
    nameJp: '七対子',
    han: 2,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  sanshokuDoujun: {
    id: 'sanshokuDoujun',
    name: '三色同顺',
    nameJp: '三色同順',
    han: 2,
    hanOpen: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  ittsu: {
    id: 'ittsu',
    name: '一气通贯',
    nameJp: '一気通貫',
    han: 2,
    hanOpen: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  chanta: {
    id: 'chanta',
    name: '混全带幺九',
    nameJp: '混全帯幺九',
    han: 2,
    hanOpen: 1,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  toitoi: {
    id: 'toitoi',
    name: '对对和',
    nameJp: '対々和',
    han: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  sanankou: {
    id: 'sanankou',
    name: '三暗刻',
    nameJp: '三暗刻',
    han: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  sanshokuDoukou: {
    id: 'sanshokuDoukou',
    name: '三色同刻',
    nameJp: '三色同刻',
    han: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  sankantsu: {
    id: 'sankantsu',
    name: '三杠子',
    nameJp: '三槓子',
    han: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  shousangen: {
    id: 'shousangen',
    name: '小三元',
    nameJp: '小三元',
    han: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  honroutou: {
    id: 'honroutou',
    name: '混老头',
    nameJp: '混老頭',
    han: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },

  // ========== 3翻役 ==========
  ryanpeikou: {
    id: 'ryanpeikou',
    name: '二盃口',
    nameJp: '二盃口',
    han: 3,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  junchan: {
    id: 'junchan',
    name: '纯全带幺九',
    nameJp: '純全帯幺九',
    han: 3,
    hanOpen: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },
  honitsu: {
    id: 'honitsu',
    name: '混一色',
    nameJp: '混一色',
    han: 3,
    hanOpen: 2,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },

  // ========== 6翻役 ==========
  chinitsu: {
    id: 'chinitsu',
    name: '清一色',
    nameJp: '清一色',
    han: 6,
    hanOpen: 5,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.NORMAL,
  },

  // ========== 役满 ==========
  tenhou: {
    id: 'tenhou',
    name: '天和',
    nameJp: '天和',
    han: 13,
    isMenzenOnly: true,
    isSpecial: true,
    type: YAKU_TYPE.YAKUMAN,
  },
  chiihou: {
    id: 'chiihou',
    name: '地和',
    nameJp: '地和',
    han: 13,
    isMenzenOnly: true,
    isSpecial: true,
    type: YAKU_TYPE.YAKUMAN,
  },
  kokushi: {
    id: 'kokushi',
    name: '国士无双',
    nameJp: '国士無双',
    han: 13,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  kokushi13: {
    id: 'kokushi13',
    name: '国士无双十三面',
    nameJp: '国士無双十三面待ち',
    han: 26,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.DOUBLE_YAKUMAN,
  },
  suuankou: {
    id: 'suuankou',
    name: '四暗刻',
    nameJp: '四暗刻',
    han: 13,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  suuankouTanki: {
    id: 'suuankouTanki',
    name: '四暗刻单骑',
    nameJp: '四暗刻単騎',
    han: 26,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.DOUBLE_YAKUMAN,
  },
  daisangen: {
    id: 'daisangen',
    name: '大三元',
    nameJp: '大三元',
    han: 13,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  shousuushi: {
    id: 'shousuushi',
    name: '小四喜',
    nameJp: '小四喜',
    han: 13,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  daisuushi: {
    id: 'daisuushi',
    name: '大四喜',
    nameJp: '大四喜',
    han: 26,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.DOUBLE_YAKUMAN,
  },
  tsuuiisou: {
    id: 'tsuuiisou',
    name: '字一色',
    nameJp: '字一色',
    han: 13,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  ryuuiisou: {
    id: 'ryuuiisou',
    name: '绿一色',
    nameJp: '緑一色',
    han: 13,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  chinroutou: {
    id: 'chinroutou',
    name: '清老头',
    nameJp: '清老頭',
    han: 13,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  chuurenpoutou: {
    id: 'chuurenpoutou',
    name: '九莲宝灯',
    nameJp: '九蓮宝燈',
    han: 13,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
  junseichuurenpoutou: {
    id: 'junseichuurenpoutou',
    name: '纯正九莲宝灯',
    nameJp: '純正九蓮宝燈',
    han: 26,
    isMenzenOnly: true,
    isSpecial: false,
    type: YAKU_TYPE.DOUBLE_YAKUMAN,
  },
  suukantsu: {
    id: 'suukantsu',
    name: '四杠子',
    nameJp: '四槓子',
    han: 13,
    isMenzenOnly: false,
    isSpecial: false,
    type: YAKU_TYPE.YAKUMAN,
  },
};

/**
 * 获取役种的实际翻数
 * @param {string} yakuId - 役种ID
 * @param {boolean} isMenzen - 是否门前
 * @returns {number} 翻数
 */
function getYakuHan(yakuId, isMenzen) {
  const yaku = YAKU_LIST[yakuId];
  if (!yaku) return 0;

  if (!isMenzen && yaku.hanOpen !== undefined) {
    return yaku.hanOpen;
  }
  return yaku.han;
}

/**
 * 检查役种是否可以在当前状态下成立
 * @param {string} yakuId - 役种ID
 * @param {boolean} isMenzen - 是否门前
 * @returns {boolean}
 */
function canYakuApply(yakuId, isMenzen) {
  const yaku = YAKU_LIST[yakuId];
  if (!yaku) return false;

  if (yaku.isMenzenOnly && !isMenzen) {
    return false;
  }
  return true;
}

/**
 * 获取所有役满役种
 * @returns {Array}
 */
function getYakumanList() {
  return Object.values(YAKU_LIST).filter(
    (y) => y.type === YAKU_TYPE.YAKUMAN || y.type === YAKU_TYPE.DOUBLE_YAKUMAN
  );
}

/**
 * 获取所有普通役种
 * @returns {Array}
 */
function getNormalYakuList() {
  return Object.values(YAKU_LIST).filter((y) => y.type === YAKU_TYPE.NORMAL);
}

module.exports = {
  YAKU_TYPE,
  YAKU_LIST,
  getYakuHan,
  canYakuApply,
  getYakumanList,
  getNormalYakuList,
};
