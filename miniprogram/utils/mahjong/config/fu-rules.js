/**
 * 符数规则配置
 */

const FU_RULES = {
  // 副底 (基础符数)
  base: 20,

  // 门前荣和加符
  menzenRon: 10,

  // 自摸加符 (平和除外)
  tsumo: 2,

  // 雀头符数
  head: {
    normal: 0, // 普通雀头 (数牌、客风)
    yakuhai: 2, // 役牌雀头 (三元牌、自风、场风)
    doubleWind: 4, // 连风牌雀头 (同时是自风和场风)
  },

  // 面子符数
  // 格式: [中张符数, 幺九符数]
  meld: {
    shuntsu: [0, 0], // 顺子 (无符)
    minkou: [2, 4], // 明刻
    ankou: [4, 8], // 暗刻
    minkan: [8, 16], // 明杠 (包括加杠)
    ankan: [16, 32], // 暗杠
  },

  // 听牌型符数
  wait: {
    ryanmen: 0, // 两面听
    shanpon: 0, // 双碰听
    kanchan: 2, // 嵌张听
    penchan: 2, // 边张听
    tanki: 2, // 单骑听
  },

  // 特殊情况
  special: {
    // 平和固定符数
    pinfu: {
      tsumo: 20, // 平和自摸
      ron: 30, // 平和荣和
    },
    // 七对子固定符数 (不进位)
    chiitoitsu: 25,
    // 最低符数 (副露平和型荣和)
    minFu: 30,
  },
};

// 听牌型定义
const WAIT_TYPES = {
  RYANMEN: 'ryanmen', // 两面: 如 23 听 1 或 4
  SHANPON: 'shanpon', // 双碰: 如 AA BB 听 A 或 B
  KANCHAN: 'kanchan', // 嵌张: 如 13 听 2
  PENCHAN: 'penchan', // 边张: 如 12 听 3 或 89 听 7
  TANKI: 'tanki', // 单骑: 如 A 听 A 做雀头
};

// 面子类型定义
const MELD_TYPES = {
  SHUNTSU: 'shuntsu', // 顺子
  KOUTSU: 'koutsu', // 刻子
  KANTSU: 'kantsu', // 杠子
};

/**
 * 获取面子符数
 * @param {string} meldType - 面子类型 (shuntsu/koutsu/kantsu)
 * @param {boolean} isOpen - 是否副露 (明)
 * @param {boolean} isTerminalOrHonor - 是否幺九牌
 * @returns {number} 符数
 */
function getMeldFu(meldType, isOpen, isTerminalOrHonor) {
  const terminalIndex = isTerminalOrHonor ? 1 : 0;

  switch (meldType) {
    case MELD_TYPES.SHUNTSU:
      return FU_RULES.meld.shuntsu[terminalIndex];
    case MELD_TYPES.KOUTSU:
      return isOpen
        ? FU_RULES.meld.minkou[terminalIndex]
        : FU_RULES.meld.ankou[terminalIndex];
    case MELD_TYPES.KANTSU:
      return isOpen
        ? FU_RULES.meld.minkan[terminalIndex]
        : FU_RULES.meld.ankan[terminalIndex];
    default:
      return 0;
  }
}

/**
 * 获取听牌型符数
 * @param {string} waitType - 听牌型
 * @returns {number} 符数
 */
function getWaitFu(waitType) {
  return FU_RULES.wait[waitType] || 0;
}

/**
 * 符数进位 (向上取整到10的倍数)
 * @param {number} fu - 原始符数
 * @returns {number} 进位后的符数
 */
function roundUpFu(fu) {
  return Math.ceil(fu / 10) * 10;
}

module.exports = {
  FU_RULES,
  WAIT_TYPES,
  MELD_TYPES,
  getMeldFu,
  getWaitFu,
  roundUpFu,
};
