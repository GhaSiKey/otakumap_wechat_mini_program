// 云函数：pilgrimageData
//
// 入参：
//   { action: 'getSubjectSummary', bgmSubjectId: 正整数 }
//   { action: 'getSubjectPoints', bgmSubjectId: 正整数 }
//
// 只代理 Anitabi 公开的按 ID 查询接口；不访问 Bangumi API、不做标题搜索，
// 也不接收客户端 URL。返回统一信封 { ok, code, data }。

const cloud = require('wx-server-sdk');
const { createCacheStore } = require('./cache');
const { requestJson } = require('./upstream');
const { createPilgrimageService } = require('./service');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const cache = createCacheStore(db);
const service = createPilgrimageService({ cache, requestJson });

exports.main = async (event) => {
  console.log('[pilgrimageData] 收到调用', {
    action: event && event.action,
    bgmSubjectId: event && event.bgmSubjectId,
  });
  const result = await service.handle(event || {});
  console.log('[pilgrimageData] 返回', { ok: result.ok, code: result.code });
  return result;
};
