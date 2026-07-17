/**
 * 麻将牌定义与工具函数
 */

// 花色定义
const SUITS = {
  m: { name: '万', nameJp: 'マンズ', isHonor: false },
  p: { name: '筒', nameJp: 'ピンズ', isHonor: false },
  s: { name: '索', nameJp: 'ソーズ', isHonor: false },
  z: { name: '字', nameJp: '字牌', isHonor: true },
};

// 字牌值定义 (z1-z7)
const HONORS = {
  1: { name: '东', nameJp: '東', type: 'wind' },
  2: { name: '南', nameJp: '南', type: 'wind' },
  3: { name: '西', nameJp: '西', type: 'wind' },
  4: { name: '北', nameJp: '北', type: 'wind' },
  5: { name: '白', nameJp: '白', type: 'dragon' },
  6: { name: '发', nameJp: '發', type: 'dragon' },
  7: { name: '中', nameJp: '中', type: 'dragon' },
};

// 风牌映射
const WINDS = {
  east: 1,
  south: 2,
  west: 3,
  north: 4,
};

// 风牌反向映射
const WIND_NAMES = {
  1: 'east',
  2: 'south',
  3: 'west',
  4: 'north',
};

/**
 * 创建一张牌
 * @param {string} suit - 花色 (m/p/s/z)
 * @param {number} value - 牌值 (1-9 或 1-7)
 * @param {boolean} isRed - 是否赤牌
 * @returns {Object} 牌对象
 */
function createTile(suit, value, isRed = false) {
  return { suit, value, isRed };
}

/**
 * 从字符串解析牌 (如 "5m", "0p" 表示赤5筒)
 * @param {string} str - 牌字符串
 * @returns {Object} 牌对象
 */
function parseTile(str) {
  const match = str.match(/^(\d)([mpsz])$/);
  if (!match) return null;

  let value = parseInt(match[1], 10);
  const suit = match[2];
  let isRed = false;

  // 0 表示赤5
  if (value === 0) {
    value = 5;
    isRed = true;
  }

  return createTile(suit, value, isRed);
}

/**
 * 从字符串解析多张牌 (如 "123m456p789s11z")
 * @param {string} str - 牌组字符串
 * @returns {Array} 牌对象数组
 */
function parseTiles(str) {
  const tiles = [];
  const pattern = /(\d+)([mpsz])/g;
  let match;

  while ((match = pattern.exec(str)) !== null) {
    const values = match[1];
    const suit = match[2];

    for (const char of values) {
      let value = parseInt(char, 10);
      let isRed = false;

      if (value === 0) {
        value = 5;
        isRed = true;
      }

      tiles.push(createTile(suit, value, isRed));
    }
  }

  return tiles;
}

/**
 * 将牌转换为字符串
 * @param {Object} tile - 牌对象
 * @returns {string} 牌字符串
 */
function tileToString(tile) {
  const value = tile.isRed ? 0 : tile.value;
  return `${value}${tile.suit}`;
}

/**
 * 将多张牌转换为紧凑字符串
 * @param {Array} tiles - 牌对象数组
 * @returns {string} 紧凑字符串 (如 "123m456p")
 */
function tilesToString(tiles) {
  const grouped = { m: [], p: [], s: [], z: [] };

  for (const tile of tiles) {
    const value = tile.isRed ? 0 : tile.value;
    grouped[tile.suit].push(value);
  }

  let result = '';
  for (const suit of ['m', 'p', 's', 'z']) {
    if (grouped[suit].length > 0) {
      grouped[suit].sort((a, b) => a - b);
      result += grouped[suit].join('') + suit;
    }
  }

  return result;
}

/**
 * 判断是否为幺九牌 (1, 9, 字牌)
 * @param {Object} tile - 牌对象
 * @returns {boolean}
 */
function isTerminalOrHonor(tile) {
  if (tile.suit === 'z') return true;
  return tile.value === 1 || tile.value === 9;
}

/**
 * 判断是否为幺九数牌 (1, 9)
 * @param {Object} tile - 牌对象
 * @returns {boolean}
 */
function isTerminal(tile) {
  if (tile.suit === 'z') return false;
  return tile.value === 1 || tile.value === 9;
}

/**
 * 判断是否为字牌
 * @param {Object} tile - 牌对象
 * @returns {boolean}
 */
function isHonor(tile) {
  return tile.suit === 'z';
}

/**
 * 判断是否为风牌
 * @param {Object} tile - 牌对象
 * @returns {boolean}
 */
function isWind(tile) {
  return tile.suit === 'z' && tile.value >= 1 && tile.value <= 4;
}

/**
 * 判断是否为三元牌
 * @param {Object} tile - 牌对象
 * @returns {boolean}
 */
function isDragon(tile) {
  return tile.suit === 'z' && tile.value >= 5 && tile.value <= 7;
}

/**
 * 判断是否为绿一色可用牌 (23468s + 發)
 * @param {Object} tile - 牌对象
 * @returns {boolean}
 */
function isGreen(tile) {
  if (tile.suit === 's') {
    return [2, 3, 4, 6, 8].includes(tile.value);
  }
  return tile.suit === 'z' && tile.value === 6; // 發
}

/**
 * 比较两张牌是否相同
 * @param {Object} a - 牌对象
 * @param {Object} b - 牌对象
 * @returns {boolean}
 */
function isSameTile(a, b) {
  return a.suit === b.suit && a.value === b.value;
}

/**
 * 获取牌的排序键值
 * @param {Object} tile - 牌对象
 * @returns {number}
 */
function getTileSortKey(tile) {
  const suitOrder = { m: 0, p: 1, s: 2, z: 3 };
  return suitOrder[tile.suit] * 10 + tile.value;
}

/**
 * 对牌数组排序
 * @param {Array} tiles - 牌对象数组
 * @returns {Array} 排序后的数组
 */
function sortTiles(tiles) {
  return [...tiles].sort((a, b) => getTileSortKey(a) - getTileSortKey(b));
}

/**
 * 获取宝牌指示牌对应的实际宝牌
 * @param {Object} indicator - 指示牌
 * @returns {Object} 实际宝牌
 */
function getDoraFromIndicator(indicator) {
  const { suit, value } = indicator;

  if (suit === 'z') {
    // 字牌: 东南西北循环, 白发中循环
    if (value <= 4) {
      return createTile(suit, value === 4 ? 1 : value + 1);
    }
    return createTile(suit, value === 7 ? 5 : value + 1);
  }

  // 数牌: 9 -> 1 循环
  return createTile(suit, value === 9 ? 1 : value + 1);
}

/**
 * 统计手牌中某张牌的数量
 * @param {Array} tiles - 牌数组
 * @param {Object} target - 目标牌
 * @returns {number}
 */
function countTile(tiles, target) {
  return tiles.filter((t) => isSameTile(t, target)).length;
}

/**
 * 统计手牌中由指示牌命中的宝牌数量
 * 注意: 只统计「指示牌 → 实际宝牌」命中的张数，不含赤宝牌。
 * 赤宝牌是独立维度 (tile.isRed)，由调用方单独统计，避免表/里宝牌重复计入。
 * @param {Array} tiles - 手牌
 * @param {Array} doraIndicators - 宝牌指示牌数组
 * @returns {number}
 */
function countDora(tiles, doraIndicators) {
  let count = 0;

  for (const indicator of doraIndicators) {
    const dora = getDoraFromIndicator(indicator);
    count += countTile(tiles, dora);
  }

  return count;
}

module.exports = {
  SUITS,
  HONORS,
  WINDS,
  WIND_NAMES,
  createTile,
  parseTile,
  parseTiles,
  tileToString,
  tilesToString,
  isTerminalOrHonor,
  isTerminal,
  isHonor,
  isWind,
  isDragon,
  isGreen,
  isSameTile,
  getTileSortKey,
  sortTiles,
  getDoraFromIndicator,
  countTile,
  countDora,
};
