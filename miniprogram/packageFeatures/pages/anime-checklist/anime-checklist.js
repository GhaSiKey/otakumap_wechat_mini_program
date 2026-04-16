const STORAGE_KEY = 'anime_checklist_data';

function generateId() {
  return `anime_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 动画时间配置（ms）
const ANIM = {
  PHASE1: 400,  // checkbox 弹跳 + 卡片闪光
  PHASE2: 350,  // 卡片滑出
  PHASE3: 400,  // 卡片在新位置滑入
};

Page({
  data: {
    inputValue: '',
    animeList: [],        // 单一数据源，持久化用
    unwatchedList: [],    // 派生：待追
    watchedList: [],      // 派生：已看完
    isEditMode: false,
    watchedCount: 0,
    // 动画状态机
    animatingId: '',
    animPhase: '',
    animDirection: '',
  },

  // ==================== 生命周期 ====================

  onLoad() {
    const saved = wx.getStorageSync(STORAGE_KEY);
    if (saved && Array.isArray(saved)) {
      this._updateLists(saved);
    }
  },

  // ==================== 派生列表 ====================
  // 核心辅助方法：从 animeList 派生出两个子列表并同步到视图
  // 相当于 Android 中 LiveData.map / Transformations.switchMap

  _updateLists(animeList) {
    const unwatchedList = animeList.filter(item => !item.watched);
    const watchedList = animeList.filter(item => item.watched);
    this.setData({
      animeList,
      unwatchedList,
      watchedList,
      watchedCount: watchedList.length,
    });
    this._saveData(animeList);
  },

  // ==================== 输入框相关 ====================

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  onAddAnime() {
    const name = this.data.inputValue.trim();
    if (!name) return;

    const exists = this.data.animeList.some(item => item.name === name);
    if (exists) {
      wx.showToast({ title: '已经添加过了', icon: 'none' });
      return;
    }

    const newItem = {
      id: generateId(),
      name,
      watched: false,
      createTime: Date.now(),
    };

    // 新番剧插入到列表头部（未看的最前面）
    const animeList = [newItem, ...this.data.animeList];
    this._updateLists(animeList);
    this.setData({ inputValue: '' });
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  // ==================== 核心：三阶段动画 ====================
  //
  // 拆分列表后，toggle watched 时卡片会从一个 wx:for 消失，
  // 在另一个 wx:for 出现。CSS 动画类名通过 animatingId 匹配，
  // 所以飞出/飞入动画仍然生效。
  //
  onToggleWatched(e) {
    const { id } = e.currentTarget.dataset;
    const { animeList, animatingId } = this.data;
    const targetItem = animeList.find(item => item.id === id);
    if (!targetItem || animatingId) return;

    const willWatch = !targetItem.watched;
    const direction = willWatch ? 'check' : 'uncheck';

    // 更新 animeList 中目标项的 watched 状态
    const updated = animeList.map(item =>
      item.id === id ? { ...item, watched: willWatch } : item
    );

    // 判断是否需要飞行动画：
    // 同组内只有自己一个 → 短距离（列表瞬间为空再出现在另一个列表）
    const sourceList = willWatch
      ? this.data.unwatchedList
      : this.data.watchedList;
    const isShortMove = sourceList.length <= 1;

    // ---- Phase 1: checkbox 弹跳 + 卡片闪光 ----
    // 先更新 watched 状态但暂不重新派生列表，让卡片留在原位播放动画
    this.setData({
      animeList: updated,
      watchedCount: updated.filter(item => item.watched).length,
      animatingId: id,
      animPhase: 'phase1',
      animDirection: direction,
    });

    if (isShortMove) {
      // 短距离：Phase1 结束后直接派生列表
      setTimeout(() => {
        const unwatchedList = updated.filter(item => !item.watched);
        const watchedList = updated.filter(item => item.watched);
        this.setData({
          unwatchedList,
          watchedList,
          animatingId: '',
          animPhase: '',
          animDirection: '',
        });
        this._saveData(updated);
      }, ANIM.PHASE1);
    } else {
      // 长距离：完整三阶段
      setTimeout(() => {
        this.setData({ animPhase: 'phase2' });
      }, ANIM.PHASE1);

      setTimeout(() => {
        // Phase3：重新派生列表，卡片出现在新列表中并播放飞入动画
        const unwatchedList = updated.filter(item => !item.watched);
        const watchedList = updated.filter(item => item.watched);
        this.setData({
          unwatchedList,
          watchedList,
          animPhase: 'phase3',
        });
        this._saveData(updated);
      }, ANIM.PHASE1 + ANIM.PHASE2);

      setTimeout(() => {
        this.setData({ animatingId: '', animPhase: '', animDirection: '' });
      }, ANIM.PHASE1 + ANIM.PHASE2 + ANIM.PHASE3);
    }
  },

  // ==================== 删除（带确认弹窗） ====================

  onDeleteAnime(e) {
    const { id } = e.currentTarget.dataset;
    const target = this.data.animeList.find(item => item.id === id);
    if (!target) return;

    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${target.name}」吗？`,
      confirmText: '删除',
      confirmColor: '#e34d59',
      success: (res) => {
        if (res.confirm) {
          const animeList = this.data.animeList.filter(item => item.id !== id);
          this._updateLists(animeList);
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      },
    });
  },

  // ==================== 排序 ====================

  onToggleEditMode() {
    this.setData({ isEditMode: !this.data.isEditMode });
  },

  // 排序模式下，在同组子列表内上移
  onMoveUp(e) {
    const { id, group } = e.currentTarget.dataset;
    const subList = group === 'watched' ? [...this.data.watchedList] : [...this.data.unwatchedList];
    const subIndex = subList.findIndex(item => item.id === id);
    if (subIndex <= 0) return;

    // 子列表内交换
    [subList[subIndex - 1], subList[subIndex]] = [subList[subIndex], subList[subIndex - 1]];

    // 映射回 animeList：unwatched 在前，watched 在后
    const animeList = group === 'watched'
      ? [...this.data.unwatchedList, ...subList]
      : [...subList, ...this.data.watchedList];

    this._updateLists(animeList);
  },

  // 排序模式下，在同组子列表内下移
  onMoveDown(e) {
    const { id, group } = e.currentTarget.dataset;
    const subList = group === 'watched' ? [...this.data.watchedList] : [...this.data.unwatchedList];
    const subIndex = subList.findIndex(item => item.id === id);
    if (subIndex < 0 || subIndex >= subList.length - 1) return;

    // 子列表内交换
    [subList[subIndex], subList[subIndex + 1]] = [subList[subIndex + 1], subList[subIndex]];

    // 映射回 animeList
    const animeList = group === 'watched'
      ? [...this.data.unwatchedList, ...subList]
      : [...subList, ...this.data.watchedList];

    this._updateLists(animeList);
  },

  // ==================== 持久化 ====================

  _saveData(animeList) {
    wx.setStorageSync(STORAGE_KEY, animeList);
  },

  // ==================== 分享 ====================

  onShareAppMessage() {
    return {
      title: '我的番剧追踪清单',
      path: '/pages/anime-checklist/anime-checklist',
    };
  },
});
