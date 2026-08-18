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
  EVENT: 'shared_board_events', // 板改动历史事件流（历史页 + 周报数据源）
};

// ── 本地存储 key（纯前端，云函数不用）──
// openid 对「用户 × 小程序」恒定不变，首次拉到后持久化，之后进任何板页直接读，
// 省掉每次进页面串行等一次 getMyOpenid 云函数往返（冷启动 1~3s 尤其明显）。
// 用 Storage 而非 globalData：后者杀进程即失效，最慢的冷启动反而命中不到。
const STORAGE_KEY = {
  MY_OPENID: 'sb_my_openid',
};

// ── 板改动事件类型（历史页 + 周报数据源）──
// 每个「会改变板状态」的写操作在服务端成功后追加一条事件。
// progress 含集数(+1/改话数)与状态(在追/看完/弃番等)变更，payload 里带 prev/新值。
const EVENT_TYPE = {
  ITEM_ADD: 'item_add', // 加番
  ITEM_REMOVE: 'item_remove', // 移出（软删）
  ITEM_RESTORE: 'item_restore', // 恢复
  ITEM_EDIT: 'item_edit', // 改共享字段（番名/总集数/放送状态等）
  PROGRESS: 'progress', // 改自己进度（集数 / 状态）
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
// airDay（周几更新，0-6）加入白名单：加番时随详情接口落库，也允许后台/编辑弹层订正
const ITEM_SHARED_FIELDS = ['name', 'totalEp', 'airStatus', 'cover', 'airDay'];

// ── 更新日（放送星期）──
// airDay 取自弹弹play 详情接口（animeMeta detail），0-6 表示周几更新。
// ⚠️ 语义待真机校准：弹弹play 未在文档明确 0 是周日还是周一，接入时用一部已知
// 更新日的在播番实测确认后再定。此处按「0=周日 … 6=周六」（JS Date.getDay 同约定）
// 先行，若实测不符只改本映射一处，不动其它逻辑。
const AIR_DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
// 番卡「周四更新」角标文案：{day} 由 AIR_DAY_LABELS 插值，前后缀集中配置不硬编码进 wxml。
// 仅在播（airStatus=airing）且 airDay 合法时显示，完结/未知不挂，避免噪音。
const AIR_DAY_COPY = {
  SUFFIX: '更新', // 「周四」+「更新」= 「周四更新」
};

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

// ── 补拉放送信息（airDay/isOnAir）超时 ──
// 选中番剧后异步补拉详情，用户可能在详情回来前就点确认（尤其番名已带出、无需改）。
// 提交时最多等这么久，等到就带上放送信息落库，超时则照旧加番（不卡用户，降级已定策略）。
const AIR_META_WAIT_MS = 3000;

// ── 关联番剧（弹弹play 数据绑定）文案 ──
// 加番弹层「搜番剧」入口区文案：搜索为推荐主路径、手填为备选，选中后转预览+确认态。
const ANIME_BIND_COPY = {
  // 加番弹层：搜索为推荐主路径，手填为备选，两段用标题/分隔区分语义
  SEARCH_TITLE: '搜番剧，一键带出封面·集数', // 搜索区标题（推荐路径）
  SEARCH_ENTRY: '搜索番剧库', // 搜索入口按钮文案
  MANUAL_TITLE: '或手动填写', // 手填区分隔标题（未选中态：另一条路，自己打字）
  EDIT_TITLE: '确认信息（可修改）', // 手填区分隔标题（已选中态：下面是带回的可编辑区，非「手动」）
  PICKED_HINT: '已选中，可修改后添加', // 选中番剧后弹层顶部预览区提示
  RESELECT: '重选', // 已选中后重新搜索的按钮
  META_FAIL: '放送信息没拉到，不影响添加', // 补调详情拉 airDay 失败的 toast（不阻塞加番）
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

// ── 改动历史页文案（board-history）──
// 每条历史 = 谁 + 做了什么 + 何时。动作文案按事件类型分模板，{name}/{from}/{to}/{status}
// 由页面插值（复用 fillTemplate），集中配置不硬编码进 wxml/js。
const HISTORY_COPY = {
  TITLE: '改动历史',
  ENTRY: '历史', // 板页头入口文案
  EMPTY: '还没有改动记录',
  EMPTY_HINT: '从现在起，加番、追进度都会记在这里',
  LOAD_MORE: '加载更多',
  LOADING: '加载中…',
  NO_MORE: '没有更多了',
  ME: '我', // 我发起的动作主语
  PEER_DEFAULT: 'TA', // 对方没设昵称时的主语兜底
  // 动作模板（主语在前面单独渲染，这里只描述「做了什么」）
  ACTION: {
    item_add: '添加了《{name}》',
    item_remove: '移出了《{name}》',
    item_restore: '把《{name}》加回来了',
    item_edit: '更新了《{name}》的信息',
    item_rename: '把《{from}》改名为《{name}》',
    // progress：按语义分流，终止态（看完/弃番/暂缓）优先于集数推进，情绪信号更重要
    progress_done: '看完了《{name}》',
    progress_dropped: '弃了《{name}》',
    progress_paused: '暂缓了《{name}》',
    progress_to: '把《{name}》追到第 {to} 话', // 单步/未折叠推进
    progress_from_to: '把《{name}》从第 {from} 话追到第 {to} 话', // 折叠区间
    progress_status: '把《{name}》标记为「{status}」', // 仅状态变化
  },
};

// ── 周报 / 报告参数（board-report 数据层）──
// 报告分两类数据：A 类快照（items.progress 当前状态，任何板都能算，首报不残缺）；
// B 类行为叙事（shared_board_events 事件流，仅埋点后有，缺则隐藏 + footnote 说明起记时间）。
// 时间双口径：滚动窗口（推进/环比）用绝对毫秒比较；按天指标（streak/神同步/爆肝）
// 必须按「本地日」分桶，否则凌晨追番算到前一天、streak 断裂——故显式带时区偏移。
const REPORT = {
  TZ_OFFSET_MINUTES: 480, // 本地日分桶时区偏移（UTC+8=480）。serverDate 存 UTC，按天指标据此归本地日
  WINDOW_DAYS: 7, // 「最近推进」滚动窗口天数（近 7 天 vs 前 7 天做环比）
  MOMENTUM_STABLE_BAND: 1, // 环比方向稳定带：近/前窗口推进话数相差 ≤ 此值算「稳定」，否则升/降
  STREAK_GRACE_DAYS: 1, // 当前 streak 宽限：最近追番日落在「今天或昨天」才算存活（Duolingo 式），否则归零
  LOOKBACK_DAYS: 90, // getBoardReport 服务端取事件的时间下界（防老板拉爆）。含 streak 纪录/爆肝的回溯深度
  RECENT_ITEMS_LIMIT: 5, // 变化区「这几天推得最猛的番」展示条数（双人合计推进降序 top N）
  DONE_STRIP_LIMIT: 8, // 累计区「一起追完的番」封面色带最多展示部数（溢出计入 +N）
  PERSONAL_STRIP_LIMIT: 6, // 个人小结每个状态（在追/追完/弃番）封面条最多展示部数（溢出计入 +N）
  PERSONAL_RECENT_LIMIT: 4, // 个人小结「我最近推进」番展示条数（我一人近窗推进话数降序 top N）
  CHART_DAYS: 14, // 每日追番柱状图窗口天数上限（旧滚动窗口调用兼容保留；周视图不用此值）
  WEEK_START: 1, // 周视图周首：1=周一（0=周日）。柱状图固定按此锚点分自然周，横滑翻周
};

// ── 报告文案（board-report）──
// 报告数据层只产出结构化数据（方向 key、计数、dayIndex），不拼字符串；措辞集中此处，
// {me}/{peer}/{n}/{date}/{name} 由页面插值（复用 fillTemplate），不硬编码进 wxml。
const REPORT_COPY = {
  TITLE: '追番小结',
  ENTRY: '小结', // 板页头入口文案
  ME_DEFAULT: '我', // 我没设昵称时的兜底称呼
  PEER_DEFAULT: 'TA', // 对方没设昵称时的兜底称呼
  // ① 头部 hero 卡：巨号数字单独渲染，前后缀 + 副信息全走配置
  DAYS_TOGETHER_LABEL: '一起追番第', // 巨号数字前缀
  DAYS_TOGETHER_UNIT: '天', // 巨号数字后缀（小字）
  DAYS_TOGETHER: '一起追番第 {n} 天', // 整句（兼容保留，页面已改三段式）
  HEAD_SINCE: '{date} 起 · 一起追了 {anime} 部番', // 副信息（配对态：日期 + 共同追番数）
  HEAD_SINCE_SOLO: '{date} 起 · 已追 {anime} 部番', // 副信息（筹备态无 peer，不说「一起」）
  HEAD_SINCE_NO_ANIME: '{date} 起', // 尚未加任何番时只显示起始日，不硬拼「0 部番」
  // ② 变化区：最近推进 + 环比方向 + 谁更活跃（中性叙事，非排名）
  RECENT_TITLE: '这几天你俩推得最猛',
  RECENT_EMPTY: '这几天你俩推得最欢', // 变化区有推进但无法归到具体番时的标题兜底（几乎不触发，防空标题）
  RECENT_ROW_ME: '我 {n}', // 番剧行内我方集数（{n} 话，单位后置）
  RECENT_ROW_PEER: 'TA {n}', // 番剧行内对方集数
  RECENT_ROW_UNIT: '话',
  RECENT_TOTAL: '合计推进 {n} 话', // 番列表下方的合计
  RECENT_UNIT: '话', // 推进单位（大字数字旁的单位，旧变化区保留兼容）
  MOMENTUM: { up: '↑ 更起劲了', flat: '→ 稳稳的', down: '↓ 歇了歇' }, // 环比方向词（不出百分比，避免假精度）
  ACTIVE_LEAD: '{peer} 这阵子多追了 {n} 话', // 谁更活跃（中性，diff>0 时用；相等则不显示）
  RECALL_TITLE: '歇了歇脚', // 空窗召回卡标题
  RECALL: '这阵子都没动静，要不要打开追一集？', // 空窗召回钩子（近窗推进=0 且当前 streak 断）
  // 每日追番柱状图（双色堆叠：我+TA 每日推进话数）+ 周视图翻周
  CHART_TITLE: '每天追了多少',
  CHART_EMPTY: '还没攒够数据，追几天就有啦', // 无任何有效柱时
  CHART_AXIS_ME: '我',
  CHART_AXIS_PEER: 'TA',
  CHART_UNIT: '话', // 柱顶/图例单位
  CHART_LEGEND_VALUE: '{name}（{ep}）', // 图例名后附本周各自集数（{name}=我/TA，{ep}=本周话数，圆括号包裹）
  CHART_WEEK_THIS: '本周', // 周标签：今天所在周
  CHART_WEEK_LAST: '上周', // 周标签：上一周
  CHART_WEEK_RANGE: '{from}–{to}', // 更早周：用 M/D–M/D 区间（from/to 页面拼）
  CHART_WEEK_DATE: '{m}/{d}', // 周区间端点日期格式
  // 每周汇总行：点明主语 + 范围，消除「部番/话指谁、什么范围」的歧义。
  // 配对/单人分文案（筹备态无 TA 时不能说「你俩」）。{anime}=当周推进过的不同番数，{ep}=合计话数
  CHART_WEEK_SUMMARY: '你俩这周追了 {anime} 部番、共 {ep} 话',
  CHART_WEEK_SUMMARY_SOLO: '你这周追了 {anime} 部番、共 {ep} 话',
  CHART_WEEK_SUMMARY_EMPTY: '你俩这周还没追番',
  CHART_WEEK_SUMMARY_EMPTY_SOLO: '你这周还没追番',
  // ③ 名场面（三徽章，show-if-present；副标题落到具体番/日期，不再是干数字）
  HIGHLIGHT_TITLE: '名场面',
  STREAK: {
    ICON: '🔥',
    LABEL: '连续追番',
    UNIT: '天',
    SUB: '{date} 起连着追', // 副标题：streak 起始日
  },
  SYNC: {
    ICON: '👯',
    LABEL: '神同步',
    UNIT: '天',
    SUB: '最近 {date}', // 副标题：最近一次神同步日
    SUB_NAMED: '最近 {date}《{name}》', // 带番名（能定位到具体番时）
  }, // 同一天两人追同一部番的天数
  BINGE: {
    ICON: '⚡',
    LABEL: '单日爆肝',
    VALUE: '{n} 话', // 徽章主值（与 streak/sync 的「N天」对齐成同结构）
    SUB: '{date}', // 无番名兜底
    SUB_NAMED: '{date}《{name}》', // 带番名
  }, // 单日推进峰值
  // ④ 累计（本命番 Hero + 三统计格 + 一起追完的番封面条）
  CUMULATIVE_TITLE: '一路追来',
  HERO_TITLE: '你俩的本命', // 双人合计集数最高的番
  HERO_EPS: '一起追了 {n} 话', // 本命番合计话数
  HERO_PAIR: '我 E{me} · TA E{peer}', // 本命番双人各自集数
  HERO_PAIR_SOLO: '我 E{me}', // 未配对时只显示我方
  STAT_TOGETHER: '一起追', // 三统计格标签
  STAT_DONE: '追完',
  STAT_COMMON: '能聊',
  STAT_UNIT: '部',
  DONE_STRIP_TITLE: '一起追完的', // 追完番封面色带标题
  DONE_STRIP_MORE: '+{n}', // 超出 DONE_STRIP_LIMIT 的余量角标
  // ⑤ 个人小结（底部收起，三统计格弱化呈现 + 各状态番封面条）
  PERSONAL_TITLE: '你自己',
  PERSONAL: '追完 {done} · 在追 {watching} · 弃番 {dropped}', // 兼容保留
  PERSONAL_DONE: '追完',
  PERSONAL_WATCHING: '在追',
  PERSONAL_DROPPED: '弃番',
  PERSONAL_UNIT: '部',
  PERSONAL_FOOTPRINT: '我一共追了 {n} 话', // 个人追番足迹（我在所有番上的 ep 累加）
  PERSONAL_FOOTPRINT_EMPTY: '还没开始追，去追第一集吧', // 足迹为 0 时兜底
  PERSONAL_STRIP_MORE: '+{n}', // 各状态封面条超出 PERSONAL_STRIP_LIMIT 的余量角标
  PERSONAL_RECENT_TITLE: '我最近在推', // 个人近窗推进小标题（只算我一人，区别于双人「推得最猛」）
  PERSONAL_RECENT_ROW: '{n} 话', // 番行我方推进话数
  PERSONAL_RECENT_TOTAL: '这几天我推进 {n} 话', // 我近窗推进合计
  // 🔥 个人连续追番（「你自己」块顶部大火苗，Duolingo 式每日打卡钩子）。四态措辞：
  // alive_done=今天已续上 / alive_pending=宽限内待续（火要灭了，制造紧迫） / broken=断了 / empty=还没开始
  MY_STREAK: {
    ICON: '🔥',
    DAYS: '连续追番 {n} 天', // 整句（兼容保留；页面已改用 LABEL/数字/UNIT 三段式突出数字）
    DAYS_LABEL: '连续追番', // 前缀小字
    DAYS_UNIT: '天', // 后缀小字（超大数字单独渲染，成为视觉焦点）
    SUB: '{date} 起没断过', // 副标题：streak 起始日
    ALIVE_DONE: '今天的番追上了，链子稳住 ✓', // 今天已推进
    ALIVE_PENDING: '火要灭了，今天追一集续上', // 宽限内今天还没追（紧迫钩子）
    BROKEN: '连续追番断了，今天追一集重新点火', // days=0 但有过行为数据
    EMPTY: '还没开始连续追番，今天追第一集', // 无行为数据 / 从没追过
  },
  // 数据起记说明（B 类事件流仅埋点后有）
  FOOTNOTE: '行为数据自 {date} 起记录',
  DATE_MD: '{m}月{d}日', // dayIndex 还原成月日的模板
  // 加载 / 错误态
  LOADING: '加载中…',
  LOAD_FAIL: '加载失败',
  NOT_MEMBER: '无权查看',
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
  STORAGE_KEY,
  EVENT_TYPE,
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
  AIR_DAY_LABELS,
  AIR_DAY_COPY,
  TOTAL_EP_COPY,
  PICKER_COPY,
  PEER_UPDATE_COPY,
  ANIME_BIND_COPY,
  AIR_META_WAIT_MS,
  HISTORY_COPY,
  REPORT,
  REPORT_COPY,
};
