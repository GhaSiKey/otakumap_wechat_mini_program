// 番剧搜索验收页
//
// 职责：输入番名 → 调 animeMeta 云函数搜索 → 列表展示候选（封面/番名/类型/年份/集数/评分）
//       → 点某条跳详情页。本页只做「查得准、选得对」的验收，不接共享板加番。

const { searchAnime } = require('../../utils/anime-meta/cloud-api');
const { ERR_MESSAGES, EMPTY, EP_UNKNOWN_LABEL } = require('../../utils/anime-meta/config');

Page({
  data: {
    keyword: '',
    animes: [],
    loading: false,
    searched: false, // 是否已发起过搜索（区分「初始」与「搜了但没结果」）
    hint: EMPTY.INITIAL, // 空态/错误提示文案
    epUnknownLabel: EP_UNKNOWN_LABEL,
    fromCache: false, // 命中缓存标记（验收期显示，方便观察缓存是否生效）
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

  // 点结果项 → 跳详情页（带 animeId + 已知的封面/集数/类型/年份，详情页先渲染再补拉）
  // 类型与年份只在搜索接口有（详情接口无 startDate/episodeCount），必须由列表带入。
  onTapItem(e) {
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
});
