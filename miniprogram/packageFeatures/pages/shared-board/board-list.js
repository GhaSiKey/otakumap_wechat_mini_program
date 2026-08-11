// P1 我的板列表页 —— 我参与的所有共享板 + 建板入口
//
// 允许一人加入多个板（PRD §5.4）。onShow 拉列表（打开即最新，MVP 不做 watch）。
const api = require('../../utils/shared-board/cloud-api');
const { pickCoverColor, sanitizeAvatar } = require('../../utils/shared-board/transform');
const { BOARD_STATUS } = require('../../utils/shared-board/config');

Page({
  data: {
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

  // 单个板卡片视图模型
  _toVM(board, myOpenid) {
    const members = board.members || [];
    const peer = members.find((m) => m && m.openid && m.openid !== myOpenid) || null;
    const archived = board.status === BOARD_STATUS.ARCHIVED;
    const paired = members.length >= 2;
    return {
      boardId: board._id,
      name: board.name,
      itemCount: board.itemCount || 0,
      archived,
      paired,
      peerName: peer ? peer.nickname || '对方' : '',
      peerAvatar: peer ? sanitizeAvatar(peer.avatar) : '', // cloud:// 净化为空→走首字母，不发失败请求刷 500
      peerFallback: peer ? pickCoverColor(peer.nickname || '对方') : null,
      waitingHint: paired ? '' : '等 TA 点开链接',
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
