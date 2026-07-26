/**
 * cloud-api.js — 共享追番板云函数调用封装
 *
 * 统一 Promise 化 wx.cloud.callFunction，并把云函数的返回信封
 * { ok, code, data } 直接透出。页面据 ok 判成败、据 data 取数据。
 *
 * 注意：本文件依赖 wx.cloud（有副作用），故不进 transform.js 纯模块，供页面 require。
 */

const { ERR } = require('./config');

/** 调用云函数，resolve 云函数返回的信封对象；网络层失败 resolve 成统一失败信封。 */
function invoke(name, data) {
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name,
      data: data || {},
      success: (res) => {
        const r = res && res.result;
        if (r && typeof r.ok === 'boolean') {
          resolve(r);
        } else {
          resolve({ ok: false, code: ERR.INTERNAL, msg: '返回格式异常' });
        }
      },
      fail: (err) => {
        resolve({ ok: false, code: ERR.INTERNAL, msg: (err && err.errMsg) || '网络错误' });
      },
    });
  });
}

// 业务云函数薄封装（名字与 cloudfunctions/ 目录一一对应）
const getMyOpenid = () => invoke('getMyOpenid');
const listMyBoards = () => invoke('listMyBoards');
const createBoard = (name, profile) => invoke('createBoard', { name, profile });
const joinBoard = (boardId, token, profile) => invoke('joinBoard', { boardId, token, profile });
const addItem = (boardId, name, extra) => invoke('addItem', Object.assign({ boardId, name }, extra || {}));
const updateProgress = (itemId, ep, status) => invoke('updateProgress', { itemId, ep, status });
const updateItem = (itemId, patch) => invoke('updateItem', { itemId, patch });
const deleteItem = (itemId, deleted) => invoke('deleteItem', { itemId, deleted });
const updateMemberProfile = (boardId, nickname, avatar) =>
  invoke('updateMemberProfile', { boardId, nickname, avatar });
const markViewed = (boardId) => invoke('markViewed', { boardId });

// 头像临时文件上传云存储，resolve fileID（失败 resolve null，调用方兜底）
// ⚠️ 已弃用（2026-07-23）：cloud:// 头像连自己都读不到（云存储公开读要付费套餐），
// 头像上传功能已砍，双方统一昵称首字色块。此函数暂留，若日后开通云存储公开读可复用。
function uploadAvatar(tempFilePath, myOpenid) {
  return new Promise((resolve) => {
    const cloudPath = `avatars/${myOpenid}_${Date.now()}.png`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
      success: (res) => resolve(res.fileID || null),
      fail: () => resolve(null),
    });
  });
}

module.exports = {
  invoke,
  getMyOpenid,
  listMyBoards,
  createBoard,
  joinBoard,
  addItem,
  updateProgress,
  updateItem,
  deleteItem,
  updateMemberProfile,
  uploadAvatar,
  markViewed,
};
