/**
 * 日麻点数计算器 - 统一导出
 */

// 核心引擎
const engine = require('./engine');

// 配置
const tiles = require('./config/tiles');
const yaku = require('./config/yaku');
const fuRules = require('./config/fu-rules');
const scoreTable = require('./config/score-table');
const theme = require('./config/theme');

// 子模块
const parser = require('./parser');
const fuCalculator = require('./fu-calculator');
const yakuChecker = require('./yaku-checker');
const scoreCalculator = require('./score-calculator');

module.exports = {
  // 主要接口
  calculate: engine.calculate,
  calculateFromString: engine.calculateFromString,
  validateHand: engine.validateHand,

  // 工具函数
  parseTiles: tiles.parseTiles,
  parseTile: tiles.parseTile,
  tilesToString: tiles.tilesToString,
  createTile: tiles.createTile,

  // 配置
  YAKU_LIST: yaku.YAKU_LIST,
  THEME: theme.THEME,
  getTileStyle: theme.getTileStyle,
  getLimitColor: theme.getLimitColor,

  // 子模块 (高级用法)
  engine,
  tiles,
  yaku,
  fuRules,
  scoreTable,
  theme,
  parser,
  fuCalculator,
  yakuChecker,
  scoreCalculator,
};
