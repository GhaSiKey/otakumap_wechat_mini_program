const api = require('../shared-board/cloud-api');
const checklist = require('../anime-checklist/transform');
const R = require('./ranking-model');

const SOURCES = { SHARED_BOARD: 'shared-board', CHECKLIST: 'anime-checklist' };
const PAGE_PATH = '/packageFeatures/pages/hang-to-la/hang-to-la';
const CHECKLIST_KEY = 'anime_checklist_data';
const LEGACY_BOARD_PREFIX = 'otakumap:shared-board-ranking:v1:';
const LOCAL_SOURCE_ID = 'default';
const SOURCE_COPY = {
  [SOURCES.SHARED_BOARD]: {
    heading: '番剧排行', name: '共享追番板', posterSubtitle: '共享追番板 · 从夯到拉',
  },
  [SOURCES.CHECKLIST]: {
    heading: '从夯到拉', name: '番剧追踪', posterSubtitle: '番剧追踪 · 从夯到拉',
  },
};
const SUBTITLE_HINT = ' · 点封面可换档';

function rankingUrl(source, boardId) {
  const query = 'source=' + encodeURIComponent(source);
  return PAGE_PATH + '?' + query + (source === SOURCES.SHARED_BOARD ? '&boardId=' + encodeURIComponent(boardId || '') : '');
}

function isValidSource(source, boardId) {
  return source === SOURCES.CHECKLIST || (source === SOURCES.SHARED_BOARD && !!boardId);
}

/** 来源层只读取原始番单；排行结果和观看进度始终分开存储。 */
async function loadSource(source, boardId) {
  if (!isValidSource(source, boardId)) throw new Error('invalid ranking source');
  let items;
  let name;
  if (source === SOURCES.CHECKLIST) {
    // 复用追踪页的旧格式读取规则，不回写状态或排序。
    items = checklist.migrateStoredValue(wx.getStorageSync(CHECKLIST_KEY), Date.now()).items;
  } else {
    const result = await api.getBoardDetail(boardId);
    if (!result || !result.ok || !result.data) throw new Error('board unavailable');
    items = result.data.items || [];
    name = result.data.board && result.data.board.name;
  }
  const copy = SOURCE_COPY[source];
  const sourceId = source === SOURCES.CHECKLIST ? LOCAL_SOURCE_ID : boardId;
  return {
    items,
    heading: copy.heading,
    subtitle: (name || copy.name) + SUBTITLE_HINT,
    posterSubtitle: copy.posterSubtitle,
    rankingKey: R.getRankingStorageKey(source, sourceId),
    titleKey: R.getRankingStorageKey(source, sourceId, 'title'),
    legacyKey: source === SOURCES.SHARED_BOARD ? LEGACY_BOARD_PREFIX + boardId : '',
  };
}

module.exports = { SOURCES, PAGE_PATH, CHECKLIST_KEY, SOURCE_COPY, rankingUrl, isValidSource, loadSource };
