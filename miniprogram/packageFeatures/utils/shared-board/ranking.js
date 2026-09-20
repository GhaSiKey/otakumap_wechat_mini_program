const RANKING_TIERS = [
  { id: 'hang', label: '夯', color: '#f27670', tint: '#fff0ed' },
  { id: 'top', label: '顶级', color: '#f2b638', tint: '#fff8e5' },
  { id: 'human', label: '人上人', color: '#477bd9', tint: '#eef4ff' },
  { id: 'npc', label: 'NPC', color: '#8b78c8', tint: '#f3f0ff' },
  { id: 'la', label: '拉', color: '#6c778f', tint: '#eef0f5' },
];

const RANKING_UI_CONFIG = {
  scrollHintThreshold: 6,
  dragHitSlop: 18,
  dragHint: '移动到目标档位后松手',
  dragOutsideHint: '移到档位或待排区后再松手',
};

const RANKING_POSTER_CONFIG = {
  canvasWidth: 750,
  scale: 2,
  title: '我的番剧排行',
  subtitle: '共享追番板 · 从夯到拉',
  rankingNote: '排名仅代表个人口味',
  footerTitle: 'OtakuMap 二次元工具箱 · 微信搜一搜 OtakuMap',
  footerCopy: '你的本命，在哪一档？继续排出你的番剧品味',
  wordmarkPath: '/pages/index/assets/otakumap-wordmark.png',
  maxTitleSize: 42,
  minTitleSize: 28,
  topHeight: 160,
  rowGap: 10,
  footerGap: 12,
  footerHeight: 74,
  bottomPadding: 8,
  rowCoverWidth: 76,
  rowCoverHeight: 104,
  rowCoverGap: 12,
  rowCoverGapY: 8,
  rowContentPadding: 8,
  rowMinHeight: 120,
  rowX: 44,
  rowWidth: 662,
  rowLabelWidth: 126,
  coverStartX: 180,
  contentRightX: 706,
  rowColumns: 6,
};

function normalizeItems(sourceItems, savedItems) {
  const saved = Array.isArray(savedItems) ? savedItems : [];
  const savedById = saved.reduce((map, item) => {
    if (item && item.id) map[item.id] = item;
    return map;
  }, {});
  return (sourceItems || []).filter((item) => item && item._id && !item.deleted).map((item) => {
    const old = savedById[item._id] || {};
    return {
      id: item._id,
      name: item.name || '未命名番剧',
      cover: item.cover || '',
      coverFallback: item.coverFallback || { color: '#477bd9', char: (item.name || '番').slice(0, 1) },
      tierId: old.tierId || null,
    };
  });
}

function moveItem(items, itemId, tierId) {
  return items.map((item) => item.id === itemId ? Object.assign({}, item, { tierId: tierId || null }) : item);
}

function removeItem(items, itemId) {
  return items.filter((item) => item.id !== itemId);
}

function serialize(items) {
  return JSON.stringify((items || []).map((item) => ({ id: item.id, tierId: item.tierId || null })));
}

function deserialize(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.id).map((item) => ({ id: item.id, tierId: item.tierId || null })) : [];
  } catch (error) {
    return [];
  }
}

function getTierItems(items, tierId) {
  return (items || []).filter((item) => item.tierId === tierId);
}

module.exports = {
  RANKING_TIERS,
  RANKING_UI_CONFIG,
  RANKING_POSTER_CONFIG,
  normalizeItems,
  moveItem,
  removeItem,
  serialize,
  deserialize,
  getTierItems,
};
