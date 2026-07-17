/**
 * 手牌解析与面子分割
 * 这是日麻计算中最复杂的部分，需要找出所有可能的和牌形式
 */

const {
  parseTiles,
  sortTiles,
  isSameTile,
  isTerminalOrHonor,
  getTileSortKey,
} = require('./config/tiles');
const { WAIT_TYPES, MELD_TYPES } = require('./config/fu-rules');

/**
 * 将牌数组转换为计数数组
 * 格式: counts[suit][value] = count
 * @param {Array} tiles - 牌数组
 * @returns {Object} 计数对象
 */
function tilesToCounts(tiles) {
  const counts = {
    m: new Array(10).fill(0),
    p: new Array(10).fill(0),
    s: new Array(10).fill(0),
    z: new Array(8).fill(0),
  };

  for (const tile of tiles) {
    counts[tile.suit][tile.value]++;
  }

  return counts;
}

/**
 * 从计数数组还原牌数组
 * @param {Object} counts - 计数对象
 * @returns {Array} 牌数组
 */
function countsToTiles(counts) {
  const tiles = [];

  for (const suit of ['m', 'p', 's', 'z']) {
    const max = suit === 'z' ? 7 : 9;
    for (let value = 1; value <= max; value++) {
      for (let i = 0; i < counts[suit][value]; i++) {
        tiles.push({ suit, value, isRed: false });
      }
    }
  }

  return tiles;
}

/**
 * 复制计数对象
 * @param {Object} counts - 计数对象
 * @returns {Object} 复制后的计数对象
 */
function copyCounts(counts) {
  return {
    m: [...counts.m],
    p: [...counts.p],
    s: [...counts.s],
    z: [...counts.z],
  };
}

/**
 * 检查是否为七对子
 * @param {Object} counts - 计数对象
 * @returns {boolean}
 */
function isChiitoitsu(counts) {
  let pairs = 0;

  for (const suit of ['m', 'p', 's', 'z']) {
    const max = suit === 'z' ? 7 : 9;
    for (let value = 1; value <= max; value++) {
      const count = counts[suit][value];
      if (count === 2) {
        pairs++;
      } else if (count !== 0) {
        return false;
      }
    }
  }

  return pairs === 7;
}

/**
 * 检查是否为国士无双
 * @param {Object} counts - 计数对象
 * @returns {boolean}
 */
function isKokushi(counts) {
  // 13种幺九牌
  const terminals = [
    { suit: 'm', value: 1 },
    { suit: 'm', value: 9 },
    { suit: 'p', value: 1 },
    { suit: 'p', value: 9 },
    { suit: 's', value: 1 },
    { suit: 's', value: 9 },
    { suit: 'z', value: 1 },
    { suit: 'z', value: 2 },
    { suit: 'z', value: 3 },
    { suit: 'z', value: 4 },
    { suit: 'z', value: 5 },
    { suit: 'z', value: 6 },
    { suit: 'z', value: 7 },
  ];

  let hasPair = false;

  for (const t of terminals) {
    const count = counts[t.suit][t.value];
    if (count === 0) return false;
    if (count === 2) {
      if (hasPair) return false; // 只能有一对
      hasPair = true;
    } else if (count !== 1) {
      return false;
    }
  }

  return hasPair;
}

/**
 * 检查是否为国士无双十三面听
 * @param {Object} counts - 计数对象
 * @param {Object} agariTile - 和牌张
 * @returns {boolean}
 */
function isKokushi13Wait(counts, agariTile) {
  if (!isKokushi(counts)) return false;

  // 十三面听: 和牌前13种幺九牌各1张，和的那张是第14张
  // 即和牌张在手牌中有2张
  return counts[agariTile.suit][agariTile.value] === 2;
}

/**
 * 递归分割面子
 * @param {Object} counts - 计数对象
 * @param {string} suit - 当前处理的花色
 * @param {number} value - 当前处理的牌值
 * @param {Array} currentMelds - 当前已分割的面子
 * @param {Array} results - 存储所有可能的分割结果
 */
function splitMelds(counts, suit, value, currentMelds, results) {
  const suits = ['m', 'p', 's', 'z'];
  const suitIndex = suits.indexOf(suit);

  // 找到下一个有牌的位置
  let nextSuit = suit;
  let nextValue = value;
  const maxValue = nextSuit === 'z' ? 7 : 9;

  while (true) {
    if (nextValue > maxValue) {
      const nextSuitIndex = suits.indexOf(nextSuit) + 1;
      if (nextSuitIndex >= suits.length) {
        // 所有牌都处理完了，保存结果
        results.push([...currentMelds]);
        return;
      }
      nextSuit = suits[nextSuitIndex];
      nextValue = 1;
      continue;
    }

    if (counts[nextSuit][nextValue] > 0) {
      break;
    }
    nextValue++;
  }

  const count = counts[nextSuit][nextValue];

  // 尝试取刻子
  if (count >= 3) {
    counts[nextSuit][nextValue] -= 3;
    currentMelds.push({
      type: MELD_TYPES.KOUTSU,
      suit: nextSuit,
      value: nextValue,
      tiles: [
        { suit: nextSuit, value: nextValue },
        { suit: nextSuit, value: nextValue },
        { suit: nextSuit, value: nextValue },
      ],
    });
    splitMelds(counts, nextSuit, nextValue, currentMelds, results);
    currentMelds.pop();
    counts[nextSuit][nextValue] += 3;
  }

  // 尝试取顺子 (字牌不能组顺子)
  if (
    nextSuit !== 'z' &&
    nextValue <= 7 &&
    counts[nextSuit][nextValue] >= 1 &&
    counts[nextSuit][nextValue + 1] >= 1 &&
    counts[nextSuit][nextValue + 2] >= 1
  ) {
    counts[nextSuit][nextValue]--;
    counts[nextSuit][nextValue + 1]--;
    counts[nextSuit][nextValue + 2]--;
    currentMelds.push({
      type: MELD_TYPES.SHUNTSU,
      suit: nextSuit,
      value: nextValue,
      tiles: [
        { suit: nextSuit, value: nextValue },
        { suit: nextSuit, value: nextValue + 1 },
        { suit: nextSuit, value: nextValue + 2 },
      ],
    });
    splitMelds(counts, nextSuit, nextValue, currentMelds, results);
    currentMelds.pop();
    counts[nextSuit][nextValue]++;
    counts[nextSuit][nextValue + 1]++;
    counts[nextSuit][nextValue + 2]++;
  }
}

/**
 * 分割标准和牌形式 (4面子+1雀头)
 * @param {Object} counts - 计数对象
 * @returns {Array} 所有可能的分割方式
 */
function splitStandardHand(counts, requiredMelds = 4) {
  const results = [];

  // 枚举所有可能的雀头
  for (const suit of ['m', 'p', 's', 'z']) {
    const max = suit === 'z' ? 7 : 9;
    for (let value = 1; value <= max; value++) {
      if (counts[suit][value] >= 2) {
        // 取出雀头
        const newCounts = copyCounts(counts);
        newCounts[suit][value] -= 2;

        const head = {
          suit,
          value,
          tiles: [
            { suit, value },
            { suit, value },
          ],
        };

        // 分割剩余的面子
        const meldResults = [];
        splitMelds(newCounts, 'm', 1, [], meldResults);

        // 只保留正好 requiredMelds 个面子的结果
        for (const melds of meldResults) {
          if (melds.length === requiredMelds) {
            results.push({ head, melds });
          }
        }
      }
    }
  }

  return results;
}

/**
 * 判断听牌型
 * @param {Object} pattern - 和牌分解
 * @param {Object} agariTile - 和牌张
 * @param {boolean} isTsumo - 是否自摸
 * @returns {string} 听牌型
 */
function determineWaitType(pattern, agariTile, isTsumo) {
  const { head, melds } = pattern;

  // 检查是否单骑 (和牌张是雀头)
  if (head.suit === agariTile.suit && head.value === agariTile.value) {
    return WAIT_TYPES.TANKI;
  }

  // 检查面子中的听牌型
  for (const meld of melds) {
    if (meld.type === MELD_TYPES.KOUTSU) {
      // 刻子: 双碰听
      if (meld.suit === agariTile.suit && meld.value === agariTile.value) {
        return WAIT_TYPES.SHANPON;
      }
    } else if (meld.type === MELD_TYPES.SHUNTSU) {
      // 顺子: 检查两面/嵌张/边张
      const { suit, value } = meld;
      if (suit !== agariTile.suit) continue;

      const agariValue = agariTile.value;

      // 检查和牌张是否在这个顺子中
      if (agariValue < value || agariValue > value + 2) continue;

      // 嵌张: 和的是中间那张
      if (agariValue === value + 1) {
        return WAIT_TYPES.KANCHAN;
      }

      // 边张: 12听3 或 89听7
      if (value === 1 && agariValue === 3) {
        return WAIT_TYPES.PENCHAN;
      }
      if (value === 7 && agariValue === 7) {
        return WAIT_TYPES.PENCHAN;
      }

      // 两面听
      if (agariValue === value || agariValue === value + 2) {
        return WAIT_TYPES.RYANMEN;
      }
    }
  }

  // 默认返回两面 (理论上不应该到这里)
  return WAIT_TYPES.RYANMEN;
}

/**
 * 解析完整手牌
 * @param {Object} hand - 手牌对象
 * @returns {Object} 解析结果
 */
function parseHand(hand) {
  const { closed, melds = [], agariTile, isTsumo } = hand;

  // 转换副露类型为内部格式
  const normalizedMelds = melds.map((m) => {
    let type;
    if (m.type === 'chi') {
      type = MELD_TYPES.SHUNTSU;
    } else if (m.type === 'pon') {
      type = MELD_TYPES.KOUTSU;
    } else if (m.type === 'kan' || m.type === 'minkan') {
      type = MELD_TYPES.KANTSU;
    } else if (m.type === 'ankan') {
      type = MELD_TYPES.KANTSU;
    } else {
      // 已经是内部格式
      type = m.type;
    }
    return {
      ...m,
      type,
      isOpen: m.type !== 'ankan' && m.isOpen !== false,
    };
  });

  // 合并门前手牌和和牌张（无论自摸还是荣和，和牌张都要参与牌型分析）
  const allClosed = [...closed];
  if (agariTile) {
    allClosed.push(agariTile);
  }

  const counts = tilesToCounts(allClosed);
  const results = [];

  // 检查特殊牌型（只有门前才可能）
  const isChiitoi = normalizedMelds.length === 0 && isChiitoitsu(counts);
  const isKokushiHand = normalizedMelds.length === 0 && isKokushi(counts);

  if (isChiitoi) {
    // 七对子
    const pairs = [];
    for (const suit of ['m', 'p', 's', 'z']) {
      const max = suit === 'z' ? 7 : 9;
      for (let value = 1; value <= max; value++) {
        if (counts[suit][value] === 2) {
          pairs.push({ suit, value });
        }
      }
    }
    results.push({
      type: 'chiitoitsu',
      pairs,
      waitType: WAIT_TYPES.TANKI,
    });
  }

  if (isKokushiHand) {
    // 国士无双
    const is13Wait = isKokushi13Wait(counts, agariTile);
    results.push({
      type: 'kokushi',
      is13Wait,
      waitType: WAIT_TYPES.TANKI,
    });
  }

  // 标准和牌形式
  if (normalizedMelds.length === 0) {
    // 门前: 分割所有14张
    const standardPatterns = splitStandardHand(counts);
    for (const pattern of standardPatterns) {
      const waitType = determineWaitType(pattern, agariTile, isTsumo);
      results.push({
        type: 'standard',
        head: pattern.head,
        melds: pattern.melds.map((m) => ({ ...m, isOpen: false })),
        waitType,
      });
    }
  } else {
    // 有副露: 只分割门前部分
    const openMeldCount = normalizedMelds.length;
    const closedMeldCount = 4 - openMeldCount;

    if (closedMeldCount === 0) {
      // 全部副露，只需要找雀头
      for (const suit of ['m', 'p', 's', 'z']) {
        const max = suit === 'z' ? 7 : 9;
        for (let value = 1; value <= max; value++) {
          if (counts[suit][value] === 2) {
            const waitType = determineWaitType(
              { head: { suit, value }, melds: [] },
              agariTile,
              isTsumo
            );
            results.push({
              type: 'standard',
              head: { suit, value, tiles: [{ suit, value }, { suit, value }] },
              melds: normalizedMelds.map((m) => ({ ...m })),
              waitType,
            });
          }
        }
      }
    } else {
      // 部分副露：分割门前部分，需要 closedMeldCount 个面子
      const standardPatterns = splitStandardHand(counts, closedMeldCount);
      for (const pattern of standardPatterns) {
        const allMelds = [
          ...pattern.melds.map((m) => ({ ...m, isOpen: false })),
          ...normalizedMelds.map((m) => ({ ...m })),
        ];
        const waitType = determineWaitType(
          { head: pattern.head, melds: allMelds },
          agariTile,
          isTsumo
        );
        results.push({
          type: 'standard',
          head: pattern.head,
          melds: allMelds,
          waitType,
        });
      }
    }
  }

  return {
    patterns: results,
    isMenzen: normalizedMelds.length === 0 || normalizedMelds.every((m) => !m.isOpen),
  };
}

/**
 * 从字符串解析手牌
 * @param {string} handStr - 手牌字符串 (如 "123m456p789s11z")
 * @param {string} agariStr - 和牌张字符串 (如 "1z")
 * @param {boolean} isTsumo - 是否自摸
 * @returns {Object} 手牌对象
 */
function parseHandFromString(handStr, agariStr, isTsumo = true) {
  const closed = parseTiles(handStr);
  const agariTile = parseTiles(agariStr)[0];

  return {
    closed,
    melds: [],
    agariTile,
    isTsumo,
  };
}

module.exports = {
  tilesToCounts,
  countsToTiles,
  copyCounts,
  isChiitoitsu,
  isKokushi,
  isKokushi13Wait,
  splitStandardHand,
  determineWaitType,
  parseHand,
  parseHandFromString,
};
