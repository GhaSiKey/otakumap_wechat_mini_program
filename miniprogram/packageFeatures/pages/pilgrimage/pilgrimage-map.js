/**
 * 圣地巡礼地图页
 *
 * 只消费搜索页已解析出的 Bangumi subject id。没有映射时直接进入空态；
 * 页面不会按标题猜测映射，也不会把弹弹play bangumiId 当作 Bangumi id。
 */
const Api = require('../../utils/pilgrimage/cloud-api');
const C = require('../../utils/pilgrimage/config');
const Geo = require('../../utils/pilgrimage/geo');
const Storage = require('../../utils/pilgrimage/storage');
const T = require('../../utils/pilgrimage/transform');

const STATE = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  EMPTY: 'empty',
  ERROR: 'error',
});

const VIEW_MODE = Object.freeze({
  MAP: 'map',
  LIST: 'list',
});

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeDecode(value) {
  const text = cleanText(value);
  if (!text) return '';
  try {
    return decodeURIComponent(text).trim();
  } catch (error) {
    return text;
  }
}

function queryFlag(value) {
  if (value === true) return true;
  const normalized = cleanText(value).toLocaleLowerCase();
  return normalized === '1' || normalized === 'true';
}

function limitKeyword(value) {
  return String(value == null ? '' : value).slice(0, C.THRESHOLD.SEARCH_KEYWORD_MAX);
}

function firstCharacter(value) {
  const characters = Array.from(cleanText(value));
  return characters.length ? characters[0] : '';
}

function eventValue(event, fallback) {
  const detail = event && event.detail;
  if (detail && typeof detail.value === 'string') return detail.value;
  if (typeof detail === 'string') return detail;
  return typeof fallback === 'string' ? fallback : '';
}

function isNoDataCode(code) {
  return code === C.ERR_CODE.NO_DATA || code === C.ERR_CODE.SUBJECT_NOT_FOUND;
}

function errorMessageOf(result) {
  const code = result && result.code;
  return C.ERR_MESSAGES[code] || C.ERR_MESSAGES.DEFAULT;
}

function normalizedMapScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return C.THRESHOLD.MAP_DEFAULT_SCALE;
  }
  return Math.min(C.THRESHOLD.MAP_MAX_SCALE, Math.max(C.THRESHOLD.MAP_MIN_SCALE, value));
}

function normalizedSummary(raw, fallback) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Api.normalizeBgmSubjectId(raw.id);
  if (!id || id !== fallback.bgmSubjectId) return null;
  const cn = cleanText(raw.cn);
  const title = cleanText(raw.title);
  const displayName = cn || cleanText(fallback.name) || title;
  const pointsLength = Number.isSafeInteger(raw.pointsLength) && raw.pointsLength >= 0
    ? raw.pointsLength
    : null;
  const imagesLength = Number.isSafeInteger(raw.imagesLength) && raw.imagesLength >= 0
    ? raw.imagesLength
    : 0;
  const entryCover = cleanText(fallback.cover);
  const anitabiCover = cleanText(raw.cover);
  return {
    bgmSubjectId: id,
    sourceId: fallback.sourceId,
    name: displayName,
    cn,
    title,
    displayName,
    initial: firstCharacter(displayName),
    city: cleanText(raw.city),
    // 入口来自弹弹play，国内可用性通常优于 Anitabi 图片域名；后者只作加载失败兜底。
    cover: entryCover || anitabiCover,
    fallbackCover: entryCover && anitabiCover && entryCover !== anitabiCover ? anitabiCover : '',
    center: Geo.normalizeCoordinate(raw.center),
    zoom: normalizedMapScale(raw.zoom),
    pointsLength,
    imagesLength,
  };
}

function storageSubject(subject) {
  if (!subject) return null;
  return {
    bgmSubjectId: subject.bgmSubjectId,
    sourceId: subject.sourceId,
    name: subject.displayName,
    cn: subject.cn,
    title: subject.title,
    cover: subject.cover,
    city: subject.city,
    pointsLength: subject.pointsLength,
    imagesLength: subject.imagesLength,
  };
}

Page({
  data: {
    copy: C.COPY.MAP_PAGE,
    state: STATE.LOADING,
    emptyMessage: '',
    errorMessage: '',

    bgmSubjectId: null,
    sourceId: null,
    subject: null,
    coverUrl: '',
    coverError: false,
    pointImageErrors: {},
    isFavorite: false,
    countText: '',
    filteredCountText: '',
    isPartial: false,

    placeKeyword: '',
    placeKeywordMax: C.THRESHOLD.SEARCH_KEYWORD_MAX,
    hasActiveFilter: false,
    selectedEpisodeKey: C.EPISODE.ALL_KEY,
    episodeOptions: [],
    viewMode: VIEW_MODE.MAP,
    filteredPoints: [],
    selectedPoint: null,

    mapCenter: C.MAP.DEFAULT_CENTER,
    mapScale: C.THRESHOLD.MAP_DEFAULT_SCALE,
    markers: [],
    includePoints: [],
  },

  onLoad(query) {
    this._destroyed = false;
    this._loadSeq = 0;
    this._rawPoints = [];
    this._selectedPointKey = '';
    this._visiblePointByKey = new Map();
    this._markerPointById = new Map();
    this._mapContext = null;
    this._clusterInitialized = false;
    this._coverFallbackUrl = '';

    const source = query || {};
    const bgmSubjectId = Api.normalizeBgmSubjectId(source.bgmSubjectId);
    const sourceId = Api.normalizeBgmSubjectId(source.sourceId);
    this._entry = {
      bgmSubjectId,
      sourceId,
      name: safeDecode(source.name),
      cover: safeDecode(source.cover),
    };

    if (queryFlag(source.unmapped) || !bgmSubjectId) {
      this.setData({
        state: STATE.EMPTY,
        emptyMessage: C.COPY.EMPTY.NO_MAPPING,
        bgmSubjectId: null,
        sourceId,
      });
      return;
    }

    this.setData({ bgmSubjectId, sourceId });
    this._load();
  },

  onShow() {
    const subject = storageSubject(this.data.subject);
    if (!subject) return;
    this.setData({ isFavorite: Storage.isFavoriteSubject(subject.bgmSubjectId) });
  },

  onUnload() {
    this._destroyed = true;
    this._loadSeq += 1;
  },

  _isCurrentLoad(sequence) {
    return !this._destroyed && sequence === this._loadSeq;
  },

  _setLoadFailure(result) {
    if (result && result.code === C.ERR_CODE.SUBJECT_UNMAPPED) {
      this.setData({ state: STATE.EMPTY, emptyMessage: C.COPY.EMPTY.NO_MAPPING });
      return;
    }
    if (isNoDataCode(result && result.code)) {
      this.setData({ state: STATE.EMPTY, emptyMessage: C.COPY.EMPTY.NO_POINTS });
      return;
    }
    this.setData({ state: STATE.ERROR, errorMessage: errorMessageOf(result) });
  },

  async _load() {
    const bgmSubjectId = this._entry && this._entry.bgmSubjectId;
    if (!bgmSubjectId) {
      this.setData({ state: STATE.EMPTY, emptyMessage: C.COPY.EMPTY.NO_MAPPING });
      return;
    }

    const sequence = this._loadSeq + 1;
    this._loadSeq = sequence;
    this._rawPoints = [];
    this._selectedPointKey = '';
    this._coverFallbackUrl = '';
    this.setData({
      state: STATE.LOADING,
      emptyMessage: '',
      errorMessage: '',
      selectedPoint: null,
      coverUrl: '',
      coverError: false,
      pointImageErrors: {},
    });

    const summaryResult = await Api.getSubjectSummary(bgmSubjectId);
    if (!this._isCurrentLoad(sequence)) return;
    if (!summaryResult || !summaryResult.ok) {
      this._setLoadFailure(summaryResult);
      return;
    }

    const subject = normalizedSummary(summaryResult.data, this._entry);
    if (!subject) {
      this.setData({ state: STATE.ERROR, errorMessage: C.COPY.MALFORMED_RESPONSE });
      return;
    }

    // 成功解析作品摘要即记入最近浏览；地点接口失败不影响下次从最近浏览重试。
    Storage.recordRecentSubject(storageSubject(subject));

    // pointsLength=0 是上游摘要对“确实无地点”的明确声明，无需再请求详情端点。
    if (subject.pointsLength === 0) {
      this.setData({ state: STATE.EMPTY, emptyMessage: C.COPY.EMPTY.NO_POINTS });
      return;
    }

    const isFavorite = Storage.isFavoriteSubject(subject.bgmSubjectId);
    // 从搜索结果重新进入已收藏作品时，用当前入口封面刷新存量收藏元数据。
    // 这样旧版本曾保存的不可用 Anitabi 封面会逐步迁移为弹弹play封面。
    if (isFavorite) Storage.saveFavoriteSubject(storageSubject(subject));
    this._coverFallbackUrl = subject.fallbackCover;

    const pointsResult = await Api.getSubjectPoints(bgmSubjectId);
    if (!this._isCurrentLoad(sequence)) return;
    if (!pointsResult || !pointsResult.ok) {
      this._setLoadFailure(pointsResult);
      return;
    }

    const payload = pointsResult.data;
    const points = payload && Array.isArray(payload.points) ? payload.points : null;
    if (!points) {
      this.setData({ state: STATE.ERROR, errorMessage: C.COPY.MALFORMED_RESPONSE });
      return;
    }
    if (!points.length) {
      this.setData({ state: STATE.EMPTY, emptyMessage: C.COPY.EMPTY.NO_POINTS });
      return;
    }

    this._rawPoints = points;
    const reportedReturnedCount = Number.isSafeInteger(payload.returnedCount) && payload.returnedCount >= 0
      ? payload.returnedCount
      : null;
    const returnedCount = reportedReturnedCount === points.length ? reportedReturnedCount : points.length;
    const declaredTotal = Number.isSafeInteger(subject.pointsLength) ? subject.pointsLength : null;
    const truncated = payload.truncated === true;
    const hasLargerDeclaredTotal = declaredTotal !== null && declaredTotal > returnedCount;
    const isPartial = truncated || hasLargerDeclaredTotal;
    const episodeOptions = T.buildEpisodeOptions(points);
    const markers = T.buildMarkers(points, {
      keyword: '',
      episodeKey: C.EPISODE.ALL_KEY,
    });
    const firstMarker = markers.length ? markers[0] : null;
    const summaryCenter = Geo.wgs84ToGcj02(subject.center);
    const mapCenter = summaryCenter || (firstMarker && {
      latitude: firstMarker.latitude,
      longitude: firstMarker.longitude,
    }) || C.MAP.DEFAULT_CENTER;

    const filterPatch = this._buildFilterPatch('', C.EPISODE.ALL_KEY);
    this.setData(Object.assign({
      state: STATE.READY,
      subject,
      coverUrl: subject.cover,
      isFavorite,
      countText: isPartial
        ? (hasLargerDeclaredTotal
          ? C.COPY.MAP_PAGE.PARTIAL_COUNT(returnedCount, declaredTotal)
          : C.COPY.MAP_PAGE.TRUNCATED_COUNT(returnedCount))
        : C.COPY.MAP_PAGE.COUNT(returnedCount),
      isPartial,
      episodeOptions,
      placeKeyword: '',
      selectedEpisodeKey: C.EPISODE.ALL_KEY,
      mapCenter,
      mapScale: subject.zoom,
    }, filterPatch));
  },

  _decoratePoint(point) {
    return Object.assign({}, point, {
      episodeTimeText: point.metaLabel,
      sourceText: point.origin || point.secondaryName,
    });
  },

  _buildFilterPatch(keyword, episodeKey) {
    const filters = { keyword, episodeKey };
    const visibleRaw = T.deriveVisiblePoints(this._rawPoints, filters);
    const filteredPoints = visibleRaw
      .map((point, index) => T.buildPointViewModel(point, index))
      .map((point) => this._decoratePoint(point));
    const rawMarkers = T.buildMarkers(this._rawPoints, filters);
    const coordinatePoints = filteredPoints.filter((point) => point.hasCoordinate);
    const markers = rawMarkers.map((marker) => Object.assign({}, marker, {
      joinCluster: true,
    }));

    this._visiblePointByKey = new Map(filteredPoints.map((point) => [point.key, point]));
    this._markerPointById = new Map(markers.map((marker, index) => [marker.id, coordinatePoints[index]]));

    let selectedPoint = null;
    if (this._selectedPointKey) {
      selectedPoint = this._visiblePointByKey.get(this._selectedPointKey) || null;
      if (!selectedPoint) this._selectedPointKey = '';
    }

    const patch = {
      placeKeyword: keyword,
      selectedEpisodeKey: episodeKey,
      hasActiveFilter: !!cleanText(keyword) || episodeKey !== C.EPISODE.ALL_KEY,
      filteredPoints,
      filteredCountText: C.COPY.MAP_PAGE.FILTER_COUNT(filteredPoints.length),
      selectedPoint,
      markers,
      includePoints: markers.map((marker) => ({
        latitude: marker.latitude,
        longitude: marker.longitude,
      })),
    };
    // 筛选结果存在但都没有可用坐标时，保留数据并直接展示列表，避免给用户一张空地图。
    if (filteredPoints.length && !markers.length) patch.viewMode = VIEW_MODE.LIST;
    return patch;
  },

  _applyFilters(keyword, episodeKey) {
    const wasMapRendered = this.data.viewMode === VIEW_MODE.MAP && this.data.filteredPoints.length > 0;
    const patch = this._buildFilterPatch(keyword, episodeKey);
    const nextViewMode = patch.viewMode || this.data.viewMode;
    const willMapRender = nextViewMode === VIEW_MODE.MAP && patch.filteredPoints.length > 0;
    if (wasMapRendered !== willMapRender) this._resetMapRuntime();
    this.setData(patch);
  },

  _showToast(title) {
    if (!title) return;
    wx.showToast({ title, icon: 'none' });
  },

  _resetMapRuntime() {
    this._mapContext = null;
    this._clusterInitialized = false;
  },

  _getMapContext() {
    if (!this._mapContext && typeof wx.createMapContext === 'function') {
      this._mapContext = wx.createMapContext('pilgrimageMap', this);
    }
    return this._mapContext;
  },

  _openPoint(point) {
    if (!point || !point.id || !this.data.bgmSubjectId) {
      this._showToast(C.COPY.DETAIL_PAGE.POINT_NOT_FOUND);
      return;
    }
    const params = [
      `bgmSubjectId=${encodeURIComponent(String(this.data.bgmSubjectId))}`,
      `pointId=${encodeURIComponent(String(point.id))}`,
    ];
    if (this.data.sourceId) params.push(`sourceId=${encodeURIComponent(String(this.data.sourceId))}`);
    if (this.data.subject && this.data.subject.displayName) {
      params.push(`name=${encodeURIComponent(this.data.subject.displayName)}`);
    }
    wx.navigateTo({ url: `${C.PAGE_PATH.SPOT_DETAIL}?${params.join('&')}` });
  },

  onRetry() {
    this._load();
  },

  onBackToSearch() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: C.PAGE_PATH.SEARCH });
  },

  onSubjectCoverError(event) {
    const failedUrl = cleanText(
      event && event.currentTarget && event.currentTarget.dataset
        && event.currentTarget.dataset.coverurl
    );
    // 忽略旧 image 节点延迟到达的 error，避免误伤已经切换成功的兜底封面。
    if (failedUrl && failedUrl !== this.data.coverUrl) return;
    const fallbackUrl = cleanText(this._coverFallbackUrl);
    this._coverFallbackUrl = '';
    if (fallbackUrl && fallbackUrl !== this.data.coverUrl) {
      this.setData({ coverUrl: fallbackUrl, coverError: false });
      return;
    }
    this.setData({ coverError: true });
  },

  onPointImageError(event) {
    const pointKey = cleanText(
      event && event.currentTarget && event.currentTarget.dataset
        && event.currentTarget.dataset.pointkey
    );
    if (!pointKey || this.data.pointImageErrors[pointKey]) return;
    this.setData({
      pointImageErrors: Object.assign({}, this.data.pointImageErrors, { [pointKey]: true }),
    });
  },

  onToggleFavorite() {
    const subject = storageSubject(this.data.subject);
    if (!subject) return;
    const result = Storage.toggleFavoriteSubject(subject);
    if (!result || typeof result.isFavorite !== 'boolean') {
      this._showToast(C.COPY.MAP_PAGE.FAVORITE_FAIL);
      return;
    }
    this.setData({ isFavorite: result.isFavorite });
    if (result.ok !== true) {
      this._showToast(C.COPY.MAP_PAGE.FAVORITE_FAIL);
      return;
    }
    this._showToast(result.isFavorite ? C.COPY.MAP_PAGE.FAVORITED : C.COPY.MAP_PAGE.UNFAVORITED);
  },

  onPlaceSearchChange(event) {
    const keyword = limitKeyword(eventValue(event, this.data.placeKeyword));
    this._applyFilters(keyword, this.data.selectedEpisodeKey);
  },

  onPlaceSearchSubmit(event) {
    const keyword = limitKeyword(eventValue(event, this.data.placeKeyword));
    this._applyFilters(keyword, this.data.selectedEpisodeKey);
  },

  onPlaceSearchClear() {
    this._applyFilters('', this.data.selectedEpisodeKey);
  },

  onEpisodeTap(event) {
    const episodeKey = cleanText(event && event.currentTarget && event.currentTarget.dataset.key)
      || C.EPISODE.ALL_KEY;
    this._applyFilters(this.data.placeKeyword, episodeKey);
  },

  onResetFilters() {
    this._selectedPointKey = '';
    this._applyFilters('', C.EPISODE.ALL_KEY);
  },

  onViewModeTap(event) {
    const mode = event && event.currentTarget && event.currentTarget.dataset.mode;
    if (mode !== VIEW_MODE.MAP && mode !== VIEW_MODE.LIST) return;
    if (mode === this.data.viewMode) return;
    if (mode === VIEW_MODE.MAP && !this.data.markers.length) return;
    this._resetMapRuntime();
    this.setData({ viewMode: mode }, () => {
      if (mode === VIEW_MODE.MAP) this.onFitAll();
    });
  },

  onMarkerTap(event) {
    const markerId = Number(event && event.detail && event.detail.markerId);
    const point = this._markerPointById.get(markerId);
    if (!point) return;
    this._selectedPointKey = point.key;
    const mapCoordinate = Geo.wgs84ToGcj02(point.geo);
    const patch = { selectedPoint: point };
    if (mapCoordinate) {
      patch.mapCenter = mapCoordinate;
      patch.mapScale = C.THRESHOLD.MAP_FOCUS_SCALE;
    }
    this.setData(patch);
  },

  onSelectedPointTap() {
    this._openPoint(this.data.selectedPoint);
  },

  onPointRowTap(event) {
    const pointKey = cleanText(event && event.currentTarget && event.currentTarget.dataset.pointkey);
    const pointId = cleanText(event && event.currentTarget && event.currentTarget.dataset.pointid);
    const byKey = pointKey && this._visiblePointByKey.get(pointKey);
    const point = byKey || this.data.filteredPoints.find((item) => item.id === pointId);
    this._openPoint(point);
  },

  onFitAll() {
    const points = this.data.includePoints;
    if (!Array.isArray(points) || !points.length) return;
    if (points.length === 1) {
      this.setData({
        mapCenter: points[0],
        mapScale: C.THRESHOLD.MAP_FOCUS_SCALE,
      });
      return;
    }
    const context = this._getMapContext();
    if (context && typeof context.includePoints === 'function') {
      context.includePoints({ points });
    }
  },

  onMapUpdated() {
    if (this._clusterInitialized || this.data.markers.length < 2) return;
    const context = this._getMapContext();
    if (!context || typeof context.initMarkerCluster !== 'function') return;
    this._clusterInitialized = true;
    context.initMarkerCluster({ enableDefaultStyle: true, zoomOnClick: true });
  },

  onCopyFullMapLink() {
    const url = C.URL && typeof C.URL.anitabiSubjectMap === 'function'
      ? C.URL.anitabiSubjectMap(this.data.bgmSubjectId)
      : '';
    if (!url || typeof wx.setClipboardData !== 'function') {
      this._showToast(C.COPY.MAP_PAGE.COPY_FAIL);
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => this._showToast(C.COPY.MAP_PAGE.COPY_SUCCESS),
      fail: () => this._showToast(C.COPY.MAP_PAGE.COPY_FAIL),
    });
  },
});
