/**
 * togetherWatch 所需的共享追番板服务端常量子集。
 * 云函数独立打包，故不能直接 require 小程序目录。
 */

const COLLECTION = {
  BOARD: 'shared_boards',
  ITEM: 'shared_board_items',
  EVENT: 'shared_board_events',
};

const EVENT_TYPE = {
  TOGETHER_ADVANCE: 'together_advance',
};

const BOARD_MEMBER_LIMIT = 2;
const BOARD_STATUS = { ACTIVE: 'active', FULL: 'full', ARCHIVED: 'archived' };
const PROGRESS_STATUS_DEFAULT = 'want';

const EP_MIN = 0;
const EP_MAX_WHEN_UNKNOWN = 9999;

const ERR = {
  OK: 'OK',
  UNAUTHENTICATED: 'ERR_UNAUTHENTICATED',
  INTERNAL: 'ERR_INTERNAL',
  INVALID_PARAM: 'ERR_INVALID_PARAM',
  BOARD_NOT_FOUND: 'ERR_BOARD_NOT_FOUND',
  NOT_MEMBER: 'ERR_NOT_MEMBER',
  BOARD_FULL: 'ERR_BOARD_FULL',
  ITEM_NOT_FOUND: 'ERR_ITEM_NOT_FOUND',
  INVALID_EP: 'ERR_INVALID_EP',
};

module.exports = {
  COLLECTION,
  EVENT_TYPE,
  BOARD_MEMBER_LIMIT,
  BOARD_STATUS,
  PROGRESS_STATUS_DEFAULT,
  EP_MIN,
  EP_MAX_WHEN_UNKNOWN,
  ERR,
};
