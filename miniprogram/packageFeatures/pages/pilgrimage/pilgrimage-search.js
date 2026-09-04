// 圣地巡礼入口：用弹弹play 搜索作品，以详情返回的 bgmSubjectId 连接 Anitabi。
// 收藏与最近浏览均为本地数据；未取得映射时仍进入地图页展示明确空态。

const animeApi = require('../../utils/anime-meta/cloud-api');
const { ERR_MESSAGES: ANIME_ERR_MESSAGES } = require('../../utils/anime-meta/config');
const pilgrimageConfig = require('../../utils/pilgrimage/config');
const { defaultStorage } = require('../../utils/pilgrimage/storage');

const SEARCH_COPY = pilgrimageConfig.COPY.SEARCH_PAGE;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function limitSearchKeyword(value) {
  return cleanText(value).slice(0, pilgrimageConfig.THRESHOLD.SEARCH_KEYWORD_MAX);
}

function searchValueFromEvent(event) {
  const detail = event && event.detail;
  if (detail && typeof detail.value === 'string') return detail.value;
  if (typeof detail === 'string') return detail;
  return null;
}

function positiveInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  const text = cleanText(value);
  if (!/^[1-9]\d*$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}

function initialOf(name) {
  const chars = Array.from(cleanText(name));
  return chars.length ? chars[0] : '';
}

function coverErrorKeyOf(scope, id, cover) {
  return `${scope}|${id}|${cleanText(cover)}`;
}

function pruneCoverErrorKeys(errorKeys, groups) {
  const activeKeys = new Set();
  groups.forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (item && item.cover && item.coverKey) activeKeys.add(item.coverKey);
    });
  });
  return Object.keys(errorKeys || {}).reduce((next, key) => {
    if (activeKeys.has(key) && errorKeys[key]) next[key] = true;
    return next;
  }, {});
}

function decorateSavedSubject(subject, scope) {
  const bgmSubjectId = positiveInteger(subject && subject.bgmSubjectId);
  if (!bgmSubjectId) return null;
  const name = cleanText(subject.name) || cleanText(subject.cn) || cleanText(subject.title);
  const cover = cleanText(subject.cover);
  const pointsLength = Number.isSafeInteger(subject.pointsLength) && subject.pointsLength > 0
    ? subject.pointsLength
    : 0;
  return {
    ...subject,
    bgmSubjectId,
    sourceId: positiveInteger(subject.sourceId),
    name,
    cover,
    key: `${scope}-${bgmSubjectId}`,
    coverKey: coverErrorKeyOf(scope, bgmSubjectId, cover),
    initial: initialOf(name),
    openAriaLabel: SEARCH_COPY.OPEN_SUBJECT_ARIA_LABEL(name),
    removeFavoriteAriaLabel: SEARCH_COPY.REMOVE_FAVORITE_ARIA_LABEL(name),
    meta: [
      cleanText(subject.city),
      pointsLength && typeof SEARCH_COPY.SPOT_COUNT === 'function'
        ? SEARCH_COPY.SPOT_COUNT(pointsLength)
        : '',
    ].filter(Boolean).join(pilgrimageConfig.COPY.META_SEPARATOR),
  };
}

function decorateSearchResult(anime) {
  const sourceId = positiveInteger(anime && anime.sourceId);
  if (!sourceId) return null;
  const name = cleanText(anime.name);
  const typeDesc = cleanText(anime.typeDesc);
  const year = cleanText(anime.year);
  const cover = cleanText(anime.cover);
  const totalEp = Number.isSafeInteger(anime.totalEp) && anime.totalEp > 0 ? anime.totalEp : 0;
  return {
    ...anime,
    sourceId,
    name,
    cover,
    typeDesc,
    year,
    totalEp,
    meta: [
      typeDesc,
      year,
      totalEp ? `${totalEp}${SEARCH_COPY.EP_SUFFIX}` : '',
    ].filter(Boolean).join(pilgrimageConfig.COPY.META_SEPARATOR),
    initial: initialOf(name),
    coverKey: coverErrorKeyOf('search', sourceId, cover),
    openAriaLabel: SEARCH_COPY.OPEN_SUBJECT_ARIA_LABEL(name),
  };
}

function encodedQuery(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

Page({
  data: {
    copy: SEARCH_COPY,
    keyword: '',
    animes: [],
    favorites: [],
    recents: [],
    loading: false,
    searched: false,
    hint: '',
    fromCache: false,
    resolvingSourceId: null,
    coverErrorKeys: {},
    searchKeywordMax: pilgrimageConfig.THRESHOLD.SEARCH_KEYWORD_MAX,
  },

  onLoad() {
    this._searchRequestId = 0;
    this._detailRequestId = 0;
    this._activeSearchKeyword = '';
    this._resolvingAnime = false;
    this._navigationPending = false;
    this._unloaded = false;
  },

  onShow() {
    this._detailRequestId += 1;
    this._resolvingAnime = false;
    this._navigationPending = false;
    this.setData({ resolvingSourceId: null });
    this._loadSavedSubjects();
  },

  onUnload() {
    this._unloaded = true;
    this._searchRequestId += 1;
    this._detailRequestId += 1;
  },

  _loadSavedSubjects() {
    const favorites = defaultStorage.getFavoriteSubjects()
      .map((subject) => decorateSavedSubject(subject, 'favorite'))
      .filter(Boolean);
    const favoriteIds = new Set(favorites.map((subject) => subject.bgmSubjectId));
    const recents = defaultStorage.getRecentSubjects()
      .map((subject) => decorateSavedSubject(subject, 'recent'))
      .filter((subject) => subject && !favoriteIds.has(subject.bgmSubjectId));
    const coverErrorKeys = pruneCoverErrorKeys(
      this.data.coverErrorKeys,
      [favorites, recents, this.data.animes]
    );
    this.setData({ favorites, recents, coverErrorKeys });
  },

  onSearchChange(e) {
    const eventValue = searchValueFromEvent(e);
    if (eventValue == null) return;
    const value = limitSearchKeyword(eventValue);
    if (value === this.data.keyword) return;

    // 输入已改变：搜索结果与正在解析的详情都属于旧关键词，不得继续展示或导航。
    this._searchRequestId += 1;
    this._detailRequestId += 1;
    this._activeSearchKeyword = '';
    this._resolvingAnime = false;
    this.setData({
      keyword: value,
      animes: [],
      loading: false,
      searched: false,
      hint: '',
      fromCache: false,
      resolvingSourceId: null,
      coverErrorKeys: pruneCoverErrorKeys(
        this.data.coverErrorKeys,
        [this.data.favorites, this.data.recents, []]
      ),
    });
  },

  async onSearch(e) {
    const eventKeyword = searchValueFromEvent(e);
    const keyword = limitSearchKeyword(eventKeyword == null ? this.data.keyword : eventKeyword);

    if (!keyword) {
      this._searchRequestId += 1;
      this._detailRequestId += 1;
      this._activeSearchKeyword = '';
      this._resolvingAnime = false;
      this.setData({
        keyword: '',
        animes: [],
        loading: false,
        searched: false,
        hint: '',
        fromCache: false,
        resolvingSourceId: null,
        coverErrorKeys: pruneCoverErrorKeys(
          this.data.coverErrorKeys,
          [this.data.favorites, this.data.recents, []]
        ),
      });
      return;
    }

    // t-search 可能为同一次操作连续抛出 submit 与 action-click，避免重复请求。
    if (this.data.loading && this._activeSearchKeyword === keyword) return;

    this._detailRequestId += 1;
    this._resolvingAnime = false;
    const requestId = this._searchRequestId + 1;
    this._searchRequestId = requestId;
    this._activeSearchKeyword = keyword;
    this.setData({
      keyword,
      animes: [],
      loading: true,
      searched: true,
      hint: '',
      fromCache: false,
      resolvingSourceId: null,
      coverErrorKeys: pruneCoverErrorKeys(
        this.data.coverErrorKeys,
        [this.data.favorites, this.data.recents, []]
      ),
    });

    let result;
    try {
      result = await animeApi.searchAnime(keyword);
    } catch (error) {
      result = null;
    }
    if (this._unloaded || requestId !== this._searchRequestId) return;
    this._activeSearchKeyword = '';

    if (!result || !result.ok) {
      this.setData({
        loading: false,
        animes: [],
        hint: ANIME_ERR_MESSAGES[(result && result.code)] || ANIME_ERR_MESSAGES.DEFAULT,
      });
      return;
    }

    const rawAnimes = result.data && Array.isArray(result.data.animes) ? result.data.animes : [];
    const animes = rawAnimes.map(decorateSearchResult).filter(Boolean);
    this.setData({
      loading: false,
      animes,
      fromCache: !!(result.data && result.data.cached),
      hint: animes.length ? '' : SEARCH_COPY.NO_RESULT,
      coverErrorKeys: pruneCoverErrorKeys(
        this.data.coverErrorKeys,
        [this.data.favorites, this.data.recents, animes]
      ),
    });
  },

  async onAnimeTap(e) {
    if (this._navigationPending || this._resolvingAnime) return;
    const sourceId = positiveInteger(e && e.currentTarget && e.currentTarget.dataset.sourceid);
    if (!sourceId) return;

    const anime = this.data.animes.find((item) => item.sourceId === sourceId);
    if (!anime) return;

    const requestId = this._detailRequestId + 1;
    this._detailRequestId = requestId;
    this._resolvingAnime = true;
    this.setData({ resolvingSourceId: sourceId });

    let result;
    try {
      result = await animeApi.getAnimeDetail(sourceId);
    } catch (error) {
      result = null;
    }
    if (this._unloaded || requestId !== this._detailRequestId) return;

    if (!result || !result.ok || !result.data || !result.data.bangumi) {
      this._resolvingAnime = false;
      this.setData({ resolvingSourceId: null });
      this._showError(ANIME_ERR_MESSAGES[(result && result.code)] || ANIME_ERR_MESSAGES.DEFAULT);
      return;
    }

    const detail = result.data.bangumi;
    const bgmSubjectId = positiveInteger(detail.bgmSubjectId);
    this._navigateToMap({
      bgmSubjectId,
      sourceId: positiveInteger(detail.sourceId) || sourceId,
      name: cleanText(detail.name) || anime.name,
      cover: cleanText(detail.cover) || anime.cover,
      unmapped: bgmSubjectId ? undefined : 1,
    });
  },

  onSavedSubjectTap(e) {
    if (this._navigationPending || this._resolvingAnime) return;
    const bgmSubjectId = positiveInteger(e && e.currentTarget && e.currentTarget.dataset.subjectid);
    if (!bgmSubjectId) return;

    const subject = [...this.data.favorites, ...this.data.recents]
      .find((item) => item.bgmSubjectId === bgmSubjectId);
    if (!subject) return;

    this._navigateToMap({
      bgmSubjectId,
      sourceId: subject.sourceId,
      name: subject.name,
      cover: subject.cover,
    });
  },

  onRemoveFavorite(e) {
    const bgmSubjectId = positiveInteger(e && e.currentTarget && e.currentTarget.dataset.subjectid);
    if (!bgmSubjectId) return;
    const remaining = defaultStorage.removeFavoriteSubject(bgmSubjectId);
    const removed = Array.isArray(remaining)
      && !remaining.some((item) => positiveInteger(item && item.bgmSubjectId) === bgmSubjectId);
    if (!removed) {
      this._showToast(SEARCH_COPY.REMOVE_FAVORITE_FAIL, 'none');
      return;
    }
    this._loadSavedSubjects();
    this._showToast(SEARCH_COPY.REMOVE_FAVORITE_SUCCESS, 'success');
  },

  onCoverError(e) {
    const key = cleanText(e && e.currentTarget && e.currentTarget.dataset.key);
    if (!key || this.data.coverErrorKeys[key]) return;
    this.setData({ coverErrorKeys: { ...this.data.coverErrorKeys, [key]: true } });
  },

  _navigateToMap(params) {
    if (this._navigationPending) return;
    this._navigationPending = true;
    const query = encodedQuery(params);
    wx.navigateTo({
      url: `${pilgrimageConfig.PAGE_PATH.MAP}?${query}`,
      fail: () => {
        if (this._unloaded) return;
        this._resolvingAnime = false;
        this._navigationPending = false;
        this.setData({ resolvingSourceId: null });
        this._showError(pilgrimageConfig.ERR_MESSAGES.DEFAULT);
      },
    });
  },

  _showError(title) {
    this._showToast(title, 'none');
  },

  _showToast(title, icon) {
    if (!title) return;
    wx.showToast({ title, icon });
  },
});
