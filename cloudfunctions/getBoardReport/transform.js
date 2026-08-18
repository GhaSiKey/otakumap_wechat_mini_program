/**
 * transform.js — 共享追番板视图模型构建（纯逻辑）
 *
 * 把云数据库原始文档转成 WXML 可直接消费的结构：进度对比、分区、首字色块等。
 * 纯函数，不依赖 wx.* / cloud.*，可 Node 测试（对齐 mahjong/worldcup 可测约定）。
 * 副作用（云函数调用、setData、动画）留页面，不进本模块。
 *
 * 定位铁律（PRD §0）：进度差异是「防剧透 + 找共同话题」的手段，不是排名。
 * 本模块只产出中性结构（lead='mine'/'peer' 等），正向措辞由页面文案层处理。
 */

const {
  EP_MAX_WHEN_UNKNOWN,
  PROGRESS_STATUS,
  EVENT_TYPE,
  BOARD_MEMBER_LIMIT,
  BOARD_STATUS,
  SECTION,
  SECTION_ORDER,
  SECTION_TITLES,
  SECTION_TITLES_SOLO,
  COVER_PALETTE,
  AIR_STATUS,
  AIR_STATUS_LABELS,
  AIR_DAY_LABELS,
  AIR_DAY_COPY,
  TOTAL_EP_MAX,
  TOTAL_EP_MIN,
  VIEW,
  REPORT,
} = require('./config');

// ── 基础工具 ──

/**
 * 归一化集数：非整数/负数 → null（非法）；
 * totalEp 已知则 min(ep, totalEp)；未知则 min(ep, EP_MAX_WHEN_UNKNOWN)。
 * 与云函数 updateProgress 的 clampEp 同规则（两处引 config，保持一致）。
 */
function clampEp(ep, totalEp) {
  if (typeof ep !== 'number' || !Number.isInteger(ep) || ep < 0) return null;
  const ceiling = totalEp != null && totalEp > 0 ? totalEp : EP_MAX_WHEN_UNKNOWN;
  return Math.min(ep, ceiling);
}

/**
 * 归一化总集数录入：把任意用户输入（字符串/数字/空）归一为
 *   - 合法值：[TOTAL_EP_MIN, TOTAL_EP_MAX] 内整数
 *   - null：空 / 非法 / 越界（视作「未设」）
 * 与云函数 addItem/updateItem 的整数守卫同规则，前端据此即时反馈，不写脏数据。
 */
function normalizeTotalEp(input) {
  if (input === '' || input == null) return null;
  const n = typeof input === 'string' ? Number(input.trim()) : input;
  if (!Number.isInteger(n) || n < TOTAL_EP_MIN || n > TOTAL_EP_MAX) return null;
  return n;
}

/** 从成员列表找出「不是我」的那个 openid；只有我一人（未配对）时返回 null。 */
function resolvePeer(members, myOpenid) {
  if (!Array.isArray(members)) return null;
  const peer = members.find((m) => m && m.openid && m.openid !== myOpenid);
  return peer ? peer.openid : null;
}

/**
 * 头像 URL 净化：cloud:// 文件 ID 无法在普通 <image src> 里加载
 * （会被拼成页面相对路径→500 报错刷屏），且不开云存储权限时对方本就读不到。
 * 故 cloud:// 一律视作「无有效头像」返回 ''，让 wxml 直接走首字母兜底，不发失败请求。
 * https/wxfile（chooseAvatar 临时路径）等可正常加载的 URL 原样返回。
 */
function sanitizeAvatar(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.indexOf('cloud://') === 0) return '';
  return url;
}

/**
 * 首字色块：番名首字符 + 按番名稳定 hash 选出的主题色。
 * 同名恒定同色（hash 逐字符累加，可测），供封面为空时占位。
 */
function pickCoverColor(name, palette) {
  const pal = Array.isArray(palette) && palette.length ? palette : COVER_PALETTE;
  const str = (name || '').trim();
  const char = str ? Array.from(str)[0] : '?';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash + str.charCodeAt(i)) % pal.length;
  }
  return { char, color: pal[hash] };
}

/**
 * 更新日可读标签：「周四更新」。
 * 仅在「在播（airing）+ airDay 为 0-6 整数」时给，否则空串——
 * 完结/未知的番挂更新日是噪音（都完结了还提「周四更新」误导），一律不显示。
 * airDay 的 0-6 语义映射见 config.AIR_DAY_LABELS（待真机校准，只此一处）。
 */
function airDayLabelOf(airStatus, airDay) {
  if (airStatus !== AIR_STATUS.AIRING) return '';
  if (!Number.isInteger(airDay) || airDay < 0 || airDay >= AIR_DAY_LABELS.length) return '';
  return AIR_DAY_LABELS[airDay] + AIR_DAY_COPY.SUFFIX;
}

/** 「能安全聊到第几集」= 双方进度的较小值（对方未翻牌则为 0）。核心价值锚点。 */
function safeTalkEp(mineEp, peerEp) {
  const a = typeof mineEp === 'number' ? mineEp : 0;
  const b = typeof peerEp === 'number' ? peerEp : 0;
  return Math.min(a, b);
}

// ── 进度对比（门面核心，UI 规格 §3）──

/**
 * 构建单番的双人进度对比视图模型。
 *
 * 输入：item（含 totalEp、progress.<openid>），我方/对方 openid。
 * 输出：同轴双头像所需的一切——两游标百分比、轴分段、领先关系、追平/断裂/模糊档。
 *
 * 两种形态（UI §3.2）：
 *   有分母（totalEp 已知）：轴是闭区间 [0,totalEp]，游标 = ep/totalEp*100。
 *   无分母（MVP 常态）：以领先者为锚，锚定在 VIEW.AXIS_LEAD_ANCHOR%，落后者按比例落在其左。
 */
function buildProgressPair(item, myOpenid, peerOpenid) {
  const progress = (item && item.progress) || {};
  const totalEp = item ? item.totalEp : null;
  const hasTotalEp = totalEp != null && totalEp > 0;

  const mineRaw = progress[myOpenid] || null;
  const peerRaw = peerOpenid ? progress[peerOpenid] || null : null;

  // clamp 一遍，防脏数据（如手改数据库导致 ep 超 totalEp）
  const mineEp = mineRaw ? clampEp(mineRaw.ep, totalEp) || 0 : 0;
  const peerEp = peerRaw ? clampEp(peerRaw.ep, totalEp) || 0 : 0;
  const hasPeer = !!peerRaw;

  const mineStatus = mineRaw ? mineRaw.status : null;
  const peerStatus = hasPeer ? peerRaw.status : null;
  const mine = mineRaw ? { ep: mineEp, status: mineStatus } : { ep: 0, status: null };
  const peer = hasPeer ? { ep: peerEp, status: peerStatus } : null;

  // 终止态标记：done=看完（轴填满到 100%），dropped=弃番（游标灰化、不参与追赶叙事）
  const mineDone = mineStatus === 'done';
  const peerDone = peerStatus === 'done';
  const mineDropped = mineStatus === 'dropped';
  const peerDropped = peerStatus === 'dropped';

  // 游标百分比。看完(done)语义上是走到终点 → 强制 100%，不受有无总集数影响
  // （无分母时若按 ep 锚定会停在 75%，违反「看完＝满进度」直觉）。
  let minePercent;
  let peerPercent;
  if (hasTotalEp) {
    minePercent = (mineEp / totalEp) * 100;
    peerPercent = hasPeer ? (peerEp / totalEp) * 100 : 0;
  } else {
    // 无分母：领先者锚在 AXIS_LEAD_ANCHOR，落后者按比例
    const anchor = VIEW.AXIS_LEAD_ANCHOR;
    const maxEp = Math.max(mineEp, peerEp);
    if (maxEp <= 0) {
      minePercent = 0;
      peerPercent = 0;
    } else {
      minePercent = (mineEp / maxEp) * anchor;
      peerPercent = hasPeer ? (peerEp / maxEp) * anchor : 0;
    }
  }
  // done 覆盖：看完就是满进度到底
  if (mineDone) minePercent = 100;
  if (peerDone) peerPercent = 100;

  // 领先关系（中性，不含褒贬；对方未翻牌 = none）
  let lead;
  if (!hasPeer) lead = 'none';
  else if (mineEp > peerEp) lead = 'mine';
  else if (mineEp < peerEp) lead = 'peer';
  else lead = 'even';

  const diff = hasPeer ? Math.abs(mineEp - peerEp) : null;
  // 任一方弃番 → 追赶叙事失效（人家不追了，「还差 X 话追上」是虚假期待），文案层改走「下车」分支
  const eitherDropped = mineDropped || peerDropped;

  // 超出预设标记：某方记录的原始集数 > 已设总集数（如设 12 集却看到第 13 话，可能有特别篇/漏设）。
  // 仅有分母时有意义（无分母无「超出」概念）。用 raw 值判定——clamp 后的 mineEp 已被压到 totalEp，
  // 看不出溢出。轴末据此提示「已超出预设 ›」，点击引导更新总集数。
  const rawMineEp = mineRaw && typeof mineRaw.ep === 'number' ? mineRaw.ep : 0;
  const rawPeerEp = peerRaw && typeof peerRaw.ep === 'number' ? peerRaw.ep : 0;
  const epExceedsTotal = hasTotalEp && Math.max(rawMineEp, rawPeerEp) > totalEp;

  // 差距档位：仅保留 break（超大 gap 的轴断裂纯视觉降级，不等比拉伸）。
  // 原 blurred 模糊档随防剧透一并砍掉（2026-07-23）——进度信息全透明，措辞统一精确。
  let gapMode = 'exact';
  if (hasPeer && diff > VIEW.BREAK_GAP) gapMode = 'break';

  // 追平重叠（两游标够近，头像合并为 ◉）。弃番方不参与合并：
  // 弃番停在某话，若与在追方 ep 恰好接近会误判「追平庆祝」，而弃番不该触发追平。
  const isOverlap =
    hasPeer && !eitherDropped && Math.abs(minePercent - peerPercent) < VIEW.OVERLAP_PCT;

  // 轴分段（UI §3.1）：共同走过 = 到较落后者；前沿 = 落后者→领先者
  const commonPercent = hasPeer ? Math.min(minePercent, peerPercent) : minePercent;
  const leadWidth = hasPeer ? Math.abs(minePercent - peerPercent) : 0;

  return {
    mine,
    peer,
    hasPeer,
    hasTotalEp,
    minePercent,
    peerPercent,
    commonPercent,
    leadWidth,
    lead,
    diff,
    gapMode,
    isOverlap,
    mineDropped,
    peerDropped,
    eitherDropped,
    epExceedsTotal,
    safeTalkEp: safeTalkEp(mineEp, hasPeer ? peerEp : 0),
  };
}

// ── 分区与视图模型（UI 规格 §P2）──

/**
 * 判定一个番归入哪个分区。
 *   两人都 done → DONE
 *   任一 paused/dropped（且非都 done）→ PAUSED
 *   至少一人 watching/caught_up → TOGETHER
 *   否则（want / 无进度）→ NOT_STARTED
 */
function sectionOf(mineStatus, peerStatus) {
  const statuses = [mineStatus, peerStatus].filter(Boolean);
  const both = statuses.length === 2;

  if (both && statuses.every((s) => s === 'done')) return SECTION.DONE;
  if (statuses.some((s) => s === 'paused' || s === 'dropped')) return SECTION.PAUSED;
  if (statuses.some((s) => s === 'watching' || s === 'caught_up')) return SECTION.TOGETHER;
  return SECTION.NOT_STARTED;
}

/** 单番视图模型：番元信息 + 进度对比 + 封面兜底 + 分区归属。 */
function buildItemViewModel(item, myOpenid, peerOpenid) {
  const pair = buildProgressPair(item, myOpenid, peerOpenid);
  const totalEp = item.totalEp != null ? item.totalEp : null;
  // 卡片副信息：放送状态 + 总集数，拼成一句「放送中 · 28 集」（缺则省略），提升信息密度
  const airLabel = AIR_STATUS_LABELS[item.airStatus] || '';
  const epLabel = totalEp ? `${totalEp} 集` : '';
  // 更新日「周四更新」：仅在播且 airDay 合法时给（详情见 airDayLabelOf）。
  // 与放送状态、集数同属放送元信息，一并拼进 subtitle 以 ` · ` 分隔，同权重灰字呈现，不再单列强调角标。
  const airDayLabel = airDayLabelOf(item.airStatus, item.airDay);
  const subtitle = [airLabel, epLabel, airDayLabel].filter(Boolean).join(' · ');
  return {
    itemId: item._id,
    name: item.name,
    airStatus: item.airStatus,
    airLabel,
    airDayLabel,
    totalEp,
    subtitle,
    cover: item.cover || '',
    coverFallback: pickCoverColor(item.name), // cover 为空时页面用它
    // 是否已绑定弹play（sourceId 有值）：详情弹层据此显示「关联」or「刷新」入口
    sourceId: Number.isInteger(item.sourceId) && item.sourceId > 0 ? item.sourceId : null,
    pair,
    sortValue: (item.sortOrder && item.sortOrder[myOpenid]) || item.createTime || 0,
    sectionKey: sectionOf(pair.mine.status, pair.peer ? pair.peer.status : null),
  };
}

/**
 * 整板番单分组：过滤软删除 → 逐条建 VM → 按 sectionKey 归组
 * → 组内按 sortOrder[my] 升序 → 按 SECTION_ORDER 输出非空组。
 */
function groupItems(items, myOpenid, peerOpenid) {
  const list = (items || []).filter((it) => it && !it.deleted);
  const vms = list.map((it) => buildItemViewModel(it, myOpenid, peerOpenid));

  const bucket = {};
  vms.forEach((vm) => {
    (bucket[vm.sectionKey] = bucket[vm.sectionKey] || []).push(vm);
  });

  // 分区标题在此算好放进视图模型（WXML 表达式不支持三元下标，逻辑前移）
  // 有对方 → 关系型标题；筹备态（无对方）→ 中性标题
  const titles = peerOpenid ? SECTION_TITLES : SECTION_TITLES_SOLO;

  const groups = [];
  SECTION_ORDER.forEach((sectionKey) => {
    const group = bucket[sectionKey];
    if (group && group.length) {
      group.sort((a, b) => a.sortValue - b.sortValue);
      groups.push({ sectionKey, title: titles[sectionKey], items: group });
    }
  });
  return groups;
}

/**
 * 整板视图模型：板信息 + 我/对方成员 + 分区番单 + 「N 部能一起聊」。
 * phase：members 不足上限 → waiting（等待配对）；已归档 → archived；否则 paired。
 */
function buildBoardViewModel(board, items, myOpenid) {
  const members = (board && board.members) || [];
  const peerOpenid = resolvePeer(members, myOpenid);
  const findMember = (openid) => members.find((m) => m && m.openid === openid) || null;

  const meM = findMember(myOpenid);
  const peerM = peerOpenid ? findMember(peerOpenid) : null;

  let phase;
  if (board && board.status === BOARD_STATUS.ARCHIVED) phase = 'archived';
  else if (members.length < BOARD_MEMBER_LIMIT) phase = 'waiting';
  else phase = 'paired';

  const sections = groupItems(items, myOpenid, peerOpenid);

  // 「N 部能一起聊」：双方 ep≥1 且都处于在看/看完的番数（能安全聊到的共同话题）
  const talkableStatus = ['watching', 'caught_up', 'done'];
  let commonCount = 0;
  (items || [])
    .filter((it) => it && !it.deleted)
    .forEach((it) => {
      const p = it.progress || {};
      const mineP = p[myOpenid];
      const peerP = peerOpenid ? p[peerOpenid] : null;
      if (
        mineP &&
        peerP &&
        mineP.ep >= 1 &&
        peerP.ep >= 1 &&
        talkableStatus.includes(mineP.status) &&
        talkableStatus.includes(peerP.status)
      ) {
        commonCount++;
      }
    });

  return {
    boardId: board._id,
    name: board.name,
    status: board.status,
    phase,
    me: meM ? { openid: meM.openid, nickname: meM.nickname, avatar: sanitizeAvatar(meM.avatar) } : null,
    peer: peerM ? { openid: peerM.openid, nickname: peerM.nickname, avatar: sanitizeAvatar(peerM.avatar) } : null,
    sections,
    commonCount,
  };
}

// ── 时间归一：serverDate 经云函数 → callFunction 序列化后到前端是 ISO 字符串，
//    数据库直读时可能是 Date 对象，脏数据可能是数字。统一转毫秒时间戳，非法返回 NaN。──
function toMillis(t) {
  if (t == null) return NaN;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  const ms = new Date(t).getTime();
  return ms; // 非法字符串 → NaN
}

/**
 * 「TA 更新了什么」：逐番比对对方进度更新时间 > 我上次查看该板的时间。
 *
 * 数据来源全部现成、不需新模型：
 *   - progress[peer].updateTime：对方每次改进度由 updateProgress/addItem 写入
 *   - board.lastViewedAt[me]：我上次进板由 markViewed 写入
 * 首次进板（myViewed 为空）返回 []：没有「上次」无从 diff，不该炸出一堆「新动向」。
 *
 * 返回结构化数据（不拼文案，措辞留页面/config）：
 *   { count, items: [{ itemId, name, ep, status }] }，按对方更新时间倒序（最新在前）。
 */
function buildPeerUpdates(board, items, myOpenid) {
  const members = (board && board.members) || [];
  const peerOpenid = resolvePeer(members, myOpenid);
  const myViewed = board && board.lastViewedAt ? toMillis(board.lastViewedAt[myOpenid]) : NaN;
  // 未配对 / 我从没查看过 → 无可 diff 的基准
  if (!peerOpenid || Number.isNaN(myViewed)) return { count: 0, items: [] };

  const updated = [];
  (items || [])
    .filter((it) => it && !it.deleted)
    .forEach((it) => {
      const peerP = (it.progress || {})[peerOpenid];
      if (!peerP) return;
      const peerAt = toMillis(peerP.updateTime);
      if (Number.isNaN(peerAt) || peerAt <= myViewed) return;
      // 只报「真看了至少第 1 话」的进度。对方新加番（ep=0/want）也会写 updateTime，
      // 若不滤会报成「TA 追到了《X》第 0 话」措辞失真——加番不是「追进度」这件事。
      const peerEp = typeof peerP.ep === 'number' ? peerP.ep : 0;
      if (peerEp < 1) return;
      updated.push({
        itemId: it._id,
        name: it.name,
        ep: peerEp,
        status: peerP.status || null,
        _at: peerAt,
      });
    });

  updated.sort((a, b) => b._at - a._at); // 最新更新在前
  return { count: updated.length, items: updated.map(({ _at, ...rest }) => rest) };
}

// ── 历史事件折叠（历史页数据源，PRD 阶段一 §5）──

/** 一条事件是否可参与「同番同人连续 progress」折叠。 */
function isFoldableProgress(e) {
  return !!(e && e.type === EVENT_TYPE.PROGRESS && e.itemId && e.actor);
}

/**
 * 折叠历史事件：把「同一番、同一人、相邻的连续 progress」合并为一条。
 *
 * 入参 events 按 createTime 倒序（最新在前，listBoardEvents 已排好）。
 * 连点 +1 会产生一串 progress（第 3→4→5 话三条），展示时折叠成一条
 *   「从 prevEp 追到 ep」（区间取最老的 prevEp、最新的 ep），避免刷屏。
 * 仅相邻同番同人的 progress 折叠——中间夹了别的事件/别的番就断开，保留时间真相。
 * 加番/移出/改信息等非 progress 事件从不折叠，各自独立成条。
 *
 * 纯函数：克隆输出，不改入参。折叠条带：
 *   foldedCount（合并了几条原始事件，未折叠为 1）
 *   firstCreateTime（该折叠段最早一条的时间，供页面显示时间区间）
 *   payload.prevEp/prevStatus 取最老一条，payload.ep/status 取最新一条。
 */
function foldEvents(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  events.forEach((e) => {
    if (!e) return;
    const last = out.length ? out[out.length - 1] : null;
    const canMerge =
      last &&
      isFoldableProgress(last) &&
      isFoldableProgress(e) &&
      last.actor === e.actor &&
      last.itemId === e.itemId;

    if (canMerge) {
      // e 比 last 更老（倒序）：把区间起点回退到 e 的 prev
      const lp = last.payload || {};
      const ep = e.payload || {};
      last.payload = {
        prevEp: ep.prevEp,
        ep: lp.ep,
        prevStatus: ep.prevStatus,
        status: lp.status,
      };
      last.foldedCount += 1;
      last.firstCreateTime = e.createTime;
      return;
    }

    // 新起一条（克隆，避免改入参）
    out.push({
      _id: e._id,
      boardId: e.boardId,
      actor: e.actor,
      type: e.type,
      itemId: e.itemId || '',
      itemName: e.itemName || '',
      payload: Object.assign({}, e.payload || {}),
      createTime: e.createTime,
      firstCreateTime: e.createTime,
      foldedCount: 1,
    });
  });
  return out;
}

/**
 * 把一条（已折叠的）事件解读成「谁 + 做了什么」的结构化描述，供历史页渲染。
 *
 * 纯决策逻辑（选哪个文案模板 + 插值变量），不拼字符串——具体文案模板在
 * config.HISTORY_COPY.ACTION，插值由页面 fillTemplate 完成，保持措辞集中可改。
 *
 * 返回：{ mine, actionKey, vars }
 *   mine     —— 是否我发起（决定主语「我」/对方昵称）
 *   actionKey—— HISTORY_COPY.ACTION 里的键（progress 已按语义分流）
 *   vars     —— { name, from, to, status } 供模板插值（status 为原始枚举，页面转标签）
 *
 * progress 分流优先级：终止态（看完/弃番/暂缓）＞ 集数推进 ＞ 纯状态变化。
 * 终止态情绪信号最重，即便同时推进了集数也以终止态叙述（「看完了」比「追到第12话」更该被看见）。
 */
function describeEvent(e, myOpenid) {
  const mine = !!(e && e.actor && e.actor === myOpenid);
  const name = (e && e.itemName) || '';
  const p = (e && e.payload) || {};

  let actionKey = e ? e.type : '';
  const vars = { name };

  if (e && e.type === EVENT_TYPE.ITEM_EDIT) {
    // 改名单独成句（改名比「更新了信息」更具体、更值得看见）
    const fields = Array.isArray(p.fields) ? p.fields : [];
    const renamed = fields.indexOf('name') >= 0 && p.prevName != null && p.prevName !== name;
    if (renamed) {
      actionKey = 'item_rename';
      vars.from = p.prevName;
    } else {
      actionKey = 'item_edit';
    }
  } else if (e && e.type === EVENT_TYPE.PROGRESS) {
    const status = p.status || null;
    const prevStatus = p.prevStatus || null;
    const statusChanged = status !== prevStatus;
    const epChanged = typeof p.ep === 'number' && p.ep !== p.prevEp;

    if (statusChanged && (status === 'done' || status === 'dropped' || status === 'paused')) {
      actionKey = 'progress_' + status; // 终止/暂缓态优先
    } else if (epChanged) {
      // 折叠区间（合并多步）用 from-to，单步只报到达话数
      if (e.foldedCount > 1 && typeof p.prevEp === 'number') {
        actionKey = 'progress_from_to';
        vars.from = p.prevEp;
      } else {
        actionKey = 'progress_to';
      }
      vars.to = p.ep;
    } else if (statusChanged) {
      actionKey = 'progress_status'; // 仅状态变化（如 想看→在追）
      vars.status = status;
    } else {
      // 理论上不会到（只记真变化），兜底给到达话数
      actionKey = 'progress_to';
      vars.to = typeof p.ep === 'number' ? p.ep : 0;
    }
  }

  return { mine, actionKey, vars };
}

/**
 * 相对时间（历史页时间戳）：刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / M月D日 [HH:mm]。
 *
 * 纯函数：createTime 与「当前时刻」nowMs 都从外部传入（页面用设备 Date.now()），
 * 便于 Node 测试且不在纯模块里读时钟。用设备本地时间显示（历史无需北京时区严格分桶，
 * 那是周报阶段的事），跨年补「YYYY年」。非法时间返回 ''。
 */
function relativeTime(createTime, nowMs) {
  const t = toMillis(createTime);
  if (Number.isNaN(t)) return '';
  const now = typeof nowMs === 'number' ? nowMs : t;
  const diff = now - t;
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  if (diff < 0) return '刚刚';
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} 小时前`;

  const d = new Date(t);
  const nd = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  // 「昨天」：本地日历日相差 1 天
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayGap = Math.round((dayStart(nd) - dayStart(d)) / (24 * HOUR));
  if (dayGap === 1) return `昨天 ${hm}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (d.getFullYear() !== nd.getFullYear()) return `${d.getFullYear()}年${md}`;
  return `${md} ${hm}`;
}

// ── 周报 / 报告数据层（board-report，PRD 阶段二）──
//
// 定位：不是排名，是「我俩这阵子一起追番的样子」。数据分两类——
//   A 类快照：从 items.progress 当前状态算（累计/个人小结），任何板都能算，首报不残缺；
//   B 类叙事：从 progress 事件流算（推进/环比/streak/神同步/爆肝），仅埋点后有，
//             缺则由页面隐藏对应块 + 显示 footnote 起记时间（show-if-present）。
//
// 全部纯函数：不读时钟（nowMs 由页面传）、不拼文案（措辞在 config.REPORT_COPY），
// 只产出结构化数据。按天指标显式带 tzOffsetMin，把 UTC 时间戳归到本地日再分桶。

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 本地日序号：UTC 毫秒 → 加时区偏移 → 取整天。同一本地日历日返回同一整数。
 * streak 找连续整数、神同步/爆肝按此 key 聚合，都依赖它把「凌晨追番」正确归到当天。
 */
function localDayIndex(ms, tzOffsetMin) {
  const off = typeof tzOffsetMin === 'number' ? tzOffsetMin : 0;
  return Math.floor((ms + off * 60 * 1000) / MS_PER_DAY);
}

/**
 * dayIndex 还原成 { m, d }（供页面拼「M月D日」）。跨年不显示年份（周报只看近况）。
 */
function dayIndexToMD(dayIndex, tzOffsetMin) {
  const off = typeof tzOffsetMin === 'number' ? tzOffsetMin : 0;
  // 该本地日中午（+12h）转回 UTC 时刻，避免边界落到相邻日
  const ms = dayIndex * MS_PER_DAY + MS_PER_DAY / 2 - off * 60 * 1000;
  const d = new Date(ms);
  return { m: d.getMonth() + 1, d: d.getDate() };
}

/**
 * dayIndex → 本地星期几（0=周日 … 6=周六，与 AIR_DAY_LABELS 下标同序）。
 * 与 dayIndexToMD 同源取「本地日中午」时刻，页面据此查 AIR_DAY_LABELS 拿「周X」+ 判周末。
 * 单独成函数（不并入 dayIndexToMD）以免改动其 {m,d} 返回结构、打破既有深比较断言。
 */
function dayIndexToWeekday(dayIndex, tzOffsetMin) {
  const off = typeof tzOffsetMin === 'number' ? tzOffsetMin : 0;
  const ms = dayIndex * MS_PER_DAY + MS_PER_DAY / 2 - off * 60 * 1000;
  return new Date(ms).getDay();
}

/** ① 一起追番第 N 天：从建板日到 now 的本地日跨度 + 1（当天即第 1 天）。非法建板时间返回 0。 */
function daysTogether(board, nowMs, tzOffsetMin) {
  const created = toMillis(board && board.createTime);
  if (Number.isNaN(created) || typeof nowMs !== 'number') return 0;
  const gap = localDayIndex(nowMs, tzOffsetMin) - localDayIndex(created, tzOffsetMin);
  return gap < 0 ? 1 : gap + 1;
}

/**
 * 建板日的本地 dayIndex（头部副信息「X 起」用，与 daysTogether 同源 board.createTime，
 * 页面用 dayIndexToMD 还原成 M/D，避免页面二次反推产生 off-by-one）。createTime 非法返回 null。
 */
function boardSinceDay(board, tzOffsetMin) {
  const created = toMillis(board && board.createTime);
  if (Number.isNaN(created)) return null;
  return localDayIndex(created, tzOffsetMin);
}

/** 单条 progress 事件的「推进话数」：max(0, ep-prevEp)。弃番/纠错回退不计负，不倒扣。 */
function progressGain(e) {
  if (!e || e.type !== EVENT_TYPE.PROGRESS) return 0;
  const p = e.payload || {};
  const ep = typeof p.ep === 'number' ? p.ep : 0;
  const prev = typeof p.prevEp === 'number' ? p.prevEp : 0;
  const gain = ep - prev;
  return gain > 0 ? gain : 0;
}

/**
 * ② 窗口推进：[fromMs, toMs) 内我 / 对方各推进多少话（progress 事件 gain 求和）。
 * 未配对时 peer 恒 0。事件时间非法者跳过。
 */
function windowProgress(events, myOpenid, peerOpenid, fromMs, toMs) {
  let me = 0;
  let peer = 0;
  (events || []).forEach((e) => {
    if (!e || e.type !== EVENT_TYPE.PROGRESS) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t) || t < fromMs || t >= toMs) return;
    const gain = progressGain(e);
    if (gain <= 0) return;
    if (e.actor === myOpenid) me += gain;
    else if (peerOpenid && e.actor === peerOpenid) peer += gain;
  });
  return { me, peer };
}

/**
 * 环比方向：近窗 vs 前窗推进话数。只出方向不出百分比（早期数据稀疏，百分比是假精度）。
 * 相差在稳定带内 → 'flat'；否则按符号 'up'/'down'。band 由 config 传。
 */
function momentumOf(recent, previous, band) {
  const b = typeof band === 'number' ? band : 0;
  const diff = recent - previous;
  if (Math.abs(diff) <= b) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

/**
 * 收集「有人真推进过（gain>0）」的本地日集合。
 * 不传 actorOpenid：board 维度合并（任一人推进即算这天有追）；
 * 传 actorOpenid：只统计该人推进的日（供个人版 streak，与板级同源不漂移）。
 */
function activeDaySet(events, tzOffsetMin, actorOpenid) {
  const days = new Set();
  (events || []).forEach((e) => {
    if (progressGain(e) <= 0) return;
    if (actorOpenid && e.actor !== actorOpenid) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t)) return;
    days.add(localDayIndex(t, tzOffsetMin));
  });
  return days;
}

/**
 * 从「有追的本地日集合」数出当前存活的连续段：{ days, startDay }。
 * 最近追番日须落在「今天或宽限天内」才算存活，从那天往回数连续段；startDay = 连续段第一天。
 * 板级 / 个人版 streak 共用此核心，喂不同 daySet 即可，保证两者口径一致。
 */
function streakFromDaySet(days, nowMs, tzOffsetMin, graceDays) {
  if (!days.size || typeof nowMs !== 'number') return { days: 0, startDay: null };
  const today = localDayIndex(nowMs, tzOffsetMin);
  const grace = typeof graceDays === 'number' ? graceDays : 0;
  let last = -Infinity;
  days.forEach((d) => {
    if (d > last) last = d;
  });
  if (today - last > grace) return { days: 0, startDay: null }; // 断超宽限
  let streak = 0;
  let cur = last;
  while (days.has(cur)) {
    streak++;
    cur--;
  }
  return { days: streak, startDay: cur + 1 }; // cur 停在断裂前一天，+1 即连续段首日
}

/**
 * 🔥 当前 streak 详情（board 维度）：{ days, startDay }。
 * Duolingo 式，grace/nowMs/tzOffsetMin 由外部传（纯函数不读时钟）。无有效 streak 返回 { days:0, startDay:null }。
 */
function currentStreakInfo(events, nowMs, tzOffsetMin, graceDays) {
  return streakFromDaySet(activeDaySet(events, tzOffsetMin), nowMs, tzOffsetMin, graceDays);
}

/** 🔥 当前 streak 天数（薄封装，兼容既有调用/测试）。 */
function currentStreakDays(events, nowMs, tzOffsetMin, graceDays) {
  return currentStreakInfo(events, nowMs, tzOffsetMin, graceDays).days;
}

/**
 * 🔥 我个人的当前 streak：{ days, startDay, todayDone }。
 * 只统计我 actor 的推进日（区别于板级的任一人）；口径与 currentStreakInfo 完全一致（同源 streakFromDaySet）。
 * todayDone：我今天是否已推进过——供 UI 区分「今天已续上」vs「宽限内待续，火要灭了」两种紧迫态。
 */
function myStreakInfo(events, myOpenid, nowMs, tzOffsetMin, graceDays) {
  const days = activeDaySet(events, tzOffsetMin, myOpenid);
  const info = streakFromDaySet(days, nowMs, tzOffsetMin, graceDays);
  const todayDone =
    typeof nowMs === 'number' && days.has(localDayIndex(nowMs, tzOffsetMin));
  return { days: info.days, startDay: info.startDay, todayDone };
}

/**
 * 👯 神同步天数：同一本地日、两人都推进过「同一部番」的去重天数。
 * 按 (dayIndex, itemId) 聚合各自 actor 集合，含齐 me+peer 的组 → 计入其 dayIndex。
 * 未配对（无 peerOpenid）恒 0。
 */
function syncInfo(events, myOpenid, peerOpenid, tzOffsetMin) {
  if (!peerOpenid) return { count: 0, lastDay: null, lastItemId: '', lastItemName: '' };
  const groups = new Map(); // key: `${day}|${itemId}` → { actors:Set, name }
  (events || []).forEach((e) => {
    if (progressGain(e) <= 0 || !e.itemId) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t)) return;
    const day = localDayIndex(t, tzOffsetMin);
    const key = `${day}|${e.itemId}`;
    let cell = groups.get(key);
    if (!cell) {
      cell = { actors: new Set(), name: e.itemName || '' };
      groups.set(key, cell);
    }
    cell.actors.add(e.actor);
    if (e.itemName) cell.name = e.itemName;
  });
  const syncedDays = new Set();
  let last = null; // { day, itemId, name }
  groups.forEach((cell, key) => {
    if (cell.actors.has(myOpenid) && cell.actors.has(peerOpenid)) {
      const [dayStr, itemId] = key.split('|');
      const day = Number(dayStr);
      syncedDays.add(day);
      if (!last || day > last.day) last = { day, itemId, name: cell.name };
    }
  });
  return {
    count: syncedDays.size,
    lastDay: last ? last.day : null,
    lastItemId: last ? last.itemId : '',
    lastItemName: last ? last.name : '',
  };
}

/** 👯 神同步天数（薄封装，兼容既有调用/测试）。 */
function syncDays(events, myOpenid, peerOpenid, tzOffsetMin) {
  return syncInfo(events, myOpenid, peerOpenid, tzOffsetMin).count;
}

/**
 * ⚡ 单日爆肝峰值：按 (本地日, actor) 聚合推进话数，取全局峰值那一格。
 * 返回 { mine, ep, dayIndex, itemName }（那天该人推进最多的番名，供文案点睛），无记录返回 null。
 * 平局取先遇到的（事件已按时间倒序，取到的是较新的峰值日，符合「最近爆肝」直觉）。
 */
function bingePeak(events, myOpenid, tzOffsetMin) {
  const cells = new Map(); // key: `${day}|${actor}` → { ep, byItem: Map(itemId→{ep,name}) }
  (events || []).forEach((e) => {
    const gain = progressGain(e);
    if (gain <= 0) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t)) return;
    const day = localDayIndex(t, tzOffsetMin);
    const key = `${day}|${e.actor}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { ep: 0, byItem: new Map() };
      cells.set(key, cell);
    }
    cell.ep += gain;
    const prevItem = cell.byItem.get(e.itemId) || { ep: 0, name: e.itemName || '' };
    prevItem.ep += gain;
    if (e.itemName) prevItem.name = e.itemName;
    cell.byItem.set(e.itemId, prevItem);
  });

  let best = null;
  cells.forEach((cell, key) => {
    if (!best || cell.ep > best.ep) {
      const [dayStr, actor] = key.split('|');
      // 那天推进最多的番
      let topItem = '';
      let topEp = -1;
      cell.byItem.forEach((v) => {
        if (v.ep > topEp) {
          topEp = v.ep;
          topItem = v.name;
        }
      });
      best = { mine: actor === myOpenid, ep: cell.ep, dayIndex: Number(dayStr), itemName: topItem };
    }
  });
  return best;
}

/**
 * ④ 累计（快照，任何板都能算）：一起追（未删番数）/ 追完（任一人 done）/ 能聊（复用 commonCount）。
 * 「追完」口径 = 任一方 status===done（用户选定：数字更好看，不强求双方都看完）。
 */
function cumulativeStats(items, myOpenid, peerOpenid, commonCount) {
  const live = (items || []).filter((it) => it && !it.deleted);
  let doneCount = 0;
  live.forEach((it) => {
    const p = it.progress || {};
    const mineDone = p[myOpenid] && p[myOpenid].status === 'done';
    const peerDone = peerOpenid && p[peerOpenid] && p[peerOpenid].status === 'done';
    if (mineDone || peerDone) doneCount++;
  });
  return { together: live.length, done: doneCount, common: commonCount || 0 };
}

/**
 * ⑤ 个人小结（快照）：我的 done / 在追(watching+caught_up) / 弃番 计数
 * + 各状态番封面条（doneItems/watchingItems/droppedItems，每条截到 limit，count 为全量）
 * + footprint（我在所有番上的绝对进度 ep 累加，「一共追了 N 话」的个人足迹）。
 * strip 内番按我方 ep 降序（追得最深的排前），保证展示稳定可测。
 */
function personalSummary(items, myOpenid, stripLimit) {
  const buckets = { done: [], watching: [], dropped: [] };
  let footprint = 0;
  (items || [])
    .filter((it) => it && !it.deleted)
    .forEach((it) => {
      const mine = (it.progress || {})[myOpenid];
      if (!mine) return;
      if (typeof mine.ep === 'number' && mine.ep > 0) footprint += mine.ep;
      let key = null;
      if (mine.status === 'done') key = 'done';
      else if (mine.status === 'watching' || mine.status === 'caught_up') key = 'watching';
      else if (mine.status === 'dropped') key = 'dropped';
      if (key) buckets[key].push({ item: it, ep: typeof mine.ep === 'number' ? mine.ep : 0 });
    });

  const n = typeof stripLimit === 'number' && stripLimit > 0 ? stripLimit : Infinity;
  const strip = (arr) => {
    const sorted = arr.slice().sort((a, b) => b.ep - a.ep);
    return { count: arr.length, items: sorted.slice(0, n).map((x) => itemCoverView(x.item)) };
  };
  return {
    done: buckets.done.length,
    watching: buckets.watching.length,
    dropped: buckets.dropped.length,
    footprint,
    doneItems: strip(buckets.done),
    watchingItems: strip(buckets.watching),
    droppedItems: strip(buckets.dropped),
  };
}

/**
 * 番剧封面视图片段：从 item 取 name/cover，cover 为空时给首字色块兜底（与门面同一套 pickCoverColor）。
 * 报告页里所有「带封面的番行/番块」都经此产出，保证与主页番卡封面视觉一致、零硬编码。
 */
function itemCoverView(item) {
  const name = (item && item.name) || '';
  return {
    itemId: (item && item._id) || '',
    name,
    cover: (item && item.cover) || '',
    coverFallback: pickCoverColor(name), // { color, char }
  };
}

/**
 * ② 变化区主体：近窗内「双人合计推进最多」的番 top N。
 * 事件按 itemId 聚合我/对方各自推进话数 → join items 拿封面/番名 → 合计降序取 limit 条。
 * 只统计 gain>0 的 PROGRESS 事件、落在 [fromMs,toMs) 窗口内的；番已软删/找不到则跳过（不虚列）。
 * 返回 [{ itemId, name, cover, coverFallback, me, peer, total }]，无则空数组。
 */
function recentItemsProgress(events, items, myOpenid, peerOpenid, fromMs, toMs, limit) {
  const itemById = new Map();
  (items || []).forEach((it) => {
    if (it && it._id && !it.deleted) itemById.set(it._id, it);
  });

  const agg = new Map(); // itemId → { me, peer }
  (events || []).forEach((e) => {
    if (!e || e.type !== EVENT_TYPE.PROGRESS || !e.itemId) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t) || t < fromMs || t >= toMs) return;
    const gain = progressGain(e);
    if (gain <= 0) return;
    let cell = agg.get(e.itemId);
    if (!cell) {
      cell = { me: 0, peer: 0 };
      agg.set(e.itemId, cell);
    }
    if (e.actor === myOpenid) cell.me += gain;
    else if (peerOpenid && e.actor === peerOpenid) cell.peer += gain;
  });

  const rows = [];
  agg.forEach((cell, itemId) => {
    const item = itemById.get(itemId);
    if (!item) return; // 番已删或不在当前板 → 不列
    const total = cell.me + cell.peer;
    if (total <= 0) return;
    rows.push(Object.assign(itemCoverView(item), { me: cell.me, peer: cell.peer, total }));
  });
  // 合计降序；平局按番名稳定排序（可测，不依赖插入顺序）
  rows.sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const n = typeof limit === 'number' && limit > 0 ? limit : rows.length;
  return rows.slice(0, n);
}

/**
 * ⑤ 个人小结「我最近推进」：近窗内**只算我一人**推进的番 top N（区别于 recentItemsProgress 的双人合计视角）。
 * 按 itemId 聚合我的 gain（对方推进不计）→ join items 拿封面 → 我方话数降序取 limit 条。
 * 番已软删/找不到则跳过。返回 { items:[{itemId,name,cover,coverFallback,me}], total }，total 为我近窗推进总话数（含未截断的）。
 */
function myRecentProgress(events, items, myOpenid, fromMs, toMs, limit) {
  const itemById = new Map();
  (items || []).forEach((it) => {
    if (it && it._id && !it.deleted) itemById.set(it._id, it);
  });

  const agg = new Map(); // itemId → me gain
  let total = 0;
  (events || []).forEach((e) => {
    if (!e || e.type !== EVENT_TYPE.PROGRESS || !e.itemId || e.actor !== myOpenid) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t) || t < fromMs || t >= toMs) return;
    const gain = progressGain(e);
    if (gain <= 0) return;
    agg.set(e.itemId, (agg.get(e.itemId) || 0) + gain);
    total += gain;
  });

  const rows = [];
  agg.forEach((me, itemId) => {
    const item = itemById.get(itemId);
    if (!item || me <= 0) return; // 番已删/不在册 → 不列（total 仍含其话数，是「我推进总量」的诚实口径）
    rows.push(Object.assign(itemCoverView(item), { me }));
  });
  // 我方话数降序；平局按番名稳定排序
  rows.sort((a, b) => b.me - a.me || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const n = typeof limit === 'number' && limit > 0 ? limit : rows.length;
  return { items: rows.slice(0, n), total };
}

/**
 * ④ 累计配图：一起追完的番（任一人 done，与 cumulativeStats 同口径），带封面。
 * 供「一起追完的」封面色带展示。返回 { items:[封面片段], total }，total 为全部追完数（含超出 limit 的）。
 */
function doneTogetherItems(items, myOpenid, peerOpenid, limit) {
  const done = [];
  (items || [])
    .filter((it) => it && !it.deleted)
    .forEach((it) => {
      const p = it.progress || {};
      const mineDone = p[myOpenid] && p[myOpenid].status === 'done';
      const peerDone = peerOpenid && p[peerOpenid] && p[peerOpenid].status === 'done';
      if (mineDone || peerDone) done.push(it);
    });
  const total = done.length;
  const n = typeof limit === 'number' && limit > 0 ? limit : total;
  return { items: done.slice(0, n).map(itemCoverView), total };
}

/**
 * 每日追番柱状图数据：按本地日分桶，各天我/对方推进话数（双色堆叠柱）。
 * 窗口 = [max(首个有记录日, today-maxDays+1), today]，连续铺满（含中间零柱，形成日历感），
 * 但不在「首个记录日之前」硬铺空柱（数据稀疏期避免半屏空白）。今天含在内。
 * 返回 { bars:[{ dayIndex, me, peer, total }], max }，max 为单日 total 峰值（页面算柱高比例）。无数据 bars=[]。
 */
function dailyProgressSeries(events, myOpenid, peerOpenid, nowMs, tzOffsetMin, maxDays) {
  if (typeof nowMs !== 'number') return { bars: [], max: 0 };
  const today = localDayIndex(nowMs, tzOffsetMin);
  const perDay = new Map(); // dayIndex → { me, peer, items:Set<itemId> }
  let firstDay = Infinity;
  (events || []).forEach((e) => {
    if (!e || e.type !== EVENT_TYPE.PROGRESS) return;
    const gain = progressGain(e);
    if (gain <= 0) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t)) return;
    const day = localDayIndex(t, tzOffsetMin);
    if (day > today) return; // 未来事件（时钟异常）不计
    if (day < firstDay) firstDay = day;
    let cell = perDay.get(day);
    if (!cell) {
      cell = { me: 0, peer: 0, items: new Set() };
      perDay.set(day, cell);
    }
    if (e.itemId) cell.items.add(e.itemId); // 当天推进过的不同番（去重），供「几部番」统计
    if (e.actor === myOpenid) cell.me += gain;
    else if (peerOpenid && e.actor === peerOpenid) cell.peer += gain;
  });
  if (firstDay === Infinity) return { bars: [], max: 0 };

  // maxDays>0：旧「近 N 天滚动窗口」行为（兼容既有调用/测试）。
  // maxDays 省略/≤0：返回首记录日→今天的全量每日，供 buildWeeklyChart 在前端按周切片。
  const cap = typeof maxDays === 'number' && maxDays > 0 ? maxDays : today - firstDay + 1;
  const from = Math.max(firstDay, today - cap + 1); // 窗口起点：不早于首记录日
  const bars = [];
  let max = 0;
  for (let d = from; d <= today; d++) {
    const cell = perDay.get(d) || { me: 0, peer: 0, items: null };
    const total = cell.me + cell.peer;
    if (total > max) max = total;
    bars.push({
      dayIndex: d,
      me: cell.me,
      peer: cell.peer,
      total,
      animeCount: cell.items ? cell.items.size : 0, // 当天推进过的不同番数
    });
  }
  return { bars, max };
}

/**
 * 每日数据按「自然周」分桶（周一→周日固定 7 格），供报告页横滑翻周展示。
 * 输入 daily.bars（dailyProgressSeries 全量输出，dayIndex 连续、含中间零柱）。
 * 每周：7 个 slot（周一…周日）；本周只到今天（未到的 day 标 future，不画柱）；
 * 每周自算 max（轻的周也看得清）；汇总当周番剧数（跨天去重）与话数。
 * 返回 { weeks:[{ startDayIndex, slots:[{dayIndex,me,peer,total,animeCount,isFuture,weekday,isWeekend}],
 *         max, animeCount, meEp, peerEp, totalEp, isCurrent }], currentIndex }。空数据 → { weeks:[], currentIndex:-1 }。
 * currentIndex 指向「今天所在周」，页面默认停在此周。
 */
function buildWeeklyChart(daily, allEvents, nowMs, tzOffsetMin, weekStart) {
  const empty = { weeks: [], currentIndex: -1 };
  if (typeof nowMs !== 'number') return empty;
  const bars = (daily && daily.bars) || [];
  if (!bars.length) return empty;
  const ws = typeof weekStart === 'number' ? weekStart : 1; // 1=周一
  const today = localDayIndex(nowMs, tzOffsetMin);

  // 某 dayIndex 所在周的周首 dayIndex（把 weekday 归一到 [0..6] 相对 weekStart 的偏移）
  const weekStartOf = (dayIndex) => {
    const wd = dayIndexToWeekday(dayIndex, tzOffsetMin); // 0=周日…6=周六
    const offset = (wd - ws + 7) % 7;
    return dayIndex - offset;
  };

  // 全量事件按 (周首, itemId) 记录，供每周番剧去重计数（跨天，不能用逐日 animeCount 相加）
  const weekItems = new Map(); // weekStartDayIndex → Set<itemId>
  (allEvents || []).forEach((e) => {
    if (progressGain(e) <= 0 || !e.itemId) return;
    const t = toMillis(e.createTime);
    if (Number.isNaN(t)) return;
    const day = localDayIndex(t, tzOffsetMin);
    if (day > today) return;
    const wk = weekStartOf(day);
    let set = weekItems.get(wk);
    if (!set) {
      set = new Set();
      weekItems.set(wk, set);
    }
    set.add(e.itemId);
  });

  const perDay = new Map(); // dayIndex → bar
  bars.forEach((b) => perDay.set(b.dayIndex, b));

  const firstWeek = weekStartOf(bars[0].dayIndex);
  const currentWeek = weekStartOf(today);
  const weeks = [];
  let currentIndex = -1;
  // 从首记录周连续铺到本周（中间空周保留，避免横滑跳格）
  for (let wk = firstWeek; wk <= currentWeek; wk += 7) {
    const slots = [];
    let max = 0;
    let meEp = 0; // 当周我方推进话数合计（图例「我 N」用）
    let peerEp = 0; // 当周对方推进话数合计（图例「TA N」用）
    for (let i = 0; i < 7; i++) {
      const dayIndex = wk + i;
      const isFuture = dayIndex > today;
      const bar = perDay.get(dayIndex);
      const me = bar ? bar.me : 0;
      const peer = bar ? bar.peer : 0;
      const total = me + peer;
      if (total > max) max = total;
      meEp += me;
      peerEp += peer;
      const weekday = dayIndexToWeekday(dayIndex, tzOffsetMin);
      slots.push({
        dayIndex,
        me,
        peer,
        total,
        animeCount: bar ? bar.animeCount : 0,
        isFuture,
        weekday,
        isWeekend: weekday === 0 || weekday === 6,
      });
    }
    const isCurrent = wk === currentWeek;
    if (isCurrent) currentIndex = weeks.length;
    weeks.push({
      startDayIndex: wk,
      slots,
      max,
      animeCount: (weekItems.get(wk) || { size: 0 }).size,
      meEp,
      peerEp,
      totalEp: meEp + peerEp,
      isCurrent,
    });
  }
  return { weeks, currentIndex };
}

/**
 * 你俩的本命番：双方合计集数（me.ep + peer.ep）最高的番（快照，任何板都能算）。
 * 弃番不算本命（status===dropped 的一方 ep 不计入合计，避免「弃了却因集数高被当本命」）。
 * 返回 { itemId,name,cover,coverFallback, me, peer, total } | null（无有效番时）。
 */
function mostInvestedItem(items, myOpenid, peerOpenid) {
  let best = null;
  (items || [])
    .filter((it) => it && !it.deleted)
    .forEach((it) => {
      const p = it.progress || {};
      const mp = p[myOpenid];
      const pp = peerOpenid ? p[peerOpenid] : null;
      const me = mp && mp.status !== 'dropped' && typeof mp.ep === 'number' ? mp.ep : 0;
      const peer = pp && pp.status !== 'dropped' && typeof pp.ep === 'number' ? pp.ep : 0;
      const total = me + peer;
      if (total <= 0) return;
      if (!best || total > best.total) {
        best = Object.assign(itemCoverView(it), { me, peer, total });
      }
    });
  return best;
}

/** 事件流最早一条的本地日（footnote「行为数据自 X 月起记录」用）。空返回 null。 */
function firstEventDayIndex(events, tzOffsetMin) {
  let min = Infinity;
  (events || []).forEach((e) => {
    const t = toMillis(e && e.createTime);
    if (Number.isNaN(t)) return;
    const day = localDayIndex(t, tzOffsetMin);
    if (day < min) min = day;
  });
  return min === Infinity ? null : min;
}

/**
 * 组装报告视图模型（一次算全，页面直接消费）。入参：
 *   { board, items, events, myOpenid, nowMs, commonCount }
 * commonCount 由页面从 buildBoardViewModel 传入（避免重算「能聊」逻辑）。
 * events 应为该板全部（或足够长）progress 相关事件，按时间倒序；不足则相关块自然为空。
 *
 * 时区/窗口/阈值全走 config.REPORT。产出结构化数据，措辞由页面用 REPORT_COPY 插值。
 * hasBehaviorData=false（无任何推进事件）时页面隐藏② ③、只留① ④ ⑤ + footnote。
 */
function buildReportModel(opts) {
  const o = opts || {};
  const { board, items, events, myOpenid } = o;
  const nowMs = typeof o.nowMs === 'number' ? o.nowMs : NaN;
  const tz = REPORT.TZ_OFFSET_MINUTES;
  const windowMs = REPORT.WINDOW_DAYS * MS_PER_DAY;

  const members = (board && board.members) || [];
  const peerOpenid = resolvePeer(members, myOpenid);

  // ② 近窗 / 前窗推进 + 环比
  const recentFrom = nowMs - windowMs;
  const prevFrom = nowMs - 2 * windowMs;
  const recent = windowProgress(events, myOpenid, peerOpenid, recentFrom, nowMs);
  const previous = windowProgress(events, myOpenid, peerOpenid, prevFrom, recentFrom);
  // 变化区主体：近窗推得最猛的番 top N（带封面/番名/双人集数），让数字挂到真实作品上
  const recentItems = recentItemsProgress(
    events, items, myOpenid, peerOpenid, recentFrom, nowMs, REPORT.RECENT_ITEMS_LIMIT
  );
  const recentTotal = recent.me + recent.peer;
  const prevTotal = previous.me + previous.peer;
  const momentum = momentumOf(recentTotal, prevTotal, REPORT.MOMENTUM_STABLE_BAND);
  // 谁更活跃（中性 diff，>0 才有意义；相等由页面判定不显示）
  const activeDiff = recent.peer - recent.me;
  const activeLead =
    activeDiff !== 0 ? { leaderIsPeer: activeDiff > 0, diff: Math.abs(activeDiff) } : null;

  // ③ 名场面（副标题挂到具体番/日期，故取富信息版）
  const streak = currentStreakInfo(events, nowMs, tz, REPORT.STREAK_GRACE_DAYS);
  // ⑤ 个人连续追番（只算我，Duolingo 式打卡钩子）——与板级 streak 同源不漂移
  const myStreak = myStreakInfo(events, myOpenid, nowMs, tz, REPORT.STREAK_GRACE_DAYS);
  const sync = syncInfo(events, myOpenid, peerOpenid, tz);
  const binge = bingePeak(events, myOpenid, tz);
  // 每日追番柱状图：取全量每日（不设上限），再按自然周分桶供页面横滑翻周
  const dailySeries = dailyProgressSeries(events, myOpenid, peerOpenid, nowMs, tz);
  const weeklyChart = buildWeeklyChart(dailySeries, events, nowMs, tz, REPORT.WEEK_START);
  // 你俩的本命番（快照，合计集数最高）——「一路追来」的情感锚点
  const hero = mostInvestedItem(items, myOpenid, peerOpenid);

  // 行为数据是否存在（决定②③是否显示 + footnote）
  const firstDay = firstEventDayIndex(events, tz);
  const hasBehaviorData = firstDay !== null && (events || []).some((e) => progressGain(e) > 0);

  // 空窗召回：有行为数据基础，但「近期」没动静——近窗零推进 + 当前 streak 已断。
  // 只看近期信号；sync/binge 是历史累计型高光，不参与判定（历史高光 + 近期召回是更好的召回叙事）。
  const emptyWindow = hasBehaviorData && recentTotal === 0 && streak.days === 0;

  return {
    daysTogether: daysTogether(board, nowMs, tz),
    sinceDay: boardSinceDay(board, tz), // 建板日 dayIndex | null（头部副信息「X 起」，页面 dayIndexToMD 还原）
    recent, // { me, peer }
    recentItems, // [{ itemId, name, cover, coverFallback, me, peer, total }]（近窗推得最猛的番）
    momentum, // 'up' | 'flat' | 'down'
    activeLead, // { leaderIsPeer, diff } | null
    streak, // { days, startDay }（startDay 供副标题「X 起连着追」）
    myStreak, // { days, startDay, todayDone }（个人连续追番，⑤「你自己」块 Duolingo 火苗）
    sync, // { count, lastDay, lastItemId, lastItemName }（副标题「最近 X《番》」）
    binge, // { mine, ep, dayIndex, itemName } | null
    dailySeries, // { bars:[{ dayIndex, me, peer, total, animeCount }], max }（全量每日，兼容保留）
    weeklyChart, // { weeks:[{ startDayIndex, slots, max, animeCount, meEp, peerEp, totalEp, isCurrent }], currentIndex }（按周分桶，页面横滑翻周）
    hero, // { itemId,name,cover,coverFallback, me, peer, total } | null（你俩的本命番）
    cumulative: cumulativeStats(items, myOpenid, peerOpenid, o.commonCount),
    doneItems: doneTogetherItems(items, myOpenid, peerOpenid, REPORT.DONE_STRIP_LIMIT), // { items, total }
    personal: personalSummary(items, myOpenid, REPORT.PERSONAL_STRIP_LIMIT),
    // ⑤「我最近在推」：近窗只算我一人的推进（B 类行为数据，随②③一起显隐）
    myRecent: myRecentProgress(events, items, myOpenid, recentFrom, nowMs, REPORT.PERSONAL_RECENT_LIMIT),
    hasBehaviorData,
    emptyWindow,
    firstEventDay: firstDay, // dayIndex | null（页面用 dayIndexToMD 还原 footnote 日期）
    tzOffsetMinutes: tz, // 页面还原 binge/footnote 日期时复用同一偏移
  };
}

module.exports = {
  clampEp,
  normalizeTotalEp,
  resolvePeer,
  sanitizeAvatar,
  pickCoverColor,
  airDayLabelOf,
  safeTalkEp,
  buildProgressPair,
  sectionOf,
  buildItemViewModel,
  groupItems,
  buildBoardViewModel,
  buildPeerUpdates,
  foldEvents,
  describeEvent,
  relativeTime,
  // 报告数据层
  localDayIndex,
  dayIndexToMD,
  dayIndexToWeekday,
  daysTogether,
  boardSinceDay,
  windowProgress,
  momentumOf,
  currentStreakDays,
  currentStreakInfo,
  myStreakInfo,
  syncDays,
  syncInfo,
  bingePeak,
  dailyProgressSeries,
  buildWeeklyChart,
  mostInvestedItem,
  cumulativeStats,
  recentItemsProgress,
  myRecentProgress,
  doneTogetherItems,
  personalSummary,
  firstEventDayIndex,
  buildReportModel,
};

