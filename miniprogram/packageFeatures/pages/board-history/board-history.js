// 板改动历史页 —— 倒序时间线，同番同人连续 +1 折叠成一条
//
// 数据源：listBoardEvents（云函数倒序分页）→ transform.foldEvents 折叠
//   → describeEvent 解读成「谁 + 做了什么」→ 页面 fillTemplate 套 HISTORY_COPY 模板。
// 历史从埋点上线起记，存量进度无回溯事件（空态有说明）。
const api = require('../../utils/shared-board/cloud-api');
const T = require('../../utils/shared-board/transform');
const { HISTORY_COPY, STATUS_LABELS, ERR } = require('../../utils/shared-board/config');

// 占位符插值：{key} → vars[key]。回调式 replace，避免番名含 $&/$1 被当特殊模式（与 P2 同一防注入约定）
function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

Page({
  data: {
    historyCopy: HISTORY_COPY,
    boardId: '',
    myOpenid: '',
    // 对方昵称（主语用）：进页时从 board 详情取，缺省兜底 TA
    peerName: HISTORY_COPY.PEER_DEFAULT,
    rows: [],        // 渲染行：{ id, mine, subject, text, time, color }
    loading: true,
    loadingMore: false,
    hasMore: false,
    _before: null,   // 分页游标（上一页最后一条 createTime 毫秒）
    empty: false,
  },

  onLoad(query) {
    const boardId = (query && query.boardId) || '';
    if (!boardId) {
      this.setData({ loading: false, empty: true });
      wx.showToast({ title: '缺少板信息', icon: 'none' });
      return;
    }
    // 对方昵称优先取 URL 传参（P2 页已有，省一次板详情拉取）；缺省再走 _loadPeerName 兜底
    const patch = { boardId };
    if (query && query.peerName) patch.peerName = decodeURIComponent(query.peerName);
    this.setData(patch);
    this._ensureOpenidThenLoad();
  },

  async _ensureOpenidThenLoad() {
    const r = await api.getMyOpenid();
    const myOpenid = r.ok && r.data ? r.data.openid : '';
    if (!myOpenid) {
      this.setData({ loading: false });
      wx.showToast({ title: '身份获取失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ myOpenid });
    // 对方昵称：URL 没带过来（如直接进页）才拉板详情兜底。读不到不阻塞，走 TA 兜底。
    if (this.data.peerName === HISTORY_COPY.PEER_DEFAULT) this._loadPeerName();
    this._loadFirstPage();
  },

  // 取对方昵称：复用 getBoardDetail（成员校验在云端），失败静默走兜底
  async _loadPeerName() {
    const r = await api.invoke('getBoardDetail', { boardId: this.data.boardId });
    if (!r.ok || !r.data || !r.data.board) return;
    const peerOpenid = T.resolvePeer(r.data.board.members, this.data.myOpenid);
    if (!peerOpenid) return;
    const peer = (r.data.board.members || []).find((m) => m && m.openid === peerOpenid);
    if (peer && peer.nickname) this.setData({ peerName: peer.nickname });
  },

  async _loadFirstPage() {
    this.setData({ loading: true });
    const rows = await this._fetchAndBuild(null);
    this.setData({ loading: false, empty: rows.length === 0 });
  },

  onPullDownRefresh() {
    if (!this.data.boardId || !this.data.myOpenid) {
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ rows: [], _before: null, hasMore: false });
    this._loadFirstPage().then(() => wx.stopPullDownRefresh());
  },

  // 触底加载下一页
  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this._loadMore();
  },

  async _loadMore() {
    this.setData({ loadingMore: true });
    await this._fetchAndBuild(this.data._before);
    this.setData({ loadingMore: false });
  },

  // 拉一页 → 折叠 → 建行 → 追加。返回本页新增行（首页用于判空）
  async _fetchAndBuild(before) {
    const r = await api.listBoardEvents(this.data.boardId, before ? { before } : {});
    if (!r.ok) {
      // 把真实错误码/msg 打到控制台，便于定位（函数未部署→INTERNAL；无权→NOT_MEMBER）
      console.error('[board-history] listBoardEvents 失败', r);
      wx.showToast({ title: r.code === ERR.NOT_MEMBER ? '无权查看' : '加载失败', icon: 'none' });
      return [];
    }
    const events = (r.data && r.data.events) || [];
    const folded = T.foldEvents(events);
    const now = Date.now();
    const newRows = folded.map((e) => this._toRow(e, now));

    // 游标：本页原始事件（非折叠后）最后一条的 createTime，供下一页续拉
    let nextBefore = this.data._before;
    if (events.length) {
      const last = events[events.length - 1];
      const ms = new Date(last.createTime).getTime();
      if (!Number.isNaN(ms)) nextBefore = ms;
    }
    this.setData({
      rows: this.data.rows.concat(newRows),
      hasMore: !!(r.data && r.data.hasMore),
      _before: nextBefore,
    });
    return newRows;
  },

  // 单条事件 → 渲染行。主语=我/对方昵称；动作套 HISTORY_COPY.ACTION 模板；身份色区分我/TA
  _toRow(e, now) {
    const d = T.describeEvent(e, this.data.myOpenid);
    const subject = d.mine ? HISTORY_COPY.ME : this.data.peerName;
    const tpl = HISTORY_COPY.ACTION[d.actionKey] || '';
    // status 变量转中文标签（progress_status 用），其余变量原样
    const vars = Object.assign({}, d.vars);
    if (vars.status) vars.status = STATUS_LABELS[vars.status] || vars.status;
    return {
      id: e._id || `${e.itemId}_${e.createTime}`,
      mine: d.mine,
      subject,
      text: fillTemplate(tpl, vars),
      time: T.relativeTime(e.createTime, now),
    };
  },
});
