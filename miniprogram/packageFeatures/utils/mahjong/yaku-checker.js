/**
 * 役种判定模块
 */

const {
  isTerminalOrHonor,
  isTerminal,
  isHonor,
  isWind,
  isDragon,
  isGreen,
  isSameTile,
  WINDS,
} = require('./config/tiles');
const { YAKU_LIST, getYakuHan } = require('./config/yaku');
const { MELD_TYPES, WAIT_TYPES } = require('./config/fu-rules');

/**
 * 获取所有牌 (包括面子中的牌)
 * @param {Object} pattern - 和牌分解
 * @returns {Array} 所有牌
 */
function getAllTiles(pattern) {
  const tiles = [];

  if (pattern.head) {
    tiles.push(...pattern.head.tiles);
  }

  if (pattern.melds) {
    for (const meld of pattern.melds) {
      tiles.push(...meld.tiles);
    }
  }

  if (pattern.pairs) {
    for (const pair of pattern.pairs) {
      tiles.push({ suit: pair.suit, value: pair.value });
      tiles.push({ suit: pair.suit, value: pair.value });
    }
  }

  return tiles;
}

/**
 * 检查断幺九
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkTanyao(pattern) {
  const tiles = getAllTiles(pattern);
  return tiles.every((t) => !isTerminalOrHonor(t));
}

/**
 * 检查平和
 * @param {Object} pattern - 和牌分解
 * @param {Object} situation - 场况
 * @returns {boolean}
 */
function checkPinfu(pattern, situation) {
  if (pattern.type !== 'standard') return false;

  // 必须是4顺子
  const shuntsuCount = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.SHUNTSU && !m.isOpen
  ).length;
  if (shuntsuCount !== 4) return false;

  // 雀头不能是役牌
  const { head } = pattern;
  if (head.suit === 'z') {
    const { bakaze, jikaze } = situation;
    const bakazeValue = WINDS[bakaze];
    const jikazeValue = WINDS[jikaze];

    // 三元牌
    if (isDragon({ suit: head.suit, value: head.value })) return false;
    // 场风
    if (head.value === bakazeValue) return false;
    // 自风
    if (head.value === jikazeValue) return false;
  }

  // 必须是两面听
  if (pattern.waitType !== WAIT_TYPES.RYANMEN) return false;

  return true;
}

/**
 * 检查一盃口
 * @param {Object} pattern - 和牌分解
 * @returns {number} 一盃口的数量 (0, 1, 2)
 */
function countIipeikou(pattern) {
  if (pattern.type !== 'standard') return 0;

  const shuntsus = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.SHUNTSU && !m.isOpen
  );

  let count = 0;
  const used = new Set();

  for (let i = 0; i < shuntsus.length; i++) {
    if (used.has(i)) continue;

    for (let j = i + 1; j < shuntsus.length; j++) {
      if (used.has(j)) continue;

      const a = shuntsus[i];
      const b = shuntsus[j];

      if (a.suit === b.suit && a.value === b.value) {
        count++;
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  return count;
}

/**
 * 检查役牌 (三元牌)
 * @param {Object} pattern - 和牌分解
 * @returns {Array} 成立的役牌列表
 */
function checkYakuhaiDragons(pattern) {
  if (pattern.type !== 'standard') return [];

  const result = [];
  const koutsus = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.KOUTSU || m.type === MELD_TYPES.KANTSU
  );

  for (const meld of koutsus) {
    const tile = meld.tiles[0];
    if (tile.suit === 'z') {
      if (tile.value === 5) result.push('yakuhaiHaku');
      if (tile.value === 6) result.push('yakuhaiHatsu');
      if (tile.value === 7) result.push('yakuhaiChun');
    }
  }

  return result;
}

/**
 * 检查役牌 (风牌)
 * @param {Object} pattern - 和牌分解
 * @param {Object} situation - 场况
 * @returns {Array} 成立的役牌列表
 */
function checkYakuhaiWinds(pattern, situation) {
  if (pattern.type !== 'standard') return [];

  const result = [];
  const { bakaze, jikaze } = situation;
  const bakazeValue = WINDS[bakaze];
  const jikazeValue = WINDS[jikaze];

  const koutsus = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.KOUTSU || m.type === MELD_TYPES.KANTSU
  );

  for (const meld of koutsus) {
    const tile = meld.tiles[0];
    if (tile.suit === 'z' && isWind(tile)) {
      if (tile.value === bakazeValue) result.push('yakuhaiBakaze');
      if (tile.value === jikazeValue) result.push('yakuhaiJikaze');
    }
  }

  return result;
}

/**
 * 检查三色同顺
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkSanshokuDoujun(pattern) {
  if (pattern.type !== 'standard') return false;

  const shuntsus = pattern.melds.filter((m) => m.type === MELD_TYPES.SHUNTSU);

  for (let value = 1; value <= 7; value++) {
    const suits = new Set();
    for (const meld of shuntsus) {
      if (meld.value === value) {
        suits.add(meld.suit);
      }
    }
    if (suits.size === 3) return true;
  }

  return false;
}

/**
 * 检查一气通贯
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkIttsu(pattern) {
  if (pattern.type !== 'standard') return false;

  const shuntsus = pattern.melds.filter((m) => m.type === MELD_TYPES.SHUNTSU);

  for (const suit of ['m', 'p', 's']) {
    const values = shuntsus.filter((m) => m.suit === suit).map((m) => m.value);
    if (values.includes(1) && values.includes(4) && values.includes(7)) {
      return true;
    }
  }

  return false;
}

/**
 * 检查混全带幺九
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkChanta(pattern) {
  if (pattern.type !== 'standard') return false;

  const tiles = getAllTiles(pattern);
  const hasHonor = tiles.some((t) => isHonor(t));
  if (!hasHonor) return false;

  // 雀头必须含幺九
  if (!isTerminalOrHonor(pattern.head.tiles[0])) return false;

  // 每个面子必须含幺九
  for (const meld of pattern.melds) {
    const hasYaochu = meld.tiles.some((t) => isTerminalOrHonor(t));
    if (!hasYaochu) return false;
  }

  return true;
}

/**
 * 检查纯全带幺九
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkJunchan(pattern) {
  if (pattern.type !== 'standard') return false;

  const tiles = getAllTiles(pattern);
  const hasHonor = tiles.some((t) => isHonor(t));
  if (hasHonor) return false;

  // 雀头必须是数牌幺九
  if (!isTerminal(pattern.head.tiles[0])) return false;

  // 每个面子必须含数牌幺九
  for (const meld of pattern.melds) {
    const hasTerminal = meld.tiles.some((t) => isTerminal(t));
    if (!hasTerminal) return false;
  }

  return true;
}

/**
 * 检查对对和
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkToitoi(pattern) {
  if (pattern.type !== 'standard') return false;

  return pattern.melds.every(
    (m) => m.type === MELD_TYPES.KOUTSU || m.type === MELD_TYPES.KANTSU
  );
}

/**
 * 检查三暗刻
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkSanankou(pattern) {
  if (pattern.type !== 'standard') return false;

  const ankouCount = pattern.melds.filter(
    (m) => (m.type === MELD_TYPES.KOUTSU || m.type === MELD_TYPES.KANTSU) && !m.isOpen
  ).length;

  return ankouCount >= 3;
}

/**
 * 检查三色同刻
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkSanshokuDoukou(pattern) {
  if (pattern.type !== 'standard') return false;

  const koutsus = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.KOUTSU || m.type === MELD_TYPES.KANTSU
  );

  for (let value = 1; value <= 9; value++) {
    const suits = new Set();
    for (const meld of koutsus) {
      if (meld.tiles[0].value === value && meld.tiles[0].suit !== 'z') {
        suits.add(meld.tiles[0].suit);
      }
    }
    if (suits.size === 3) return true;
  }

  return false;
}

/**
 * 检查三杠子
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkSankantsu(pattern) {
  if (pattern.type !== 'standard') return false;

  const kantsuCount = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.KANTSU
  ).length;

  return kantsuCount >= 3;
}

/**
 * 检查小三元
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkShousangen(pattern) {
  if (pattern.type !== 'standard') return false;

  let dragonKoutsu = 0;
  let dragonHead = false;

  // 检查刻子中的三元牌
  for (const meld of pattern.melds) {
    if (meld.type === MELD_TYPES.KOUTSU || meld.type === MELD_TYPES.KANTSU) {
      const tile = meld.tiles[0];
      if (isDragon(tile)) dragonKoutsu++;
    }
  }

  // 检查雀头是否是三元牌
  if (isDragon(pattern.head.tiles[0])) {
    dragonHead = true;
  }

  return dragonKoutsu === 2 && dragonHead;
}

/**
 * 检查混老头
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkHonroutou(pattern) {
  const tiles = getAllTiles(pattern);
  const allYaochu = tiles.every((t) => isTerminalOrHonor(t));
  const hasHonor = tiles.some((t) => isHonor(t));
  const hasTerminal = tiles.some((t) => isTerminal(t));

  return allYaochu && hasHonor && hasTerminal;
}

/**
 * 检查混一色
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkHonitsu(pattern) {
  const tiles = getAllTiles(pattern);

  const suits = new Set();
  let hasHonor = false;

  for (const tile of tiles) {
    if (tile.suit === 'z') {
      hasHonor = true;
    } else {
      suits.add(tile.suit);
    }
  }

  return suits.size === 1 && hasHonor;
}

/**
 * 检查清一色
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkChinitsu(pattern) {
  const tiles = getAllTiles(pattern);

  const suits = new Set();

  for (const tile of tiles) {
    suits.add(tile.suit);
  }

  return suits.size === 1 && !suits.has('z');
}

// ========== 役满判定 ==========

/**
 * 检查四暗刻
 * @param {Object} pattern - 和牌分解
 * @param {boolean} isTsumo - 是否自摸
 * @returns {string|null} 'suuankou' | 'suuankouTanki' | null
 */
function checkSuuankou(pattern, isTsumo) {
  if (pattern.type !== 'standard') return null;

  const ankouCount = pattern.melds.filter(
    (m) => (m.type === MELD_TYPES.KOUTSU || m.type === MELD_TYPES.KANTSU) && !m.isOpen
  ).length;

  if (ankouCount !== 4) return null;

  // 单骑听牌 = 双倍役满
  if (pattern.waitType === WAIT_TYPES.TANKI) {
    return 'suuankouTanki';
  }

  // 双碰听牌时，荣和不算四暗刻 (因为最后一个刻子变成明刻)
  if (!isTsumo && pattern.waitType === WAIT_TYPES.SHANPON) {
    return null;
  }

  return 'suuankou';
}

/**
 * 检查大三元
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkDaisangen(pattern) {
  if (pattern.type !== 'standard') return false;

  let dragonCount = 0;

  for (const meld of pattern.melds) {
    if (meld.type === MELD_TYPES.KOUTSU || meld.type === MELD_TYPES.KANTSU) {
      if (isDragon(meld.tiles[0])) dragonCount++;
    }
  }

  return dragonCount === 3;
}

/**
 * 检查小四喜/大四喜
 * @param {Object} pattern - 和牌分解
 * @returns {string|null} 'shousuushi' | 'daisuushi' | null
 */
function checkSuushi(pattern) {
  if (pattern.type !== 'standard') return false;

  let windKoutsu = 0;
  let windHead = false;

  for (const meld of pattern.melds) {
    if (meld.type === MELD_TYPES.KOUTSU || meld.type === MELD_TYPES.KANTSU) {
      if (isWind(meld.tiles[0])) windKoutsu++;
    }
  }

  if (isWind(pattern.head.tiles[0])) {
    windHead = true;
  }

  if (windKoutsu === 4) return 'daisuushi';
  if (windKoutsu === 3 && windHead) return 'shousuushi';

  return null;
}

/**
 * 检查字一色
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkTsuuiisou(pattern) {
  const tiles = getAllTiles(pattern);
  return tiles.every((t) => t.suit === 'z');
}

/**
 * 检查绿一色
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkRyuuiisou(pattern) {
  const tiles = getAllTiles(pattern);
  return tiles.every((t) => isGreen(t));
}

/**
 * 检查清老头
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkChinroutou(pattern) {
  const tiles = getAllTiles(pattern);
  return tiles.every((t) => isTerminal(t));
}

/**
 * 检查九莲宝灯
 * @param {Object} pattern - 和牌分解
 * @param {Object} agariTile - 和牌张
 * @returns {string|null} 'chuurenpoutou' | 'junseichuurenpoutou' | null
 */
function checkChuurenpoutou(pattern, agariTile) {
  const tiles = getAllTiles(pattern);

  // 必须是清一色数牌
  const suits = new Set(tiles.map((t) => t.suit));
  if (suits.size !== 1 || suits.has('z')) return null;

  const suit = tiles[0].suit;

  // 统计每个数字的数量
  const counts = new Array(10).fill(0);
  for (const tile of tiles) {
    counts[tile.value]++;
  }

  // 九莲宝灯基本形: 1112345678999
  // 即 1和9各3张，2-8各1张，加上任意1张
  const basePattern = [0, 3, 1, 1, 1, 1, 1, 1, 1, 3];

  // 检查是否符合九莲宝灯
  let extraValue = 0;
  for (let i = 1; i <= 9; i++) {
    const diff = counts[i] - basePattern[i];
    if (diff < 0) return null;
    if (diff === 1) {
      if (extraValue !== 0) return null; // 只能多1张
      extraValue = i;
    } else if (diff > 1) {
      return null;
    }
  }

  // 纯正九莲宝灯: 和牌张是多出来的那张
  if (agariTile.suit === suit && agariTile.value === extraValue) {
    // 检查是否9面听 (和牌前是1112345678999)
    const beforeAgari = [...counts];
    beforeAgari[agariTile.value]--;

    let is9Wait = true;
    for (let i = 1; i <= 9; i++) {
      if (beforeAgari[i] !== basePattern[i]) {
        is9Wait = false;
        break;
      }
    }

    if (is9Wait) return 'junseichuurenpoutou';
  }

  return 'chuurenpoutou';
}

/**
 * 检查四杠子
 * @param {Object} pattern - 和牌分解
 * @returns {boolean}
 */
function checkSuukantsu(pattern) {
  if (pattern.type !== 'standard') return false;

  const kantsuCount = pattern.melds.filter(
    (m) => m.type === MELD_TYPES.KANTSU
  ).length;

  return kantsuCount === 4;
}

/**
 * 判定所有役种 (主入口)
 * @param {Object} pattern - 和牌分解
 * @param {Object} situation - 场况
 * @param {boolean} isMenzen - 是否门前
 * @param {Object} agariTile - 和牌张
 * @returns {Array} 成立的役种列表
 */
function checkAllYaku(pattern, situation, isMenzen, agariTile) {
  const yakuList = [];
  const isTsumo = situation.isTsumo !== false;

  // ========== 特殊状态役 ==========
  if (situation.isTenhou) {
    yakuList.push({ ...YAKU_LIST.tenhou });
    return yakuList; // 天和直接返回
  }

  if (situation.isChiihou) {
    yakuList.push({ ...YAKU_LIST.chiihou });
    return yakuList; // 地和直接返回
  }

  // ========== 役满判定 (优先) ==========

  // 国士无双
  if (pattern.type === 'kokushi') {
    if (pattern.is13Wait) {
      yakuList.push({ ...YAKU_LIST.kokushi13 });
    } else {
      yakuList.push({ ...YAKU_LIST.kokushi });
    }
    return yakuList;
  }

  // 四暗刻
  const suuankouResult = checkSuuankou(pattern, isTsumo);
  if (suuankouResult) {
    yakuList.push({ ...YAKU_LIST[suuankouResult] });
  }

  // 大三元
  if (checkDaisangen(pattern)) {
    yakuList.push({ ...YAKU_LIST.daisangen });
  }

  // 小四喜/大四喜
  const suushiResult = checkSuushi(pattern);
  if (suushiResult) {
    yakuList.push({ ...YAKU_LIST[suushiResult] });
  }

  // 字一色
  if (checkTsuuiisou(pattern)) {
    yakuList.push({ ...YAKU_LIST.tsuuiisou });
  }

  // 绿一色
  if (checkRyuuiisou(pattern)) {
    yakuList.push({ ...YAKU_LIST.ryuuiisou });
  }

  // 清老头
  if (checkChinroutou(pattern)) {
    yakuList.push({ ...YAKU_LIST.chinroutou });
  }

  // 九莲宝灯
  if (isMenzen) {
    const chuurenResult = checkChuurenpoutou(pattern, agariTile);
    if (chuurenResult) {
      yakuList.push({ ...YAKU_LIST[chuurenResult] });
    }
  }

  // 四杠子
  if (checkSuukantsu(pattern)) {
    yakuList.push({ ...YAKU_LIST.suukantsu });
  }

  // 如果有役满，不再判定普通役
  if (yakuList.length > 0) {
    return yakuList;
  }

  // ========== 普通役判定 ==========

  // 七对子
  if (pattern.type === 'chiitoitsu') {
    yakuList.push({ ...YAKU_LIST.chiitoitsu });
  }

  // 立直系
  if (situation.isRiichi) {
    if (situation.isDoubleRiichi) {
      yakuList.push({ ...YAKU_LIST.doubleRiichi });
    } else {
      yakuList.push({ ...YAKU_LIST.riichi });
    }

    if (situation.isIppatsu) {
      yakuList.push({ ...YAKU_LIST.ippatsu });
    }
  }

  // 门前清自摸和
  if (isMenzen && isTsumo) {
    yakuList.push({ ...YAKU_LIST.tsumo });
  }

  // 特殊状态役
  if (situation.isRinshan) {
    yakuList.push({ ...YAKU_LIST.rinshan });
  }
  if (situation.isChankan) {
    yakuList.push({ ...YAKU_LIST.chankan });
  }
  if (situation.isHaitei && isTsumo) {
    yakuList.push({ ...YAKU_LIST.haitei });
  }
  if (situation.isHoutei && !isTsumo) {
    yakuList.push({ ...YAKU_LIST.houtei });
  }

  // 平和
  if (isMenzen && checkPinfu(pattern, situation)) {
    yakuList.push({ ...YAKU_LIST.pinfu });
  }

  // 断幺九
  if (checkTanyao(pattern)) {
    yakuList.push({ ...YAKU_LIST.tanyao });
  }

  // 一盃口/二盃口
  if (isMenzen) {
    const iipeikouCount = countIipeikou(pattern);
    if (iipeikouCount === 2) {
      yakuList.push({ ...YAKU_LIST.ryanpeikou });
    } else if (iipeikouCount === 1) {
      yakuList.push({ ...YAKU_LIST.iipeikou });
    }
  }

  // 役牌
  const dragonYaku = checkYakuhaiDragons(pattern);
  for (const yakuId of dragonYaku) {
    yakuList.push({ ...YAKU_LIST[yakuId] });
  }

  const windYaku = checkYakuhaiWinds(pattern, situation);
  for (const yakuId of windYaku) {
    yakuList.push({ ...YAKU_LIST[yakuId] });
  }

  // 三色同顺
  if (checkSanshokuDoujun(pattern)) {
    const yaku = { ...YAKU_LIST.sanshokuDoujun };
    if (!isMenzen) yaku.han = yaku.hanOpen;
    yakuList.push(yaku);
  }

  // 一气通贯
  if (checkIttsu(pattern)) {
    const yaku = { ...YAKU_LIST.ittsu };
    if (!isMenzen) yaku.han = yaku.hanOpen;
    yakuList.push(yaku);
  }

  // 混全带幺九 / 纯全带幺九
  if (checkJunchan(pattern)) {
    const yaku = { ...YAKU_LIST.junchan };
    if (!isMenzen) yaku.han = yaku.hanOpen;
    yakuList.push(yaku);
  } else if (checkChanta(pattern)) {
    const yaku = { ...YAKU_LIST.chanta };
    if (!isMenzen) yaku.han = yaku.hanOpen;
    yakuList.push(yaku);
  }

  // 对对和
  if (checkToitoi(pattern)) {
    yakuList.push({ ...YAKU_LIST.toitoi });
  }

  // 三暗刻
  if (checkSanankou(pattern)) {
    yakuList.push({ ...YAKU_LIST.sanankou });
  }

  // 三色同刻
  if (checkSanshokuDoukou(pattern)) {
    yakuList.push({ ...YAKU_LIST.sanshokuDoukou });
  }

  // 三杠子
  if (checkSankantsu(pattern)) {
    yakuList.push({ ...YAKU_LIST.sankantsu });
  }

  // 小三元
  if (checkShousangen(pattern)) {
    yakuList.push({ ...YAKU_LIST.shousangen });
  }

  // 混老头
  if (checkHonroutou(pattern)) {
    yakuList.push({ ...YAKU_LIST.honroutou });
  }

  // 清一色 / 混一色
  if (checkChinitsu(pattern)) {
    const yaku = { ...YAKU_LIST.chinitsu };
    if (!isMenzen) yaku.han = yaku.hanOpen;
    yakuList.push(yaku);
  } else if (checkHonitsu(pattern)) {
    const yaku = { ...YAKU_LIST.honitsu };
    if (!isMenzen) yaku.han = yaku.hanOpen;
    yakuList.push(yaku);
  }

  return yakuList;
}

/**
 * 计算役种总翻数
 * @param {Array} yakuList - 役种列表
 * @returns {number} 总翻数
 */
function calculateTotalHan(yakuList) {
  return yakuList.reduce((sum, yaku) => sum + yaku.han, 0);
}

module.exports = {
  checkAllYaku,
  calculateTotalHan,
  // 导出单独的检查函数供测试使用
  checkTanyao,
  checkPinfu,
  countIipeikou,
  checkSanshokuDoujun,
  checkIttsu,
  checkChanta,
  checkJunchan,
  checkToitoi,
  checkSanankou,
  checkHonitsu,
  checkChinitsu,
};
