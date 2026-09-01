/**
 * cloud-api.js — 番剧元数据云函数调用封装
 *
 * 统一 Promise 化 wx.cloud.callFunction，透出云函数信封 { ok, code, data }。
 * 与 shared-board 的 cloud-api 同款写法，但独立文件（功能边界不同，不交叉依赖）。
 */

// 云函数执行超时不是“弹弹play 上游不可用”：它表示 CloudBase 的函数运行上限配置太短。
// 单独归类后，调用页日志可以直接给出配置动作，不再误导成普通网络错误。
function normalizeCallFailure(err) {
  const msg = (err && err.errMsg) || '网络错误';
  const rawCode = Number(err && err.errCode);
  const timeout = rawCode === -504003
    || /FUNCTIONS_TIME_LIMIT_EXCEEDED|-504003|timed out after\s+\d+\s+seconds?/i.test(msg);
  if (timeout) {
    const match = msg.match(/timed out after\s+(\d+)\s+seconds?/i);
    return {
      ok: false,
      code: 'ERR_FUNCTION_TIMEOUT',
      msg,
      timeoutSeconds: match ? Number(match[1]) : null,
    };
  }
  return { ok: false, code: 'ERR_UPSTREAM_UNAVAILABLE', msg };
}

/** 调用云函数，resolve 云函数返回的信封对象；网络层失败也归一成失败信封。 */
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
        resolve(normalizeCallFailure(err));
      },
    });
  });
}

// action 分支封装：搜索番名 / 按 animeId 拉详情 / 静默升级板内存量 small 封面
const searchAnime = (keyword) => invoke('animeMeta', { action: 'search', keyword });
const getAnimeDetail = (animeId) => invoke('animeMeta', { action: 'detail', animeId });
const upgradeBoardCovers = (boardId) => invoke('animeMeta', { action: 'upgradeBoardCovers', boardId });

module.exports = { normalizeCallFailure, invoke, searchAnime, getAnimeDetail, upgradeBoardCovers };
