// P1 我的板列表页 —— 我参与的所有共享板 + 建板入口
//
// 允许一人加入多个板（PRD §5.4）。onShow 拉列表（打开即最新，MVP 不做 watch）。
const api = require('../../utils/shared-board/cloud-api');
const { pickCoverColor } = require('../../utils/shared-board/transform');
const { BOARD_STATUS } = require('../../utils/shared-board/config');

Page({
  data: {
    loading: true,
    boards: [],       // 视图模型列表
    myOpenid: '',
    showCreate: false, // 建板弹层
    newBoardName: '',
    creating: false,
  },

  onLoad() {
    // 先拿到 openid 再加载列表，避免 _toVM 用空 openid 误判「我 vs 对方」
    this._ensureOpenid();
  },

  onShow() {
    // openid 已就绪才刷新（onLoad 首次会自行触发加载）
    if (this.data.myOpenid) this._loadBoards();
  },

  onPullDownRefresh() {
    this._loadBoards().then(() => wx.stopPullDownRefresh());
  },

  // 确保拿到自己的 openid（拿到后触发首次加载）
  async _ensureOpenid() {
    const r = await api.getMyOpenid();
    if (r.ok && r.data && r.data.openid) {
      this.setData({ myOpenid: r.data.openid });
      this._loadBoards();
    } else {
      this.setData({ loading: false });
      wx.showToast({ title: '身份获取失败，请重试', icon: 'none' });
    }
  },

  // 拉板列表并构建列表视图模型（对方头像、番数、归档态）
  async _loadBoards() {
    const r = await api.listMyBoards();
    if (!r.ok) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
      return;
    }
    const myOpenid = this.data.myOpenid;
    const boards = (r.data.boards || []).map((b) => this._toVM(b, myOpenid));
    this.setData({ boards, loading: false });
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
      peerAvatar: peer ? peer.avatar || '' : '',
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
