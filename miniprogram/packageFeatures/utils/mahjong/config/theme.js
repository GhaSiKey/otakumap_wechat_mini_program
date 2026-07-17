/**
 * UI主题配置
 * 霓虹夜鸦风格
 */

const THEME = {
  // 颜色配置
  colors: {
    // 背景色
    bgPrimary: '#0a0a14',
    bgSecondary: '#141428',
    bgGlass: 'rgba(255, 255, 255, 0.05)',
    bgGlassBorder: 'rgba(255, 255, 255, 0.1)',

    // 霓虹色
    neonPurple: '#9d4edd',
    neonPink: '#ff6b9d',
    neonCyan: '#00d4ff',
    neonGold: '#ffd93d',
    neonGreen: '#00ff88',

    // 文字色
    textPrimary: '#ffffff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textMuted: 'rgba(255, 255, 255, 0.4)',
    textDanger: '#ff4757',
    textSuccess: '#2ed573',

    // 状态色
    active: '#9d4edd',
    inactive: 'rgba(255, 255, 255, 0.2)',
    disabled: 'rgba(255, 255, 255, 0.1)',
  },

  // 牌面配色
  tiles: {
    m: {
      name: '万',
      bg: '#1e3a5f',
      bgGradient: 'linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%)',
      text: '#ffd93d',
      border: 'rgba(255, 217, 61, 0.3)',
    },
    p: {
      name: '筒',
      bg: '#3d1e1e',
      bgGradient: 'linear-gradient(135deg, #3d1e1e 0%, #4d2e2e 100%)',
      text: '#ff6b9d',
      border: 'rgba(255, 107, 157, 0.3)',
    },
    s: {
      name: '索',
      bg: '#1e3d2f',
      bgGradient: 'linear-gradient(135deg, #1e3d2f 0%, #2e4d3f 100%)',
      text: '#00d4ff',
      border: 'rgba(0, 212, 255, 0.3)',
    },
    z: {
      name: '字',
      bg: '#2d2d3d',
      bgGradient: 'linear-gradient(135deg, #2d2d3d 0%, #3d3d4d 100%)',
      text: '#ffd93d',
      border: 'rgba(255, 217, 61, 0.3)',
    },
    // 赤牌特殊样式
    red: {
      bg: '#4a1a1a',
      bgGradient: 'linear-gradient(135deg, #4a1a1a 0%, #6a2a2a 100%)',
      text: '#ff4757',
      border: 'rgba(255, 71, 87, 0.5)',
      glow: '0 0 10px rgba(255, 71, 87, 0.5)',
    },
  },

  // 特效配置
  effects: {
    glassBlur: '10px',
    neonGlow: '0 0 10px',
    neonGlowStrong: '0 0 20px',
    borderRadius: '12rpx',
    borderRadiusLarge: '20rpx',
    transition: 'all 0.3s ease',
  },

  // 字体配置
  fonts: {
    primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"SF Mono", "Monaco", "Inconsolata", monospace',
  },

  // 尺寸配置
  sizes: {
    // 牌尺寸
    tileWidth: '60rpx',
    tileHeight: '80rpx',
    tileWidthLarge: '80rpx',
    tileHeightLarge: '106rpx',

    // 间距
    spacingXs: '8rpx',
    spacingSm: '16rpx',
    spacingMd: '24rpx',
    spacingLg: '32rpx',
    spacingXl: '48rpx',
  },

  // 满贯等级配色
  limitColors: {
    mangan: '#ffd93d',
    haneman: '#ff9f43',
    baiman: '#ff6b9d',
    sanbaiman: '#9d4edd',
    yakuman: '#00d4ff',
    doubleYakuman: '#00ff88',
  },

  // 役种分类配色
  yakuColors: {
    normal: '#ffffff',
    special: '#ffd93d',
    yakuman: '#00d4ff',
  },
};

/**
 * 获取牌面样式
 * @param {string} suit - 花色
 * @param {boolean} isRed - 是否赤牌
 * @returns {Object} 样式对象
 */
function getTileStyle(suit, isRed = false) {
  if (isRed) {
    return THEME.tiles.red;
  }
  return THEME.tiles[suit] || THEME.tiles.z;
}

/**
 * 获取满贯等级颜色
 * @param {string} limitName - 满贯等级名称
 * @returns {string} 颜色值
 */
function getLimitColor(limitName) {
  const colorMap = {
    满贯: THEME.limitColors.mangan,
    跳满: THEME.limitColors.haneman,
    倍满: THEME.limitColors.baiman,
    三倍满: THEME.limitColors.sanbaiman,
    役满: THEME.limitColors.yakuman,
    双倍役满: THEME.limitColors.doubleYakuman,
  };
  return colorMap[limitName] || THEME.colors.textPrimary;
}

module.exports = {
  THEME,
  getTileStyle,
  getLimitColor,
};
