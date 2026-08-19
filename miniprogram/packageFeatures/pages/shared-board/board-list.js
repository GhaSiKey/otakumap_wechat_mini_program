// P1 我的板列表页 —— 我参与的所有共享板 + 建板入口
//
// 允许一人加入多个板（PRD §5.4）。onShow 拉列表（打开即最新，MVP 不做 watch）。
const api = require('../../utils/shared-board/cloud-api');
const { pickCoverColor, sanitizeAvatar, relativeTime } = require('../../utils/shared-board/transform');
const { BOARD_STATUS, BOARD_LIST_COPY } = require('../../utils/shared-board/config');

// 占位符插值：{key} → vars[key]。回调式 replace，避免番名含 $&/$1 被当特殊模式（与 board-report/history 同一约定）
function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

Page({
  data: {
    copy: BOARD_LIST_COPY, // 静态文案（空态/建板弹层）走配置，wxml 直接取
    loading: true,
    boards: [],       // 视图模型列表
    myOpenid: '',
    showCreate: false, // 建板弹层
    newBoardName: '',
    creating: false,
    avatarErr: {},    // {boardId: true} 对方头像加载失败 → 回退首字母（不开云存储时常见）
  },

  onLoad() {
    this._init();
  },

  onShow() {
    // openid 已就绪才刷新（首次由 onLoad 的 _init 触发；此处覆盖切后台回来 / 建板页返回）
    if (this.data.myOpenid) this._loadBoards();
  },

  onPullDownRefresh() {
    this._loadBoards().then(() => wx.stopPullDownRefresh());
  },

  // 首次加载：openid 与板列表并行拉取，砍掉「先串行等 openid 再拉列表」的一次 RTT。
  // listMyBoards 不依赖前端 openid（云端 getWXContext 自取身份），openid 仅在返回后
  // _toVM 区分「我 vs 对方」时才用，故两请求可并行。getMyOpenid 缓存命中时同步返回，
  // Promise.all 自然退化为「只等 listMyBoards」。
  async _init() {
    const [me, list] = await Promise.all([api.getMyOpenid(), api.listMyBoards()]);
    if (!(me.ok && me.data && me.data.openid)) {
      this.setData({ loading: false });
      wx.showToast({ title: '身份获取失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ myOpenid: me.data.openid });
    this._applyBoards(list, me.data.openid);
  },

  // 拉板列表（onShow / 下拉复用；此时 openid 已就绪，读 this.data）
  async _loadBoards() {
    const r = await api.listMyBoards();
    this._applyBoards(r, this.data.myOpenid);
  },

  // listMyBoards 返回信封 → 列表视图模型（_init 并行路径与 _loadBoards 复用）
  _applyBoards(r, myOpenid) {
    if (!r.ok) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
      return;
    }
    const boards = (r.data.boards || []).map((b) => this._toVM(b, myOpenid));
    // 不重置 avatarErr：不开云存储时对方头像恒失败，每次 onShow 重置会导致列表头像反复闪烁。
    // 首字母兜底后保持稳定；按 boardId 索引，脏标记无害（首字母本就是兜底）
    this.setData({ boards, loading: false });
  },

  // 对方头像加载失败 → 标记该板回退首字母色块
  onPeerAvatarError(e) {
    const { boardId } = e.currentTarget.dataset;
    if (!boardId) return;
    this.setData({ [`avatarErr.${boardId}`]: true });
  },

  // 单个板卡片视图模型（P1 统一大卡：双人同轴头像 + 封面墙 + 番数 + 活跃时间）
  _toVM(board, myOpenid) {
    const members = board.members || [];
    const me = members.find((m) => m && m.openid === myOpenid) || null;
    const peer = members.find((m) => m && m.openid && m.openid !== myOpenid) || null;
    const archived = board.status === BOARD_STATUS.ARCHIVED;
    const paired = members.length >= 2;
    const peerName = peer ? peer.nickname || BOARD_LIST_COPY.PEER_DEFAULT : '';

    // 封面墙：前 N 部番名生成首字色块（封面基本为空色块，有 https 图才用图；cloud:// 净化掉）。
    // 溢出（itemCount 超过预览条数）计入 +N 角标。
    const preview = board.previewItems || [];
    const itemCount = board.itemCount || 0;
    const covers = preview.map((it) => ({
      cover: sanitizeAvatar(it.cover),
      fallback: pickCoverColor(it.name || ''),
    }));
    const moreCount = itemCount > covers.length ? itemCount - covers.length : 0;

    // 活跃/等待文案：配对态显示「和TA · X前一起追」；筹备态未配对显示「等 TA 点开链接」，
    // 已配对但走单人叙事的边界几乎不存在（配对即双人），故只按 paired 分两支。
    const activeTime = relativeTime(board.updateTime, Date.now());
    let subline;
    if (!paired) {
      subline = BOARD_LIST_COPY.WAITING_PEER;
    } else {
      subline = fillTemplate(BOARD_LIST_COPY.ACTIVE_WITH_PEER, { peer: peerName, time: activeTime });
    }

    return {
      boardId: board._id,
      name: board.name,
      itemCount,
      itemCountText: fillTemplate(BOARD_LIST_COPY.ITEM_COUNT, { n: itemCount }),
      archived,
      paired,
      // 双人同轴头像：我方（左）恒有，对方（右）配对后有、未配对为虚位
      meFallback: pickCoverColor((me && me.nickname) || BOARD_LIST_COPY.PEER_DEFAULT),
      meAvatar: me ? sanitizeAvatar(me.avatar) : '',
      peerName,
      peerAvatar: peer ? sanitizeAvatar(peer.avatar) : '', // cloud:// 净化为空→走首字母，不发失败请求刷 500
      peerFallback: peer ? pickCoverColor(peerName) : null,
      covers,
      moreText: moreCount > 0 ? fillTemplate(BOARD_LIST_COPY.COVERS_MORE, { n: moreCount }) : '',
      subline,
      hasUnread: !!board.hasUnread,
    };
  },

  onCreateTap() {
    this.setData({ showCreate: true, newBoardName: '' });
  },

  onCreateVisibleChange(e) {
    this.setData({ showCreate: e.detail.visible });
  },

  onBoardNameInput(e) {
    this.setData({ newBoardName: e.detail.value });
  },

  async onConfirmCreate() {
    if (this.data.creating) return;
    const name = (this.data.newBoardName || '').trim();
    this.setData({ creating: true });
    const r = await api.createBoard(name || undefined);
    this.setData({ creating: false });
    if (!r.ok) {
      wx.showToast({ title: '建板失败', icon: 'none' });
      return;
    }
    this.setData({ showCreate: false });
    // 进入新板（空板态 = 配对流 P4）
    wx.navigateTo({ url: `/packageFeatures/pages/shared-board/shared-board?boardId=${r.data.boardId}` });
  },

  onBoardTap(e) {
    const { boardId } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packageFeatures/pages/shared-board/shared-board?boardId=${boardId}` });
  },
});
