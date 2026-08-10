/**
 * 共享追番板 transform 模块测试
 *
 * 零依赖，用 Node 原生跑：
 *   node tests/shared-board.test.js
 *
 * transform.js 是纯 CommonJS、不依赖小程序 API，可直接在 Node 下验证。
 * 覆盖：进度对比各分支、集数归一、首字色块、分区、软删除过滤、config 前后端漂移守卫。
 */
const T = require('../miniprogram/packageFeatures/utils/shared-board/transform');
const C = require('../miniprogram/packageFeatures/utils/shared-board/config');

// ── 极简断言框架（与 worldcup.test.js 一致）──
let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${a}\n     期望: ${e}`);
  }
}

// 构造一条 item 的辅助
function item(overrides) {
  return Object.assign(
    { _id: 'i1', name: '测试番', totalEp: null, airStatus: 'unknown', cover: '', deleted: false, createTime: 100, progress: {}, sortOrder: {} },
    overrides
  );
}

// ============================================================
// config 关键阈值存在性（防误删/漂移）
// ============================================================
eq('EP_ROLL_MAX 为正整数', Number.isInteger(C.EP_ROLL_MAX) && C.EP_ROLL_MAX > 0, true);
eq('EP_ROLL_MAX 不超无分母展示上限', C.EP_ROLL_MAX <= C.EP_PICKER_MAX_UNKNOWN, true);

// ============================================================
// clampEp：集数归一
// ============================================================
eq('clampEp 超总集数被截', T.clampEp(30, 28), 28);
eq('clampEp 负数非法', T.clampEp(-1, null), null);
eq('clampEp 无分母正常值', T.clampEp(5, null), 5);
eq('clampEp 非整数非法', T.clampEp(3.5, null), null);
eq('clampEp 无分母超兜底上限', T.clampEp(99999, null), C.EP_MAX_WHEN_UNKNOWN);
eq('clampEp 0 合法', T.clampEp(0, 28), 0);

// ============================================================
// normalizeTotalEp：总集数录入归一（与云函数整数守卫同规则）
// ============================================================
eq('normalizeTotalEp 空串 → null', T.normalizeTotalEp(''), null);
eq('normalizeTotalEp null → null', T.normalizeTotalEp(null), null);
eq('normalizeTotalEp 合法数字字符串', T.normalizeTotalEp('12'), 12);
eq('normalizeTotalEp 合法整数', T.normalizeTotalEp(24), 24);
eq('normalizeTotalEp 0 越下限 → null', T.normalizeTotalEp('0'), null);
eq('normalizeTotalEp 负数 → null', T.normalizeTotalEp('-3'), null);
eq('normalizeTotalEp 小数 → null', T.normalizeTotalEp('3.5'), null);
eq('normalizeTotalEp 超上限 → null', T.normalizeTotalEp(String(C.TOTAL_EP_MAX + 1)), null);
eq('normalizeTotalEp 上限边界合法', T.normalizeTotalEp(C.TOTAL_EP_MAX), C.TOTAL_EP_MAX);
eq('normalizeTotalEp 非数字文本 → null', T.normalizeTotalEp('abc'), null);

// ============================================================
// resolvePeer
// ============================================================
const twoMembers = [{ openid: 'me' }, { openid: 'pe' }];
eq('resolvePeer 2 人板返回对方', T.resolvePeer(twoMembers, 'me'), 'pe');
eq('resolvePeer 1 人板返回 null', T.resolvePeer([{ openid: 'me' }], 'me'), null);
eq('resolvePeer 非数组返回 null', T.resolvePeer(null, 'me'), null);

// ============================================================
// pickCoverColor：首字色块确定性
// ============================================================
const cc1 = T.pickCoverColor('葬送的芙莉莲');
const cc2 = T.pickCoverColor('葬送的芙莉莲');
eq('pickCoverColor 同名颜色恒定', cc1.color, cc2.color);
eq('pickCoverColor 取首字', cc1.char, '葬');
eq('pickCoverColor 色值在调色板内', C.COVER_PALETTE.includes(cc1.color), true);
eq('pickCoverColor 空名兜底', T.pickCoverColor('').char, '?');

// ============================================================
// safeTalkEp：能安全聊到第几集
// ============================================================
eq('safeTalkEp 取较小值', T.safeTalkEp(12, 8), 8);
eq('safeTalkEp 对方未翻牌为 0', T.safeTalkEp(12, 0), 0);

// ============================================================
// buildProgressPair：进度对比各分支
// ============================================================

// 我领先 · 有分母
const p1 = T.buildProgressPair(
  item({ totalEp: 28, progress: { me: { ep: 12, status: 'watching' }, pe: { ep: 8, status: 'watching' } } }),
  'me',
  'pe'
);
eq('我领先 lead=mine', p1.lead, 'mine');
eq('我领先 diff=4', p1.diff, 4);
eq('有分母 hasTotalEp', p1.hasTotalEp, true);
eq('我领先 gapMode=exact', p1.gapMode, 'exact');
eq('我领先 非重叠', p1.isOverlap, false);

// 对方领先
const p2 = T.buildProgressPair(
  item({ totalEp: 28, progress: { me: { ep: 5, status: 'watching' }, pe: { ep: 12, status: 'watching' } } }),
  'me',
  'pe'
);
eq('对方领先 lead=peer', p2.lead, 'peer');

// 持平 → 重叠
const p3 = T.buildProgressPair(
  item({ totalEp: 28, progress: { me: { ep: 10, status: 'watching' }, pe: { ep: 10, status: 'watching' } } }),
  'me',
  'pe'
);
eq('持平 lead=even', p3.lead, 'even');
eq('持平 isOverlap', p3.isOverlap, true);
eq('持平 diff=0', p3.diff, 0);

// 无总集数（MVP 常态）：领先者锚 AXIS_LEAD_ANCHOR
const p4 = T.buildProgressPair(
  item({ totalEp: null, progress: { me: { ep: 8, status: 'watching' }, pe: { ep: 12, status: 'watching' } } }),
  'me',
  'pe'
);
eq('无分母 hasTotalEp=false', p4.hasTotalEp, false);
eq('无分母 领先者锚 75', p4.peerPercent, C.VIEW.AXIS_LEAD_ANCHOR);
eq('无分母 落后者按比例', p4.minePercent, (8 / 12) * C.VIEW.AXIS_LEAD_ANCHOR);

// 进度回退（脏数据 ep > totalEp 被 clamp）
const p5 = T.buildProgressPair(
  item({ totalEp: 12, progress: { me: { ep: 99, status: 'watching' } } }),
  'me',
  'pe'
);
eq('回退 mine.ep 被 clamp 到 totalEp', p5.mine.ep, 12);
eq('回退 minePercent 不超 100', p5.minePercent <= 100, true);

// 对方未翻牌
const p6 = T.buildProgressPair(
  item({ totalEp: 28, progress: { me: { ep: 3, status: 'watching' } } }),
  'me',
  'pe'
);
eq('未翻牌 peer=null', p6.peer, null);
eq('未翻牌 hasPeer=false', p6.hasPeer, false);
eq('未翻牌 lead=none', p6.lead, 'none');
eq('未翻牌 diff=null', p6.diff, null);

// 砍防剧透后：中等差距不再有 blurred 模糊档，统一 exact（差 8 集，>5 但 ≤BREAK_GAP）
const p7 = T.buildProgressPair(
  item({ totalEp: 28, progress: { me: { ep: 2, status: 'watching' }, pe: { ep: 10, status: 'watching' } } }),
  'me',
  'pe'
);
eq('差 8 集 gapMode=exact（不再模糊）', p7.gapMode, 'exact');

// 断裂档（差 > BREAK_GAP）：纯视觉轴断裂，与剧透无关，保留
const p8 = T.buildProgressPair(
  item({ totalEp: 28, progress: { me: { ep: 2, status: 'watching' }, pe: { ep: 24, status: 'watching' } } }),
  'me',
  'pe'
);
eq('差 22 集 gapMode=break', p8.gapMode, 'break');

// ============================================================
// epExceedsTotal：某方原始集数 > 已设总集数（特别篇/漏设）
// 用 raw ep 判定（clamp 后看不出溢出），仅有分母时有意义
// ============================================================
const pEx1 = T.buildProgressPair(
  item({ totalEp: 12, progress: { me: { ep: 13, status: 'watching' } } }),
  'me',
  'pe'
);
eq('我超出总集数 epExceedsTotal=true', pEx1.epExceedsTotal, true);

const pEx2 = T.buildProgressPair(
  item({ totalEp: 12, progress: { me: { ep: 12, status: 'watching' }, pe: { ep: 14, status: 'watching' } } }),
  'me',
  'pe'
);
eq('对方超出也算 epExceedsTotal=true', pEx2.epExceedsTotal, true);

const pEx3 = T.buildProgressPair(
  item({ totalEp: 12, progress: { me: { ep: 12, status: 'watching' } } }),
  'me',
  'pe'
);
eq('正好等于总集数不算超出', pEx3.epExceedsTotal, false);

const pEx4 = T.buildProgressPair(
  item({ totalEp: null, progress: { me: { ep: 99, status: 'watching' } } }),
  'me',
  'pe'
);
eq('无分母无「超出」概念 epExceedsTotal=false', pEx4.epExceedsTotal, false);

// ============================================================
// 终止态：done 轴填满 100% / dropped 灰化不参与追赶
// ============================================================
// 看完(done)无总集数：游标强制 100%（不再停在 75% 锚点）
const pDone = T.buildProgressPair(
  item({ totalEp: null, progress: { me: { ep: 8, status: 'done' }, pe: { ep: 8, status: 'done' } } }),
  'me',
  'pe'
);
eq('done 无分母 minePercent=100', pDone.minePercent, 100);
eq('done 无分母 peerPercent=100', pDone.peerPercent, 100);
eq('双方 done 仍算追平 isOverlap', pDone.isOverlap, true);

// 单方 done（有总集数）也到 100
const pDone2 = T.buildProgressPair(
  item({ totalEp: 12, progress: { me: { ep: 12, status: 'done' }, pe: { ep: 6, status: 'watching' } } }),
  'me',
  'pe'
);
eq('done 有分母 minePercent=100', pDone2.minePercent, 100);

// 一方弃番(dropped)一方在追：dropped 标记 + 不触发追平合并
const pDrop = T.buildProgressPair(
  item({ totalEp: null, progress: { me: { ep: 4, status: 'watching' }, pe: { ep: 1, status: 'dropped' } } }),
  'me',
  'pe'
);
eq('TA 弃番 peerDropped=true', pDrop.peerDropped, true);
eq('TA 弃番 mineDropped=false', pDrop.mineDropped, false);
eq('有弃番 eitherDropped=true', pDrop.eitherDropped, true);

// 弃番方 ep 与在追方接近也不误判追平（eitherDropped 否决 overlap）
const pDropClose = T.buildProgressPair(
  item({ totalEp: 12, progress: { me: { ep: 6, status: 'watching' }, pe: { ep: 6, status: 'dropped' } } }),
  'me',
  'pe'
);
eq('弃番方 ep 接近不误判追平 isOverlap=false', pDropClose.isOverlap, false);

// 本人弃番也标记
const pMineDrop = T.buildProgressPair(
  item({ totalEp: null, progress: { me: { ep: 2, status: 'dropped' }, pe: { ep: 5, status: 'watching' } } }),
  'me',
  'pe'
);
eq('我弃番 mineDropped=true', pMineDrop.mineDropped, true);

// ============================================================
// sanitizeAvatar：cloud:// 净化为空，其余原样
// ============================================================
eq('cloud:// → 空（无法在 image 加载，避免 500）', T.sanitizeAvatar('cloud://env-x/avatars/a.png'), '');
eq('https 原样返回', T.sanitizeAvatar('https://x.com/a.png'), 'https://x.com/a.png');
eq('wxfile 临时路径原样（chooseAvatar 预览）', T.sanitizeAvatar('wxfile://tmp_123.png'), 'wxfile://tmp_123.png');
eq('空值 → 空', T.sanitizeAvatar(''), '');
eq('null → 空', T.sanitizeAvatar(null), '');

// ============================================================
// sectionOf：分区判定
// ============================================================
eq('两人 watching → TOGETHER', T.sectionOf('watching', 'watching'), C.SECTION.TOGETHER);
eq('一人 want 一人无进度 → NOT_STARTED', T.sectionOf('want', null), C.SECTION.NOT_STARTED);
eq('一方 dropped → PAUSED', T.sectionOf('watching', 'dropped'), C.SECTION.PAUSED);
eq('一方 paused → PAUSED', T.sectionOf('paused', 'watching'), C.SECTION.PAUSED);
eq('两人 done → DONE', T.sectionOf('done', 'done'), C.SECTION.DONE);
eq('一人 done 一人 watching → TOGETHER', T.sectionOf('done', 'watching'), C.SECTION.TOGETHER);

// ============================================================
// groupItems：分组、软删除过滤、组内排序、分区顺序
// ============================================================
const items = [
  item({ _id: 'a', name: '在追番', sortOrder: { me: 200 }, progress: { me: { ep: 3, status: 'watching' }, pe: { ep: 2, status: 'watching' } } }),
  item({ _id: 'b', name: '先加但序号大', sortOrder: { me: 300 }, progress: { me: { ep: 1, status: 'watching' }, pe: { ep: 1, status: 'watching' } } }),
  item({ _id: 'c', name: '排最前', sortOrder: { me: 100 }, progress: { me: { ep: 5, status: 'watching' }, pe: { ep: 5, status: 'watching' } } }),
  item({ _id: 'd', name: '想看的', progress: { me: { ep: 0, status: 'want' } } }),
  item({ _id: 'e', name: '都看完', progress: { me: { ep: 12, status: 'done' }, pe: { ep: 12, status: 'done' } } }),
  item({ _id: 'f', name: '被移出', deleted: true, deletedBy: 'me', progress: { me: { ep: 1, status: 'watching' } } }),
];
const groups = T.groupItems(items, 'me', 'pe');

// 软删除过滤：被移出的 f 不出现在任何组
const allIds = groups.reduce((acc, g) => acc.concat(g.items.map((v) => v.itemId)), []);
eq('软删除项被过滤', allIds.includes('f'), false);
eq('未删项全部在列', allIds.sort(), ['a', 'b', 'c', 'd', 'e']);

// 分区顺序：TOGETHER 在 NOT_STARTED 在 DONE 之前
eq('分区顺序遵循 SECTION_ORDER', groups.map((g) => g.sectionKey), [C.SECTION.TOGETHER, C.SECTION.NOT_STARTED, C.SECTION.DONE]);

// 组内按 sortOrder[me] 升序：TOGETHER 组应是 c(100) < a(200) < b(300)
const togetherGroup = groups.find((g) => g.sectionKey === C.SECTION.TOGETHER);
eq('组内按 sortOrder[me] 升序', togetherGroup.items.map((v) => v.itemId), ['c', 'a', 'b']);

// 分区标题：配对态用关系型标题（题已在 transform 内算好，WXML 直接取 sec.title）
eq('配对态分区标题', togetherGroup.title, C.SECTION_TITLES[C.SECTION.TOGETHER]);

// 筹备态（无 peer）：分区标题中性化
const soloGroups = T.groupItems(items, 'me', null);
const soloTogether = soloGroups.find((g) => g.sectionKey === C.SECTION.TOGETHER);
eq('筹备态分区标题中性化', soloTogether.title, C.SECTION_TITLES_SOLO[C.SECTION.TOGETHER]);

// ============================================================
// buildBoardViewModel：整板视图模型
// ============================================================
const board2 = {
  _id: 'b1',
  name: '我俩的番单',
  status: 'full',
  members: [
    { openid: 'me', nickname: '小高', avatar: '' },
    { openid: 'pe', nickname: '小王', avatar: '' },
  ],
};
const vm = T.buildBoardViewModel(board2, items, 'me');
eq('配对完 phase=paired', vm.phase, 'paired');
eq('识别对方成员', vm.peer.openid, 'pe');
eq('识别我方成员', vm.me.openid, 'me');
// commonCount：双方 ep≥1 且都在看/看完的番 = a,b,c,e 共 4（d 我 want、f 已删）
eq('N 部能一起聊 commonCount', vm.commonCount, 4);

// 未配对板 → waiting
const board1 = { _id: 'b2', name: '等待中', status: 'active', members: [{ openid: 'me', nickname: '小高', avatar: '' }] };
const vm1 = T.buildBoardViewModel(board1, [], 'me');
eq('未配对 phase=waiting', vm1.phase, 'waiting');
eq('未配对 peer=null', vm1.peer, null);

// 已归档板 → archived
const boardArc = { _id: 'b3', name: '归档', status: 'archived', members: board2.members };
eq('归档 phase=archived', T.buildBoardViewModel(boardArc, [], 'me').phase, 'archived');

// ============================================================
// buildPeerUpdates：进板结算「TA 在我上次查看后更新了什么」
// updateTime 用毫秒数（真实是 ISO 字符串，toMillis 兼容字符串/Date/数字）
// ============================================================
const puBoard = (myViewed) => ({
  _id: 'b1',
  name: '板',
  status: 'full',
  members: [
    { openid: 'me', nickname: '小高' },
    { openid: 'pe', nickname: '小王' },
  ],
  lastViewedAt: myViewed == null ? {} : { me: myViewed },
});
// 对方在 t=200 更新，我上次看是 t=100 → 应报为新动向
const puItems = [
  item({ _id: 'x', name: '进击的巨人', progress: { me: { ep: 3, status: 'watching', updateTime: 150 }, pe: { ep: 8, status: 'watching', updateTime: 200 } } }),
];
const pu1 = T.buildPeerUpdates(puBoard(100), puItems, 'me');
eq('TA 更新晚于我查看 → count=1', pu1.count, 1);
eq('TA 更新条目带番名', pu1.items[0].name, '进击的巨人');
eq('TA 更新条目带集数', pu1.items[0].ep, 8);

// 对方更新早于我查看 → 不算新
const pu2 = T.buildPeerUpdates(puBoard(300), puItems, 'me');
eq('TA 更新早于我查看 → count=0', pu2.count, 0);

// 我从没查看过（lastViewedAt 无我这格）→ 无基准，返回空
const pu3 = T.buildPeerUpdates(puBoard(null), puItems, 'me');
eq('我从没查看过 → count=0（无 diff 基准）', pu3.count, 0);

// 未配对（无对方）→ 空
const puSolo = { _id: 'b2', name: '单人', status: 'active', members: [{ openid: 'me' }], lastViewedAt: { me: 100 } };
eq('未配对 → count=0', T.buildPeerUpdates(puSolo, puItems, 'me').count, 0);

// 只统计对方进度，我自己的更新不算（即便晚于我查看）
const puMineOnly = [
  item({ _id: 'y', name: '我改的番', progress: { me: { ep: 5, status: 'watching', updateTime: 999 } } }),
];
eq('只有我更新 → count=0（不误报自己操作）', T.buildPeerUpdates(puBoard(100), puMineOnly, 'me').count, 0);

// 软删除的番不计入
const puDeleted = [
  item({ _id: 'z', name: '已删', deleted: true, progress: { pe: { ep: 9, status: 'watching', updateTime: 500 } } }),
];
eq('软删番不计入 TA 更新', T.buildPeerUpdates(puBoard(100), puDeleted, 'me').count, 0);

// 对方新加番（ep=0/want）虽写了 updateTime，但不算「追进度」，不报（避免「第 0 话」失真）
const puAdded = [
  item({ _id: 'w', name: '刚加的番', progress: { pe: { ep: 0, status: 'want', updateTime: 500 } } }),
];
eq('对方加番 ep=0 不计入（避免第0话）', T.buildPeerUpdates(puBoard(100), puAdded, 'me').count, 0);

// 多部按更新时间倒序（最新在前）
const puMulti = [
  item({ _id: 'a', name: '早更新', progress: { pe: { ep: 2, status: 'watching', updateTime: 200 } } }),
  item({ _id: 'b', name: '晚更新', progress: { pe: { ep: 4, status: 'watching', updateTime: 400 } } }),
];
const puM = T.buildPeerUpdates(puBoard(100), puMulti, 'me');
eq('多部 TA 更新 count=2', puM.count, 2);
eq('多部按更新时间倒序（最新在前）', puM.items[0].name, '晚更新');

// ============================================================
// ============================================================
// airDayLabelOf / VM airDayLabel：更新日角标（仅在播 + airDay 合法才显示）
// ============================================================
eq('airDayLabelOf 在播周四', T.airDayLabelOf('airing', 4), '周四' + C.AIR_DAY_COPY.SUFFIX);
eq('airDayLabelOf 在播周日(边界0)', T.airDayLabelOf('airing', 0), '周日' + C.AIR_DAY_COPY.SUFFIX);
eq('airDayLabelOf 在播周六(边界6)', T.airDayLabelOf('airing', 6), '周六' + C.AIR_DAY_COPY.SUFFIX);
eq('airDayLabelOf 完结不显示', T.airDayLabelOf('finished', 4), '');
eq('airDayLabelOf 未知不显示', T.airDayLabelOf('unknown', 4), '');
eq('airDayLabelOf 越界(7)不显示', T.airDayLabelOf('airing', 7), '');
eq('airDayLabelOf 负数不显示', T.airDayLabelOf('airing', -1), '');
eq('airDayLabelOf 非整数不显示', T.airDayLabelOf('airing', 3.5), '');
eq('airDayLabelOf null 不显示', T.airDayLabelOf('airing', null), '');
eq(
  'VM 在播带 airDayLabel',
  T.buildItemViewModel(item({ airStatus: 'airing', airDay: 4 }), 'me', null).airDayLabel,
  '周四' + C.AIR_DAY_COPY.SUFFIX
);
eq(
  'VM 完结不带 airDayLabel',
  T.buildItemViewModel(item({ airStatus: 'finished', airDay: 4 }), 'me', null).airDayLabel,
  ''
);
eq(
  'VM 无 airDay 不带 airDayLabel',
  T.buildItemViewModel(item({ airStatus: 'airing' }), 'me', null).airDayLabel,
  ''
);
// subtitle 三段拼接：放送状态 · 集数 · 更新日（更新日已并入 subtitle，同权重灰字，不再单列角标）
eq(
  'VM subtitle 三段全含更新日',
  T.buildItemViewModel(item({ airStatus: 'airing', totalEp: 12, airDay: 6 }), 'me', null).subtitle,
  [C.AIR_STATUS_LABELS.airing, '12 集', '周六' + C.AIR_DAY_COPY.SUFFIX].join(' · ')
);
eq(
  'VM subtitle 完结无更新日段',
  T.buildItemViewModel(item({ airStatus: 'finished', totalEp: 12, airDay: 6 }), 'me', null).subtitle,
  [C.AIR_STATUS_LABELS.finished, '12 集'].join(' · ')
);

// buildItemViewModel 透出 sourceId（绑定标记字段，加番时随 addItem 存）
// ============================================================
eq('VM 透出 sourceId（有值）', T.buildItemViewModel(item({ sourceId: 555 }), 'me', null).sourceId, 555);
eq('VM sourceId 缺省为 null', T.buildItemViewModel(item({}), 'me', null).sourceId, null);
eq('VM 非法 sourceId 归 null', T.buildItemViewModel(item({ sourceId: 0 }), 'me', null).sourceId, null);

// ============================================================
// foldEvents 历史事件折叠（阶段一 §5）
// 入参倒序（新→旧）；同番同人相邻 progress 折叠，其余独立成条。
// ============================================================
const PT = C.EVENT_TYPE.PROGRESS;
// 造一条 progress 事件（倒序里越靠前越新）
function ev(o) {
  return Object.assign(
    { _id: 'e', boardId: 'b', actor: 'me', type: PT, itemId: 'i1', itemName: '番A', payload: {}, createTime: 0 },
    o
  );
}

// 空/非数组
eq('foldEvents 空数组', T.foldEvents([]), []);
eq('foldEvents 非数组归空', T.foldEvents(null), []);

// 连续同番同人 progress（倒序：5→4→3）折叠成一条：区间 prevEp 取最老(2)、ep 取最新(5)
(() => {
  const events = [
    ev({ _id: 'e3', createTime: 300, payload: { prevEp: 4, ep: 5, prevStatus: 'watching', status: 'watching' } }),
    ev({ _id: 'e2', createTime: 200, payload: { prevEp: 3, ep: 4, prevStatus: 'watching', status: 'watching' } }),
    ev({ _id: 'e1', createTime: 100, payload: { prevEp: 2, ep: 3, prevStatus: 'watching', status: 'watching' } }),
  ];
  const folded = T.foldEvents(events);
  eq('折叠连续 progress → 1 条', folded.length, 1);
  eq('折叠 foldedCount=3', folded[0].foldedCount, 3);
  eq('折叠区间 prevEp 取最老', folded[0].payload.prevEp, 2);
  eq('折叠区间 ep 取最新', folded[0].payload.ep, 5);
  eq('折叠 createTime 保留最新', folded[0].createTime, 300);
  eq('折叠 firstCreateTime 取最老', folded[0].firstCreateTime, 100);
})();

// 不同人不折叠
(() => {
  const events = [
    ev({ _id: 'e2', actor: 'me', createTime: 200, payload: { prevEp: 4, ep: 5 } }),
    ev({ _id: 'e1', actor: 'ta', createTime: 100, payload: { prevEp: 3, ep: 4 } }),
  ];
  eq('不同人不折叠', T.foldEvents(events).length, 2);
})();

// 不同番不折叠
(() => {
  const events = [
    ev({ _id: 'e2', itemId: 'i2', createTime: 200, payload: { prevEp: 4, ep: 5 } }),
    ev({ _id: 'e1', itemId: 'i1', createTime: 100, payload: { prevEp: 3, ep: 4 } }),
  ];
  eq('不同番不折叠', T.foldEvents(events).length, 2);
})();

// 中间夹非 progress 事件 → 断开，两段各自不与对方合并
(() => {
  const events = [
    ev({ _id: 'e3', createTime: 300, payload: { prevEp: 4, ep: 5 } }),
    ev({ _id: 'e2', type: C.EVENT_TYPE.ITEM_EDIT, createTime: 200, payload: { fields: ['name'] } }),
    ev({ _id: 'e1', createTime: 100, payload: { prevEp: 2, ep: 3 } }),
  ];
  const folded = T.foldEvents(events);
  eq('夹非 progress 断开 → 3 条', folded.length, 3);
  eq('夹断后各段 foldedCount=1', folded.map((f) => f.foldedCount), [1, 1, 1]);
})();

// 加番/移出等非 progress 从不折叠，即便相邻同番同人
(() => {
  const events = [
    ev({ _id: 'e2', type: C.EVENT_TYPE.ITEM_ADD, createTime: 200 }),
    ev({ _id: 'e1', type: C.EVENT_TYPE.ITEM_ADD, createTime: 100 }),
  ];
  eq('非 progress 不折叠', T.foldEvents(events).length, 2);
})();

// 不改入参（纯函数）
(() => {
  const events = [
    ev({ _id: 'e2', createTime: 200, payload: { prevEp: 4, ep: 5 } }),
    ev({ _id: 'e1', createTime: 100, payload: { prevEp: 3, ep: 4 } }),
  ];
  const before = JSON.stringify(events);
  T.foldEvents(events);
  eq('foldEvents 不改入参', JSON.stringify(events), before);
})();

// ============================================================
// describeEvent 历史事件解读（选模板 + 插值变量，不拼串）
// ============================================================
// 主语判定
eq('describeEvent 我发起 → mine=true', T.describeEvent(ev({ actor: 'me' }), 'me').mine, true);
eq('describeEvent 对方发起 → mine=false', T.describeEvent(ev({ actor: 'ta' }), 'me').mine, false);

// 加番/移出/恢复直接映射类型
eq(
  'describeEvent item_add',
  T.describeEvent(ev({ type: C.EVENT_TYPE.ITEM_ADD, itemName: '番A' }), 'me').actionKey,
  'item_add'
);
eq(
  'describeEvent item_remove',
  T.describeEvent(ev({ type: C.EVENT_TYPE.ITEM_REMOVE }), 'me').actionKey,
  'item_remove'
);

// item_edit：改名分流 item_rename（带 from），非改名走 item_edit
(() => {
  const renamed = T.describeEvent(
    ev({ type: C.EVENT_TYPE.ITEM_EDIT, itemName: '新名', payload: { fields: ['name'], prevName: '旧名' } }),
    'me'
  );
  eq('describeEvent 改名 → item_rename', renamed.actionKey, 'item_rename');
  eq('describeEvent 改名带 from', renamed.vars.from, '旧名');
  eq(
    'describeEvent 改总集数 → item_edit',
    T.describeEvent(ev({ type: C.EVENT_TYPE.ITEM_EDIT, payload: { fields: ['totalEp'] } }), 'me').actionKey,
    'item_edit'
  );
})();

// progress：终止态优先于集数推进
eq(
  'describeEvent 看完 → progress_done',
  T.describeEvent(ev({ payload: { prevEp: 11, ep: 12, prevStatus: 'watching', status: 'done' } }), 'me').actionKey,
  'progress_done'
);
eq(
  'describeEvent 弃番 → progress_dropped',
  T.describeEvent(ev({ payload: { prevEp: 3, ep: 3, prevStatus: 'watching', status: 'dropped' } }), 'me').actionKey,
  'progress_dropped'
);

// progress：折叠区间用 from_to，单步用 to
(() => {
  const range = T.describeEvent(
    ev({ foldedCount: 3, payload: { prevEp: 2, ep: 5, prevStatus: 'watching', status: 'watching' } }),
    'me'
  );
  eq('describeEvent 折叠区间 → progress_from_to', range.actionKey, 'progress_from_to');
  eq('describeEvent 区间 from', range.vars.from, 2);
  eq('describeEvent 区间 to', range.vars.to, 5);
  const step = T.describeEvent(
    ev({ foldedCount: 1, payload: { prevEp: 4, ep: 5, prevStatus: 'watching', status: 'watching' } }),
    'me'
  );
  eq('describeEvent 单步 → progress_to', step.actionKey, 'progress_to');
  eq('describeEvent 单步 to', step.vars.to, 5);
})();

// progress：仅状态变化（想看→在追，ep 未动）
eq(
  'describeEvent 仅状态变化 → progress_status',
  T.describeEvent(ev({ payload: { prevEp: 0, ep: 0, prevStatus: 'want', status: 'watching' } }), 'me').actionKey,
  'progress_status'
);

// 每个 actionKey 在 config.HISTORY_COPY.ACTION 都有对应模板（防漏配）
(() => {
  const keys = [
    'item_add', 'item_remove', 'item_restore', 'item_edit', 'item_rename',
    'progress_done', 'progress_dropped', 'progress_paused', 'progress_to', 'progress_from_to', 'progress_status',
  ];
  const missing = keys.filter((k) => !C.HISTORY_COPY.ACTION[k]);
  eq('HISTORY_COPY.ACTION 覆盖所有 actionKey', missing, []);
})();

// ============================================================
// relativeTime 相对时间（纯函数，now 外部传入）
// 基准 now 用固定本地时间，避免依赖真实时钟。
// ============================================================
(() => {
  const now = new Date(2026, 6, 27, 15, 0, 0).getTime(); // 2026-07-27 15:00 本地
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  eq('relativeTime 非法 → 空', T.relativeTime('not-a-date', now), '');
  eq('relativeTime 30秒内 → 刚刚', T.relativeTime(now - 30 * 1000, now), '刚刚');
  eq('relativeTime 5分钟前', T.relativeTime(now - 5 * MIN, now), '5 分钟前');
  eq('relativeTime 3小时前', T.relativeTime(now - 3 * HOUR, now), '3 小时前');
  // 昨天 09:30
  const yst = new Date(2026, 6, 26, 9, 30, 0).getTime();
  eq('relativeTime 昨天 HH:mm', T.relativeTime(yst, now), '昨天 09:30');
  // 同年更早：M月D日 HH:mm
  const early = new Date(2026, 2, 3, 8, 5, 0).getTime();
  eq('relativeTime 同年更早 → M月D日 HH:mm', T.relativeTime(early, now), '3月3日 08:05');
  // 跨年：YYYY年M月D日
  const lastYear = new Date(2025, 11, 31, 20, 0, 0).getTime();
  eq('relativeTime 跨年 → YYYY年M月D日', T.relativeTime(lastYear, now), '2025年12月31日');
})();

// ============================================================
// 周报 / 报告数据层（board-report）
// 全用显式 UTC 毫秒构造，配固定时区偏移，不依赖运行机器时区。
// ============================================================
(() => {
  const TZ = C.REPORT.TZ_OFFSET_MINUTES; // 480 (UTC+8)
  const DAY = 24 * 60 * 60 * 1000;
  const ME = 'me-openid';
  const PEER = 'peer-openid';
  // 「北京某日某时」→ UTC 毫秒：Date.UTC 给的是 UTC，减去 8h 偏移即为该北京墙钟时刻的 UTC 时间戳
  const bj = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) - TZ * 60 * 1000;
  // progress 事件构造
  const ev = (actor, itemId, prevEp, ep, at, extra) =>
    Object.assign({ type: C.EVENT_TYPE.PROGRESS, actor, itemId, itemName: itemId, payload: { prevEp, ep }, createTime: at }, extra);

  // ── localDayIndex：凌晨归本地日不漂前一天 ──
  const d1noon = bj(2026, 7, 5, 12, 0); // 8/5 12:00 北京
  const d1late = bj(2026, 7, 5, 1, 30); // 8/5 01:30 北京（凌晨）
  const d2 = bj(2026, 7, 6, 9, 0); // 8/6
  eq('localDayIndex 同日中午/凌晨同桶', T.localDayIndex(d1noon, TZ), T.localDayIndex(d1late, TZ));
  eq('localDayIndex 跨日不同桶', T.localDayIndex(d2, TZ) - T.localDayIndex(d1noon, TZ), 1);
  // dayIndexToMD 还原
  eq('dayIndexToMD 还原月日', T.dayIndexToMD(T.localDayIndex(d1noon, TZ), TZ), { m: 8, d: 5 });
  // dayIndexToWeekday 还原星期（0=周日 … 6=周六，与 AIR_DAY_LABELS 同序）
  eq('dayIndexToWeekday 工作日(8/5=周三)', T.dayIndexToWeekday(T.localDayIndex(d1noon, TZ), TZ), 3);
  eq('dayIndexToWeekday 周六(8/8)', T.dayIndexToWeekday(T.localDayIndex(bj(2026, 7, 8, 12, 0), TZ), TZ), 6);
  eq('dayIndexToWeekday 周日(8/9)', T.dayIndexToWeekday(T.localDayIndex(bj(2026, 7, 9, 12, 0), TZ), TZ), 0);
  eq('dayIndexToWeekday 凌晨不漂前一天', T.dayIndexToWeekday(T.localDayIndex(d1late, TZ), TZ), 3);

  // ── daysTogether ──
  const board = { _id: 'b1', createTime: bj(2026, 7, 1, 10, 0), members: [{ openid: ME }, { openid: PEER }], status: 'active' };
  eq('daysTogether 建板当天=第1天', T.daysTogether(board, bj(2026, 7, 1, 22, 0), TZ), 1);
  eq('daysTogether 第5天', T.daysTogether(board, bj(2026, 7, 5, 9, 0), TZ), 5);
  eq('daysTogether 非法建板→0', T.daysTogether({ createTime: 'x' }, bj(2026, 7, 5, 9, 0), TZ), 0);

  // ── windowProgress（progressGain 内部覆盖：回退不计负）──
  const now = bj(2026, 7, 10, 12, 0);
  const winEvents = [
    ev(ME, 'i1', 2, 5, bj(2026, 7, 9, 20, 0)), // 近窗，我 +3
    ev(PEER, 'i1', 0, 4, bj(2026, 7, 8, 20, 0)), // 近窗，TA +4
    ev(ME, 'i2', 10, 8, bj(2026, 7, 7, 20, 0)), // 近窗，回退不计负 → 0
    ev(ME, 'i1', 0, 6, bj(2026, 7, 1, 20, 0)), // 前窗，我 +6
    ev(PEER, 'i2', 0, 2, bj(2026, 7, 2, 20, 0)), // 前窗，TA +2
  ];
  const recent = T.windowProgress(winEvents, ME, PEER, now - 7 * DAY, now);
  eq('windowProgress 近窗我+3', recent.me, 3);
  eq('windowProgress 近窗TA+4', recent.peer, 4);
  const prev = T.windowProgress(winEvents, ME, PEER, now - 14 * DAY, now - 7 * DAY);
  eq('windowProgress 前窗我+6', prev.me, 6);
  eq('windowProgress 前窗TA+2', prev.peer, 2);

  // ── momentumOf 方向（稳定带=1）──
  const band = C.REPORT.MOMENTUM_STABLE_BAND;
  eq('momentum 升', T.momentumOf(10, 5, band), 'up');
  eq('momentum 降', T.momentumOf(3, 10, band), 'down');
  eq('momentum 带内稳定', T.momentumOf(6, 5, band), 'flat');
  eq('momentum 相等稳定', T.momentumOf(4, 4, band), 'flat');

  // ── currentStreakDays（宽限=1，Duolingo 式）──
  const grace = C.REPORT.STREAK_GRACE_DAYS;
  // 连续 8/8、8/9、8/10 三天有追，now=8/10 → streak 3
  const streakEvents = [
    ev(ME, 'i1', 0, 1, bj(2026, 7, 10, 21, 0)),
    ev(ME, 'i1', 1, 2, bj(2026, 7, 9, 21, 0)),
    ev(PEER, 'i1', 0, 1, bj(2026, 7, 8, 21, 0)),
  ];
  eq('streak 连续3天', T.currentStreakDays(streakEvents, bj(2026, 7, 10, 23, 0), TZ, grace), 3);
  // 清晨宽限：now=8/11 06:00，最近追番在 8/10（昨天）→ 仍存活=3
  eq('streak 清晨宽限仍存活', T.currentStreakDays(streakEvents, bj(2026, 7, 11, 6, 0), TZ, grace), 3);
  // 断超过宽限：now=8/13，最近追番 8/10（3天前）→ 归零
  eq('streak 断超宽限归零', T.currentStreakDays(streakEvents, bj(2026, 7, 13, 12, 0), TZ, grace), 0);
  eq('streak 无记录→0', T.currentStreakDays([], now, TZ, grace), 0);
  // 中间断开：8/10 有、8/9 无、8/8 有 → 从最近往回只连到 8/10 =1
  const gapEvents = [ev(ME, 'i1', 0, 1, bj(2026, 7, 10, 21, 0)), ev(ME, 'i1', 1, 2, bj(2026, 7, 8, 21, 0))];
  eq('streak 中间断开只数最近段', T.currentStreakDays(gapEvents, bj(2026, 7, 10, 23, 0), TZ, grace), 1);

  // ── syncDays（同天两人追同番）──
  const syncEvents = [
    ev(ME, 'i1', 0, 1, bj(2026, 7, 5, 10, 0)), // 8/5 我追 i1
    ev(PEER, 'i1', 0, 2, bj(2026, 7, 5, 22, 0)), // 8/5 TA 也追 i1 → 神同步日
    ev(ME, 'i2', 0, 1, bj(2026, 7, 6, 10, 0)), // 8/6 我追 i2
    ev(PEER, 'i3', 0, 1, bj(2026, 7, 6, 10, 0)), // 8/6 TA 追 i3（不同番，不算）
  ];
  eq('syncDays 同天同番=1', T.syncDays(syncEvents, ME, PEER, TZ), 1);
  eq('syncDays 未配对=0', T.syncDays(syncEvents, ME, null, TZ), 0);

  // ── bingePeak（单日推进峰值）──
  const bingeEvents = [
    ev(ME, 'i1', 0, 3, bj(2026, 7, 5, 10, 0)), // 8/5 我 i1 +3
    ev(ME, 'i2', 0, 5, bj(2026, 7, 5, 20, 0)), // 8/5 我 i2 +5 → 当天合计8，峰值番=i2
    ev(PEER, 'i1', 0, 2, bj(2026, 7, 6, 10, 0)), // 8/6 TA +2
  ];
  const peak = T.bingePeak(bingeEvents, ME, TZ);
  eq('bingePeak 峰值话数', peak.ep, 8);
  eq('bingePeak 是我', peak.mine, true);
  eq('bingePeak 峰值番', peak.itemName, 'i2');
  eq('bingePeak 日期还原', T.dayIndexToMD(peak.dayIndex, TZ), { m: 8, d: 5 });
  eq('bingePeak 无记录→null', T.bingePeak([], ME, TZ), null);

  // ── currentStreakInfo（富信息：起始日）──
  const si = T.currentStreakInfo(streakEvents, bj(2026, 7, 10, 23, 0), TZ, grace);
  eq('streakInfo 天数', si.days, 3);
  // 连续段 8/8~8/10，起始日=8/8
  eq('streakInfo 起始日还原', T.dayIndexToMD(si.startDay, TZ), { m: 8, d: 8 });
  eq('streakInfo 无记录 startDay=null', T.currentStreakInfo([], now, TZ, grace).startDay, null);

  // ── syncInfo（富信息：最近同步日 + 番名）──
  const syncEvents2 = [
    ev(ME, 'i1', 0, 1, bj(2026, 7, 5, 10, 0), { itemName: '药屋' }),
    ev(PEER, 'i1', 0, 2, bj(2026, 7, 5, 22, 0), { itemName: '药屋' }), // 8/5 同步《药屋》
    ev(ME, 'i2', 0, 1, bj(2026, 7, 6, 10, 0), { itemName: '芙莉莲' }),
    ev(PEER, 'i2', 0, 2, bj(2026, 7, 6, 20, 0), { itemName: '芙莉莲' }), // 8/6 同步《芙莉莲》→ 更近
  ];
  const syi = T.syncInfo(syncEvents2, ME, PEER, TZ);
  eq('syncInfo 天数', syi.count, 2);
  eq('syncInfo 最近同步日', T.dayIndexToMD(syi.lastDay, TZ), { m: 8, d: 6 });
  eq('syncInfo 最近同步番名', syi.lastItemName, '芙莉莲');
  eq('syncInfo 未配对 lastDay=null', T.syncInfo(syncEvents2, ME, null, TZ).lastDay, null);

  // ── dailyProgressSeries（每日双色堆叠柱）──
  const chartEvents = [
    ev(ME, 'i1', 0, 3, bj(2026, 7, 8, 10, 0)), // 8/8 我+3
    ev(PEER, 'i1', 0, 2, bj(2026, 7, 8, 20, 0)), // 8/8 TA+2 → 当天 total 5
    // 8/9 无人推进 → 中间零柱
    ev(ME, 'i2', 0, 4, bj(2026, 7, 10, 10, 0)), // 8/10 我+4
    ev(ME, 'i2', 6, 2, bj(2026, 7, 10, 12, 0)), // 回退不计负
  ];
  const chart = T.dailyProgressSeries(chartEvents, ME, PEER, bj(2026, 7, 10, 23, 0), TZ, 14);
  eq('chart 从首记录日到今天连续铺满', chart.bars.length, 3); // 8/8,8/9,8/10
  eq('chart 首柱我', chart.bars[0].me, 3);
  eq('chart 首柱TA', chart.bars[0].peer, 2);
  eq('chart 中间零柱', chart.bars[1].total, 0);
  eq('chart 末柱我', chart.bars[2].me, 4);
  eq('chart 峰值', chart.max, 5);
  eq('chart 窗口上限截断', T.dailyProgressSeries(chartEvents, ME, PEER, bj(2026, 7, 10, 23, 0), TZ, 2).bars.length, 2);
  eq('chart 无记录→空', T.dailyProgressSeries([], ME, PEER, now, TZ, 14).bars.length, 0);

  // ── mostInvestedItem（合计集数最高的本命番）──
  const heroItems = [
    item({ _id: 'h1', name: '芙莉莲', cover: 'https://x/f.jpg', progress: { [ME]: { ep: 8, status: 'watching' }, [PEER]: { ep: 6, status: 'watching' } } }), // 合计14
    item({ _id: 'h2', name: '药屋', progress: { [ME]: { ep: 20, status: 'dropped' }, [PEER]: { ep: 2, status: 'watching' } } }), // 我弃番不计→合计2
    item({ _id: 'h3', name: '软删', deleted: true, progress: { [ME]: { ep: 99, status: 'watching' } } }), // 软删不计
  ];
  const hero = T.mostInvestedItem(heroItems, ME, PEER);
  eq('hero 取合计最高', hero.itemId, 'h1');
  eq('hero 合计话数', hero.total, 14);
  eq('hero 我方集数', hero.me, 8);
  eq('hero 对方集数', hero.peer, 6);
  eq('hero 带封面', hero.cover, 'https://x/f.jpg');
  eq('hero 弃番方不计入合计', T.mostInvestedItem([heroItems[1]], ME, PEER).total, 2);
  eq('hero 无有效番→null', T.mostInvestedItem([], ME, PEER), null);

  // ── cumulativeStats（快照，任一人done）──
  const cItems = [
    item({ _id: 'a', progress: { [ME]: { ep: 12, status: 'done' }, [PEER]: { ep: 5, status: 'watching' } } }),
    item({ _id: 'b', progress: { [ME]: { ep: 3, status: 'watching' }, [PEER]: { ep: 3, status: 'watching' } } }),
    item({ _id: 'c', deleted: true, progress: { [ME]: { ep: 1, status: 'done' } } }), // 软删不计
  ];
  const cum = T.cumulativeStats(cItems, ME, PEER, 1);
  eq('cumulative 一起追(未删)', cum.together, 2);
  eq('cumulative 追完(任一done)', cum.done, 1);
  eq('cumulative 能聊沿用commonCount', cum.common, 1);

  // ── personalSummary（计数 + 足迹 + 各状态封面条）──
  const ps = T.personalSummary(cItems, ME, 6);
  eq('personal 追完', ps.done, 1);
  eq('personal 在追', ps.watching, 1);
  eq('personal 弃番', ps.dropped, 0);
  // 足迹 = 我在所有番的 ep 累加：a(done ep12) + b(watching ep3) = 15（c 软删不计）
  eq('personal 足迹累加 ep', ps.footprint, 15);
  eq('personal done 封面条计数', ps.doneItems.count, 1);
  eq('personal watching 封面条计数', ps.watchingItems.count, 1);
  eq('personal dropped 封面条空', ps.droppedItems.count, 0);
  eq('personal 封面条带番名', typeof ps.doneItems.items[0].name === 'string', true);
  // strip limit：多番时按我方 ep 降序截断，count 仍全量
  const manyItems = [
    item({ _id: 'w1', name: 'A', progress: { [ME]: { ep: 2, status: 'watching' } } }),
    item({ _id: 'w2', name: 'B', progress: { [ME]: { ep: 9, status: 'watching' } } }),
    item({ _id: 'w3', name: 'C', progress: { [ME]: { ep: 5, status: 'watching' } } }),
  ];
  const psMany = T.personalSummary(manyItems, ME, 2);
  eq('personal strip 截断到 limit', psMany.watchingItems.items.length, 2);
  eq('personal strip count 全量', psMany.watchingItems.count, 3);
  eq('personal strip 按 ep 降序首位', psMany.watchingItems.items[0].itemId, 'w2');

  // ── firstEventDayIndex ──
  eq('firstEventDay 取最早', T.firstEventDayIndex(winEvents, TZ), T.localDayIndex(bj(2026, 7, 1, 20, 0), TZ));
  eq('firstEventDay 空→null', T.firstEventDayIndex([], TZ), null);

  // ── recentItemsProgress（近窗推得最猛的番 top N，带封面）──
  const riItems = [
    item({ _id: 'i1', name: '芙莉莲', cover: 'https://x/1.jpg', progress: {} }),
    item({ _id: 'i2', name: '药屋少女', cover: '', progress: {} }),
    item({ _id: 'i3', name: '葬送', progress: {} }),
    item({ _id: 'gone', name: '已删', deleted: true, progress: {} }),
  ];
  const riEvents = [
    ev(ME, 'i1', 0, 5, bj(2026, 7, 9, 20, 0)), // 近窗 i1 我+5
    ev(PEER, 'i1', 0, 3, bj(2026, 7, 9, 21, 0)), // 近窗 i1 TA+3 → i1 合计8
    ev(ME, 'i2', 0, 4, bj(2026, 7, 8, 20, 0)), // 近窗 i2 我+4 → 合计4
    ev(PEER, 'i3', 0, 2, bj(2026, 7, 8, 20, 0)), // 近窗 i3 TA+2 → 合计2
    ev(ME, 'gone', 0, 9, bj(2026, 7, 9, 20, 0)), // 番已删 → 不列
    ev(ME, 'i2', 5, 3, bj(2026, 7, 8, 22, 0)), // 回退不计负
    ev(ME, 'i1', 0, 6, bj(2026, 7, 1, 20, 0)), // 前窗 → 不计入近窗
  ];
  const ri = T.recentItemsProgress(riEvents, riItems, ME, PEER, now - 7 * DAY, now, 3);
  eq('recentItems 条数(过滤已删)', ri.length, 3);
  eq('recentItems 按合计降序首位', ri[0].itemId, 'i1');
  eq('recentItems 首位合计', ri[0].total, 8);
  eq('recentItems 首位我方', ri[0].me, 5);
  eq('recentItems 首位对方', ri[0].peer, 3);
  eq('recentItems 带番名', ri[0].name, '芙莉莲');
  eq('recentItems 有封面原样带', ri[0].cover, 'https://x/1.jpg');
  eq('recentItems 无封面给首字兜底', ri[1].coverFallback.char, T.pickCoverColor('药屋少女').char);
  eq('recentItems limit 生效', T.recentItemsProgress(riEvents, riItems, ME, PEER, now - 7 * DAY, now, 1).length, 1);
  eq('recentItems 无事件→空', T.recentItemsProgress([], riItems, ME, PEER, now - 7 * DAY, now, 3).length, 0);

  // ── myRecentProgress（只算我一人的近窗推进）──
  const mr = T.myRecentProgress(riEvents, riItems, ME, now - 7 * DAY, now, 3);
  // 我近窗推进：i1+5、i2+4（i2 回退不计负）、gone+9(番已删不列但计入total)；TA 的 i1+3/i3+2 不算
  eq('myRecent total 只含我(5+4+9)', mr.total, 18);
  eq('myRecent 列表排除已删番', mr.items.length, 2);
  eq('myRecent 按我方话数降序首位', mr.items[0].itemId, 'i1');
  eq('myRecent 首位我方话数', mr.items[0].me, 5);
  eq('myRecent 次位', mr.items[1].itemId, 'i2');
  eq('myRecent 不含对方字段', mr.items[0].peer, undefined);
  eq('myRecent limit 生效', T.myRecentProgress(riEvents, riItems, ME, now - 7 * DAY, now, 1).items.length, 1);
  eq('myRecent 无事件→空且total0', T.myRecentProgress([], riItems, ME, now - 7 * DAY, now, 3).total, 0);

  // ── doneTogetherItems（任一人done，带封面）──
  const dtItems = [
    item({ _id: 'd1', name: '进击的巨人', progress: { [ME]: { ep: 25, status: 'done' }, [PEER]: { ep: 3, status: 'watching' } } }),
    item({ _id: 'd2', name: '鬼灭', progress: { [ME]: { ep: 2, status: 'watching' }, [PEER]: { ep: 26, status: 'done' } } }),
    item({ _id: 'd3', name: '在追', progress: { [ME]: { ep: 1, status: 'watching' } } }),
    item({ _id: 'd4', name: '软删', deleted: true, progress: { [ME]: { ep: 1, status: 'done' } } }),
  ];
  const dt = T.doneTogetherItems(dtItems, ME, PEER, 8);
  eq('doneTogether 总数(任一done,不含软删)', dt.total, 2);
  eq('doneTogether 封面片段数', dt.items.length, 2);
  eq('doneTogether 带番名', dt.items[0].name, '进击的巨人');
  const dtCap = T.doneTogetherItems(dtItems, ME, PEER, 1);
  eq('doneTogether limit 截断但 total 全量', dtCap.items.length === 1 && dtCap.total === 2, true);

  // ── buildReportModel 组装 + 空窗 + 无行为数据 ──
  const full = T.buildReportModel({ board, items: cItems, events: streakEvents, myOpenid: ME, nowMs: bj(2026, 7, 10, 23, 0), commonCount: 1 });
  eq('report 天数', full.daysTogether, 10);
  eq('report streak', full.streak.days, 3);
  eq('report 有行为数据', full.hasBehaviorData, true);
  eq('report 累计追完', full.cumulative.done, 1);
  eq('report 含 recentItems 数组', Array.isArray(full.recentItems), true);
  eq('report 含 doneItems 结构', typeof full.doneItems.total === 'number' && Array.isArray(full.doneItems.items), true);
  eq('report doneItems 追完1部', full.doneItems.total, 1);
  eq('report streak 富信息(含startDay)', typeof full.streak.days === 'number' && 'startDay' in full.streak, true);
  eq('report sync 富信息(含lastDay)', typeof full.sync.count === 'number' && 'lastDay' in full.sync, true);
  eq('report 含 dailySeries 结构', Array.isArray(full.dailySeries.bars) && typeof full.dailySeries.max === 'number', true);
  eq('report hero 取本命(cItems合计最高=a)', full.hero.itemId, 'a');
  // 无任何事件 → 只有快照，行为块隐藏
  const bare = T.buildReportModel({ board, items: cItems, events: [], myOpenid: ME, nowMs: now, commonCount: 1 });
  eq('report 无事件 hasBehaviorData=false', bare.hasBehaviorData, false);
  eq('report 无事件仍有累计', bare.cumulative.together, 2);
  eq('report 无事件 streak=0', bare.streak.days, 0);
  eq('report 无事件 footnote 日=null', bare.firstEventDay, null);
  // 空窗召回：有历史事件但都在窗外，近窗无推进、名场面全空
  const oldOnly = [ev(ME, 'i1', 0, 1, bj(2026, 6, 1, 10, 0))]; // 7/1，远早于 now=8/10
  const empty = T.buildReportModel({ board, items: cItems, events: oldOnly, myOpenid: ME, nowMs: bj(2026, 7, 10, 12, 0), commonCount: 1 });
  eq('report 空窗召回', empty.emptyWindow, true);
  eq('report 空窗仍标记有行为数据', empty.hasBehaviorData, true);
})();

// ============================================================
// config 前后端漂移守卫（docs/shared-board-data.md §5.2）
// 云函数侧 constants.js 是前端 config.js 服务端子集的拷贝，键值必须一致。
// ============================================================
const S = require('../cloudfunctions/_shared-board/constants');
eq('漂移守卫 COLLECTION 一致', S.COLLECTION, C.COLLECTION);
eq('漂移守卫 EVENT_TYPE 一致', S.EVENT_TYPE, C.EVENT_TYPE);
eq('漂移守卫 人数上限一致', S.BOARD_MEMBER_LIMIT, C.BOARD_MEMBER_LIMIT);
eq('漂移守卫 BOARD_STATUS 一致', S.BOARD_STATUS, C.BOARD_STATUS);
eq('漂移守卫 MEMBER_ROLE 一致', S.MEMBER_ROLE, C.MEMBER_ROLE);
eq('漂移守卫 AIR_STATUS 一致', S.AIR_STATUS, C.AIR_STATUS);
eq('漂移守卫 PROGRESS_STATUS 一致', S.PROGRESS_STATUS, C.PROGRESS_STATUS);
eq('漂移守卫 EP_MAX_WHEN_UNKNOWN 一致', S.EP_MAX_WHEN_UNKNOWN, C.EP_MAX_WHEN_UNKNOWN);
eq('漂移守卫 TOTAL_EP_MAX 一致', S.TOTAL_EP_MAX, C.TOTAL_EP_MAX);
eq('漂移守卫 TOTAL_EP_MIN 一致', S.TOTAL_EP_MIN, C.TOTAL_EP_MIN);
eq('漂移守卫 ITEM_SHARED_FIELDS 一致', S.ITEM_SHARED_FIELDS, C.ITEM_SHARED_FIELDS);
eq('漂移守卫 ERR 一致', S.ERR, C.ERR);

// getBoardReport 云函数复用前端同构纯模块（config/transform 逐字拷贝，算法单一实现）。
// 拷贝必须与前端逐字一致，否则「搬 transform 进云函数」会退化成两份各改各的实现。
(() => {
  const fs = require('fs');
  const path = require('path');
  const front = (p) => fs.readFileSync(path.join(__dirname, '../miniprogram/packageFeatures/utils/shared-board', p), 'utf8');
  const server = (p) => fs.readFileSync(path.join(__dirname, '../cloudfunctions/getBoardReport', p), 'utf8');
  eq('漂移守卫 getBoardReport/config.js 逐字一致', server('config.js') === front('config.js'), true);
  eq('漂移守卫 getBoardReport/transform.js 逐字一致', server('transform.js') === front('transform.js'), true);
})();

// ============================================================
// 汇总输出
// ============================================================
console.log('\n共享追番板 transform 模块测试');
console.log('─'.repeat(40));
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('─'.repeat(40));
}
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);

