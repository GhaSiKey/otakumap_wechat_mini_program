// P2 单个板页（核心门面）+ P4 配对流（空板态）
//
// 职责：
//  - onLoad 拿 boardId（分享卡片带 token 时，非成员自动 joinBoard 入板）
//  - onShow 拉板 + 番单，buildBoardViewModel 构建视图（打开即最新，MVP 不做 watch）
//  - waiting 态 → 邀请分享（P4）；paired 态 → 同轴对比番单 + 加番
//  - 改进度走 P3 弹层；进度更新用乐观 UI + 云函数对账
const api = require('../../utils/shared-board/cloud-api');
const T = require('../../utils/shared-board/transform');
const {
  STATUS_LABELS,
  STATUS_TAG_THEME,
  STATUS_TAG_THEME_DEFAULT,
  PROGRESS_STATUS,
  EP_ROLL_MAX,
  JOIN_ERR_MESSAGES,
  COMMON_TALK,
  SECTION,
  TOTAL_EP_COPY,
  TOTAL_EP_MAX,
  TOTAL_EP_MIN,
  AIR_STATUS_OPTIONS,
  PICKER_COPY,
  PEER_UPDATE_COPY,
  ANIME_BIND_COPY,
  AIR_META_WAIT_MS,
  HISTORY_COPY,
  REPORT_COPY,
  STORAGE_KEY,
  ADD_ITEM_FAB,
  ITEM_VIEW,
  ITEM_VIEW_INTERACTION,
  ITEM_VIEW_SWITCH,
  ITEM_POSTER_COPY,
  normalizeItemView,
} = require('../../utils/shared-board/config');
// 搜索页交互模式 + 回带事件名（跨包同一 miniprogram 内，直接 require anime-meta 配置层）
const {
  SEARCH_MODE,
  PICK_EVENT,
  preferDetailCover,
  isSearchThumbnailCover,
} = require('../../utils/anime-meta/config');
// 番剧详情云调用：加番选中后用详情 medium 封面替换搜索 small，并补拉 airDay/isOnAir。
const animeApi = require('../../utils/anime-meta/cloud-api');

const ANIME_SEARCH_URL = '/packageFeatures/pages/anime-search/anime-search';

// 占位符插值：{key} → vars[key]。用回调式 replace，避免番名等值含 $&/$1 等
// 被 String.replace 第二参当特殊模式解析（番名用户可自由输入，属必防的注入面）。
function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

// 「TA 更新了」信息条文案插值：把 {peer}/{name}/{ep}/{count} 替换成实值。
// 单部报具体番名+集数，多部报数量。措辞全在 PEER_UPDATE_COPY，此处只做填充。
function formatPeerUpdate(updates, peerName) {
  const peer = peerName || PEER_UPDATE_COPY.PEER_DEFAULT;
  if (!updates || updates.count <= 0) return '';
  if (updates.count === 1) {
    const u = updates.items[0];
    return fillTemplate(PEER_UPDATE_COPY.SINGLE, { peer, name: u.name, ep: u.ep });
  }
  return fillTemplate(PEER_UPDATE_COPY.MULTI, { peer, count: updates.count });
}

// 状态 action-sheet 的选项（按 PROGRESS_STATUS 顺序生成，文案走 STATUS_LABELS，不硬编码）
const STATUS_SHEET_ITEMS = PROGRESS_STATUS.map((s) => ({ label: STATUS_LABELS[s], value: s }));

Page({
  data: {
    statusLabels: STATUS_LABELS, // 分区标题已在 transform 内算好（sec.title），此处只留状态标签
    statusTagTheme: STATUS_TAG_THEME, // 状态标签按语义配色（t-tag theme），不再全蓝
    statusTagThemeDefault: STATUS_TAG_THEME_DEFAULT, // WXML 状态 theme 的配置化兜底
    commonTalk: COMMON_TALK,     // 「N 部能一起聊」文案配置（图标/前后缀），数字在 wxml 用 vm.commonCount 插
    totalEpCopy: TOTAL_EP_COPY,  // 总集数录入相关文案（占位/提示/字段名），集中配置不硬编码进 wxml
    airStatusOptions: AIR_STATUS_OPTIONS, // 番剧信息弹层放送状态可选项（放送中/已完结/未定）
    pickerCopy: PICKER_COPY, // 选集器取消/确认按钮文案（覆盖 t-picker 布尔默认值渲染成 "true" 的问题）
    peerUpdateCopy: PEER_UPDATE_COPY, // 「TA 更新了」信息条图标等视觉文案（正文已在 _load 插值成 peerUpdateText）
    animeBindCopy: ANIME_BIND_COPY, // 关联番剧（搜索区标题/入口/手填分隔/预览提示 + 补绑入口）文案
    historyCopy: HISTORY_COPY, // 改动历史入口文案
    reportCopy: REPORT_COPY, // 追番小结入口文案
    addItemFab: ADD_ITEM_FAB, // 右下角圆形加番 FAB 的图标与无障碍文案
    itemView: ITEM_VIEW.LIST, // 番单默认完整列表；onLoad 按 boardId 恢复本机偏好
    itemViewEnum: ITEM_VIEW, // WXML 比较使用同一枚举，不散落 list/poster 字面量
    itemViewInteraction: ITEM_VIEW_INTERACTION, // 切换按钮/两类卡片共用的点按反馈参数
    itemViewSwitch: ITEM_VIEW_SWITCH, // 当前模式 → 目标模式的按钮图标/文案/无障碍说明
    itemPosterCopy: ITEM_POSTER_COPY, // 海报卡紧凑进度与分区计数文案
    boardId: '',
    token: '',            // 分享卡片带的配对 token
    myOpenid: '',
    loading: true,
    vm: null,             // buildBoardViewModel 结果
    // 注意：原始 board/items 不进 data（wxml 不消费，纯 JS 逻辑用）。
    // 它们只被 onItemTap/onShareAppMessage/_commitProgress 等读取，放实例属性
    // this._rawBoard/this._rawItems，避免每次 _load 把整份原始数据序列化跨线程传到渲染层。
    // 加番弹层
    showAdd: false,
    newItemName: '',
    newItemTotalEp: '', // 选填总集数（字符串，空=不填），提交时归一
    newItemCover: '',   // 搜番剧带回的封面预览 URL（可能为空——番剧无封面）
    newItemPicked: false, // 是否已通过搜索选中一部（控制弹层顶部预览区 vs 搜索入口区）
    newItemCoverError: false, // 预览封面加载失败（回退首字色块，避免 cloud:// 或坏链裸奔）
    newItemFallback: null, // 预览无封面/加载失败时的首字色块 {color,char}（同卡片兜底语言）
    adding: false,
    // 进度编辑弹层（P3）
    showDetail: false,
    detailItem: null,
    // 番剧信息编辑弹层（共享字段：总集数 + 放送状态），独立于进度编辑，绝不复用 showEpInput
    showItemInfo: false,
    itemInfoTotalEp: '',      // 总集数（字符串，空=未设），提交时归一
    itemInfoAirStatus: '',    // 放送状态（AIR_STATUS 枚举值）
    savingItemInfo: false,
    // 集数滚轮（短番，totalEp ≤ EP_ROLL_MAX）
    showEpPicker: false,
    epOptions: [],        // [{label:'E0',value:0}, ...]
    epPickerValue: [0],
    // 集数数字输入（长番/无分母，滚轮太长改直接输入）
    showEpInput: false,
    epInputValue: '',
    // 状态选择器
    showStatusSheet: false,
    statusSheetItems: STATUS_SHEET_ITEMS,
    // 追平动效：当前要播 sync 动画的 itemId（播完清空）
    syncItemId: '',
    // 番名内联改名（在详情弹层内原地编辑，不再叠独立弹层）
    editingName: false,
    editName: '',
    savingEdit: false,
    // 对方加入动画标记
    justJoined: false,
    // 头像加载失败标记（不开云存储时对方常读不到，回退首字母；换头像后 _load 重置重试）
    meAvatarError: false,
    peerAvatarError: false,
    // 番剧封面加载失败的 itemId 映射（{itemId:true}）：失败即回退首字色块，不每次渲染重试免闪烁
    coverErrorIds: {},
    // 设置昵称弹层（头像上传已砍，统一首字色块）
    showProfile: false,
    profileNickname: '',
    savingProfile: false,
    // +1 动画开关：详情弹层集数大字上跳 + 绿色 +1 浮起（点「看完一集」触发）
    epBump: false,
    // 「N 部能一起聊」提示条：不再常驻，仅 commonCount 变大时短暂弹出
    showCommonTalk: false,
    // 「TA 更新了」信息条：进板结算一次（对方在我上次查看后的新动向），展示固定不重算，点击收起
    peerUpdateText: '',
    showPeerUpdate: false,
  },

  async onLoad(query) {
    this._unloaded = false;
    const boardId = query.boardId || '';
    const token = query.token || '';
    // 视图偏好属于「本机 × 当前板」：按 boardId 拼 key，非法/旧值统一回退完整列表。
    // 与 boardId/token 一次 setData，避免页面先闪列表、下一帧再跳海报视图。
    const storedItemView = boardId
      ? wx.getStorageSync(STORAGE_KEY.ITEM_VIEW_PREFIX + boardId)
      : ITEM_VIEW.LIST;
    this.setData({ boardId, token, itemView: normalizeItemView(storedItemView) });

    // getMyOpenid 不被 getBoardDetail/joinBoard 依赖（云端 getWXContext 自取身份），
    // 故可与首屏数据请求并行，砍掉「先串行等 openid」的一个冷启动 RTT。
    // 带 token：openid 与 joinBoard 并行（joinBoard→getBoardDetail 是真依赖，配对成功才拉最新）。
    // 不带 token：openid 与 getBoardDetail 并行，两者齐了直接渲染（把并行拿到的 detail 交给 _load）。
    let me;
    let preloaded = null;
    if (boardId && token) {
      const [meRes, jr] = await Promise.all([api.getMyOpenid(), api.joinBoard(boardId, token)]);
      me = meRes;
      if (jr.ok) {
        // rejoin=true 是本人重复进入（如刷新），不弹提示；首次加入才庆祝
        if (!jr.data.rejoin) wx.showToast({ title: '加入成功，一起追吧 🎬', icon: 'none' });
      } else {
        // 各错误码走配置映射，覆盖满员/板不存在/token 无效/过期/已用/网络异常
        const m = JOIN_ERR_MESSAGES[jr.code] || JOIN_ERR_MESSAGES._default;
        wx.showModal({ title: m.title, content: m.content, showCancel: false });
      }
    } else {
      const [meRes, detail] = await Promise.all([
        api.getMyOpenid(),
        api.invoke('getBoardDetail', { boardId }),
      ]);
      me = meRes;
      preloaded = detail; // 复用这份并行结果，避免 _load 再拉一次
    }

    if (!(me.ok && me.data && me.data.openid)) {
      this.setData({ loading: false });
      wx.showToast({ title: '身份获取失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ myOpenid: me.data.openid });

    // openid 就绪后首次渲染（onShow 的守卫会跳过重复加载）。
    // 不带 token 时把并行预取的 detail 传入，_load 直接用不再请求。
    this._load(preloaded);
  },

  onShow() {
    // 仅在 openid 已就绪时刷新（首次加载由 onLoad 末尾触发，避免时序竞态）
    if (this.data.boardId && this.data.myOpenid) this._load();
  },

  onPullDownRefresh() {
    this._load().then(() => wx.stopPullDownRefresh());
  },

  // 列表 / 海报一键切换。只换渲染方式，不重算 vm.sections；按钮配置里的 next
  // 明确表达目标态，避免页面写反向三元判断。偏好按板落本机 Storage，不影响 TA。
  onToggleItemView() {
    const current = normalizeItemView(this.data.itemView);
    const next = ITEM_VIEW_SWITCH[current].next;
    this.setData({ itemView: next });
    if (this.data.boardId) {
      wx.setStorageSync(STORAGE_KEY.ITEM_VIEW_PREFIX + this.data.boardId, next);
    }
  },

  onUnload() {
    this._unloaded = true;
    // 防页面销毁后 setData
    if (this._epBumpTimer) clearTimeout(this._epBumpTimer);
    if (this._commonTalkTimer) clearTimeout(this._commonTalkTimer);
  },

  // 拉板 + 番单，构建视图模型。
  // preloaded：onLoad 首次并行已预取的 getBoardDetail 结果，有则直接用（省一次请求）；
  //            onShow / 下拉 / +1 对账等复访不传，照常请求最新。
  async _load(preloaded) {
    const { boardId, myOpenid } = this.data;
    const loadSeq = (this._loadSeq || 0) + 1;
    this._loadSeq = loadSeq;
    const res = preloaded || (await api.invoke('getBoardDetail', { boardId }));
    // onShow/下拉/写后对账可能并发拉详情；只允许最后发起的一次落地，避免旧 small 快照
    // 晚到后覆盖新 medium/进度。页面已销毁或 boardId 已变化时同样不再 setData/markViewed。
    if (this._unloaded || this._loadSeq !== loadSeq || this.data.boardId !== boardId) return;
    if (!res.ok) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
      return;
    }
    const { board, items } = res.data;
    // progress revision 独立于 raw 对象保存：_load 会整份替换 _rawItems，若只把请求回包的
    // rev 写回旧对象，连续点击的下一次提交会误拿旧 rev。先吸收本次权威 rev，再把仍待提交的
    // 乐观目标覆盖到展示副本上（不改 revision），保证刷新与连点交错时 UI/协议都连续。
    this._progressRevByItem = this._progressRevByItem || {};
    items.forEach((item) => {
      if (!item || !item._id) return;
      item.progress = item.progress || {};
      const mine = item.progress[myOpenid] || {};
      const serverRev = Number.isInteger(mine.rev) && mine.rev >= 0 ? mine.rev : 0;
      const knownRev = this._progressRevByItem[item._id] || 0;
      this._progressRevByItem[item._id] = Math.max(knownRev, serverRev);
      const desired = this._progressDesired && this._progressDesired[item._id];
      if (desired) {
        item.progress[myOpenid] = Object.assign({}, mine, {
          ep: desired.ep,
          status: desired.status,
          rev: this._progressRevByItem[item._id],
        });
      }
    });
    const vm = T.buildBoardViewModel(board, items, myOpenid);
    // 检测「对方刚加入」：本次从 waiting 变 paired（上一次还没配对，这次有对方了）
    const wasWaiting = this.data.vm && this.data.vm.phase === 'waiting';
    const nowPaired = vm.phase === 'paired';
    // 头像 error 标记不在此重置：不开云存储时对方头像恒失败，每次 _load（含每次 +1）重置会导致
    // 反复重试闪烁。仅在「换了对方 / 我改了头像」这类 URL 真变化时才清（见下方 peerUrl 比较 + onSaveProfile）
    const prevPeerUrl = this._lastPeerAvatarUrl;
    const curPeerUrl = (vm.peer && vm.peer.avatar) || '';
    const peerUrlChanged = curPeerUrl !== prevPeerUrl;
    this._lastPeerAvatarUrl = curPeerUrl;
    // 封面错误态按 itemId 记忆以避免坏链反复闪烁；但 URL 真的变了（例如另一端已把
    // small 升级为 medium）必须清掉旧标记，让新 URL 获得一次加载机会。
    const prevCoverByItemId = {};
    (this._rawItems || []).forEach((item) => {
      if (item && item._id) prevCoverByItemId[item._id] = item.cover || '';
    });
    const coverErrorIds = Object.assign({}, this.data.coverErrorIds);
    let coverErrorChanged = false;
    items.forEach((item) => {
      if (!item || !item._id || !coverErrorIds[item._id]) return;
      if (Object.prototype.hasOwnProperty.call(prevCoverByItemId, item._id)
        && prevCoverByItemId[item._id] !== (item.cover || '')) {
        delete coverErrorIds[item._id];
        coverErrorChanged = true;
      }
    });
    // 原始 board/items 存实例属性（wxml 不消费）——乐观对账靠 this._rawItems 的对象引用
    // 累积（_commitProgress 直接改 raw.progress[myOpenid]），此处每次 _load 用最新权威值整份替换。
    this._rawBoard = board;
    this._rawItems = items;
    const patch = { vm, loading: false };
    if (peerUrlChanged) patch.peerAvatarError = false; // 对方头像换了新 URL，给一次加载机会
    if (coverErrorChanged) patch.coverErrorIds = coverErrorIds;
    // 详情弹层打开时用最新数据重建 detailItem，否则改了总集数/放送状态/进度后弹层仍显示旧值。
    // pair 也从同一份权威 raw 重算，与 _commitProgress 的乐观对账一致，不冲突。
    if (this.data.detailItem) {
      const curRaw = items.find((it) => it._id === this.data.detailItem.itemId);
      if (curRaw) {
        const pOpenid = vm.peer ? vm.peer.openid : null;
        patch.detailItem = T.buildItemViewModel(curRaw, myOpenid, pOpenid);
      }
    }
    // 「TA 更新了」信息条：仅进板首次结算一次（用本次返回 board 里的旧 lastViewedAt 做基准，
    // 必须在 markViewed 写新值之前算——markViewed 改的是数据库不是这份内存 board，故顺序安全）。
    // 后续 _load（onShow 复访 / +1 对账 / 下拉刷新）不重算，避免信息条闪烁或误报我自己的操作。
    if (!this._settledPeerUpdates) {
      this._settledPeerUpdates = true;
      const updates = T.buildPeerUpdates(board, items, myOpenid);
      if (updates.count > 0) {
        patch.peerUpdateText = formatPeerUpdate(updates, vm.peer ? vm.peer.nickname : '');
        patch.showPeerUpdate = true;
      }
    }

    this.setData(patch);
    wx.setNavigationBarTitle({ title: board.name });
    if (wasWaiting && nowPaired) this._celebrateJoin(vm.peer);
    // 顶部「N 部能一起聊」不再常驻：仅当本次比上次「多了能一起聊的番」才短暂弹出提醒。
    // 首次进入（_lastCommonCount 未定义）不弹，避免每次打开都刷屏 = 变相常驻。
    this._maybeFlashCommonTalk(vm.commonCount);
    // 记录本人查看时间，清未读红点（不阻塞渲染，失败无妨）。
    // 放在 buildPeerUpdates 之后：本次信息条已用旧 viewed 算完，此处写新值只影响下次进板。
    api.markViewed(this.data.boardId);
    // 首屏先用现有数据立即可交互；若发现历史 small 封面，再后台限量补拉详情 medium。
    // 每个页面实例只尝试一次，不阻塞 loading，也不因失败反复打上游。
    this._maybeUpgradeStoredCovers(items);
  },

  _maybeUpgradeStoredCovers(items) {
    if (this._coverUpgradeAttempted) return;
    const upgradeCandidates = (items || []).filter(
      (item) => item && Number.isInteger(item.sourceId) && item.sourceId > 0
        && isSearchThumbnailCover(item.cover)
    );
    const boardId = this.data.boardId;
    if (!upgradeCandidates.length) {
      this._coverUpgradeAttempted = true;
      console.log('[shared-board][cover-upgrade] 无需升级', {
        boardId,
        totalItems: (items || []).length,
      });
      return;
    }

    this._coverUpgradeAttempted = true;
    console.log('[shared-board][cover-upgrade] 检测到存量 small，开始后台升级', {
      boardId,
      detectedSmall: upgradeCandidates.length,
    });
    return animeApi.upgradeBoardCovers(boardId).then((r) => {
      if (this._unloaded || this.data.boardId !== boardId) return;
      if (!r || !r.ok) {
        if (r && r.code === 'ERR_FUNCTION_TIMEOUT') {
          console.warn('[shared-board][cover-upgrade] animeMeta 云函数执行超时，请把超时时间调整为 40 秒', {
            boardId,
            currentTimeoutSeconds: r.timeoutSeconds || 3,
            action: '云开发 → 云函数 → animeMeta → 函数配置（或高级设置）→ 超时时间：40 秒',
            rawMessage: r.msg,
          });
          return;
        }
        console.warn('[shared-board][cover-upgrade] 升级请求失败，保留原 small', {
          boardId,
          code: r && r.code,
          message: r && r.msg,
        });
        return;
      }
      const progress = r.data || {};
      if (progress.throttled) {
        console.log('[shared-board][cover-upgrade] 同板处于 60 秒冷却期，本次未重复请求', {
          boardId,
          detectedSmall: upgradeCandidates.length,
        });
        return;
      }
      const updates = Array.isArray(progress.updates) ? progress.updates : [];
      const checked = Number.isInteger(progress.checked) ? progress.checked : updates.length;
      const upgraded = Number.isInteger(progress.upgraded) ? progress.upgraded : updates.length;
      const remaining = Number.isInteger(progress.remaining)
        ? progress.remaining
        : Math.max(0, upgradeCandidates.length - upgraded);
      console.log('[shared-board][cover-upgrade] 本轮完成', {
        boardId,
        checked,
        upgraded,
        skipped: progress.skipped || 0,
        failed: progress.failed || 0,
        remaining,
        hasMore: typeof progress.hasMore === 'boolean' ? progress.hasMore : remaining > 0,
      });
      if (!updates.length) return;

      const coverByItemId = {};
      updates.forEach((entry) => {
        if (entry && entry.itemId && entry.cover) coverByItemId[entry.itemId] = entry.cover;
      });
      const currentItems = this._rawItems || [];
      let changed = false;
      const nextItems = currentItems.map((item) => {
        const cover = item && coverByItemId[item._id];
        if (!cover || cover === item.cover) return item;
        changed = true;
        return Object.assign({}, item, { cover });
      });
      if (!changed || !this._rawBoard) return;

      this._rawItems = nextItems;
      const vm = T.buildBoardViewModel(this._rawBoard, nextItems, this.data.myOpenid);
      const coverErrorIds = Object.assign({}, this.data.coverErrorIds);
      Object.keys(coverByItemId).forEach((itemId) => delete coverErrorIds[itemId]);
      const patch = { vm, coverErrorIds };
      if (this.data.detailItem) {
        const raw = nextItems.find((item) => item._id === this.data.detailItem.itemId);
        if (raw) patch.detailItem = T.buildItemViewModel(raw, this.data.myOpenid, vm.peer ? vm.peer.openid : null);
      }
      this.setData(patch);
    }).catch((e) => {
      // 维护任务必须完全静默：低版本基础库或云能力异常时保留原 small，不影响板页主流程。
      console.warn('[shared-board][cover-upgrade] 调用异常，保留原 small', {
        boardId,
        message: String((e && e.message) || e),
      });
    });
  },

  // 「N 部能一起聊」按需提醒：commonCount 变大才弹横条，3.5s 后自动收起。
  // 首次进入不弹（_lastCommonCount 为 undefined）；变小/不变不弹。
  _maybeFlashCommonTalk(count) {
    const prev = this._lastCommonCount;
    this._lastCommonCount = count;
    if (prev == null) return; // 首次加载，只记不弹
    if (count > prev && count > 0) {
      if (this._commonTalkTimer) clearTimeout(this._commonTalkTimer);
      this.setData({ showCommonTalk: true });
      this._commonTalkTimer = setTimeout(() => this.setData({ showCommonTalk: false }), 3500);
    }
  },

  // 点「TA 更新了」信息条 → 收起（用户已看见即达成告知目的，不跳转，交互最轻）
  onDismissPeerUpdate() {
    this.setData({ showPeerUpdate: false });
  },

  // 点摘要下钻到改动历史看 TA 具体动向。先收起（要去看明细了，摘要留着无意义），再跳转。
  onPeerUpdateTap() {
    this.setData({ showPeerUpdate: false });
    this.onHistoryTap();
  },

  // 对方加入庆祝：成员条虚位实体化动画 + toast + 震动
  _celebrateJoin(peer) {
    wx.vibrateShort({ type: 'medium' });
    this.setData({ justJoined: true });
    wx.showToast({ title: `${(peer && peer.nickname) || 'TA'} 来了 🎬`, icon: 'none' });
    setTimeout(() => this.setData({ justJoined: false }), 500);
  },

  // 点「N 部能一起聊」→ 滚到相关分区。commonCount 含「双方都看完(done)」，
  // 而 done 归 DONE 分区不归 TOGETHER，故 together 不存在时兜底滚到 done，避免点了没反应。
  onTapCommonTalk() {
    const sections = (this.data.vm && this.data.vm.sections) || [];
    const has = (key) => sections.some((s) => s.sectionKey === key);
    const targetKey = has(SECTION.TOGETHER) ? SECTION.TOGETHER : (has(SECTION.DONE) ? SECTION.DONE : null);
    if (!targetKey) return;
    wx.pageScrollTo({ selector: `#section-${targetKey}`, duration: 300 });
  },

  // ==================== 头像加载失败兜底 ====================
  // 不开云存储时对方读不到 cloud:// 头像，image binderror 触发 → 回退首字母色块
  onMeAvatarError() {
    this.setData({ meAvatarError: true });
  },

  onPeerAvatarError() {
    this.setData({ peerAvatarError: true });
  },

  // 番剧封面加载失败：记下该 itemId，wxml 据此回退首字色块，不再重试（避免每次渲染闪烁）
  onItemCoverError(e) {
    const { itemId } = e.currentTarget.dataset;
    if (!itemId || this.data.coverErrorIds[itemId]) return;
    this.setData({ [`coverErrorIds.${itemId}`]: true });
  },

  // ==================== 设置昵称（微信不能自动读，用户主动设）====================
  // 头像上传已砍：cloud:// 头像连自己都读不到，双方统一昵称首字色块。只设昵称。
  onEditProfileTap() {
    this.setData({
      showProfile: true,
      profileNickname: (this.data.vm && this.data.vm.me && this.data.vm.me.nickname) || '',
    });
  },

  onProfileVisibleChange(e) {
    this.setData({ showProfile: e.detail.visible });
  },

  onNicknameInput(e) {
    this.setData({ profileNickname: e.detail.value });
  },

  async onSaveProfile() {
    if (this.data.savingProfile) return;
    const nickname = (this.data.profileNickname || '').trim();
    if (!nickname) {
      wx.showToast({ title: '设个昵称吧', icon: 'none' });
      return;
    }
    this.setData({ savingProfile: true });
    // 只更新昵称，avatar 传空（历史 cloud:// 头像也无展示价值，sanitizeAvatar 已净化）
    const r = await api.updateMemberProfile(this.data.boardId, nickname, '');
    this.setData({ savingProfile: false });
    if (!r.ok) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      return;
    }
    this.setData({ showProfile: false });
    wx.showToast({ title: '已更新', icon: 'success' });
    this._load();
  },

  // ==================== 编辑番剧（共享字段，MVP 只改名）====================
  // 番名改为在详情弹层内原地编辑（editingName 切换），不再叠第二层弹窗
  onEditItemTap() {
    const d = this.data.detailItem;
    if (!d) return;
    this.setData({ editingName: true, editName: d.name });
  },

  onCancelEditName() {
    this.setData({ editingName: false });
  },

  onEditNameInput(e) {
    this.setData({ editName: e.detail.value });
  },

  async onConfirmEdit() {
    if (this.data.savingEdit) return;
    const d = this.data.detailItem;
    const name = (this.data.editName || '').trim();
    if (!name) {
      wx.showToast({ title: '番名不能为空', icon: 'none' });
      return;
    }
    if (name === d.name) {
      this.setData({ editingName: false });
      return;
    }
    this.setData({ savingEdit: true });
    const r = await api.updateItem(d.itemId, { name });
    this.setData({ savingEdit: false });
    if (!r.ok) {
      const msg = r.code === 'ERR_DUPLICATE_ITEM' ? '番单里已经有这部番了' : '保存失败';
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    // 退出编辑态 + 同步详情标题 + 重拉列表
    this.setData({ editingName: false, 'detailItem.name': name });
    this._load();
  },

  // ==================== 番剧信息编辑（总集数 + 放送状态，共享字段）====================
  // 独立于「看到第几话」（个人进度）：那个写 progress.ep，这个写 item.totalEp/airStatus。
  // 点详情弹层「共X集 / 放送状态」行进入，收起详情遮罩再叠，关闭时弹回详情。
  onItemInfoTap() {
    const d = this.data.detailItem;
    if (!d) return;
    this.setData({
      showDetail: false,
      showItemInfo: true,
      itemInfoTotalEp: d.totalEp != null ? String(d.totalEp) : '',
      itemInfoAirStatus: d.airStatus || '',
    });
  },


  onItemInfoVisibleChange(e) {
    // 点遮罩关闭 → 回详情（与 ep 输入弹层同款出口）
    if (!e.detail.visible) this.setData({ showItemInfo: false, showDetail: true });
  },

  // 卡片上「已超出预设 ›」提示点击：直接打开番剧信息弹层改总集数（catchtap 已阻止冒泡到卡片）。
  // 不经详情弹层，故先备好 detailItem 再复用 onItemInfoTap 的开层逻辑。
  onExceedHintTap(e) {
    const { itemId } = e.currentTarget.dataset;
    const raw = (this._rawItems || []).find((it) => it._id === itemId);
    if (!raw) return;
    const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;
    const detailItem = T.buildItemViewModel(raw, this.data.myOpenid, peerOpenid);
    this.setData({
      detailItem,
      showDetail: false,
      showItemInfo: true,
      itemInfoTotalEp: detailItem.totalEp != null ? String(detailItem.totalEp) : '',
      itemInfoAirStatus: detailItem.airStatus || '',
    });
  },

  onItemInfoTotalEpInput(e) {
    this.setData({ itemInfoTotalEp: this._sanitizeTotalEpInput(e.detail.value) });
  },

  onItemInfoTotalEpInc() {
    this.setData({ itemInfoTotalEp: String(this._stepTotalEp(this.data.itemInfoTotalEp, +1)) });
  },

  onItemInfoTotalEpDec() {
    const cur = this.data.itemInfoTotalEp;
    if (!cur) return;
    this.setData({ itemInfoTotalEp: String(this._stepTotalEp(cur, -1)) });
  },

  onItemInfoAirStatusChange(e) {
    this.setData({ itemInfoAirStatus: e.currentTarget.dataset.value });
  },

  async onItemInfoConfirm() {
    if (this.data.savingItemInfo) return;
    const d = this.data.detailItem;
    if (!d) return;
    const totalEp = T.normalizeTotalEp(this.data.itemInfoTotalEp); // 合法整数或 null
    const airStatus = this.data.itemInfoAirStatus || '';
    // 首次从「无总集数」变「有总集数」→ 进度轴从无分母切到有分母，播校准提示
    const wasUnset = d.totalEp == null;
    const nowSet = totalEp != null;

    const patch = { totalEp };
    if (airStatus) patch.airStatus = airStatus;

    this.setData({ savingItemInfo: true });
    const r = await api.updateItem(d.itemId, patch);
    this.setData({ savingItemInfo: false });
    if (!r.ok) {
      wx.showToast({ title: '保存失败', icon: 'none' });
      return;
    }
    this.setData({ showItemInfo: false, showDetail: true });
    if (wasUnset && nowSet) {
      wx.showToast({ title: this.data.totalEpCopy.CALIBRATED, icon: 'none' });
    } else {
      wx.showToast({ title: '已更新', icon: 'success' });
    }
    this._load();
  },

  // ==================== 移出番单（软删，可恢复）====================
  onRemoveItemTap() {
    const d = this.data.detailItem;
    if (!d) return;
    // 轻确认防误触；措辞软（软删可恢复，不叫删除）
    // 不染红 confirm：软删可恢复，不制造删除恐慌，与「移出而非删除」的措辞一致
    wx.showModal({
      title: '移出番单？',
      content: '会从你俩的番单里拿掉，需要的话之后还能加回来',
      confirmText: '移出',
      cancelText: '再想想',
      success: async (res) => {
        if (!res.confirm) return;
        const r = await api.deleteItem(d.itemId, true);
        if (!r.ok) {
          wx.showToast({ title: '移出失败', icon: 'none' });
          return;
        }
        this.setData({ showDetail: false });
        wx.showToast({ title: '已移出', icon: 'none' });
        this._load();
      },
    });
  },

  // ==================== 配对邀请（P4）====================
  // 空板态点「邀请 TA」→ 走 onShareAppMessage（button open-type=share）
  onShareAppMessage() {
    const { boardId } = this.data;
    const rawBoard = this._rawBoard;
    // 分享卡片带 boardId + 当前 token，对方点开即尝试 joinBoard
    const token = rawBoard && rawBoard.pairing ? rawBoard.pairing.token : '';
    return {
      title: '和我一起追番吧 🎬',
      path: `/packageFeatures/pages/shared-board/shared-board?boardId=${boardId}&token=${token}`,
    };
  },

  // ==================== 加番 ====================
  onAddTap() {
    if (this.data.adding) return;
    this._pickedMeta = null; // 新一轮加番，清掉上次搜番剧带出的暂存封面/sourceId
    this._airMetaWait = null; // 同步清补拉 promise，避免本轮等到上一轮的旧回包
    this.setData({
      showAdd: true,
      newItemName: '',
      newItemTotalEp: '',
      newItemCover: '',
      newItemPicked: false,
      newItemCoverError: false,
    });
  },

  // 加番弹层「搜番剧」：跳搜索页 pick 模式，选中后回带填入番名/总集数（封面在提交时随 addItem 一起存）。
  // 用 EventChannel 单层回写：navigateTo 打开搜索页，搜索页选中 emit PICK_EVENT，此处 on 接收。
  onAddSearchTap() {
    if (this.data.adding) return;
    wx.navigateTo({
      url: `${ANIME_SEARCH_URL}?mode=${SEARCH_MODE.PICK}`,
      events: {
        [PICK_EVENT]: (picked) => this._onPickedForAdd(picked),
      },
    });
  },

  // 加番场景收到选中番剧：回填番名 + 总集数，并暂存封面/sourceId 待提交时随 addItem 存。
  // 不直接 addItem——让用户回到弹层还能改名/改集数再确认，选中只是「带出」不是「提交」。
  _onPickedForAdd(picked) {
    if (!picked || this.data.adding) return;
    const cover = picked.cover || '';
    const sourceId = Number.isInteger(picked.sourceId) && picked.sourceId > 0 ? picked.sourceId : null;
    // 先存搜索结果已有的字段（small cover/sourceId）；详情回来后优先换 medium cover，
    // 并异步补入 airDay/isOnAir。
    this._pickedMeta = { cover, sourceId };
    const name = picked.name || this.data.newItemName;
    this.setData({
      newItemName: name,
      newItemTotalEp: picked.totalEp ? String(picked.totalEp) : this.data.newItemTotalEp,
      newItemCover: cover, // 弹层顶部显示封面缩略图，让「已选中这部」所见即所得
      newItemPicked: true,
      newItemCoverError: false, // 新封面给一次加载机会
      newItemFallback: T.pickCoverColor(name), // 无封面/加载失败时的首字色块兜底
    });
    // 补拉详情：搜索接口只有 small cover 且不给 airDay/isOnAir；详情提供 medium cover 和放送信息。
    // 异步进行，不阻塞选中回填；失败仅 toast 提示、不影响加番（用户已确认的降级策略）。
    // 存下这次补拉的 promise：用户可能在详情回来前就点确认，onConfirmAdd 提交前 await 它
    // （带超时），确保放送信息尽量赶上落库，避免竞态导致 airStatus/airDay 双缺失。
    this._airMetaWait = sourceId ? this._fetchAirMeta(sourceId) : null;
  },

  // 按 sourceId 补拉详情，优先采用详情返回的中图封面，并取 airDay/isOnAir 存入
  // _pickedMeta，供提交时随 addItem 落库。捕获本次选中对象并在回包后校验对象身份：
  // 只比 sourceId 挡不住「重选了同一部番」的旧请求，旧回包仍可能覆盖新一轮预览。
  async _fetchAirMeta(sourceId) {
    const pickedMeta = this._pickedMeta;
    const r = await animeApi.getAnimeDetail(sourceId);
    // 弹层已重选/关闭（_pickedMeta 被替换或清空）→ 丢弃这次回包，不串档。
    // 对象身份校验同时覆盖 sourceId 相同的重复选择。
    if (this._unloaded || !pickedMeta || this._pickedMeta !== pickedMeta || pickedMeta.sourceId !== sourceId) return;
    if (!r || !r.ok || !r.data || !r.data.bangumi) {
      wx.showToast({ title: ANIME_BIND_COPY.META_FAIL, icon: 'none' });
      return;
    }
    const b = r.data.bangumi;
    const bestCover = preferDetailCover(pickedMeta.cover, b.cover);
    if (bestCover && bestCover !== pickedMeta.cover) {
      pickedMeta.cover = bestCover;
      // 搜索结果先展示 small；详情回来后无缝切到 medium，并清掉 small 的失败态给新 URL 一次加载机会。
      this.setData({ newItemCover: bestCover, newItemCoverError: false });
    }
    if (Number.isInteger(b.airDay)) pickedMeta.airDay = b.airDay;
    if (typeof b.isOnAir === 'boolean') pickedMeta.isOnAir = b.isOnAir;
  },

  // 提交前等补拉详情就绪：race「补拉 promise」与「AIR_META_WAIT_MS 超时」。
  // 补拉先回 → medium 封面/放送信息已写回 _pickedMeta，带上落库；超时先到 → 用 small 加番（降级）。
  // 业务失败信封由 _fetchAirMeta toast；网络层 Promise reject 在这里静默兜底，不重复提示。
  _waitAirMeta(waitPromise) {
    const wait = waitPromise || this._airMetaWait;
    if (!wait) return Promise.resolve();
    const timeout = new Promise((resolve) => setTimeout(resolve, AIR_META_WAIT_MS));
    return Promise.race([wait.catch(() => {}), timeout]);
  },

  // 预览封面加载失败：回退首字色块（同卡片封面兜底，避免坏链/cloud:// 裸奔）
  onAddCoverError() {
    this.setData({ newItemCoverError: true });
  },

  // 已选中后「重选」：清预览与暂存，回到搜索入口态，再次跳搜索页
  onReselectAnime() {
    if (this.data.adding) return;
    this._pickedMeta = null;
    this._airMetaWait = null; // 重选清补拉 promise，旧回包因 sourceId 不匹配也会被丢弃
    this.setData({ newItemPicked: false, newItemCover: '', newItemCoverError: false });
    this.onAddSearchTap();
  },

  onAddVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    // 点击“添加”后最多会等详情 3 秒；等待/提交期间保持弹层与选中对象稳定，
    // 防止遮罩关闭或重选让后台提交协程拿到另一轮数据。
    if (this.data.adding && !visible) return;
    this.setData({ showAdd: visible });
  },

  onItemNameInput(e) {
    if (this.data.adding) return;
    this.setData({ newItemName: e.detail.value });
  },

  // 总集数步进器：input 直接改（保留字符串，空=不填），±按钮在当前值基础上增减。
  // 边界钳制统一走 _stepTotalEp，不散落魔法数字。
  onAddTotalEpInput(e) {
    if (this.data.adding) return;
    this.setData({ newItemTotalEp: this._sanitizeTotalEpInput(e.detail.value) });
  },

  onAddTotalEpInc() {
    if (this.data.adding) return;
    this.setData({ newItemTotalEp: String(this._stepTotalEp(this.data.newItemTotalEp, +1)) });
  },

  onAddTotalEpDec() {
    if (this.data.adding) return;
    const cur = this.data.newItemTotalEp;
    if (!cur) return; // 空态减无意义（下限即 1，不从空跳到 0）
    this.setData({ newItemTotalEp: String(this._stepTotalEp(cur, -1)) });
  },

  // 输入净化：只留数字，去前导空；不在输入期强制钳上限（让人能连打），提交时再归一
  _sanitizeTotalEpInput(v) {
    const digits = String(v == null ? '' : v).replace(/[^\d]/g, '');
    return digits;
  },

  // 步进：在当前值（空按 0 起）基础上 ±1，钳到 [TOTAL_EP_MIN, TOTAL_EP_MAX]
  _stepTotalEp(cur, delta) {
    const base = parseInt(cur, 10);
    const n = (Number.isNaN(base) ? 0 : base) + delta;
    return Math.max(TOTAL_EP_MIN, Math.min(TOTAL_EP_MAX, n));
  },

  async onConfirmAdd() {
    if (this.data.adding) return;
    const name = (this.data.newItemName || '').trim();
    if (!name) {
      wx.showToast({ title: '输入番剧名称', icon: 'none' });
      return;
    }
    // 在任何 await 之前上锁并捕获本次选择：按钮连点、遮罩关闭、重选都不能启动第二条提交协程。
    const pickedMeta = this._pickedMeta;
    const detailWait = this._airMetaWait;
    const totalEpInput = this.data.newItemTotalEp;
    const boardId = this.data.boardId;
    this.setData({ adding: true });
    try {
      // 详情补拉可能还在路上（用户选完番很快点确认）。提交前最多等 AIR_META_WAIT_MS；
      // 命中就把 medium/放送信息写进捕获的 pickedMeta，超时则沿用 small 降级。
      if (detailWait) await this._waitAirMeta(detailWait);
      if (this._unloaded) return;

      // 总集数和选中对象都以点击“添加”的瞬间为准，等待期间的迟到 UI 事件不会串进本次提交。
      const totalEp = T.normalizeTotalEp(totalEpInput);
      const meta = pickedMeta || {};
      const extra = {};
      if (totalEp != null) extra.totalEp = totalEp;
      if (meta.cover) extra.cover = meta.cover;
      if (meta.sourceId) extra.sourceId = meta.sourceId;
      if (Number.isInteger(meta.airDay)) extra.airDay = meta.airDay;
      if (typeof meta.isOnAir === 'boolean') extra.isOnAir = meta.isOnAir;

      const r = await api.addItem(boardId, name, extra);
      if (this._unloaded) return;
      if (!r.ok) {
        const msg = r.code === 'ERR_DUPLICATE_ITEM' ? '这部番已经在单里啦' : '添加失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      this._pickedMeta = null; // 用完即清，避免下次手打加番误带上一次的封面
      this._airMetaWait = null; // 补拉 promise 已消费，清掉不留给下一轮
      this.setData({ showAdd: false, newItemCover: '', newItemPicked: false, newItemCoverError: false });
      this._load(); // 重新拉取，卡片出现
    } catch (e) {
      if (!this._unloaded) wx.showToast({ title: '添加失败', icon: 'none' });
    } finally {
      if (!this._unloaded) this.setData({ adding: false });
    }
  },

  // ==================== 进度编辑（P3 弹层）====================
  onItemTap(e) {
    const { itemId } = e.currentTarget.dataset;
    const raw = (this._rawItems || []).find((it) => it._id === itemId);
    if (!raw) return;
    const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;
    // 用 buildItemViewModel 构建：一并拿到 subtitle/airLabel（番剧信息行展示用），避免页面重复拼串
    const detailItem = T.buildItemViewModel(raw, this.data.myOpenid, peerOpenid);
    this.setData({
      showDetail: true,
      editingName: false, // 每次打开回到展示态
      detailItem,
    });
  },

  onDetailVisibleChange(e) {
    // 关闭详情时一并退出番名编辑态，避免下次打开残留
    this.setData({ showDetail: e.detail.visible, editingName: false });
  },

  // 进改动历史页（独立时间线，带 boardId）。
  // 顺带把对方昵称经 URL 传过去（本页已有 vm.peer.nickname），省掉历史页再拉一次板详情。
  onHistoryTap() {
    if (!this.data.boardId) return;
    const peer = this.data.vm && this.data.vm.peer;
    const peerName = peer && peer.nickname ? peer.nickname : '';
    const q = peerName ? `&peerName=${encodeURIComponent(peerName)}` : '';
    wx.navigateTo({ url: `/packageFeatures/pages/board-history/board-history?boardId=${this.data.boardId}${q}` });
  },

  // 进追番小结页（独立报告，仅需 boardId；双人昵称/集数由 getBoardReport 云函数返回）
  onReportTap() {
    if (!this.data.boardId) return;
    wx.navigateTo({ url: `/packageFeatures/pages/board-report/board-report?boardId=${this.data.boardId}` });
  },

  // 进持久「一起看」清单；已归档的双人板也保留入口，由子页切为只读。
  onTogetherWatchTap() {
    const vm = this.data.vm;
    if (!this.data.boardId || !vm || !vm.peer || !['paired', 'archived'].includes(vm.phase)) return;
    wx.navigateTo({ url: `/packageFeatures/pages/together-watch/together-watch?boardId=${this.data.boardId}` });
  },

  // +1：本地即时累加（连点基于最新本地态，五连点=+5），_commitProgress 内部乐观更新 + 异步对账
  onEpInc() {
    const d = this.data.detailItem;
    if (!d) return;
    const target = d.pair.mine.ep + 1;
    this._commitProgress(d.itemId, target, this._deriveStatus(d.pair.mine.status, target));
    this._playEpBump();
  },

  // +1 动画：集数大字上跳回落 + 绿色 +1 浮起淡出。CSS animation 驱动，700ms 后复位。
  // 复位用 setData(false) 让下次点击能重新触发（同名 class 需先移除再加）。
  _playEpBump() {
    if (this._epBumpTimer) clearTimeout(this._epBumpTimer);
    // 先关再开：连点时若已是 true，setData 同值不会重放动画，故强制先 false
    this.setData({ epBump: false });
    wx.nextTick(() => this.setData({ epBump: true }));
    this._epBumpTimer = setTimeout(() => this.setData({ epBump: false }), 700);
  },

  // 唯一的状态自动联动：ep 从 0 变 ≥1 且当前是「想看」→ 自动转「在追」（其余状态不动）
  _deriveStatus(currentStatus, targetEp) {
    if (targetEp >= 1 && (currentStatus === 'want' || !currentStatus)) return 'watching';
    return currentStatus || 'watching';
  },

  // ==================== 集数编辑（短番滚轮 / 长番数字输入）====================
  // 分流：有明确总集数且 ≤ EP_ROLL_MAX（短番）走滚轮，可视化好；
  // 长番或无分母（滚一两百格反人类）走数字键盘直接输入。
  onEpTap() {
    const d = this.data.detailItem;
    if (!d) return;
    const useRoll = d.totalEp && d.totalEp > 0 && d.totalEp <= EP_ROLL_MAX;
    if (useRoll) {
      const epOptions = [];
      for (let i = 0; i <= d.totalEp; i++) epOptions.push({ label: `第${i}话`, value: i });
      // 收起详情遮罩再叠滚轮，避免两层遮罩叠暗 + 两张白卡摞
      this.setData({
        showDetail: false,
        showEpPicker: true,
        epOptions,
        epPickerValue: [d.pair.mine.ep],
      });
    } else {
      this.setData({
        showDetail: false,
        showEpInput: true,
        epInputValue: String(d.pair.mine.ep),
      });
    }
  },

  // 注意：t-picker 的 confirm/cancel 不发 visible-change（只有点遮罩才发），与 t-action-sheet 机制不同，
  // 故这两条路径必须自己恢复 showDetail，不能像 action-sheet 那样统一交给 visible-change。
  onEpPickerConfirm(e) {
    const ep = e.detail.value[0];
    const d = this.data.detailItem;
    this.setData({ showEpPicker: false, showDetail: true });
    if (!d) return;
    this._commitProgress(d.itemId, ep, this._deriveStatus(d.pair.mine.status, ep));
  },

  onEpPickerCancel() {
    this.setData({ showEpPicker: false, showDetail: true });
  },

  // 兜住「点遮罩关闭」这条 confirm/cancel 覆盖不到的额外路径（幂等，与上面重复设置无害）
  onEpPickerVisibleChange(e) {
    if (!e.detail.visible) this.setData({ showEpPicker: false, showDetail: true });
  },

  // ── 集数数字输入（长番/无分母）──
  onEpInputVisibleChange(e) {
    // 点遮罩关闭 → 回详情
    if (!e.detail.visible) this.setData({ showEpInput: false, showDetail: true });
  },

  onEpInputChange(e) {
    this.setData({ epInputValue: e.detail.value });
  },

  onEpInputConfirm() {
    const d = this.data.detailItem;
    const raw = (this.data.epInputValue || '').trim();
    const ep = parseInt(raw, 10);
    if (!raw || Number.isNaN(ep) || ep < 0) {
      wx.showToast({ title: '输入有效集数', icon: 'none' });
      return;
    }
    this.setData({ showEpInput: false, showDetail: true });
    if (!d) return;
    // 上限交给云函数 clampEp 兜底（有 totalEp 截到最后一集，无则截到 EP_MAX_WHEN_UNKNOWN）
    this._commitProgress(d.itemId, ep, this._deriveStatus(d.pair.mine.status, ep));
  },

  // ==================== 状态选择器（六选一）====================
  onStatusTap() {
    // 同样先收起详情遮罩再叠 action-sheet
    this.setData({ showDetail: false, showStatusSheet: true });
  },

  onStatusSelected(e) {
    const status = e.detail.selected.value;
    const d = this.data.detailItem;
    // 只收 sheet + 提交；「弹回详情」统一交给 onStatusSheetVisibleChange
    this.setData({ showStatusSheet: false });
    if (!d) return;
    // 弃番给一次轻确认（去批判感文案）；其余直接改
    if (status === 'dropped') {
      wx.showModal({
        title: '先下车？',
        content: '随时能回来接着追',
        confirmText: '先下车',
        cancelText: '再想想',
        success: (res) => {
          if (res.confirm) this._commitProgress(d.itemId, d.pair.mine.ep, status);
        },
      });
      return;
    }
    this._commitProgress(d.itemId, d.pair.mine.ep, status);
  },

  onStatusSheetCancel() {
    this.setData({ showStatusSheet: false });
  },

  // 统一的状态选择器关闭出口：selected/cancel/点遮罩关闭都触发，同步父级状态并弹回详情
  onStatusSheetVisibleChange(e) {
    if (!e.detail.visible) this.setData({ showStatusSheet: false, showDetail: true });
  },

  // 乐观 UI：本地先更新（UI 秒变，支持连点累加），云函数回来对账；失败回滚 + toast。
  // PRD §10 冷启动应对——云函数首次 1~3s，不能让最高频的 +1 手势卡在网络后面。
  _commitProgress(itemId, ep, status) {
    const myOpenid = this.data.myOpenid;
    const raw = (this._rawItems || []).find((it) => it._id === itemId);
    if (!raw) return;
    const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;

    // ① 本地乐观写入 rawItems + 重算 pair 立即上屏（clamp 与云函数同规则，本地也先夹一下）
    // 失败不靠本地快照回滚，直接 _load 拉服务端权威值对账，故这里不存快照。
    const optimisticEp = T.clampEp(ep, raw.totalEp);
    raw.progress = raw.progress || {};
    const previousMine = raw.progress[myOpenid] || {};
    const optimisticMine = Object.assign({}, previousMine, {
      ep: optimisticEp != null ? optimisticEp : ep,
      status,
    });
    raw.progress[myOpenid] = optimisticMine;
    const optimisticPair = T.buildProgressPair(raw, myOpenid, peerOpenid);
    this.setData({ 'detailItem.pair': optimisticPair });
    // 追平里程碑在乐观态即时庆祝（本地防重放），手感更跟手
    if (optimisticPair.hasPeer && optimisticPair.lead === 'even') {
      this._celebrateSync(itemId);
    }

    // ② 同一 item 的网络写串行并折叠到最新目标。连续 +1 仍立即乐观上屏，但服务端必须
    // 先确认 rev=N 才发 rev=N+1，杜绝旧请求晚到覆盖共同推进或把 E7 写回 E6。
    this._commitSeq = (this._commitSeq || 0) + 1;
    this._progressDesired = this._progressDesired || {};
    this._progressDesired[itemId] = {
      ep: optimisticMine.ep,
      status,
      seq: this._commitSeq,
    };
    this._flushProgress(itemId);
  },

  _flushProgress(itemId) {
    this._progressInFlight = this._progressInFlight || {};
    if (this._progressInFlight[itemId]) return;
    const desired = this._progressDesired && this._progressDesired[itemId];
    const raw = (this._rawItems || []).find((it) => it._id === itemId);
    if (!desired || !raw) return;

    const myOpenid = this.data.myOpenid;
    const mine = (raw.progress && raw.progress[myOpenid]) || {};
    const rawRev = Number.isInteger(mine.rev) && mine.rev >= 0 ? mine.rev : 0;
    this._progressRevByItem = this._progressRevByItem || {};
    const expectedRev = Math.max(this._progressRevByItem[itemId] || 0, rawRev);
    this._progressRevByItem[itemId] = expectedRev;
    this._progressInFlight[itemId] = true;

    api.updateProgress(itemId, desired.ep, desired.status, expectedRev).then((r) => {
      if (this._unloaded) return;
      this._progressInFlight[itemId] = false;
      const latest = this._progressDesired && this._progressDesired[itemId];
      if (!r || !r.ok || !r.data || !r.data.mine) {
        delete this._progressDesired[itemId];
        const conflict = r && r.code === 'ERR_CONFLICT';
        wx.showToast({ title: conflict ? '进度已变化，请重试' : '更新失败，已还原', icon: 'none' });
        this._load();
        return;
      }

      const authoritativeMine = r.data.mine;
      const authoritativeRev = Number.isInteger(authoritativeMine.rev) ? authoritativeMine.rev : expectedRev;
      const knownRev = this._progressRevByItem[itemId] || 0;
      // 请求期间 _load/共同推进已带回更高 rev：当前回包已经过时，绝不能拿旧绝对值覆盖。
      if (knownRev > authoritativeRev) {
        delete this._progressDesired[itemId];
        wx.showToast({ title: '进度已变化，请重试', icon: 'none' });
        this._load();
        return;
      }
      this._progressRevByItem[itemId] = authoritativeRev;
      // 按 itemId 合并到当前 raw；不要使用请求发起时捕获的 raw，它可能已被 _load 替换。
      const currentRaw = (this._rawItems || []).find((it) => it._id === itemId);
      if (!currentRaw) {
        delete this._progressDesired[itemId];
        this._load();
        return;
      }
      currentRaw.progress = currentRaw.progress || {};
      currentRaw.progress[myOpenid] = authoritativeMine;
      if (latest && latest.seq !== desired.seq) {
        // 等待期间又有操作：保留最新乐观值，拿刚返回的新 rev 继续发下一次。
        currentRaw.progress[myOpenid] = Object.assign({}, authoritativeMine, {
          ep: latest.ep,
          status: latest.status,
        });
        const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;
        this.setData({ 'detailItem.pair': T.buildProgressPair(currentRaw, myOpenid, peerOpenid) });
        this._flushProgress(itemId);
        return;
      }

      delete this._progressDesired[itemId];
      const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;
      this.setData({ 'detailItem.pair': T.buildProgressPair(currentRaw, myOpenid, peerOpenid) });
      this._load();
    }).catch(() => {
      if (this._unloaded) return;
      this._progressInFlight[itemId] = false;
      delete this._progressDesired[itemId];
      wx.showToast({ title: '更新失败，已还原', icon: 'none' });
      this._load();
    });
  },

  // 追平庆祝（本地 storage 防重放，同一 item 同一人只放一次）
  _celebrateSync(itemId) {
    const key = `sb_milestone_sync_${itemId}_${this.data.myOpenid}`;
    if (wx.getStorageSync(key)) return;
    wx.setStorageSync(key, 1);
    wx.vibrateShort({ type: 'medium' });
    this.setData({ syncItemId: itemId });
    setTimeout(() => {
      if (this.data.syncItemId === itemId) this.setData({ syncItemId: '' });
    }, 600);
  },

});
