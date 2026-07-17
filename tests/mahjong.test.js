/**
 * 日麻计算核心模块测试
 *
 * 零依赖，用 Node 原生跑：
 *   node tests/mahjong.test.js
 *
 * 麻将模块是纯 CommonJS、不依赖小程序 API，可直接在 Node 下验证。
 * 新增/修改算法后务必跑一遍，作为回归安全网。
 */
const mahjong = require('../miniprogram/packageFeatures/utils/mahjong/index');
const { parseTiles } = require('../miniprogram/packageFeatures/utils/mahjong/config/tiles');
const {
  determineWaitType,
  splitStandardHand,
  tilesToCounts,
} = require('../miniprogram/packageFeatures/utils/mahjong/parser');

// ── 极简断言框架 ──
let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${a}\n     期望: ${e}`);
  }
}

// 计算单一手牌字符串的听牌型（13张手牌 + 1张和牌张）
function waitOf(handStr, agariStr) {
  const counts = tilesToCounts(parseTiles(handStr + agariStr));
  const pats = splitStandardHand(counts);
  const agari = parseTiles(agariStr)[0];
  return [...new Set(pats.map((p) => determineWaitType(p, agari, false)))].join('|');
}

// ============================================================
// 宝牌计数（三维度独立统计，互不重叠，相加得 total）
// 回归 v1.1.1 修复：曾因 countDora 混入赤牌 + 减法补丁算出负数
// ============================================================
// 固定手牌: 234567m 234p 赤5p 67p 9s + 自摸 9s
//   含 2m 一张（表指示 1m 命中）、赤5p 一张、5p（里指示 4p 命中）
const doraClosed = parseTiles('234567m2340p67p9s'); // 0p = 赤5p
const doraBase = {
  hand: { closed: doraClosed, melds: [], agariTile: parseTiles('9s')[0], isTsumo: true },
  situation: { bakaze: 'east', jikaze: 'south', isParent: false, isTsumo: true, honba: 0, kyoutaku: 0 },
};
function doraCountOf(situationPatch, dora) {
  const r = mahjong.calculate({
    ...doraBase,
    situation: { ...doraBase.situation, ...situationPatch },
    dora,
  });
  return r.success ? r.doraCount : { error: r.error };
}

eq('宝牌-仅赤牌无指示',
  doraCountOf({}, { indicators: [], uraIndicators: [] }),
  { dora: 0, uraDora: 0, akaDora: 1, total: 1 });

eq('宝牌-表+赤',
  doraCountOf({}, { indicators: parseTiles('1m'), uraIndicators: [] }),
  { dora: 1, uraDora: 0, akaDora: 1, total: 2 });

eq('宝牌-立直但无里指示',
  doraCountOf({ isRiichi: true }, { indicators: parseTiles('1m'), uraIndicators: [] }),
  { dora: 1, uraDora: 0, akaDora: 1, total: 2 });

eq('宝牌-表+里+赤齐全',
  doraCountOf({ isRiichi: true }, { indicators: parseTiles('1m'), uraIndicators: parseTiles('4p') }),
  { dora: 1, uraDora: 1, akaDora: 1, total: 3 });

eq('宝牌-非立直应忽略里指示',
  doraCountOf({}, { indicators: [], uraIndicators: parseTiles('4p') }),
  { dora: 0, uraDora: 0, akaDora: 1, total: 1 });

// ============================================================
// 符数 / 役种
// ============================================================
const pinfu = mahjong.calculateFromString('234567m234p78s33z', '6s', {
  isTsumo: true, bakaze: 'east', jikaze: 'south',
});
eq('平和自摸-20符', pinfu.success && { fu: pinfu.fu.rounded, han: pinfu.yakuHan }, { fu: 20, han: 2 });

const chiitoi = mahjong.calculateFromString('1122m3344p5566s7z', '7z', {
  isTsumo: false, isRiichi: true, bakaze: 'east', jikaze: 'south',
});
eq('七对子-25符', chiitoi.success && chiitoi.fu.rounded, 25);

// ============================================================
// 听牌型判定
// ============================================================
eq('听牌型-89听7为边张', waitOf('89m999p555s333z11m', '7m'), 'penchan');
eq('听牌型-78听9为两面', waitOf('78m999p555s333z11m', '9m'), 'ryanmen');
eq('听牌型-13听2为嵌张', waitOf('13m999p555s333z11p', '2m'), 'kanchan');
eq('听牌型-12听3为边张', waitOf('12m999p555s333z11p', '3m'), 'penchan');
eq('听牌型-45听3为两面', waitOf('45m999p555s333z11p', '3m'), 'ryanmen');

// ============================================================
// 汇总输出
// ============================================================
console.log('\n日麻核心模块测试');
console.log('─'.repeat(40));
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('─'.repeat(40));
}
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
