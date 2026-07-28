/**
 * cloud-api.js — 番剧元数据云函数调用封装
 *
 * 统一 Promise 化 wx.cloud.callFunction，透出云函数信封 { ok, code, data }。
 * 与 shared-board 的 cloud-api 同款写法，但独立文件（功能边界不同，不交叉依赖）。
 */

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
          resolve({ ok: false, code: 'ERR_INTERNAL', msg: '返回格式异常' });
        }
      },
      fail: (err) => {
        resolve({ ok: false, code: 'ERR_UPSTREAM_UNAVAILABLE', msg: (err && err.errMsg) || '网络错误' });
      },
    });
  });
}

// action 分支封装：搜索番名 / 按 animeId 拉详情
const searchAnime = (keyword) => invoke('animeMeta', { action: 'search', keyword });
const getAnimeDetail = (animeId) => invoke('animeMeta', { action: 'detail', animeId });

module.exports = { invoke, searchAnime, getAnimeDetail };
