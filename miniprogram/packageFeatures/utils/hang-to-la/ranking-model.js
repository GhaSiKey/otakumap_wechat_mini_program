const RANKING_TIERS = [
  { id: 'hang', label: '夯', color: '#f27670', tint: '#fff0ed' },
  { id: 'top', label: '顶级', color: '#f2b638', tint: '#fff8e5' },
  { id: 'human', label: '人上人', color: '#477bd9', tint: '#eef4ff' },
  { id: 'npc', label: 'NPC', color: '#8b78c8', tint: '#f3f0ff' },
  { id: 'la', label: '拉', color: '#6c778f', tint: '#eef0f5' },
];
const TIER_IDS = new Set(RANKING_TIERS.map((tier) => tier.id));

const RANKING_UI_CONFIG = {
  tapSuppressMs: 320,
  scrollHintThreshold: 6,
  dragHitSlop: 18,
  dragHint: '移动到目标档位后松手',
  dragOutsideHint: '移到档位或待排区后再松手',
};

const RANKING_POSTER_CONFIG = {
  canvasWidth: 750,
  scale: 2,
  title: '我的番剧排行',
  subtitle: '番剧排行 · 从夯到拉',
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

const RANKING_STORAGE_PREFIX = 'otakumap:ranking:v1:';

function itemId(item) {
  return item && (item.id || item._id);
}

function fallbackFor(itemName, coverFallback) {
  const name = itemName || '番';
  const fallback = { color: '#477bd9', char: name.slice(0, 1) };
  return coverFallback && typeof coverFallback === 'object'
    ? Object.assign(fallback, coverFallback)
    : fallback;
}

function tierIdOf(value) {
  return TIER_IDS.has(value) ? value : null;
}

/**
 * Build the local ranking item shape from either cloud-board or checklist data.
 * Both sources use slightly different identifiers and title fields, so this is
 * deliberately the only place where those source differences are handled.
 */
function normalizeItems(sourceItems, savedItems) {
  const saved = Array.isArray(savedItems) ? savedItems : [];
  const savedById = saved.reduce((map, item) => {
    const id = itemId(item);
    if (id) map[id] = item;
    return map;
  }, {});

  return (Array.isArray(sourceItems) ? sourceItems : [])
    .filter((item) => item && itemId(item) && !item.deleted)
    .map((item) => {
      const id = itemId(item);
      const name = item.name || item.title || '未命名番剧';
      const old = savedById[id] || {};
      return {
        id,
        name,
        cover: item.cover || '',
        coverFallback: fallbackFor(name, item.coverFallback),
        tierId: tierIdOf(old.tierId),
      };
    });
}

function moveItem(items, itemIdValue, tierId) {
  return (Array.isArray(items) ? items : []).map((item) => item.id === itemIdValue
    ? Object.assign({}, item, { tierId: tierIdOf(tierId) })
    : item);
}

function removeItem(items, itemIdValue) {
  return (Array.isArray(items) ? items : []).filter((item) => item.id !== itemIdValue);
}

function serialize(items) {
  return JSON.stringify((Array.isArray(items) ? items : []).map((item) => ({
    id: itemId(item),
    tierId: item.tierId || null,
  })));
}

function deserialize(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && itemId(item)).map((item) => ({
        id: itemId(item),
        tierId: tierIdOf(item.tierId),
      }))
      : [];
  } catch (error) {
    return [];
  }
}

function getTierItems(items, tierId) {
  return (Array.isArray(items) ? items : []).filter((item) => item.tierId === tierId);
}

function getRankingStorageKey(scope, sourceId, suffix) {
  const scopePart = String(scope || 'default').trim() || 'default';
  const sourcePart = String(sourceId || 'default').trim() || 'default';
  const suffixPart = suffix ? ':' + String(suffix).trim() : '';
  return RANKING_STORAGE_PREFIX + scopePart + ':' + sourcePart + suffixPart;
}

module.exports = {
  RANKING_TIERS,
  RANKING_UI_CONFIG,
  RANKING_POSTER_CONFIG,
  RANKING_STORAGE_PREFIX,
  normalizeItems,
  moveItem,
  removeItem,
  serialize,
  deserialize,
  getTierItems,
  getRankingStorageKey,
};
