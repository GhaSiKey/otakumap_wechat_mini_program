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
  BOARD_MEMBER_LIMIT,
  BOARD_STATUS,
  SECTION,
  SECTION_ORDER,
  SECTION_TITLES,
  SECTION_TITLES_SOLO,
  COVER_PALETTE,
  AIR_STATUS_LABELS,
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
  const subtitle = [airLabel, epLabel].filter(Boolean).join(' · ');
  return {
    itemId: item._id,
    name: item.name,
    airStatus: item.airStatus,
    airLabel,
    totalEp,
    subtitle,
    cover: item.cover || '',
    coverFallback: pickCoverColor(item.name), // cover 为空时页面用它
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

module.exports = {
  clampEp,
  normalizeTotalEp,
  resolvePeer,
  sanitizeAvatar,
  pickCoverColor,
  safeTalkEp,
  buildProgressPair,
  sectionOf,
  buildItemViewModel,
  groupItems,
  buildBoardViewModel,
  buildPeerUpdates,
};

