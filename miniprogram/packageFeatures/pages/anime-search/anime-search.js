// 番剧搜索页
//
// 两种模式（由 query.mode 决定，见 SEARCH_MODE）：
//   normal — 验收/查看：点条目跳详情页（查得准、选得对的验收）
//   pick   — 选择：从共享板加番/补绑跳入，点条目直接回带 {sourceId,name,cover,totalEp}
//            到来源页并 navigateBack，不进详情页（列表直选）。放送状态列表接口拿不到，故不带。

const { searchAnime } = require('../../utils/anime-meta/cloud-api');
const {
  ERR_MESSAGES,
  EMPTY,
  EP_UNKNOWN_LABEL,
  SEARCH_MODE,
  PICK_EVENT,
  PICK_COPY,
} = require('../../utils/anime-meta/config');

Page({
  data: {
    keyword: '',
    animes: [],
    loading: false,
    searched: false, // 是否已发起过搜索（区分「初始」与「搜了但没结果」）
    hint: EMPTY.INITIAL, // 空态/错误提示文案
    epUnknownLabel: EP_UNKNOWN_LABEL,
    fromCache: false, // 命中缓存标记（验收期显示，方便观察缓存是否生效）
    mode: SEARCH_MODE.NORMAL, // 交互模式：normal 进详情 / pick 直接回带
    isPick: false, // = (mode === pick)，wxml 用它切换列表项右侧箭头/「选择」标签与顶部引导
    pickCopy: PICK_COPY, // pick 模式引导文案（顶部提示 + 列表项动作标签）
  },

  onLoad(query) {
    // 来源页带 mode=pick 时进入选择模式（加番/补绑）；缺省或非法值都当 normal
    const mode = (query && query.mode) === SEARCH_MODE.PICK ? SEARCH_MODE.PICK : SEARCH_MODE.NORMAL;
    this.setData({ mode, isPick: mode === SEARCH_MODE.PICK });
    if (mode === SEARCH_MODE.PICK) {
      wx.setNavigationBarTitle({ title: '选择番剧' });
    }
  },

  onSearchChange(e) {
    this.setData({ keyword: e.detail.value });
  },

  // 提交搜索（t-search 的 submit 或按钮触发）
  async onSearch() {
    const kw = (this.data.keyword || '').trim();
    if (!kw) {
      this.setData({ hint: EMPTY.INITIAL });
      return;
    }
    this.setData({ loading: true, searched: true, hint: EMPTY.SEARCHING, animes: [] });

    const r = await searchAnime(kw);
    console.log('[anime-search] searchAnime 返回', r); // 验收期：控制台可见完整信封（含真实 msg）
    if (!r.ok) {
      const friendly = ERR_MESSAGES[r.code] || ERR_MESSAGES.DEFAULT;
      // 验收期把 code+真实 msg 一并显示，便于定位（接入正式流程后可只留 friendly）
      const hint = r.msg ? `${friendly}\n[${r.code}] ${r.msg}` : friendly;
      this.setData({ loading: false, animes: [], hint });
      return;
    }

    const animes = (r.data && r.data.animes) || [];
    this.setData({
      loading: false,
      animes,
      fromCache: !!(r.data && r.data.cached),
      hint: animes.length ? '' : EMPTY.NO_RESULT,
    });
  },

  // 点结果项：pick 模式直接回带来源页，normal 模式跳详情页
  onTapItem(e) {
    if (this.data.mode === SEARCH_MODE.PICK) {
      this._pickAndBack(e.currentTarget.dataset);
      return;
    }
    // normal：跳详情页（带 animeId + 已知的封面/集数/类型/年份，详情页先渲染再补拉）
    // 类型与年份只在搜索接口有（详情接口无 startDate/episodeCount），必须由列表带入。
    const { id, name, cover, totalep, typedesc, year, startdate } = e.currentTarget.dataset;
    const q = [
      `animeId=${id}`,
      `name=${encodeURIComponent(name || '')}`,
      `cover=${encodeURIComponent(cover || '')}`,
      `totalEp=${totalep || 0}`,
      `typeDesc=${encodeURIComponent(typedesc || '')}`,
      `year=${encodeURIComponent(year || '')}`,
      `startDate=${encodeURIComponent(startdate || '')}`,
    ].join('&');
    wx.navigateTo({ url: `/packageFeatures/pages/anime-search/anime-detail?${q}` });
  },

  // pick 模式：把选中番剧回传来源页并返回。
  // 只带 {sourceId,name,cover,totalEp}——放送状态列表接口无法得到（仅详情有 isOnAir），不带。
  // 回写走 EventChannel（本页由来源页 navigateTo 打开，取 getOpenerEventChannel 单层直通，最稳）。
  _pickAndBack(ds) {
    const totalEp = parseInt(ds.totalep, 10);
    const picked = {
      sourceId: parseInt(ds.id, 10) || null,
      name: ds.name || '',
      cover: ds.cover || '',
      totalEp: Number.isNaN(totalEp) || totalEp <= 0 ? null : totalEp,
    };
    const ch = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (ch && typeof ch.emit === 'function') {
      ch.emit(PICK_EVENT, picked);
    }
    wx.navigateBack();
  },
});
