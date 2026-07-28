// 番剧详情验收页
//
// 职责：用搜索页传来的 animeId 拉详情，展示大封面/放送状态/每周几更新/简介/分集数。
// 列表已知的封面/番名/集数先即时渲染（秒开），详情接口返回后补齐放送状态等增量字段。

const { getAnimeDetail } = require('../../utils/anime-meta/cloud-api');
const {
  ERR_MESSAGES,
  AIR_STATUS_DISPLAY,
  airStatusOf,
  airDayLabel,
  airDateLabel,
  EP_UNKNOWN_LABEL,
  previewCoverUrl,
  SECTION_TITLES,
  EPISODE_PREVIEW_MAX,
  episodeMoreLabel,
} = require('../../utils/anime-meta/config');

Page({
  data: {
    animeId: 0,
    name: '',
    cover: '',
    totalEp: 0,
    typeDesc: '', // 类型（TV动画/剧场版…），列表带入
    year: '', // 年份，列表带入（详情接口无 startDate）
    airDateText: '', // 首播日期文案（列表带 startDate，详情接口无此字段）
    epUnknownLabel: EP_UNKNOWN_LABEL,
    sectionTitles: SECTION_TITLES,
    // 详情增量（拉取后填充）
    loading: true,
    error: '',
    airStatusText: '',
    airDayText: '',
    intro: '', // 制作信息一行
    summary: '',
    tags: [], // 标签名数组
    episodeTitles: [], // 分集标题（预览截断后）
    episodeMore: '', // 分集折叠提示（超出预览上限时）
    relateds: [], // 相关作品卡 [{sourceId,name,cover,rating}]
    similars: [], // 相似推荐卡
    rating: 0,
  },

  onLoad(query) {
    const animeId = parseInt(query.animeId, 10) || 0;
    // 先用列表传入的已知字段即时渲染，避免白屏
    this.setData({
      animeId,
      name: decodeURIComponent(query.name || ''),
      cover: decodeURIComponent(query.cover || ''),
      totalEp: parseInt(query.totalEp, 10) || 0,
      typeDesc: decodeURIComponent(query.typeDesc || ''),
      year: decodeURIComponent(query.year || ''),
      airDateText: airDateLabel(decodeURIComponent(query.startDate || '')),
    });
    if (animeId) {
      wx.setNavigationBarTitle({ title: decodeURIComponent(query.name || '番剧详情') });
      this._load(animeId);
    } else {
      this.setData({ loading: false, error: ERR_MESSAGES.ERR_INVALID_PARAM });
    }
  },

  async _load(animeId) {
    const r = await getAnimeDetail(animeId);
    if (!r.ok) {
      this.setData({ loading: false, error: ERR_MESSAGES[r.code] || ERR_MESSAGES.DEFAULT });
      return;
    }
    const b = (r.data && r.data.bangumi) || {};
    const airStatus = airStatusOf(b.isOnAir);
    const allTitles = Array.isArray(b.episodeTitles) ? b.episodeTitles : [];
    const previewTitles = allTitles.slice(0, EPISODE_PREVIEW_MAX);
    this.setData({
      loading: false,
      error: '',
      // 详情接口可能带更全的封面/番名，优先用详情的，缺失回退列表传入的
      name: b.name || this.data.name,
      cover: b.cover || this.data.cover,
      rating: b.rating || 0,
      airStatusText: AIR_STATUS_DISPLAY[airStatus],
      airDayText: airDayLabel(b.airDay, b.isOnAir),
      intro: b.intro || '',
      summary: b.summary || '',
      tags: Array.isArray(b.tags) ? b.tags : [],
      episodeTitles: previewTitles,
      episodeMore: episodeMoreLabel(allTitles.length, previewTitles.length),
      relateds: Array.isArray(b.relateds) ? b.relateds : [],
      similars: Array.isArray(b.similars) ? b.similars : [],
    });
  },

  // 点 hero 封面 → 全屏预览（原生 wx.previewImage，支持双指缩放/退出手势）。
  // 注意：previewImage 走 downloadFile 通道，真机需在小程序后台配 assets.anixplayer.net 为
  // downloadFile 合法域名，否则报「不在合法域名列表」。当前图源无更大原图，预览即原封面。
  onTapCover() {
    const url = previewCoverUrl(this.data.cover);
    if (!url) return;
    wx.previewImage({ current: url, urls: [url] });
  },

  // 点相关/相似作品卡 → 跳该番详情（同页复用；这些项无年份/集数，只带已知封面）
  onTapRef(e) {
    const { id, name, cover } = e.currentTarget.dataset;
    if (!id) return;
    const q = [
      `animeId=${id}`,
      `name=${encodeURIComponent(name || '')}`,
      `cover=${encodeURIComponent(cover || '')}`,
    ].join('&');
    wx.navigateTo({ url: `/packageFeatures/pages/anime-search/anime-detail?${q}` });
  },
});
