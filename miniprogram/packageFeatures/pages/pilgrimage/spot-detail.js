const PilgrimageApi = require('../../utils/pilgrimage/cloud-api');
const PilgrimageTransform = require('../../utils/pilgrimage/transform');
const PilgrimageGeo = require('../../utils/pilgrimage/geo');
const PilgrimageConfig = require('../../utils/pilgrimage/config');

const DETAIL_COPY = PilgrimageConfig.COPY.DETAIL_PAGE || Object.freeze({});
const IMAGE_STATE = Object.freeze({
  MISSING: 'missing',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});
const EMPTY_RESULT_CODES = new Set([
  PilgrimageConfig.ERR_CODE.INVALID_PARAM,
  PilgrimageConfig.ERR_CODE.NO_DATA,
  PilgrimageConfig.ERR_CODE.SUBJECT_UNMAPPED,
  PilgrimageConfig.ERR_CODE.SUBJECT_NOT_FOUND,
]);

function safeDecode(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return '';
  try {
    return decodeURIComponent(text).trim();
  } catch (error) {
    return text.trim();
  }
}

function configuredErrorMessage(code) {
  return PilgrimageConfig.ERR_MESSAGES[code]
    || PilgrimageConfig.ERR_MESSAGES.DEFAULT;
}

function formatCoordinate(coordinate) {
  const normalized = PilgrimageGeo.normalizeCoordinate(coordinate);
  if (!normalized) return DETAIL_COPY.COORDINATE_UNKNOWN || '';
  return typeof DETAIL_COPY.COORDINATE === 'function'
    ? DETAIL_COPY.COORDINATE(normalized.latitude, normalized.longitude)
    : '';
}

function buildSubject(summary, fallbackName) {
  const data = summary && typeof summary === 'object' ? summary : {};
  return {
    id: data.id || 0,
    displayName: data.cn || data.title || fallbackName || PilgrimageConfig.COPY.PAGE_TITLE.SPOT_DETAIL,
    city: data.city || '',
    cover: data.cover || '',
  };
}

function decoratePoint(point) {
  if (!point) return null;
  return {
    ...point,
    originalName: point.secondaryName || '',
    episodeTimeText: point.metaLabel || point.episodeLabel || '',
    coordinateText: formatCoordinate(point.geo),
    sourceText: point.origin || DETAIL_COPY.SOURCE_FALLBACK || '',
  };
}

function imagePatch(point) {
  const data = point && typeof point === 'object' ? point : {};
  const previewUrl = typeof data.imagePreview === 'string' ? data.imagePreview.trim() : '';
  const thumbUrl = typeof data.imageThumb === 'string' ? data.imageThumb.trim() : '';
  const displayImageUrl = previewUrl || thumbUrl;
  return {
    displayImageUrl,
    imageState: displayImageUrl ? IMAGE_STATE.LOADING : IMAGE_STATE.MISSING,
  };
}

function shouldShowBackFallback() {
  if (typeof getCurrentPages !== 'function') return true;
  try {
    return getCurrentPages().length <= 1;
  } catch (error) {
    return true;
  }
}

Page({
  data: {
    state: 'loading',
    stateMessage: '',
    copy: DETAIL_COPY,
    bgmSubjectId: 0,
    pointId: '',
    sourceId: '',
    subjectName: '',
    subject: {},
    point: {},
    sameEpisodePoints: [],
    sameEpisodeImageErrors: {},
    displayImageUrl: '',
    imageState: IMAGE_STATE.MISSING,
    showBackFallback: false,
  },

  onLoad(query) {
    this._requestToken = 0;
    this._points = [];

    const params = query || {};
    const bgmSubjectId = PilgrimageApi.normalizeBgmSubjectId(params.bgmSubjectId);
    const pointId = safeDecode(params.pointId);
    const sourceId = safeDecode(params.sourceId);
    const subjectName = safeDecode(params.name);

    this.setData({
      bgmSubjectId: bgmSubjectId || 0,
      pointId,
      sourceId,
      subjectName,
      showBackFallback: shouldShowBackFallback(),
    });

    wx.setNavigationBarTitle({
      title: PilgrimageConfig.COPY.PAGE_TITLE.SPOT_DETAIL,
    });

    if (!bgmSubjectId) {
      this.setData({
        state: 'empty',
        stateMessage: PilgrimageConfig.COPY.EMPTY.NO_MAPPING,
      });
      return;
    }

    if (!pointId) {
      this.setData({
        state: 'empty',
        stateMessage: DETAIL_COPY.POINT_NOT_FOUND,
      });
      return;
    }

    this._load();
  },

  onUnload() {
    this._requestToken += 1;
    this._points = [];
  },

  async _load() {
    const bgmSubjectId = this.data.bgmSubjectId;
    const pointId = this.data.pointId;
    if (!bgmSubjectId || !pointId) return;

    const requestToken = ++this._requestToken;
    this.setData({
      state: 'loading',
      stateMessage: '',
      displayImageUrl: '',
      imageState: IMAGE_STATE.MISSING,
      sameEpisodeImageErrors: {},
    });

    let summaryResult;
    try {
      summaryResult = await PilgrimageApi.getSubjectSummary(bgmSubjectId);
    } catch (error) {
      if (requestToken !== this._requestToken) return;
      this.setData({
        state: 'error',
        stateMessage: configuredErrorMessage(PilgrimageConfig.ERR_CODE.INTERNAL),
      });
      return;
    }

    if (requestToken !== this._requestToken) return;
    if (!summaryResult || !summaryResult.ok) {
      this._showRequestFailure(summaryResult);
      return;
    }

    const summary = summaryResult.data;
    if (!summary || typeof summary !== 'object') {
      this.setData({
        state: 'error',
        stateMessage: configuredErrorMessage(PilgrimageConfig.ERR_CODE.INTERNAL),
      });
      return;
    }
    // 只有数值 0 才表示摘要明确声明没有地点；null/缺失代表总数未知，仍请求详情端点。
    if (summary.pointsLength === 0) {
      this.setData({
        state: 'empty',
        stateMessage: PilgrimageConfig.COPY.EMPTY.NO_POINTS,
      });
      return;
    }

    let pointsResult;
    try {
      pointsResult = await PilgrimageApi.getSubjectPoints(bgmSubjectId);
    } catch (error) {
      if (requestToken !== this._requestToken) return;
      this.setData({
        state: 'error',
        stateMessage: configuredErrorMessage(PilgrimageConfig.ERR_CODE.INTERNAL),
      });
      return;
    }

    if (requestToken !== this._requestToken) return;
    if (!pointsResult || !pointsResult.ok) {
      this._showRequestFailure(pointsResult);
      return;
    }

    const pointsPayload = pointsResult.data;
    const points = pointsPayload && Array.isArray(pointsPayload.points)
      ? pointsPayload.points
      : null;
    if (!points) {
      this.setData({
        state: 'error',
        stateMessage: configuredErrorMessage(PilgrimageConfig.ERR_CODE.INTERNAL),
      });
      return;
    }
    if (!points.length) {
      this.setData({
        state: 'empty',
        stateMessage: PilgrimageConfig.COPY.EMPTY.NO_POINTS,
      });
      return;
    }

    this._points = points;
    const subject = buildSubject(summary, this.data.subjectName);
    const selected = this._buildSelection(pointId);
    if (!selected) {
      this.setData({
        state: 'empty',
        stateMessage: DETAIL_COPY.POINT_NOT_FOUND,
      });
      return;
    }

    this.setData(Object.assign({
      state: 'content',
      stateMessage: '',
      subject,
      point: selected.point,
      sameEpisodePoints: selected.sameEpisodePoints,
      sameEpisodeImageErrors: {},
    }, imagePatch(selected.point)));
    wx.setNavigationBarTitle({
      title: selected.point.displayName || PilgrimageConfig.COPY.PAGE_TITLE.SPOT_DETAIL,
    });
  },

  _showRequestFailure(result) {
    const code = result && result.code;
    this.setData({
      state: EMPTY_RESULT_CODES.has(code) ? 'empty' : 'error',
      stateMessage: configuredErrorMessage(code),
    });
  },

  _buildSelection(pointId) {
    const pointList = PilgrimageTransform.buildPointList(this._points);
    const selectedPoint = pointList.find((point) => point.id === String(pointId));
    if (!selectedPoint) return null;

    return {
      point: decoratePoint(selectedPoint),
      sameEpisodePoints: PilgrimageTransform
        .buildSameEpisodePointList(this._points, String(pointId))
        .map(decoratePoint),
    };
  },

  onRetry() {
    this._load();
  },

  onBack() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    const params = [`bgmSubjectId=${this.data.bgmSubjectId}`];
    if (this.data.sourceId) params.push(`sourceId=${encodeURIComponent(this.data.sourceId)}`);
    const subjectName = (this.data.subject && this.data.subject.displayName) || this.data.subjectName;
    if (subjectName) params.push(`name=${encodeURIComponent(subjectName)}`);
    wx.redirectTo({
      url: `${PilgrimageConfig.PAGE_PATH.MAP}?${params.join('&')}`,
    });
  },

  onImageLoad(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const pointId = String(dataset.pointid || '');
    const imageUrl = String(dataset.url || '');
    const currentPointId = String((this.data.point && this.data.point.id) || '');
    if (!pointId || pointId !== currentPointId || imageUrl !== this.data.displayImageUrl) return;
    this.setData({ imageState: IMAGE_STATE.READY });
  },

  onImageError(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const pointId = String(dataset.pointid || '');
    const failedUrl = String(dataset.url || '');
    const currentPoint = this.data.point || {};
    if (!pointId || pointId !== String(currentPoint.id || '')) return;
    if (!failedUrl || failedUrl !== this.data.displayImageUrl) return;

    const thumbUrl = typeof currentPoint.imageThumb === 'string'
      ? currentPoint.imageThumb.trim()
      : '';
    if (thumbUrl && thumbUrl !== failedUrl) {
      this.setData({
        displayImageUrl: thumbUrl,
        imageState: IMAGE_STATE.LOADING,
      });
      return;
    }

    this.setData({
      displayImageUrl: '',
      imageState: IMAGE_STATE.ERROR,
    });
  },

  onPreviewImage() {
    const url = this.data.displayImageUrl;
    if (!url || this.data.imageState !== IMAGE_STATE.READY) return;
    wx.previewImage({
      current: url,
      urls: [url],
      fail: () => wx.showToast({ title: DETAIL_COPY.PREVIEW_FAIL, icon: 'none' }),
    });
  },

  onSameEpisodeImageError(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const pointKey = String(dataset.pointkey || '');
    const imageUrl = String(dataset.url || '');
    if (!pointKey || !imageUrl || this.data.sameEpisodeImageErrors[pointKey]) return;

    const point = this.data.sameEpisodePoints.find((item) => (
      item.key === pointKey && item.imageThumb === imageUrl
    ));
    if (!point) return;
    this.setData({
      sameEpisodeImageErrors: {
        ...this.data.sameEpisodeImageErrors,
        [pointKey]: true,
      },
    });
  },

  onCopySource() {
    const sourceUrl = this.data.point && this.data.point.originUrl;
    if (!sourceUrl) return;
    wx.setClipboardData({
      data: sourceUrl,
      success: () => wx.showToast({ title: DETAIL_COPY.COPY_SUCCESS, icon: 'success' }),
      fail: () => wx.showToast({ title: DETAIL_COPY.COPY_FAIL, icon: 'none' }),
    });
  },

  onOpenLocation() {
    const point = this.data.point || {};
    const coordinate = PilgrimageGeo.wgs84ToGcj02(point.geo);
    if (!coordinate) {
      wx.showToast({ title: DETAIL_COPY.NAVIGATION_UNAVAILABLE, icon: 'none' });
      return;
    }

    const subjectName = this.data.subject && this.data.subject.displayName;
    const address = [point.episodeTimeText, subjectName]
      .filter(Boolean)
      .join(PilgrimageConfig.COPY.META_SEPARATOR);
    wx.openLocation({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      scale: PilgrimageConfig.THRESHOLD.MAP_FOCUS_SCALE,
      name: point.displayName || '',
      address,
      fail: () => wx.showToast({ title: DETAIL_COPY.NAVIGATION_FAIL, icon: 'none' }),
    });
  },

  onSameEpisodeTap(event) {
    const pointId = String((event.currentTarget.dataset && event.currentTarget.dataset.pointid) || '');
    if (!pointId || pointId === this.data.pointId) return;

    const selected = this._buildSelection(pointId);
    if (!selected) return;
    this.setData(Object.assign({
      pointId,
      point: selected.point,
      sameEpisodePoints: selected.sameEpisodePoints,
      sameEpisodeImageErrors: {},
    }, imagePatch(selected.point)), () => {
      if (typeof wx.pageScrollTo === 'function') {
        wx.pageScrollTo({ scrollTop: 0, duration: 0 });
      }
    });
    wx.setNavigationBarTitle({
      title: selected.point.displayName || PilgrimageConfig.COPY.PAGE_TITLE.SPOT_DETAIL,
    });
  },
});
