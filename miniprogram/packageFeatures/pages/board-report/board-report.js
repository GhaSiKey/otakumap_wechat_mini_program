// 追番小结 / 周报页 —— 快照式报告，五块：头部/变化区/名场面/累计/个人小结
//
// 数据源：getBoardReport 云函数（服务端取全事件+items，复用 transform.buildReportModel 一次算好）。
//   nowMs 传客户端 Date.now()：streak 判「今天」需可信本地时钟，云机房时区不可信。
// 页面职责：把结构化数据（方向 key、计数、dayIndex）套 REPORT_COPY 模板拼成展示串，保持 wxml 干净。
// 数据边界：A 类快照（累计/个人）任何板都有；B 类行为（变化区/名场面）仅埋点后有，
//   hasBehaviorData 控制显隐 + footnote 说明起记时间。
const api = require('../../utils/shared-board/cloud-api');
const T = require('../../utils/shared-board/transform');
const { REPORT_COPY, MEMBER_COLORS, AIR_DAY_LABELS, ERR } = require('../../utils/shared-board/config');

// 占位符插值：{key} → vars[key]。回调式 replace，避免番名含 $&/$1 被当特殊模式（与历史页同一约定）
function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

Page({
  data: {
    copy: REPORT_COPY,
    colors: MEMBER_COLORS,
    boardId: '',
    loading: true,
    failed: false,
    // 展示视图（_buildView 产出，wxml 直接消费）
    view: null,
    // 封面图加载失败的 itemId 集合：failed 后回退首字色块，不再重试（同主页番卡兜底）
    coverErrorIds: {},
  },

  onLoad(query) {
    const boardId = (query && query.boardId) || '';
    if (!boardId) {
      this.setData({ loading: false, failed: true });
      wx.showToast({ title: '缺少板信息', icon: 'none' });
      return;
    }
    this.setData({ boardId });
    this._load();
  },

  onPullDownRefresh() {
    if (!this.data.boardId) {
      wx.stopPullDownRefresh();
      return;
    }
    this._load().then(() => wx.stopPullDownRefresh());
  },

  async _load() {
    this.setData({ loading: true, failed: false });
    // nowMs 传客户端时钟（服务端时区不可信，streak 判「今天」要用它）
    const r = await api.getBoardReport(this.data.boardId, Date.now());
    if (!r.ok || !r.data) {
      console.error('[board-report] getBoardReport 失败', r);
      wx.showToast({ title: r.code === ERR.NOT_MEMBER ? REPORT_COPY.NOT_MEMBER : REPORT_COPY.LOAD_FAIL, icon: 'none' });
      this.setData({ loading: false, failed: true });
      return;
    }
    const view = this._buildView(r.data.report, r.data.me, r.data.peer);
    this.setData({ loading: false, view });
  },

  // dayIndex → 「M月D日」（复用 transform.dayIndexToMD + DATE_MD 模板）
  _mdOf(dayIndex, tz) {
    const md = T.dayIndexToMD(dayIndex, tz);
    return fillTemplate(REPORT_COPY.DATE_MD, md);
  },

  // 封面图加载失败：标记该 itemId，wxml 转走首字色块兜底（cloud:// 已在数据层净化，此处兜 https 失效）
  onCoverError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.coverErrorIds[id]) return;
    this.setData({ [`coverErrorIds.${id}`]: true });
  },

  // 结构化 report → wxml 直接消费的展示串。措辞全走 REPORT_COPY，零硬编码。
  _buildView(report, me, peer) {
    const tz = report.tzOffsetMinutes;
    const meName = (me && me.nickname) || REPORT_COPY.ME_DEFAULT;
    const peerName = (peer && peer.nickname) || REPORT_COPY.PEER_DEFAULT;

    // ② 变化区（仅 hasBehaviorData && !emptyWindow）
    // 主体从「两个大数字」改成「推得最猛的番」清单——每行封面 + 番名 + 双人集数，让数字挂到真实作品上。
    const recentItems = (report.recentItems || []).map((r) => ({
      itemId: r.itemId,
      name: r.name,
      cover: r.cover,
      coverFallback: r.coverFallback,
      meText: fillTemplate(REPORT_COPY.RECENT_ROW_ME, { n: r.me }),
      peerText: fillTemplate(REPORT_COPY.RECENT_ROW_PEER, { n: r.peer }),
      unit: REPORT_COPY.RECENT_ROW_UNIT,
      hasPeer: !!peer,
    }));
    const recentTotal = report.recent.me + report.recent.peer;
    const change = {
      // 有具体番用主标题，极端情况（推进落不到任何在册番，如番已全删）用兜底标题避免空标题
      title: recentItems.length ? REPORT_COPY.RECENT_TITLE : REPORT_COPY.RECENT_EMPTY,
      items: recentItems,
      totalText: fillTemplate(REPORT_COPY.RECENT_TOTAL, { n: recentTotal }),
      momentum: REPORT_COPY.MOMENTUM[report.momentum] || '',
      // 谁更活跃：diff>0 才显示，中性文案（领先方昵称）
      activeLead:
        report.activeLead && report.activeLead.diff > 0
          ? fillTemplate(REPORT_COPY.ACTIVE_LEAD, {
              peer: report.activeLead.leaderIsPeer ? peerName : meName,
              n: report.activeLead.diff,
            })
          : '',
    };

    // ③ 名场面三徽章（各自 show-if-present）：主值 + 副标题（挂到具体番/日期，不再是干数字）
    const badges = [];
    const streak = report.streak || {};
    if (streak.days > 0) {
      badges.push({
        key: 'streak',
        icon: REPORT_COPY.STREAK.ICON,
        label: REPORT_COPY.STREAK.LABEL,
        value: streak.days + REPORT_COPY.STREAK.UNIT,
        // 副标题：连续段起始日（缺 startDay 的老数据不显示副标题，不硬拼）
        sub: streak.startDay != null ? fillTemplate(REPORT_COPY.STREAK.SUB, { date: this._mdOf(streak.startDay, tz) }) : '',
      });
    }
    const sync = report.sync || {};
    if (sync.count > 0) {
      // 有番名走带名模板（「最近 8月6日《药屋》」），缺番名/老数据退回无名模板
      const syncName = sync.lastItemName || '';
      const syncSub =
        sync.lastDay != null
          ? fillTemplate(syncName ? REPORT_COPY.SYNC.SUB_NAMED : REPORT_COPY.SYNC.SUB, { date: this._mdOf(sync.lastDay, tz), name: syncName })
          : '';
      badges.push({ key: 'sync', icon: REPORT_COPY.SYNC.ICON, label: REPORT_COPY.SYNC.LABEL, value: sync.count + REPORT_COPY.SYNC.UNIT, sub: syncSub });
    }
    if (report.binge && report.binge.ep > 0) {
      // 主值「N 话」+ 副标题日期/番名（「8月4日《芙莉莲》」），老数据缺番名时退回无名模板
      const bingeName = report.binge.itemName || '';
      const bingeVars = { date: this._mdOf(report.binge.dayIndex, tz), n: report.binge.ep, name: bingeName };
      badges.push({
        key: 'binge',
        icon: REPORT_COPY.BINGE.ICON,
        label: REPORT_COPY.BINGE.LABEL,
        value: fillTemplate(REPORT_COPY.BINGE.VALUE, bingeVars),
        sub: fillTemplate(bingeName ? REPORT_COPY.BINGE.SUB_NAMED : REPORT_COPY.BINGE.SUB, bingeVars),
      });
    }

    // 每日追番柱状图：把每日 me/peer 话数换算成柱高百分比（相对峰值），双色堆叠。
    // 峰值为 0（全零柱，理论上 bars 非空必有峰值>0，防御性兜底）时高度归 0。
    const chartMax = report.dailySeries && report.dailySeries.max > 0 ? report.dailySeries.max : 1;
    const chartBars = ((report.dailySeries && report.dailySeries.bars) || []).map((b) => {
      const md = T.dayIndexToMD(b.dayIndex, tz);
      const wd = T.dayIndexToWeekday(b.dayIndex, tz); // 0=周日 … 6=周六，与 AIR_DAY_LABELS 同序
      return {
        dayIndex: b.dayIndex,
        day: md.d, // 轴标下行：日（月份靠标题/footnote 语境）
        weekday: AIR_DAY_LABELS[wd], // 轴标上行：周X（复用配置，不硬编码）
        isWeekend: wd === 0 || wd === 6, // 周末：轴标加重区分
        mePct: Math.round((b.me / chartMax) * 100),
        peerPct: Math.round((b.peer / chartMax) * 100),
        total: b.total,
        hasPeer: !!peer,
      };
    });
    const chart = {
      bars: chartBars,
      hasData: chartBars.length > 0,
    };

    // ④ 本命番 Hero（快照，合计集数最高）——「一路追来」的情感锚点
    const h = report.hero;
    const hero = h
      ? {
          itemId: h.itemId,
          name: h.name,
          cover: h.cover,
          coverFallback: h.coverFallback,
          epsText: fillTemplate(REPORT_COPY.HERO_EPS, { n: h.total }),
          pairText: peer ? fillTemplate(REPORT_COPY.HERO_PAIR, { me: h.me, peer: h.peer }) : fillTemplate(REPORT_COPY.HERO_PAIR_SOLO, { me: h.me }),
        }
      : null;

    // ④ 三统计格（一起追 / 追完 / 能聊）——数字落到「部」，配图标签
    const cum = report.cumulative;
    const stats = [
      { key: 'together', label: REPORT_COPY.STAT_TOGETHER, value: cum.together, unit: REPORT_COPY.STAT_UNIT },
      { key: 'done', label: REPORT_COPY.STAT_DONE, value: cum.done, unit: REPORT_COPY.STAT_UNIT },
      { key: 'common', label: REPORT_COPY.STAT_COMMON, value: cum.common, unit: REPORT_COPY.STAT_UNIT },
    ];

    // ⑤ 我最近在推（近窗只算我一人，随行为数据显隐）：番行封面 + 我方话数
    const mr = report.myRecent || { items: [], total: 0 };
    const myRecent = {
      hasData: mr.items.length > 0,
      items: mr.items.map((r) => ({
        itemId: r.itemId,
        name: r.name,
        cover: r.cover,
        coverFallback: r.coverFallback,
        epText: fillTemplate(REPORT_COPY.PERSONAL_RECENT_ROW, { n: r.me }),
      })),
      totalText: fillTemplate(REPORT_COPY.PERSONAL_RECENT_TOTAL, { n: mr.total }),
    };

    // ⑤ 个人小结：足迹大数字 + 三状态封面组（在追/追完/弃番，各挂封面条）
    const ps = report.personal;
    // 足迹：我在所有番上的绝对进度累加（footprint>0 用主文案，0 用兜底钩子）
    const personalFootprint = ps.footprint > 0
      ? fillTemplate(REPORT_COPY.PERSONAL_FOOTPRINT, { n: ps.footprint })
      : REPORT_COPY.PERSONAL_FOOTPRINT_EMPTY;
    // 三状态各成一组：标签 + 计数 + 封面条（count>0 才渲染，空状态整组隐藏，避免空块）。
    // moreText：全量 count 超过封面条展示部数时的 +N 角标。
    const buildGroup = (key, label, bucket) => {
      const items = (bucket && bucket.items) || [];
      const count = (bucket && bucket.count) || 0;
      return {
        key,
        label,
        count,
        items,
        moreText: count > items.length ? fillTemplate(REPORT_COPY.PERSONAL_STRIP_MORE, { n: count - items.length }) : '',
      };
    };
    const personalGroups = [
      buildGroup('watching', REPORT_COPY.PERSONAL_WATCHING, ps.watchingItems),
      buildGroup('done', REPORT_COPY.PERSONAL_DONE, ps.doneItems),
      buildGroup('dropped', REPORT_COPY.PERSONAL_DROPPED, ps.droppedItems),
    ].filter((g) => g.count > 0);

    // ④ 累计配图：一起追完的番封面色带（溢出计入 +N 角标）
    const doneStrip = {
      items: (report.doneItems && report.doneItems.items) || [],
      // total 是全量追完数；封面条只放前 DONE_STRIP_LIMIT 部，超出部分算成 +N 角标
      moreText:
        report.doneItems && report.doneItems.total > report.doneItems.items.length
          ? fillTemplate(REPORT_COPY.DONE_STRIP_MORE, { n: report.doneItems.total - report.doneItems.items.length })
          : '',
    };

    // footnote：起记日期
    const footnote =
      report.hasBehaviorData && report.firstEventDay != null
        ? fillTemplate(REPORT_COPY.FOOTNOTE, { date: this._mdOf(report.firstEventDay, tz) })
        : '';

    return {
      // ① 头部
      meName,
      peerName,
      hasPeer: !!peer,
      daysText: fillTemplate(REPORT_COPY.DAYS_TOGETHER, { n: report.daysTogether }),
      // ② 变化区 / 空窗召回
      showChange: report.hasBehaviorData && !report.emptyWindow,
      showRecall: report.emptyWindow,
      change,
      recallTitle: REPORT_COPY.RECALL_TITLE,
      recallText: REPORT_COPY.RECALL,
      // 每日柱状图
      chart,
      chartTitle: REPORT_COPY.CHART_TITLE,
      chartEmpty: REPORT_COPY.CHART_EMPTY,
      chartAxisMe: REPORT_COPY.CHART_AXIS_ME,
      chartAxisPeer: REPORT_COPY.CHART_AXIS_PEER,
      // ③ 名场面
      badges,
      highlightTitle: REPORT_COPY.HIGHLIGHT_TITLE,
      // ④ 累计（本命番 Hero + 三统计格 + 追完封面条）
      cumulativeTitle: REPORT_COPY.CUMULATIVE_TITLE,
      heroTitle: REPORT_COPY.HERO_TITLE,
      hero,
      stats,
      doneStripTitle: REPORT_COPY.DONE_STRIP_TITLE,
      doneStrip,
      // ⑤ 个人小结（我最近在推 + 足迹大数字 + 三状态封面组）
      personalTitle: REPORT_COPY.PERSONAL_TITLE,
      myRecent,
      myRecentTitle: REPORT_COPY.PERSONAL_RECENT_TITLE,
      personalFootprint,
      personalGroups,
      // footnote
      footnote,
    };
  },
});
