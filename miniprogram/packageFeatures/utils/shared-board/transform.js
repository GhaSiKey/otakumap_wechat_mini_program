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
};

