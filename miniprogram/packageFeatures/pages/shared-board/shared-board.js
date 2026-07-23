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
  PROGRESS_STATUS,
  EP_PICKER_MAX_UNKNOWN,
  JOIN_ERR_MESSAGES,
} = require('../../utils/shared-board/config');

// 状态 action-sheet 的选项（按 PROGRESS_STATUS 顺序生成，文案走 STATUS_LABELS，不硬编码）
const STATUS_SHEET_ITEMS = PROGRESS_STATUS.map((s) => ({ label: STATUS_LABELS[s], value: s }));

Page({
  data: {
    statusLabels: STATUS_LABELS, // 分区标题已在 transform 内算好（sec.title），此处只留状态标签
    boardId: '',
    token: '',            // 分享卡片带的配对 token
    myOpenid: '',
    loading: true,
    vm: null,             // buildBoardViewModel 结果
    rawBoard: null,       // 原始 board（分享用）
    rawItems: [],         // 原始 items（改进度后局部更新用）
    // 加番弹层
    showAdd: false,
    newItemName: '',
    adding: false,
    // 进度编辑弹层（P3）
    showDetail: false,
    detailItem: null,
    // 集数选择器
    showEpPicker: false,
    epOptions: [],        // [{label:'E0',value:0}, ...]
    epPickerValue: [0],
    // 状态选择器
    showStatusSheet: false,
    statusSheetItems: STATUS_SHEET_ITEMS,
    // 追平动效：当前要播 sync 动画的 itemId（播完清空）
    syncItemId: '',
    // 编辑番剧弹层（共享字段，MVP 只改名）
    showEdit: false,
    editName: '',
    savingEdit: false,
    // 对方加入动画标记
    justJoined: false,
    // 设置头像昵称弹层
    showProfile: false,
    profileAvatar: '',    // chooseAvatar 拿到的临时路径
    profileNickname: '',
    savingProfile: false,
  },

  async onLoad(query) {
    const boardId = query.boardId || '';
    const token = query.token || '';
    this.setData({ boardId, token });

    const me = await api.getMyOpenid();
    if (!(me.ok && me.data && me.data.openid)) {
      this.setData({ loading: false });
      wx.showToast({ title: '身份获取失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ myOpenid: me.data.openid });

    // 带 token 进来（来自分享卡片）→ 尝试配对入板
    if (boardId && token) {
      const jr = await api.joinBoard(boardId, token);
      if (jr.ok) {
        // rejoin=true 是本人重复进入（如刷新），不弹提示；首次加入才庆祝
        if (!jr.data.rejoin) wx.showToast({ title: '加入成功，一起追吧 🎬', icon: 'none' });
      } else {
        // 各错误码走配置映射，覆盖满员/板不存在/token 无效/过期/已用/网络异常
        const m = JOIN_ERR_MESSAGES[jr.code] || JOIN_ERR_MESSAGES._default;
        wx.showModal({ title: m.title, content: m.content, showCancel: false });
      }
    }

    // openid 就绪后触发首次加载（onShow 的守卫会跳过重复加载）
    this._load();
  },

  onShow() {
    // 仅在 openid 已就绪时刷新（首次加载由 onLoad 末尾触发，避免时序竞态）
    if (this.data.boardId && this.data.myOpenid) this._load();
  },

  onPullDownRefresh() {
    this._load().then(() => wx.stopPullDownRefresh());
  },

  // 拉板 + 番单，构建视图模型
  async _load() {
    const { boardId, myOpenid } = this.data;
    const res = await api.invoke('getBoardDetail', { boardId });
    if (!res.ok) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
      return;
    }
    const { board, items } = res.data;
    const vm = T.buildBoardViewModel(board, items, myOpenid);
    // 检测「对方刚加入」：本次从 waiting 变 paired（上一次还没配对，这次有对方了）
    const wasWaiting = this.data.vm && this.data.vm.phase === 'waiting';
    const nowPaired = vm.phase === 'paired';
    this.setData({ vm, rawBoard: board, rawItems: items, loading: false });
    wx.setNavigationBarTitle({ title: board.name });
    if (wasWaiting && nowPaired) this._celebrateJoin(vm.peer);
    // 记录本人查看时间，清未读红点（不阻塞渲染，失败无妨）
    api.markViewed(this.data.boardId);
  },

  // 对方加入庆祝：成员条虚位实体化动画 + toast + 震动
  _celebrateJoin(peer) {
    wx.vibrateShort({ type: 'medium' });
    this.setData({ justJoined: true });
    wx.showToast({ title: `${(peer && peer.nickname) || 'TA'} 来了 🎬`, icon: 'none' });
    setTimeout(() => this.setData({ justJoined: false }), 500);
  },

  // ==================== 设置头像昵称（微信不能自动读，用户主动设）====================
  onEditProfileTap() {
    this.setData({
      showProfile: true,
      profileAvatar: (this.data.vm && this.data.vm.me && this.data.vm.me.avatar) || '',
      profileNickname: (this.data.vm && this.data.vm.me && this.data.vm.me.nickname) || '',
    });
  },

  onProfileVisibleChange(e) {
    this.setData({ showProfile: e.detail.visible });
  },

  // chooseAvatar 回调：拿到临时头像路径先本地预览，保存时才上传
  onChooseAvatar(e) {
    this.setData({ profileAvatar: e.detail.avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ profileNickname: e.detail.value });
  },

  async onSaveProfile() {
    if (this.data.savingProfile) return;
    const nickname = (this.data.profileNickname || '').trim();
    const localAvatar = this.data.profileAvatar || '';
    if (!nickname && !localAvatar) {
      wx.showToast({ title: '设个头像或昵称吧', icon: 'none' });
      return;
    }
    this.setData({ savingProfile: true });
    // 头像是本地临时路径才需上传；已是云 fileID（http/cloud）则沿用
    let avatarFileId = localAvatar;
    if (localAvatar && !/^cloud:\/\/|^https?:\/\//.test(localAvatar)) {
      avatarFileId = (await api.uploadAvatar(localAvatar, this.data.myOpenid)) || '';
    }
    const r = await api.updateMemberProfile(this.data.boardId, nickname, avatarFileId);
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
  onEditItemTap() {
    const d = this.data.detailItem;
    if (!d) return;
    this.setData({ showEdit: true, editName: d.name });
  },

  onEditVisibleChange(e) {
    this.setData({ showEdit: e.detail.visible });
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
      this.setData({ showEdit: false });
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
    // 同步刷新详情弹层标题 + 列表
    this.setData({ showEdit: false, 'detailItem.name': name });
    this._load();
  },

  // ==================== 配对邀请（P4）====================
  // 空板态点「邀请 TA」→ 走 onShareAppMessage（button open-type=share）
  onShareAppMessage() {
    const { boardId, rawBoard } = this.data;
    // 分享卡片带 boardId + 当前 token，对方点开即尝试 joinBoard
    const token = rawBoard && rawBoard.pairing ? rawBoard.pairing.token : '';
    return {
      title: '和我一起追番吧 🎬',
      path: `/packageFeatures/pages/shared-board/shared-board?boardId=${boardId}&token=${token}`,
    };
  },

  // ==================== 加番 ====================
  onAddTap() {
    this.setData({ showAdd: true, newItemName: '' });
  },

  onAddVisibleChange(e) {
    this.setData({ showAdd: e.detail.visible });
  },

  onItemNameInput(e) {
    this.setData({ newItemName: e.detail.value });
  },

  async onConfirmAdd() {
    if (this.data.adding) return;
    const name = (this.data.newItemName || '').trim();
    if (!name) {
      wx.showToast({ title: '输入番剧名称', icon: 'none' });
      return;
    }
    this.setData({ adding: true });
    const r = await api.addItem(this.data.boardId, name);
    this.setData({ adding: false });
    if (!r.ok) {
      const msg = r.code === 'ERR_DUPLICATE_ITEM' ? '这部番已经在单里啦' : '添加失败';
      wx.showToast({ title: msg, icon: 'none' });
      return;
    }
    this.setData({ showAdd: false });
    this._load(); // 重新拉取，卡片出现
  },

  // ==================== 进度编辑（P3 弹层）====================
  onItemTap(e) {
    const { itemId } = e.currentTarget.dataset;
    const raw = this.data.rawItems.find((it) => it._id === itemId);
    if (!raw) return;
    const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;
    const pair = T.buildProgressPair(raw, this.data.myOpenid, peerOpenid);
    this.setData({
      showDetail: true,
      detailItem: {
        itemId,
        name: raw.name,
        totalEp: raw.totalEp,
        airStatus: raw.airStatus,
        pair,
      },
    });
  },

  onDetailVisibleChange(e) {
    this.setData({ showDetail: e.detail.visible });
  },

  // +1：乐观 UI 本地先加，云函数回来对账（被 clamp 则 snap 到权威值）
  async onEpInc() {
    const d = this.data.detailItem;
    if (!d) return;
    const target = d.pair.mine.ep + 1;
    await this._commitProgress(d.itemId, target, this._deriveStatus(d.pair.mine.status, target));
  },

  // 唯一的状态自动联动：ep 从 0 变 ≥1 且当前是「想看」→ 自动转「在追」（其余状态不动）
  _deriveStatus(currentStatus, targetEp) {
    if (targetEp >= 1 && (currentStatus === 'want' || !currentStatus)) return 'watching';
    return currentStatus || 'watching';
  },

  // ==================== 集数选择器（跳集/补集/纠错）====================
  onEpTap() {
    const d = this.data.detailItem;
    if (!d) return;
    // 范围从 0 开始（0=未开追，支持回退纠错）；有 totalEp 用它，否则用展示上限
    const max = d.totalEp && d.totalEp > 0 ? d.totalEp : EP_PICKER_MAX_UNKNOWN;
    const epOptions = [];
    for (let i = 0; i <= max; i++) epOptions.push({ label: `E${i}`, value: i });
    this.setData({
      showEpPicker: true,
      epOptions,
      epPickerValue: [d.pair.mine.ep],
    });
  },

  onEpPickerConfirm(e) {
    const ep = e.detail.value[0];
    const d = this.data.detailItem;
    this.setData({ showEpPicker: false });
    if (!d) return;
    this._commitProgress(d.itemId, ep, this._deriveStatus(d.pair.mine.status, ep));
  },

  onEpPickerCancel() {
    this.setData({ showEpPicker: false });
  },

  // ==================== 状态选择器（六选一）====================
  onStatusTap() {
    this.setData({ showStatusSheet: true });
  },

  onStatusSelected(e) {
    const status = e.detail.selected.value;
    const d = this.data.detailItem;
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

  async _commitProgress(itemId, ep, status) {
    const r = await api.updateProgress(itemId, ep, status);
    if (!r.ok) {
      wx.showToast({ title: '更新失败', icon: 'none' });
      return;
    }
    // 用服务端权威值刷新弹层 + 重拉列表
    const raw = this.data.rawItems.find((it) => it._id === itemId);
    if (raw) {
      raw.progress = raw.progress || {};
      raw.progress[this.data.myOpenid] = { ep: r.data.mine.ep, status: r.data.mine.status };
    }
    const peerOpenid = this.data.vm && this.data.vm.peer ? this.data.vm.peer.openid : null;
    const newPair = T.buildProgressPair(raw, this.data.myOpenid, peerOpenid);
    this.setData({ 'detailItem.pair': newPair });
    // 追平里程碑：双方都在追且刚好持平，本地未庆祝过 → 播 sync 动画 + 震动（防重放）
    if (newPair.hasPeer && newPair.lead === 'even') {
      this._celebrateSync(itemId);
    }
    this._load();
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

