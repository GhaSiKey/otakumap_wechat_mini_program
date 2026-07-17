/**
 * 日麻点数计算核心引擎
 * 整合所有模块，提供统一的计算接口
 */

const { parseHand, parseHandFromString } = require('./parser');
const { calculateFu } = require('./fu-calculator');
const { checkAllYaku, calculateTotalHan } = require('./yaku-checker');
const { calculateScore, formatScoreDisplay } = require('./score-calculator');
const { countDora, parseTiles } = require('./config/tiles');

/**
 * 计算和牌点数 (主入口)
 * @param {Object} input - 输入参数
 * @param {Object} input.hand - 手牌对象
 * @param {Object} input.situation - 场况
 * @param {Object} input.dora - 宝牌信息
 * @returns {Object} 计算结果
 */
function calculate(input) {
  const { hand, situation, dora = {} } = input;

  // 1. 解析手牌，获取所有可能的和牌形式
  const parseResult = parseHand(hand);
  const { patterns, isMenzen } = parseResult;

  if (patterns.length === 0) {
    return {
      success: false,
      error: '无法解析手牌，请检查输入是否正确',
    };
  }

  // 2. 对每种和牌形式计算点数，选择最优解
  let bestResult = null;

  for (const pattern of patterns) {
    // 判定役种
    const yakuList = checkAllYaku(pattern, situation, isMenzen, hand.agariTile);

    // 无役判定
    if (yakuList.length === 0) {
      continue;
    }

    // 计算符数
    const fuResult = calculateFu(
      pattern,
      situation,
      hand.isTsumo,
      isMenzen,
      yakuList
    );

    // 计算役种翻数
    const yakuHan = calculateTotalHan(yakuList);

    // 计算宝牌
    const allTiles = getAllHandTiles(hand);
    const doraCount = countAllDoraForHand(allTiles, dora, situation.isRiichi);

    // 总翻数
    const totalHan = yakuHan + doraCount.total;

    // 计算点数
    const scoreResult = calculateScore(
      fuResult.rounded,
      totalHan,
      situation.isParent,
      hand.isTsumo,
      situation.honba || 0,
      situation.kyoutaku || 0
    );

    // 选择点数最高的结果
    if (!bestResult || scoreResult.grandTotal > bestResult.score.grandTotal) {
      bestResult = {
        pattern,
        yakuList,
        fu: fuResult,
        doraCount,
        yakuHan,
        totalHan,
        score: scoreResult,
      };
    }
  }

  if (!bestResult) {
    return {
      success: false,
      error: '无役，不能和牌',
    };
  }

  // 3. 格式化输出
  const display = formatScoreDisplay(bestResult.score);

  return {
    success: true,
    // 和牌分解
    pattern: bestResult.pattern,
    // 符数详情
    fu: bestResult.fu,
    // 役种列表
    yakuList: bestResult.yakuList,
    // 宝牌详情
    doraCount: bestResult.doraCount,
    // 翻数
    yakuHan: bestResult.yakuHan,
    totalHan: bestResult.totalHan,
    // 点数
    score: bestResult.score,
    // 显示信息
    display,
  };
}

/**
 * 获取手牌中的所有牌 (包括副露)
 * @param {Object} hand - 手牌对象
 * @returns {Array} 所有牌
 */
function getAllHandTiles(hand) {
  const tiles = [...hand.closed];

  if (hand.agariTile) {
    tiles.push(hand.agariTile);
  }

  if (hand.melds) {
    for (const meld of hand.melds) {
      tiles.push(...meld.tiles);
    }
  }

  return tiles;
}

/**
 * 计算手牌中的宝牌数量
 * 三个维度各自独立统计后相加: 表宝牌、里宝牌、赤宝牌互不重叠。
 * @param {Array} tiles - 所有牌
 * @param {Object} dora - 宝牌信息
 * @param {boolean} isRiichi - 是否立直 (决定是否计算里宝牌)
 * @returns {Object} 宝牌详情
 */
function countAllDoraForHand(tiles, dora, isRiichi) {
  const { indicators = [], uraIndicators = [] } = dora;

  // 表宝牌 (指示牌命中, 不含赤)
  const doraCount = countDora(tiles, indicators);

  // 里宝牌 (只有立直才计算, 不含赤)
  const uraDoraCount = isRiichi ? countDora(tiles, uraIndicators) : 0;

  // 赤宝牌 (独立维度)
  const akaDoraCount = tiles.filter((t) => t.isRed).length;

  return {
    dora: doraCount,
    uraDora: uraDoraCount,
    akaDora: akaDoraCount,
    total: doraCount + uraDoraCount + akaDoraCount,
  };
}

/**
 * 简化版计算接口 (使用字符串输入)
 * @param {string} handStr - 手牌字符串 (如 "123m456p789s1z")
 * @param {string} agariStr - 和牌张字符串 (如 "1z")
 * @param {Object} options - 选项
 * @returns {Object} 计算结果
 */
function calculateFromString(handStr, agariStr, options = {}) {
  const {
    isTsumo = true,
    bakaze = 'east',
    jikaze = 'east',
    isRiichi = false,
    isDoubleRiichi = false,
    isIppatsu = false,
    honba = 0,
    kyoutaku = 0,
    doraIndicators = [],
    uraIndicators = [],
  } = options;

  const hand = parseHandFromString(handStr, agariStr, isTsumo);

  const situation = {
    bakaze,
    jikaze,
    isParent: jikaze === 'east',
    isTsumo,
    isRiichi,
    isDoubleRiichi,
    isIppatsu,
    honba,
    kyoutaku,
  };

  const dora = {
    indicators: doraIndicators.map((s) => parseTiles(s)[0]).filter(Boolean),
    uraIndicators: uraIndicators.map((s) => parseTiles(s)[0]).filter(Boolean),
  };

  return calculate({ hand, situation, dora });
}

/**
 * 验证手牌是否合法
 * @param {Object} hand - 手牌对象
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateHand(hand) {
  const { closed, melds = [], agariTile } = hand;

  // 检查总牌数
  const closedCount = closed.length + (agariTile ? 1 : 0);
  const meldCount = melds.reduce((sum, m) => {
    if (m.type === 'kantsu' || m.type === 'ankan') return sum + 4;
    return sum + 3;
  }, 0);

  const totalCount = closedCount + meldCount;

  // 标准和牌: 14张 (有杠时可能更多)
  const expectedCount = 14 + melds.filter((m) => m.type === 'kantsu' || m.type === 'ankan').length;

  if (totalCount !== expectedCount) {
    return {
      valid: false,
      error: `牌数不正确: 期望 ${expectedCount} 张，实际 ${totalCount} 张`,
    };
  }

  // 检查每种牌的数量不超过4张
  const counts = {};
  const allTiles = getAllHandTiles(hand);

  for (const tile of allTiles) {
    const key = `${tile.suit}${tile.value}`;
    counts[key] = (counts[key] || 0) + 1;
    if (counts[key] > 4) {
      return {
        valid: false,
        error: `${key} 超过4张`,
      };
    }
  }

  return { valid: true };
}

module.exports = {
  calculate,
  calculateFromString,
  validateHand,
  getAllHandTiles,
};
