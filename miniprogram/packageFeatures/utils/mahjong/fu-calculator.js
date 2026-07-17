/**
 * 符数计算模块
 */

const { isTerminalOrHonor, isWind, isDragon } = require('./config/tiles');
const { FU_RULES, WAIT_TYPES, MELD_TYPES, getMeldFu, getWaitFu, roundUpFu } = require('./config/fu-rules');

/**
 * 计算雀头符数
 * @param {Object} head - 雀头
 * @param {Object} situation - 场况
 * @returns {Object} { fu, reason }
 */
function calculateHeadFu(head, situation) {
  const { suit, value } = head;
  const { bakaze, jikaze } = situation;

  // 数牌雀头无符
  if (suit !== 'z') {
    return { fu: 0, reason: null };
  }

  // 三元牌
  if (isDragon({ suit, value })) {
    return { fu: FU_RULES.head.yakuhai, reason: '役牌雀头' };
  }

  // 风牌
  if (isWind({ suit, value })) {
    const windMap = { east: 1, south: 2, west: 3, north: 4 };
    const bakazeValue = windMap[bakaze];
    const jikazeValue = windMap[jikaze];

    const isBakaze = value === bakazeValue;
    const isJikaze = value === jikazeValue;

    // 连风牌 (同时是场风和自风)
    if (isBakaze && isJikaze) {
      return { fu: FU_RULES.head.doubleWind, reason: '连风牌雀头' };
    }

    // 场风或自风
    if (isBakaze) {
      return { fu: FU_RULES.head.yakuhai, reason: '场风雀头' };
    }
    if (isJikaze) {
      return { fu: FU_RULES.head.yakuhai, reason: '自风雀头' };
    }
  }

  // 客风无符
  return { fu: 0, reason: null };
}

/**
 * 计算单个面子的符数
 * @param {Object} meld - 面子
 * @returns {Object} { fu, reason }
 */
function calculateMeldFu(meld) {
  const { type, isOpen, tiles } = meld;

  // 顺子无符
  if (type === MELD_TYPES.SHUNTSU) {
    return { fu: 0, reason: null };
  }

  // 刻子/杠子
  const tile = tiles[0];
  const isYaochu = isTerminalOrHonor(tile);

  if (type === MELD_TYPES.KOUTSU) {
    const fu = getMeldFu(MELD_TYPES.KOUTSU, isOpen, isYaochu);
    const typeStr = isOpen ? '明刻' : '暗刻';
    const tileStr = isYaochu ? '幺九' : '中张';
    return { fu, reason: `${tileStr}${typeStr}` };
  }

  if (type === MELD_TYPES.KANTSU) {
    const fu = getMeldFu(MELD_TYPES.KANTSU, isOpen, isYaochu);
    const typeStr = isOpen ? '明杠' : '暗杠';
    const tileStr = isYaochu ? '幺九' : '中张';
    return { fu, reason: `${tileStr}${typeStr}` };
  }

  return { fu: 0, reason: null };
}

/**
 * 计算标准和牌形式的符数
 * @param {Object} pattern - 和牌分解
 * @param {Object} situation - 场况
 * @param {boolean} isTsumo - 是否自摸
 * @param {boolean} isMenzen - 是否门前
 * @param {boolean} isPinfu - 是否平和
 * @returns {Object} 符数详情
 */
function calculateStandardFu(pattern, situation, isTsumo, isMenzen, isPinfu) {
  const details = [];
  let totalFu = 0;

  // 副底
  details.push({ name: '副底', fu: FU_RULES.base });
  totalFu += FU_RULES.base;

  // 平和特殊处理
  if (isPinfu) {
    if (isTsumo) {
      // 平和自摸: 固定20符
      return {
        details: [{ name: '平和自摸', fu: FU_RULES.special.pinfu.tsumo }],
        total: FU_RULES.special.pinfu.tsumo,
        rounded: FU_RULES.special.pinfu.tsumo,
      };
    }
    // 平和荣和: 固定30符
    return {
      details: [{ name: '平和荣和', fu: FU_RULES.special.pinfu.ron }],
      total: FU_RULES.special.pinfu.ron,
      rounded: FU_RULES.special.pinfu.ron,
    };
  }

  // 门前荣和加符
  if (isMenzen && !isTsumo) {
    details.push({ name: '门前荣和', fu: FU_RULES.menzenRon });
    totalFu += FU_RULES.menzenRon;
  }

  // 自摸加符 (平和除外，已在上面处理)
  if (isTsumo) {
    details.push({ name: '自摸', fu: FU_RULES.tsumo });
    totalFu += FU_RULES.tsumo;
  }

  // 雀头符数
  const headFu = calculateHeadFu(pattern.head, situation);
  if (headFu.fu > 0) {
    details.push({ name: headFu.reason, fu: headFu.fu });
    totalFu += headFu.fu;
  }

  // 面子符数
  for (const meld of pattern.melds) {
    const meldFu = calculateMeldFu(meld);
    if (meldFu.fu > 0) {
      details.push({ name: meldFu.reason, fu: meldFu.fu });
      totalFu += meldFu.fu;
    }
  }

  // 听牌型符数
  const waitFu = getWaitFu(pattern.waitType);
  if (waitFu > 0) {
    const waitNames = {
      [WAIT_TYPES.KANCHAN]: '嵌张',
      [WAIT_TYPES.PENCHAN]: '边张',
      [WAIT_TYPES.TANKI]: '单骑',
    };
    details.push({ name: waitNames[pattern.waitType], fu: waitFu });
    totalFu += waitFu;
  }

  // 进位
  let rounded = roundUpFu(totalFu);

  // 最低30符保底 (副露平和型荣和)
  if (!isMenzen && !isTsumo && rounded < FU_RULES.special.minFu) {
    rounded = FU_RULES.special.minFu;
  }

  return {
    details,
    total: totalFu,
    rounded,
  };
}

/**
 * 计算七对子的符数
 * @returns {Object} 符数详情
 */
function calculateChiitoitsuFu() {
  return {
    details: [{ name: '七对子', fu: FU_RULES.special.chiitoitsu }],
    total: FU_RULES.special.chiitoitsu,
    rounded: FU_RULES.special.chiitoitsu, // 七对子不进位
  };
}

/**
 * 计算符数 (主入口)
 * @param {Object} pattern - 和牌分解
 * @param {Object} situation - 场况
 * @param {boolean} isTsumo - 是否自摸
 * @param {boolean} isMenzen - 是否门前
 * @param {Array} yakuList - 役种列表 (用于判断平和)
 * @returns {Object} 符数详情
 */
function calculateFu(pattern, situation, isTsumo, isMenzen, yakuList = []) {
  // 七对子
  if (pattern.type === 'chiitoitsu') {
    return calculateChiitoitsuFu();
  }

  // 国士无双没有符数概念
  if (pattern.type === 'kokushi') {
    return {
      details: [{ name: '国士无双', fu: 0 }],
      total: 0,
      rounded: 0,
    };
  }

  // 标准和牌形式
  const isPinfu = yakuList.some((y) => y.id === 'pinfu');
  return calculateStandardFu(pattern, situation, isTsumo, isMenzen, isPinfu);
}

module.exports = {
  calculateHeadFu,
  calculateMeldFu,
  calculateStandardFu,
  calculateChiitoitsuFu,
  calculateFu,
};
