/**
 * 点数计算模块
 */

const {
  LIMIT_HANDS,
  getLimitLevel,
  getScoreFromTable,
} = require('./config/score-table');

/**
 * 计算最终点数
 * @param {number} fu - 符数
 * @param {number} han - 翻数 (含宝牌)
 * @param {boolean} isParent - 是否亲家
 * @param {boolean} isTsumo - 是否自摸
 * @param {number} honba - 本场数
 * @param {number} kyoutaku - 供托数 (立直棒数量)
 * @returns {Object} 点数详情
 */
function calculateScore(fu, han, isParent, isTsumo, honba = 0, kyoutaku = 0) {
  // 从速查表获取基础点数
  const baseScore = getScoreFromTable(fu, han, isParent, isTsumo);

  // 本场加算
  const honbaBonus = honba * (isTsumo ? 100 : 300);

  // 供托获得
  const kyoutakuBonus = kyoutaku * 1000;

  if (isTsumo) {
    // 自摸: 三家分摊
    const [childPayment, parentPayment] = baseScore.payments;

    if (isParent) {
      // 亲家自摸: 每位子家支付相同点数
      const eachPayment = childPayment + Math.floor(honbaBonus / 3) * 100;
      const roundedEach = Math.ceil(eachPayment / 100) * 100;

      return {
        fu,
        han,
        limitName: baseScore.limitName || null,
        isParent,
        isTsumo,
        payments: {
          fromEachChild: roundedEach,
          total: roundedEach * 3,
        },
        honbaBonus: honba * 300,
        kyoutakuBonus,
        grandTotal: roundedEach * 3 + kyoutakuBonus,
      };
    }

    // 子家自摸
    const childPay = childPayment + Math.floor(honbaBonus / 3) * 100;
    const parentPay = parentPayment + Math.floor(honbaBonus / 3) * 100;
    const roundedChild = Math.ceil(childPay / 100) * 100;
    const roundedParent = Math.ceil(parentPay / 100) * 100;

    return {
      fu,
      han,
      limitName: baseScore.limitName || null,
      isParent,
      isTsumo,
      payments: {
        fromEachChild: roundedChild,
        fromParent: roundedParent,
        total: roundedChild * 2 + roundedParent,
      },
      honbaBonus: honba * 300,
      kyoutakuBonus,
      grandTotal: roundedChild * 2 + roundedParent + kyoutakuBonus,
    };
  }

  // 荣和: 放铳者单独支付
  const totalPayment = baseScore.total + honbaBonus;
  const roundedTotal = Math.ceil(totalPayment / 100) * 100;

  return {
    fu,
    han,
    limitName: baseScore.limitName || null,
    isParent,
    isTsumo,
    payments: {
      fromDealer: roundedTotal,
      total: roundedTotal,
    },
    honbaBonus,
    kyoutakuBonus,
    grandTotal: roundedTotal + kyoutakuBonus,
  };
}

/**
 * 格式化点数显示
 * @param {Object} scoreResult - calculateScore 的返回值
 * @returns {Object} 格式化后的显示信息
 */
function formatScoreDisplay(scoreResult) {
  const {
    fu,
    han,
    limitName,
    isParent,
    isTsumo,
    payments,
    honbaBonus,
    kyoutakuBonus,
    grandTotal,
  } = scoreResult;

  const lines = [];

  // 符翻信息
  if (limitName) {
    lines.push(`${limitName}`);
  } else {
    lines.push(`${fu}符 ${han}翻`);
  }

  // 支付信息
  if (isTsumo) {
    if (isParent) {
      lines.push(`${payments.fromEachChild} all`);
    } else {
      lines.push(`${payments.fromEachChild}/${payments.fromParent}`);
    }
  } else {
    lines.push(`${payments.total}点`);
  }

  // 本场/供托
  const extras = [];
  if (honbaBonus > 0) {
    extras.push(`+${honbaBonus}(本场)`);
  }
  if (kyoutakuBonus > 0) {
    extras.push(`+${kyoutakuBonus}(供托)`);
  }
  if (extras.length > 0) {
    lines.push(extras.join(' '));
  }

  // 总计
  lines.push(`合计: ${grandTotal}点`);

  return {
    summary: limitName || `${fu}符${han}翻`,
    paymentText: isTsumo
      ? isParent
        ? `${payments.fromEachChild} all`
        : `${payments.fromEachChild}/${payments.fromParent}`
      : `${payments.total}`,
    totalText: `${grandTotal}`,
    lines,
  };
}

/**
 * 计算宝牌数量
 * @param {Array} tiles - 手牌 (包括副露)
 * @param {Array} doraIndicators - 表宝牌指示牌
 * @param {Array} uraIndicators - 里宝牌指示牌
 * @returns {Object} 宝牌详情
 */
function countAllDora(tiles, doraIndicators = [], uraIndicators = []) {
  const { countDora } = require('./config/tiles');

  const dora = countDora(tiles, doraIndicators);
  const uraDora = countDora(tiles, uraIndicators);
  const akaDora = tiles.filter((t) => t.isRed).length;

  // 注意: akaDora 已经在 countDora 中计算过了，这里单独列出是为了显示
  // 实际总数不需要再加 akaDora

  return {
    dora: dora - akaDora, // 表宝牌 (不含赤)
    uraDora: uraDora - tiles.filter((t) => t.isRed).length, // 里宝牌 (不含赤)
    akaDora,
    total: dora + (uraIndicators.length > 0 ? uraDora - akaDora : 0),
  };
}

module.exports = {
  calculateScore,
  formatScoreDisplay,
  countAllDora,
};
