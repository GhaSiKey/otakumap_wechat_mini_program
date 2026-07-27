/**
 * config.js — 共享追番板配置（权威源）
 *
 * 所有集合名 / 人数上限 / 状态枚举 / 错误码 / 阈值 / 文案一律集中于此，
 * 业务代码只引符号名，不写字面量（对齐项目「禁止硬编码」约束）。
 *
 * 纯 CommonJS，不依赖小程序 API，可被前端页面、transform.js、Node 测试共同 require。
 * 云函数无法 require 本文件（各云函数目录独立打包），采用「服务端子集拷贝 + 深比较守卫测试」
 * 保持同源，详见 docs/shared-board-data.md §5.2。
 */

// ── 集合名 ──
const COLLECTION = {
  BOARD: 'shared_boards',
  ITEM: 'shared_board_items',
  NUDGE: 'shared_board_nudges', // Should：催更事件流，MVP 不建
};

// ── 人数上限（固定 2 人配对，不写死数字 2）──
const BOARD_MEMBER_LIMIT = 2;

// ── 状态枚举 ──
const BOARD_STATUS = { ACTIVE: 'active', FULL: 'full', ARCHIVED: 'archived' };
const MEMBER_ROLE = { OWNER: 'owner', GUEST: 'guest' };
const AIR_STATUS = { AIRING: 'airing', FINISHED: 'finished', UNKNOWN: 'unknown' };
// 放送状态中文标签（卡片信息密度用；unknown 不显示，不硬造文案）
const AIR_STATUS_LABELS = { airing: '放送中', finished: '已完结', unknown: '' };
// 番剧信息编辑弹层的放送状态可选项（顺序即展示顺序）。
// 编辑态 unknown 用「未定」而非空——展示态可以留白，但让人「选」时必须给可点的实义标签。
const AIR_STATUS_OPTIONS = [
  { value: AIR_STATUS.AIRING, label: '放送中' },
  { value: AIR_STATUS.FINISHED, label: '已完结' },
  { value: AIR_STATUS.UNKNOWN, label: '未定' },
];

// 进度状态机（PRD §5.2）：想看 / 在追 / 追平待更 / 暂缓 / 看完 / 弃番
const PROGRESS_STATUS = ['want', 'watching', 'caught_up', 'paused', 'done', 'dropped'];
const PROGRESS_STATUS_DEFAULT = 'want';

// ── 集数边界 ──
const EP_MIN = 0; // 0 = 未开追
const EP_MAX_WHEN_UNKNOWN = 9999; // 无 totalEp 时的上限兜底（后端 clamp 用）
// 总集数录入上限：与无分母兜底同量级（柯南上千、海贼上千均在内），防手滑输天文数字
const TOTAL_EP_MAX = 9999;
const TOTAL_EP_MIN = 1; // 总集数至少 1 集（0/负数无意义，走「未设」而非填 0）
const EP_PICKER_MAX_UNKNOWN = 99; // 无 totalEp 时选集器展示上限（滚轮别太长，够用即可）
// 滚轮/数字输入分界：总集数 ≤ 此值用滚轮（一季标准番 12/24 集），> 此值或无分母（长番/连续放送，
// 如凡人 183、柯南上千）改数字键盘直接输入——让人滚一两百格选集数是反人类的（纯前端展示阈值）
const EP_ROLL_MAX = 24;

// ── 配对 token ──
const PAIR_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 有效期 24h

// ── 文案 / 长度 ──
const DEFAULT_BOARD_NAME = '我俩的番单';
const BOARD_NAME_MAX = 20;
const ITEM_NAME_MAX = 60;

// updateItem 可改的共享字段白名单（防越权改私有/受控字段）
const ITEM_SHARED_FIELDS = ['name', 'totalEp', 'airStatus', 'cover'];

// 催更冷却（Should）
const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;

// ── 错误码 ──
const ERR = {
  OK: 'OK',
  UNAUTHENTICATED: 'ERR_UNAUTHENTICATED',
  INTERNAL: 'ERR_INTERNAL',
  INVALID_PARAM: 'ERR_INVALID_PARAM',
  BOARD_NOT_FOUND: 'ERR_BOARD_NOT_FOUND',
  NOT_MEMBER: 'ERR_NOT_MEMBER',
  BOARD_FULL: 'ERR_BOARD_FULL',
  TOKEN_INVALID: 'ERR_TOKEN_INVALID',
  TOKEN_EXPIRED: 'ERR_TOKEN_EXPIRED',
  TOKEN_USED: 'ERR_TOKEN_USED',
  ITEM_NOT_FOUND: 'ERR_ITEM_NOT_FOUND',
  DUPLICATE_ITEM: 'ERR_DUPLICATE_ITEM',
  INVALID_EP: 'ERR_INVALID_EP',
  INVALID_STATUS: 'ERR_INVALID_STATUS',
};

// 「加入板」场景各错误码对应的用户提示（标题 + 内容），集中配置不硬编码进页面
const JOIN_ERR_MESSAGES = {
  [ERR.BOARD_FULL]: { title: '来晚一步', content: '这个板已经满啦' },
  [ERR.BOARD_NOT_FOUND]: { title: '板不存在', content: '这个板可能已被解散' },
  [ERR.TOKEN_INVALID]: { title: '邀请无效', content: '链接不完整，让 TA 重新分享' },
  [ERR.TOKEN_EXPIRED]: { title: '邀请过期', content: '邀请链接已过期，让 TA 重新分享' },
  [ERR.TOKEN_USED]: { title: '邀请失效', content: '这个邀请已被使用，让 TA 重新分享' },
  _default: { title: '加入失败', content: '请稍后重试' },
};

// ── 视图层阈值（transform.js 用，UI 规格 §8）──
const VIEW = {
  AXIS_LEAD_ANCHOR: 75, // 无分母时领先者游标锚定在轴的百分比位置
  OVERLAP_PCT: 3, // 两游标间距 < 此值 → 判定追平重叠 ◉
  BREAK_GAP: 12, // 集数差 > 此值 → 轴断裂波浪，不等比拉伸（纯视觉降级，与剧透无关）
  // BLUR_GAP 已删（2026-07-23 砍防剧透）：原用于「领先幅度模糊档」，进度信息现全透明
};

// ── 分区（UI 规格 §P2，顺序即展示顺序，不硬编码）──
const SECTION = {
  TOGETHER: 'together', // 一起追
  NOT_STARTED: 'not_started', // 还没开追
  PAUSED: 'paused', // 暂缓 / 下车了
  DONE: 'done', // 一起追完了
};
const SECTION_ORDER = [SECTION.TOGETHER, SECTION.NOT_STARTED, SECTION.PAUSED, SECTION.DONE];

// 「N 部能一起聊」共同话题带文案（门面核心卖点，配对态 commonCount>0 才显示）。
// 数字由前端插，前后缀集中配置不硬编码进 wxml。
const COMMON_TALK = {
  ICON: '💬',
  PREFIX: '', // 数字前缀（如需「有」等前置词放这）
  SUFFIX: ' 部能一起聊', // 数字后缀
};

// 分区标题文案（配对态：含关系词，UI 层展示，集中配置不硬编码进 wxml）
const SECTION_TITLES = {
  [SECTION.TOGETHER]: '一起追',
  [SECTION.NOT_STARTED]: '还没开追',
  [SECTION.PAUSED]: '暂缓 / 下车了',
  [SECTION.DONE]: '一起追完了 🎉',
};

// 筹备态（单人，对方未加入）分区标题：去关系词，中性化（会议决策 §5.5）
const SECTION_TITLES_SOLO = {
  [SECTION.TOGETHER]: '在追',
  [SECTION.NOT_STARTED]: '想看',
  [SECTION.PAUSED]: '暂缓 / 弃番',
  [SECTION.DONE]: '看完了',
};

// 进度状态中文标签
const STATUS_LABELS = {
  want: '想看',
  watching: '在追',
  caught_up: '追平待更',
  paused: '暂缓',
  done: '看完',
  dropped: '弃番',
};

// 状态标签色（TDesign t-tag theme）：按语义区分冷暖，不再全蓝一个色。
// primary 蓝=进行中主态；success 绿=完成；warning=暂停；default 灰=淡化（想看/弃番不强调）
const STATUS_TAG_THEME = {
  want: 'default', // 想看：还没开始，弱化
  watching: 'primary', // 在追：进行中主态
  caught_up: 'primary', // 追平待更：也是进行中
  paused: 'warning', // 暂缓：黄，提示中断
  done: 'success', // 看完：绿，完成感
  dropped: 'default', // 弃番：灰，不强调（去批判感，和「下车」调性一致）
};

// 总集数录入相关文案（加番弹层 / 番剧信息编辑弹层 / 轴提示共用，集中不散落进 wxml）
const TOTAL_EP_COPY = {
  ADD_PLACEHOLDER: '总集数（选填）', // 加番弹层输入框占位
  ADD_HINT: '放送中的番可以先不填，看完再补', // 加番弹层副提示
  INFO_TITLE: '番剧信息', // 番剧信息编辑弹层标题
  TOTAL_EP_LABEL: '总集数', // 编辑弹层字段名
  AIR_STATUS_LABEL: '放送状态', // 编辑弹层字段名
  TOTAL_EP_UNSET: '未设置', // 详情弹层「共X集」行未设总集数时的展示
  CALIBRATED: '进度轴已按总集数校准', // 首次填完总集数后的校准 toast
  EXCEED_HINT: '已超出预设 ›', // 个人进度 > 总集数时的轴末提示（点击可改总集数）
};

// ── 选集器按钮文案 ──
// 本版本 TDesign t-picker 的 cancelBtn/confirmBtn 默认值是布尔 true，模板直接
// 渲染 {{cancelBtn}} → 屏幕上显示 "true"。必须显式传字符串文案覆盖。
const PICKER_COPY = {
  CANCEL: '取消',
  CONFIRM: '确认',
};

// ── P2 顶部「TA 更新了」信息条文案 ──
// 进板结算：对方在我上次查看后更新过的番。单部报具体番名+集数，多部报数量。
// {peer}/{name}/{ep}/{count} 由页面插值（peer 用对方昵称，缺省「TA」），不硬编码进 wxml。
const PEER_UPDATE_COPY = {
  ICON: '🔔',
  SINGLE: '{peer} 追到了《{name}》第 {ep} 话',
  MULTI: '{peer} 更新了 {count} 部番的进度',
  PEER_DEFAULT: 'TA', // 对方没设昵称时的兜底称呼
};

// ── 首字色块调色板（封面为空时占位）──
// JS 侧取不到 WXSS 的 --td-* 变量，故从 TDesign 品牌色阶人工派生并集中于此，
// 属「配置层集中管理」而非「散落硬编码」。真按变量取色需 wx.getComputedStyle，MVP 不做。
// 全部收敛为「能扛白字」的深色档（2026-07-23 视觉评审）：原浅蓝/黄/橙/绿白字对比度低于 4.5:1
// （黄 #EBB105 白字仅 1.9:1 基本不可读），已分别压深到 ≥4.5:1，配 ≥36rpx 首字稳达大字阈值。
const COVER_PALETTE = ['#0052D9', '#0A6DD1', '#0A8C5E', '#D9600F', '#E34D59', '#834EC2', '#B67C00'];

// ── 成员身份色（固定 2 人）──
// 我=品牌蓝，TA=紫。TA 刻意不用成功绿(#00A870)：绿是「追平/看完」的奖章色，
// TA 恒绿会让里程碑绿失去高光、且在进度语境易读成「TA 领先」，踩碎「陪伴不排名」。
// 同 COVER_PALETTE：JS 侧驱动 inline style 取不到 --td-* 变量，故集中配置于此。
const MEMBER_COLORS = { me: '#0052D9', peer: '#834EC2' };

module.exports = {
  COLLECTION,
  BOARD_MEMBER_LIMIT,
  BOARD_STATUS,
  MEMBER_ROLE,
  AIR_STATUS,
  PROGRESS_STATUS,
  PROGRESS_STATUS_DEFAULT,
  EP_MIN,
  EP_MAX_WHEN_UNKNOWN,
  EP_PICKER_MAX_UNKNOWN,
  EP_ROLL_MAX,
  TOTAL_EP_MAX,
  TOTAL_EP_MIN,
  PAIR_TOKEN_TTL_MS,
  DEFAULT_BOARD_NAME,
  BOARD_NAME_MAX,
  ITEM_NAME_MAX,
  ITEM_SHARED_FIELDS,
  NUDGE_COOLDOWN_MS,
  ERR,
  JOIN_ERR_MESSAGES,
  VIEW,
  SECTION,
  SECTION_ORDER,
  SECTION_TITLES,
  SECTION_TITLES_SOLO,
  COMMON_TALK,
  STATUS_LABELS,
  STATUS_TAG_THEME,
  COVER_PALETTE,
  MEMBER_COLORS,
  AIR_STATUS_LABELS,
  AIR_STATUS_OPTIONS,
  TOTAL_EP_COPY,
  PICKER_COPY,
  PEER_UPDATE_COPY,
};
