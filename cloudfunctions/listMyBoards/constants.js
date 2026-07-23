/**
 * constants.js — 共享追番板云函数侧常量（服务端子集）
 *
 * 权威源是 miniprogram/packageFeatures/utils/shared-board/config.js。
 * 云函数各目录独立打包、无法 require 小程序目录，故此处拷贝「服务端需要的子集」。
 * tests/shared-board.test.js 有深比较守卫，两处不一致即测试失败（防漂移）。
 * 详见 docs/shared-board-data.md §5.2。
 *
 * 部署前把本文件拷到各云函数目录：
 *   cp cloudfunctions/_shared-board/constants.js cloudfunctions/<fn>/constants.js
 */

const COLLECTION = {
  BOARD: 'shared_boards',
  ITEM: 'shared_board_items',
  NUDGE: 'shared_board_nudges',
};

const BOARD_MEMBER_LIMIT = 2;

const BOARD_STATUS = { ACTIVE: 'active', FULL: 'full', ARCHIVED: 'archived' };
const MEMBER_ROLE = { OWNER: 'owner', GUEST: 'guest' };
const AIR_STATUS = { AIRING: 'airing', FINISHED: 'finished', UNKNOWN: 'unknown' };

const PROGRESS_STATUS = ['want', 'watching', 'caught_up', 'paused', 'done', 'dropped'];
const PROGRESS_STATUS_DEFAULT = 'want';

const EP_MIN = 0;
const EP_MAX_WHEN_UNKNOWN = 9999;

const PAIR_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_BOARD_NAME = '我俩的番单';
const BOARD_NAME_MAX = 20;
const ITEM_NAME_MAX = 60;

const ITEM_SHARED_FIELDS = ['name', 'totalEp', 'airStatus', 'cover'];

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

module.exports = {
  COLLECTION,
  BOARD_MEMBER_LIMIT,
  BOARD_STATUS,
  MEMBER_ROLE,
  AIR_STATUS,
  PROGRESS_STATUS,
  PROGRESS_STATUS_DEFAULT,
  EP_MIN,
  EP_MAX_WHEN_UNKNOWN,
  PAIR_TOKEN_TTL_MS,
  DEFAULT_BOARD_NAME,
  BOARD_NAME_MAX,
  ITEM_NAME_MAX,
  ITEM_SHARED_FIELDS,
  ERR,
};
