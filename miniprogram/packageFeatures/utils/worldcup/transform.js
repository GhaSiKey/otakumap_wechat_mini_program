/**
 * transform.js — 世界杯赔率数据预处理
 *
 * Web 版在渲染时用字符串拼接计算这些（色温 class、矩阵、排序），
 * 小程序是数据驱动渲染，所以把这些计算前移到这里，输出可直接被 WXML 消费的结构。
 * 纯函数，不依赖小程序 API，可 Node 测试。
 */

// ── 时间解析 ──

/** ISO 时间串 -> "06-16 18:25"（仅展示，不做时区换算）。 */
function fmtStamp(iso) {
  if (!iso) return '—';
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso;
}

/** "2026-06-12 10:00" -> { date:"6/12", weekday:"周四", time:"10:00" } */
function parseMatchTime(dt) {
  const m = (dt || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return { date: dt || '', weekday: '', time: '' };
  const [, y, mo, da, hh, mm] = m;
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const d = new Date(+y, +mo - 1, +da);
  return { date: `${+mo}/${+da}`, weekday: wd[d.getDay()], time: `${hh}:${mm}` };
}

/** 浏览器/手机本地"今天"的 YYYY-MM-DD（实时算，不依赖冻结数据）。 */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── 赔率色温 / 返还率 ──

/** 赔率值 -> 色温档位 class（越低越热，让热门项浮出）。 */
function oddsHeatClass(odds) {
  const v = parseFloat(odds);
  if (isNaN(v)) return '';
  if (v < 2) return 'heat-5';   // 很热
  if (v < 3.5) return 'heat-4'; // 热
  if (v < 7) return 'heat-3';   // 中
  if (v < 20) return 'heat-2';  // 冷
  return 'heat-1';              // 很冷
}

/** 返还率 -> 等级（用于徽章配色）。 */
function returnLevel(r) {
  if (r == null) return 'na';
  if (r >= 0.85) return 'high';
  if (r >= 0.78) return 'mid';
  return 'low';
}

// ── 阶段配色（日历 + 分组徽章共用）──

/** 阶段 -> 配色 class（淘汰赛按阶段）。 */
const PHASE_CLASS = {
  小组赛: 'ph-1', '32强': 'ph-2', '16强': 'ph-3',
  '8强': 'ph-4', '4强': 'ph-5', 季军赛: 'ph-6', 决赛: 'ph-7',
};
/** 阶段 -> 短标（日历格子）。 */
const PHASE_SHORT = {
  小组赛: '组', '32强': '32', '16强': '16',
  '8强': '8', '4强': '4', 季军赛: '季', 决赛: '决',
};
/** 小组赛轮次 -> 配色 class（R1/R2/R3 三色）。 */
const ROUND_CLASS = { 1: 'gr-1', 2: 'gr-2', 3: 'gr-3' };

/** 某天配色 class：小组赛按轮次，淘汰赛按阶段。 */
function dayColorClass(d) {
  if (d.mainPhase === '小组赛' && d.groupRound) return ROUND_CLASS[d.groupRound] || 'ph-1';
  return PHASE_CLASS[d.mainPhase] || '';
}
/** 某天短标：小组赛 R1/R2/R3，淘汰赛阶段短标。 */
function dayShortLabel(d) {
  if (d.mainPhase === '小组赛' && d.groupRound) return 'R' + d.groupRound;
  return PHASE_SHORT[d.mainPhase] || '';
}
/** 某天完整阶段名：小组赛带轮次。 */
function dayPhaseName(d) {
  if (d.mainPhase === '小组赛' && d.groupRound) return `小组赛第${d.groupRound}轮`;
  return d.mainPhase;
}

// ── 列表卡片 ──

/** 价值标签 -> { emoji, 英文 class slug }。
 *  注意：WXSS 编译器不支持中文 class 选择器（.tag--大热盘 会报编码错），
 *  所以 class 用英文 slug，中文仅作显示文本。 */
const TAG_META = {
  大热盘: { icon: '🔥', cls: 'hot' },
  均势盘: { icon: '⚖️', cls: 'even' },
  关注平局: { icon: '💎', cls: 'draw' },
  小球倾向: { icon: '🧊', cls: 'under' },
};

/** 给一组标签附上 icon 和英文 class slug，供 WXML 直接渲染。 */
function buildTags(tags) {
  if (!tags || !tags.length) return [];
  return tags.map((t) => {
    const meta = TAG_META[t] || { icon: '', cls: 'default' };
    return { name: t, icon: meta.icon, cls: meta.cls };
  });
}

/** 列表卡片视图模型。 */
function buildCard(m) {
  const t = parseMatchTime(m.datetime);
  const had = m.odds.had || null;
  const hhad = (m.odds.hhad && m.odds.hhad[0]) || null;
  // 比赛结果（已结束才有）：result.status==='finished' 且有全场比分
  const result = m.result || {};
  const finished = result.status === 'finished' && !!result.full;
  return {
    mid: m.mid,
    matchNum: m.matchNum,
    group: m.group,
    time: t.time,
    home: m.home,
    away: m.away,
    had,
    hhad,
    tags: buildTags(m.tags),
    hasPlan: !!(m.commentary && m.commentary.plan),
    finished,
    score: finished ? { h: result.full.h, a: result.full.a } : null,
    halfScore: finished && result.half ? { h: result.half.h, a: result.half.a } : null,
  };
}

/** 按日期分组列表（每组带锚点 anchor、阶段徽章、今天标记）。 */
function buildGroups(matches, schedule) {
  const dayMeta = buildDayMeta(schedule);
  const today = todayStr();
  const buckets = new Map();
  for (const m of matches) {
    const t = parseMatchTime(m.datetime);
    const anchor = (m.datetime || '').slice(0, 10); // YYYY-MM-DD
    const key = `${t.date} ${t.weekday}`;
    if (!buckets.has(anchor)) {
      const meta = dayMeta[anchor];
      buckets.set(anchor, {
        anchor,
        key,
        order: m.datetime || '',
        isToday: anchor === today,
        phaseLabel: meta ? meta.label : '',
        phaseClass: meta ? meta.colorClass : '',
        items: [],
      });
    }
    buckets.get(anchor).items.push(buildCard(m));
  }
  return [...buckets.values()]
    .sort((a, b) => (a.order < b.order ? -1 : 1))
    .map((g) => ({ ...g, count: g.items.length }));
}

/** {date: {label, colorClass}} 映射，供分组头展示阶段徽章。 */
function buildDayMeta(schedule) {
  const meta = {};
  if (!schedule || !schedule.days) return meta;
  for (const d of schedule.days) {
    meta[d.date] = { label: dayPhaseName(d), colorClass: dayColorClass(d) };
  }
  return meta;
}

// ── 赛程日历 ──

/** 日历日期条 / 月历共用的单元格视图模型。 */
function buildCalCell(d, available, today) {
  return {
    date: d.date,
    md: d.md,
    weekday: d.weekday,
    total: d.total,
    colorClass: dayColorClass(d),
    shortLabel: dayShortLabel(d),
    hasList: available.has(d.date),
    isToday: d.date === today,
  };
}

/** 月历网格：按自然月分块，周一为每周首列。 */
function buildCalMonths(days, available, today) {
  const map = new Map(days.map((d) => [d.date, d]));
  const first = days[0].date.split('-').map(Number);
  const last = days[days.length - 1].date.split('-').map(Number);
  const months = [];
  let y = first[0];
  let mo = first[1] - 1; // 0-based
  const endY = last[0];
  const endMo = last[1] - 1;
  while (y < endY || (y === endY && mo <= endMo)) {
    const cells = [];
    const firstDow = (new Date(y, mo, 1).getDay() + 6) % 7; // 周一=0
    for (let i = 0; i < firstDow; i++) cells.push({ empty: true });
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    for (let dd = 1; dd <= daysInMonth; dd++) {
      const key = `${y}-${String(mo + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      const d = map.get(key);
      if (!d) {
        cells.push({ off: true, num: dd });
      } else {
        cells.push({ ...buildCalCell(d, available, today), num: dd });
      }
    }
    months.push({ title: `${y}年${mo + 1}月`, cells });
    mo++;
    if (mo > 11) { mo = 0; y++; }
  }
  return months;
}

/** 赛程日历视图模型（日期条 cells + 月历 months + 图例 + 标题）。 */
function buildCalendar(schedule, matches) {
  if (!schedule || !schedule.days || !schedule.days.length) return null;
  const today = todayStr();
  const available = new Set(matches.map((m) => (m.datetime || '').slice(0, 10)));
  const days = schedule.days;
  return {
    title: `${schedule.totalMatches}场 · ${days[0].md}–${days[days.length - 1].md}`,
    strip: days.map((d) => buildCalCell(d, available, today)),
    months: buildCalMonths(days, available, today),
    legend: [
      { c: 'gr-1', label: '小组赛R1' }, { c: 'gr-2', label: '小组赛R2' },
      { c: 'gr-3', label: '小组赛R3' }, { c: 'ph-2', label: '32强' },
      { c: 'ph-3', label: '16强' }, { c: 'ph-4', label: '8强' },
      { c: 'ph-5', label: '4强' }, { c: 'ph-6', label: '季军' },
      { c: 'ph-7', label: '决赛' },
    ],
  };
}

// ── 详情：玩法赔率 ──

/** 半全场字段 -> 中文。 */
const HAFU_LABEL = {
  hh: '胜/胜', hd: '胜/平', ha: '胜/负', dh: '平/胜', dd: '平/平',
  da: '平/负', ah: '负/胜', ad: '负/平', aa: '负/负',
};

/** 玩法行：键值对 -> 带色温/最热高亮的 cells。 */
function buildOddsRow(label, pairs) {
  let minIdx = -1;
  let minVal = Infinity;
  pairs.forEach(([, v], i) => {
    const n = parseFloat(v);
    if (!isNaN(n) && n < minVal) { minVal = n; minIdx = i; }
  });
  const cells = pairs.map(([k, v], i) => ({
    k,
    v,
    heat: oddsHeatClass(v),
    hot: i === minIdx,
  }));
  return { label, cells };
}

/** 比分 6×6 热力矩阵：行=主队进球，列=客队进球；"其它"另列。 */
function buildCrsMatrix(crs) {
  const MAX = 5;
  const grid = {};
  const others = [];
  let minV = Infinity;
  let minKey = '';
  for (const c of crs) {
    const m = c.name.match(/^(\d):(\d)$/);
    if (m) {
      const h = +m[1];
      const a = +m[2];
      if (h <= MAX && a <= MAX) {
        grid[`${h}-${a}`] = c.odds;
        if (c.odds < minV) { minV = c.odds; minKey = `${h}-${a}`; }
      }
    } else {
      others.push({ name: c.name, odds: c.odds, heat: oddsHeatClass(c.odds) });
    }
  }
  const head = [];
  for (let a = 0; a <= MAX; a++) head.push(a);
  const rows = [];
  for (let h = 0; h <= MAX; h++) {
    const cells = [];
    for (let a = 0; a <= MAX; a++) {
      const v = grid[`${h}-${a}`];
      if (v == null) {
        cells.push({ empty: true });
      } else {
        cells.push({ v, heat: oddsHeatClass(v), hot: `${h}-${a}` === minKey });
      }
    }
    rows.push({ h, cells });
  }
  return { head, rows, others };
}

/** 完整赔率区：5 种玩法的视图模型。 */
function buildOddsSection(odds) {
  const rows = [];
  if (odds.had) {
    rows.push(buildOddsRow('胜平负', [['主胜', odds.had.h], ['平', odds.had.d], ['客胜', odds.had.a]]));
  }
  (odds.hhad || []).forEach((x) => {
    rows.push(buildOddsRow(`让球${x.goalLine}`, [['让胜', x.h], ['让平', x.d], ['让负', x.a]]));
  });
  if (odds.ttg) {
    const pairs = Object.entries(odds.ttg).map(([k, v]) => [k === '7' ? '7+' : k, v]);
    rows.push(buildOddsRow('总进球', pairs));
  }
  let hafuRow = null;
  if (odds.hafu) {
    const pairs = Object.entries(odds.hafu)
      .map(([k, v]) => [HAFU_LABEL[k] || k, v])
      .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]));
    hafuRow = buildOddsRow('半全场', pairs);
  }
  const crs = odds.crs && odds.crs.length ? buildCrsMatrix(odds.crs) : null;
  return { rows, hafuRow, crs };
}

// ── 详情：价值分析 / 点评 ──

/** 去水概率三色条（百分比已算好）。 */
function buildProbBar(prob) {
  if (!prob) return null;
  const pct = (v) => Math.round(v * 100);
  return {
    h: { w: prob.h * 100, pct: pct(prob.h) },
    d: { w: prob.d * 100, pct: pct(prob.d) },
    a: { w: prob.a * 100, pct: pct(prob.a) },
  };
}

/** 返还率徽章。 */
function buildReturnBadge(r, label) {
  if (r == null) return null;
  return { label, level: returnLevel(r), pct: (r * 100).toFixed(1) };
}

/** 详情视图模型。 */
function buildDetail(m) {
  const t = parseMatchTime(m.datetime);
  const mt = m.metrics || {};
  const had = mt.had || null;
  const badges = [
    had ? buildReturnBadge(had.return, '胜平负') : null,
    mt.ttg ? buildReturnBadge(mt.ttg.return, '总进球') : null,
    mt.hafu ? buildReturnBadge(mt.hafu.return, '半全场') : null,
    mt.crs ? buildReturnBadge(mt.crs.return, '比分') : null,
  ].filter(Boolean);
  const c = m.commentary || {};
  return {
    mid: m.mid,
    metaLine: `${m.matchNum} · ${m.group} · ${t.date} ${t.weekday} ${t.time}`,
    home: m.home,
    away: m.away,
    tags: buildTags(m.tags),
    probBar: had ? buildProbBar(had.prob) : null,
    badges,
    commentary: {
      summary: c.summary || '',
      value: c.value || '',
      plan: c.plan || null,
      empty: !c.summary && !c.value && !c.plan,
    },
    odds: buildOddsSection(m.odds),
  };
}

// ── 顶层：构建整页视图模型 ──

/** 由原始数据构建整页视图模型。 */
function buildPageModel(data) {
  return {
    meta: {
      crawledStamp: fmtStamp(data.meta.crawledAt),
      analyzedStamp: data.meta.analyzedAt ? fmtStamp(data.meta.analyzedAt) : '',
      disclaimer: data.meta.disclaimer || '',
    },
    calendar: buildCalendar(data.schedule, data.matches),
    groups: buildGroups(data.matches, data.schedule),
  };
}

module.exports = {
  fmtStamp,
  parseMatchTime,
  todayStr,
  oddsHeatClass,
  returnLevel,
  buildGroups,
  buildCalendar,
  buildDetail,
  buildPageModel,
};


