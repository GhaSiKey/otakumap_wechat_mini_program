/**
 * 点数速查表与计算规则
 */

// 满贯系统定义
const LIMIT_HANDS = {
  MANGAN: {
    name: '满贯',
    nameJp: '満貫',
    basePoints: 2000,
  },
  HANEMAN: {
    name: '跳满',
    nameJp: '跳満',
    basePoints: 3000,
  },
  BAIMAN: {
    name: '倍满',
    nameJp: '倍満',
    basePoints: 4000,
  },
  SANBAIMAN: {
    name: '三倍满',
    nameJp: '三倍満',
    basePoints: 6000,
  },
  YAKUMAN: {
    name: '役满',
    nameJp: '役満',
    basePoints: 8000,
  },
  DOUBLE_YAKUMAN: {
    name: '双倍役满',
    nameJp: 'ダブル役満',
    basePoints: 16000,
  },
};

// 翻数到满贯等级的映射
const HAN_TO_LIMIT = {
  5: 'MANGAN',
  6: 'HANEMAN',
  7: 'HANEMAN',
  8: 'BAIMAN',
  9: 'BAIMAN',
  10: 'BAIMAN',
  11: 'SANBAIMAN',
  12: 'SANBAIMAN',
  13: 'YAKUMAN',
};

/**
 * 点数速查表
 * 格式: SCORE_TABLE[符数][翻数] = { ron: 荣和点数, tsumo: [子家付, 亲家付] }
 * 亲家的点数需要乘以1.5
 */
const SCORE_TABLE = {
  // 20符 (平和自摸限定)
  20: {
    2: { tsumoChild: [400, 700], tsumoParent: [700, 700] },
    3: { tsumoChild: [700, 1300], tsumoParent: [1300, 1300] },
    4: { tsumoChild: [1300, 2600], tsumoParent: [2600, 2600] },
  },
  // 25符 (七对子限定, 不进位)
  25: {
    2: { ronChild: 1600, ronParent: 2400, tsumoChild: [400, 800], tsumoParent: [800, 800] },
    3: { ronChild: 3200, ronParent: 4800, tsumoChild: [800, 1600], tsumoParent: [1600, 1600] },
    4: { ronChild: 6400, ronParent: 9600, tsumoChild: [1600, 3200], tsumoParent: [3200, 3200] },
  },
  // 30符
  30: {
    1: { ronChild: 1000, ronParent: 1500, tsumoChild: [300, 500], tsumoParent: [500, 500] },
    2: { ronChild: 2000, ronParent: 2900, tsumoChild: [500, 1000], tsumoParent: [1000, 1000] },
    3: { ronChild: 3900, ronParent: 5800, tsumoChild: [1000, 2000], tsumoParent: [2000, 2000] },
    4: { ronChild: 7700, ronParent: 11600, tsumoChild: [2000, 3900], tsumoParent: [3900, 3900] },
  },
  // 40符
  40: {
    1: { ronChild: 1300, ronParent: 2000, tsumoChild: [400, 700], tsumoParent: [700, 700] },
    2: { ronChild: 2600, ronParent: 3900, tsumoChild: [700, 1300], tsumoParent: [1300, 1300] },
    3: { ronChild: 5200, ronParent: 7700, tsumoChild: [1300, 2600], tsumoParent: [2600, 2600] },
    4: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 50符
  50: {
    1: { ronChild: 1600, ronParent: 2400, tsumoChild: [400, 800], tsumoParent: [800, 800] },
    2: { ronChild: 3200, ronParent: 4800, tsumoChild: [800, 1600], tsumoParent: [1600, 1600] },
    3: { ronChild: 6400, ronParent: 9600, tsumoChild: [1600, 3200], tsumoParent: [3200, 3200] },
    4: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 60符
  60: {
    1: { ronChild: 2000, ronParent: 2900, tsumoChild: [500, 1000], tsumoParent: [1000, 1000] },
    2: { ronChild: 3900, ronParent: 5800, tsumoChild: [1000, 2000], tsumoParent: [2000, 2000] },
    3: { ronChild: 7700, ronParent: 11600, tsumoChild: [2000, 3900], tsumoParent: [3900, 3900] },
    4: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 70符
  70: {
    1: { ronChild: 2300, ronParent: 3400, tsumoChild: [600, 1200], tsumoParent: [1200, 1200] },
    2: { ronChild: 4500, ronParent: 6800, tsumoChild: [1200, 2300], tsumoParent: [2300, 2300] },
    3: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 80符
  80: {
    1: { ronChild: 2600, ronParent: 3900, tsumoChild: [700, 1300], tsumoParent: [1300, 1300] },
    2: { ronChild: 5200, ronParent: 7700, tsumoChild: [1300, 2600], tsumoParent: [2600, 2600] },
    3: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 90符
  90: {
    1: { ronChild: 2900, ronParent: 4400, tsumoChild: [800, 1500], tsumoParent: [1500, 1500] },
    2: { ronChild: 5800, ronParent: 8700, tsumoChild: [1500, 2900], tsumoParent: [2900, 2900] },
    3: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 100符
  100: {
    1: { ronChild: 3200, ronParent: 4800, tsumoChild: [800, 1600], tsumoParent: [1600, 1600] },
    2: { ronChild: 6400, ronParent: 9600, tsumoChild: [1600, 3200], tsumoParent: [3200, 3200] },
    3: { ronChild: 8000, ronParent: 12000, tsumoChild: [2000, 4000], tsumoParent: [4000, 4000] }, // 满贯
  },
  // 110符
  110: {
    1: { ronChild: 3600, ronParent: 5300, tsumoChild: [900, 1800], tsumoParent: [1800, 1800] },
    2: { ronChild: 7100, ronParent: 10600, tsumoChild: [1800, 3600], tsumoParent: [3600, 3600] },
  },
};

// 满贯点数表
const LIMIT_SCORES = {
  MANGAN: {
    ronChild: 8000,
    ronParent: 12000,
    tsumoChild: [2000, 4000],
    tsumoParent: [4000, 4000],
  },
  HANEMAN: {
    ronChild: 12000,
    ronParent: 18000,
    tsumoChild: [3000, 6000],
    tsumoParent: [6000, 6000],
  },
  BAIMAN: {
    ronChild: 16000,
    ronParent: 24000,
    tsumoChild: [4000, 8000],
    tsumoParent: [8000, 8000],
  },
  SANBAIMAN: {
    ronChild: 24000,
    ronParent: 36000,
    tsumoChild: [6000, 12000],
    tsumoParent: [12000, 12000],
  },
  YAKUMAN: {
    ronChild: 32000,
    ronParent: 48000,
    tsumoChild: [8000, 16000],
    tsumoParent: [16000, 16000],
  },
  DOUBLE_YAKUMAN: {
    ronChild: 64000,
    ronParent: 96000,
    tsumoChild: [16000, 32000],
    tsumoParent: [32000, 32000],
  },
};

/**
 * 判断是否达到满贯
 * @param {number} fu - 符数
 * @param {number} han - 翻数
 * @returns {string|null} 满贯等级或null
 */
function getLimitLevel(fu, han) {
  // 役满级别
  if (han >= 26) return 'DOUBLE_YAKUMAN';
  if (han >= 13) return 'YAKUMAN';

  // 普通满贯判定
  if (han >= 5) {
    return HAN_TO_LIMIT[Math.min(han, 13)] || 'YAKUMAN';
  }

  // 4翻30符以上 或 3翻60符以上 = 满贯
  if (han === 4 && fu >= 30) return 'MANGAN';
  if (han === 3 && fu >= 60) return 'MANGAN';

  return null;
}

/**
 * 计算基本点
 * @param {number} fu - 符数
 * @param {number} han - 翻数
 * @returns {number} 基本点
 */
function calculateBasePoints(fu, han) {
  const limitLevel = getLimitLevel(fu, han);

  if (limitLevel) {
    return LIMIT_HANDS[limitLevel].basePoints;
  }

  // 基本点 = 符 × 2^(翻+2)
  const basePoints = fu * Math.pow(2, han + 2);

  // 向上取整到百位
  return Math.ceil(basePoints / 100) * 100;
}

/**
 * 从速查表获取点数
 * @param {number} fu - 符数
 * @param {number} han - 翻数
 * @param {boolean} isParent - 是否亲家
 * @param {boolean} isTsumo - 是否自摸
 * @returns {Object} 点数信息
 */
function getScoreFromTable(fu, han, isParent, isTsumo) {
  const limitLevel = getLimitLevel(fu, han);

  // 满贯以上使用满贯点数表
  if (limitLevel) {
    const scores = LIMIT_SCORES[limitLevel];
    if (isTsumo) {
      return {
        total: isParent
          ? scores.tsumoParent[0] * 3
          : scores.tsumoChild[0] * 2 + scores.tsumoChild[1],
        payments: isParent ? scores.tsumoParent : scores.tsumoChild,
        limitName: LIMIT_HANDS[limitLevel].name,
      };
    }
    return {
      total: isParent ? scores.ronParent : scores.ronChild,
      limitName: LIMIT_HANDS[limitLevel].name,
    };
  }

  // 从速查表查询
  const fuScores = SCORE_TABLE[fu];
  if (!fuScores || !fuScores[han]) {
    // 表中没有的情况，使用公式计算
    return calculateScoreByFormula(fu, han, isParent, isTsumo);
  }

  const entry = fuScores[han];
  if (isTsumo) {
    const payments = isParent ? entry.tsumoParent : entry.tsumoChild;
    return {
      total: isParent ? payments[0] * 3 : payments[0] * 2 + payments[1],
      payments,
    };
  }

  return {
    total: isParent ? entry.ronParent : entry.ronChild,
  };
}

/**
 * 使用公式计算点数 (速查表没有的情况)
 * @param {number} fu - 符数
 * @param {number} han - 翻数
 * @param {boolean} isParent - 是否亲家
 * @param {boolean} isTsumo - 是否自摸
 * @returns {Object} 点数信息
 */
function calculateScoreByFormula(fu, han, isParent, isTsumo) {
  const basePoints = calculateBasePoints(fu, han);

  if (isTsumo) {
    if (isParent) {
      // 亲家自摸: 每人付 基本点×2
      const payment = Math.ceil((basePoints * 2) / 100) * 100;
      return {
        total: payment * 3,
        payments: [payment, payment],
      };
    }
    // 子家自摸: 亲家付 基本点×2, 子家付 基本点×1
    const childPayment = Math.ceil(basePoints / 100) * 100;
    const parentPayment = Math.ceil((basePoints * 2) / 100) * 100;
    return {
      total: childPayment * 2 + parentPayment,
      payments: [childPayment, parentPayment],
    };
  }

  // 荣和
  const multiplier = isParent ? 6 : 4;
  const total = Math.ceil((basePoints * multiplier) / 100) * 100;
  return { total };
}

module.exports = {
  LIMIT_HANDS,
  HAN_TO_LIMIT,
  SCORE_TABLE,
  LIMIT_SCORES,
  getLimitLevel,
  calculateBasePoints,
  getScoreFromTable,
  calculateScoreByFormula,
};
