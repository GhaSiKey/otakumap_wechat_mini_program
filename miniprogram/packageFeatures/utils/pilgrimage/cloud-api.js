/**
 * cloud-api.js — 圣地巡礼云函数调用封装
 *
 * 前端只传 Bangumi subject id；映射来源与 Anitabi 请求细节全部留在云函数。
 * 所有结果统一收敛为 { ok, code, data }，网络层失败也不会 reject 到页面。
 */

const C = require('./config');

function normalizeBgmSubjectId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function normalizeCallFailure(err) {
  const msg = (err && err.errMsg) || C.COPY.NETWORK_ERROR;
  const rawCode = Number(err && err.errCode);
  const timeout = rawCode === -504003
    || /FUNCTIONS_TIME_LIMIT_EXCEEDED|-504003|timed out after\s+\d+\s+seconds?/i.test(msg);
  if (timeout) {
    const match = msg.match(/timed out after\s+(\d+)\s+seconds?/i);
    return {
      ok: false,
      code: C.ERR_CODE.FUNCTION_TIMEOUT,
      msg,
      timeoutSeconds: match ? Number(match[1]) : null,
    };
  }
  return { ok: false, code: C.ERR_CODE.UPSTREAM_UNAVAILABLE, msg };
}

/**
 * 调用 pilgrimageData。第三个参数仅供 Node 测试注入 wx 兼容对象，页面无需传。
 */
function invoke(action, bgmSubjectId, wxApi) {
  const id = normalizeBgmSubjectId(bgmSubjectId);
  if (!id || !Object.values(C.ACTION).includes(action)) {
    return Promise.resolve({
      ok: false,
      code: C.ERR_CODE.INVALID_PARAM,
      msg: C.ERR_MESSAGES[C.ERR_CODE.INVALID_PARAM],
    });
  }

  const runtime = wxApi || (typeof wx !== 'undefined' ? wx : null);
  if (!runtime || !runtime.cloud || typeof runtime.cloud.callFunction !== 'function') {
    return Promise.resolve({
      ok: false,
      code: C.ERR_CODE.INTERNAL,
      msg: C.COPY.MALFORMED_RESPONSE,
    });
  }

  return new Promise((resolve) => {
    runtime.cloud.callFunction({
      name: C.CLOUD_FUNCTION,
      data: { action, bgmSubjectId: id },
      success: (res) => {
        const result = res && res.result;
        if (result && typeof result.ok === 'boolean') {
          resolve(result);
          return;
        }
        resolve({ ok: false, code: C.ERR_CODE.INTERNAL, msg: C.COPY.MALFORMED_RESPONSE });
      },
      fail: (err) => resolve(normalizeCallFailure(err)),
    });
  });
}

const getSubjectSummary = (bgmSubjectId, wxApi) => (
  invoke(C.ACTION.GET_SUBJECT_SUMMARY, bgmSubjectId, wxApi)
);

const getSubjectPoints = (bgmSubjectId, wxApi) => (
  invoke(C.ACTION.GET_SUBJECT_POINTS, bgmSubjectId, wxApi)
);

module.exports = {
  normalizeBgmSubjectId,
  normalizeCallFailure,
  invoke,
  getSubjectSummary,
  getSubjectPoints,
};
