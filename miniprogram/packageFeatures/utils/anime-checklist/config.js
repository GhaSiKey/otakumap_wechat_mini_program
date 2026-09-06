/** 番剧追踪页展示配置，避免页面散落魔法文案。 */
const STATUS = { WANT: 'want', WATCHING: 'watching', DONE: 'done' };
const STATUS_LABELS = { want: '想看', watching: '追踪中', done: '已看完' };
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: STATUS.WATCHING, label: STATUS_LABELS.watching },
  { key: STATUS.WANT, label: STATUS_LABELS.want },
  { key: STATUS.DONE, label: STATUS_LABELS.done },
];
const COPY = {
  ADD_TITLE: '添加番剧',
  SEARCH_TITLE: '搜索真实番剧',
  SEARCH_PLACEHOLDER: '输入番名，如 葬送的芙莉莲',
  MANUAL_PLACEHOLDER: '也可以手动输入番名',
  SEARCH_HINT: '选中后会自动带入封面、集数和放送信息',
  EMPTY: '还没有追踪记录',
  EMPTY_HINT: '搜索一部番剧，开始记录你的观看进度',
  UNKNOWN_EP: '集数待定',
  SEARCH_INITIAL: '输入番名，找找看',
  SEARCHING: '搜索中…',
  SEARCH_EMPTY: '没找到这部番，换个名字试试',
  SEARCH_ERROR: '番剧数据暂时不可用，请稍后重试',
  YEAR_UNKNOWN: '年份未知',
  SEARCH_ACTION: '添加',
  SEARCH_SUBMIT: '搜索',
  ADDED: '已添加',
  FILTER_EMPTY: '这个分类还没有番剧',
  ADVANCE: '看到下一集',
  DONE_ACTION: '已追平',
};
module.exports = { STATUS, STATUS_LABELS, FILTERS, COPY };
