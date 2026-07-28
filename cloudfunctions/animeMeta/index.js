// 云函数：animeMeta
//
// 职责：代理弹弹play 开放平台，为小程序提供番剧元数据查询（搜索 + 详情）。
// 为什么走云函数而非前端直连：① 密钥 AppSecret 只能待在服务端，绝不下发前端；
// ② 云函数在境内腾讯云，直连弹弹play（国内服务）稳定；③ 便于统一缓存与裁剪字段。
//
// 类比 Android：相当于一个 BFF（Backend For Frontend）接口，聚合+裁剪上游数据。
//
// 入参：{ action: 'search', keyword } | { action: 'detail', animeId }
// 返回：统一信封 { ok, code, data }，与 shared-board 云函数一致。

const crypto = require('crypto');
const cloud = require('wx-server-sdk');
const { DDP, CACHE, LIMIT, ERR } = require('./constants');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV }); // 自动用当前云环境，不硬编码
const db = cloud.database();

const ok = (data) => ({ ok: true, code: ERR.OK, data });
const fail = (code, msg) => ({ ok: false, code, msg: msg || code });

// 读密钥：只从环境变量取，代码里绝不出现密钥明文。缺失即配置错误，明确报出。
function readCredentials() {
  const appId = process.env.DDP_APP_ID;
  const appSecret = process.env.DDP_APP_SECRET;
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

// 计算弹弹play 签名：base64(sha256(AppId + Timestamp + Path + AppSecret))。
// Path 是接口路径（以 / 开头，不含域名和查询参数），官方要求。
function sign(appId, appSecret, timestamp, signPath) {
  return crypto
    .createHash('sha256')
    .update(appId + timestamp + signPath + appSecret)
    .digest('base64');
}

// 用 Node 内置 https 发 GET，Promise 化，带超时。
// 为什么不用全局 fetch：微信云函数运行时低于 Node 18 时无全局 fetch（实测抛
// ReferenceError）。https 是所有 Node 版本都有的内置模块，最稳、零新依赖。
// resolve { status, body }，网络层错误/超时 reject（上层归一为 UPSTREAM_UNAVAILABLE）。
function httpsGet(fullUrl, headers, timeoutMs) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.get(fullUrl, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`上游超时(${timeoutMs}ms)`));
    });
  });
}

// 带签名请求弹弹play。signPath 用于签名（无查询参数），fullPath 是实际请求路径（可带 query）。
// 统一把「上游不可用」（403/空体/超时/网络错）归一成 UPSTREAM_UNAVAILABLE 抛出，由 main catch。
async function callDandanplay(cred, signPath, fullPath) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(cred.appId, cred.appSecret, timestamp, signPath);
  const url = DDP.BASE_URL + fullPath;

  // 诊断日志：目标 URL / appId 尾号（不打完整密钥）。
  console.log('[animeMeta] 请求上游', {
    url,
    signPath,
    appIdTail: cred.appId ? cred.appId.slice(-4) : '(空)',
    timestamp,
  });

  // 用内置 https（不依赖运行时是否有全局 fetch）。网络层错误/超时归一为上游不可用。
  let resp;
  try {
    resp = await httpsGet(
      url,
      {
        [DDP.HEADER_APPID]: cred.appId,
        [DDP.HEADER_TIMESTAMP]: String(timestamp),
        [DDP.HEADER_SIGNATURE]: signature,
        Accept: 'application/json',
      },
      DDP.TIMEOUT_MS
    );
  } catch (e) {
    console.error('[animeMeta] https 异常', { name: e && e.name, message: e && e.message });
    throw { _upstream: true, msg: `请求失败: ${(e && e.message) || e}` };
  }

  const text = resp.body;
  const okStatus = resp.status >= 200 && resp.status < 300;
  console.log('[animeMeta] 上游响应', { status: resp.status, bodyLen: text ? text.length : 0, bodyHead: (text || '').slice(0, 200) });

  // 实测：被限流时返回 HTTP 403 + 空 body。空体无法 JSON.parse，须先兜底。
  if (!okStatus || !text) {
    throw { _upstream: true, msg: `上游 HTTP ${resp.status}${text ? '' : '（空响应，疑似被限流）'}` };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw { _upstream: true, msg: `上游返回非 JSON: ${(text || '').slice(0, 80)}` };
  }
  // 弹弹play 业务层错误：success:false
  if (!json || json.success !== true) {
    const m = (json && json.errorMessage) || '上游返回 success:false';
    console.error('[animeMeta] 上游业务失败', { errorCode: json && json.errorCode, errorMessage: json && json.errorMessage });
    const err = new Error(m);
    err._bizFail = true;
    throw err;
  }
  return json;
}

// 从 ISO 日期串取年份（"2023-09-29T00:00:00" → "2023"）。非法返回空串。
function yearOf(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const y = dateStr.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : '';
}

// 裁剪搜索结果单条：只保留前端展示/落库需要的字段，不泄漏上游完整结构。
function pickSearchItem(a) {
  return {
    sourceId: a.animeId, // 弹弹play animeId，作 sourceId（可空、不当主键）
    name: a.animeTitle || '',
    cover: a.imageUrl || '', // https 外链，前端 <image> 直接加载
    type: a.type || '',
    typeDesc: a.typeDescription || '',
    year: yearOf(a.startDate),
    startDate: a.startDate || '', // 首播日期 ISO 串（详情接口无此字段，格式化在前端 config）
    totalEp: typeof a.episodeCount === 'number' ? a.episodeCount : 0, // 正片集数（非 episodes.length）
    rating: typeof a.rating === 'number' ? a.rating : 0,
  };
}

// 裁剪相关/相似作品单项：结构与搜索结果一致（animeId/animeTitle/imageUrl/rating），
// 复用为可点击的推荐卡数据。详情接口的这些项无年份/集数，只带封面+评分。
function pickRefItem(r) {
  return {
    sourceId: r.animeId,
    name: r.animeTitle || '',
    cover: r.imageUrl || '',
    rating: typeof r.rating === 'number' ? r.rating : 0,
  };
}

// 裁剪详情：在搜索字段基础上补放送状态、更新日、简介、制作信息、标签、相关/相似作品、分集标题。
// isOnAir → airStatus 的语义映射放前端 config（这里只透出原始 isOnAir，保持来源无关）。
// 注意：详情接口无 startDate/episodeCount，年份与正片集数以搜索结果为准（前端由列表带入）。
function pickDetail(b) {
  return {
    sourceId: b.animeId,
    name: b.animeTitle || '',
    cover: b.imageUrl || '',
    type: b.type || '',
    typeDesc: b.typeDescription || '',
    totalEp: 0, // 详情接口无 episodeCount 字段，总集数以搜索结果为准；此处占位
    rating: typeof b.rating === 'number' ? b.rating : 0,
    isOnAir: !!b.isOnAir, // 是否在播
    airDay: typeof b.airDay === 'number' ? b.airDay : null, // 周几更新（0-6，语义映射在前端）
    intro: b.intro || '', // 制作信息一行（原作/导演/动画制作 …）
    summary: b.summary || '',
    tags: Array.isArray(b.tags)
      ? b.tags.map((t) => t && t.name).filter(Boolean).slice(0, LIMIT.TAG_MAX)
      : [],
    relateds: Array.isArray(b.relateds)
      ? b.relateds.map(pickRefItem).slice(0, LIMIT.RELATED_MAX)
      : [],
    similars: Array.isArray(b.similars)
      ? b.similars.map(pickRefItem).slice(0, LIMIT.SIMILAR_MAX)
      : [],
    episodeTitles: Array.isArray(b.episodes)
      ? b.episodes.map((e) => e && e.episodeTitle).filter(Boolean)
      : [],
  };
}

// 读缓存：命中且未过期返回 data，否则 null。缓存失败不影响主流程（降级为直接打上游）。
async function readCache(kind, key) {
  try {
    const _id = `${kind}:${key}`;
    const doc = await db.collection(CACHE.COLLECTION).doc(_id).get();
    const rec = doc && doc.data;
    if (rec && typeof rec.expireAt === 'number' && rec.expireAt > Date.now()) {
      return rec.payload;
    }
  } catch (e) {
    // 文档不存在会抛，属正常未命中，静默
  }
  return null;
}

// 写缓存：set 覆盖式写（doc(_id).set 无则建、有则覆盖）。失败静默，不阻断返回。
async function writeCache(kind, key, payload) {
  try {
    const _id = `${kind}:${key}`;
    await db
      .collection(CACHE.COLLECTION)
      .doc(_id)
      .set({ data: { kind, key, payload, expireAt: Date.now() + CACHE.TTL_MS } });
  } catch (e) {
    // 缓存写失败无妨，下次重新打上游
  }
}

// action: search —— 按番名搜索，返回裁剪后的候选列表
async function handleSearch(cred, keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return fail(ERR.INVALID_PARAM, '关键词为空');
  if (kw.length > LIMIT.KEYWORD_MAX) return fail(ERR.INVALID_PARAM, '关键词过长');

  const cached = await readCache(CACHE.KIND_SEARCH, kw);
  if (cached) return ok({ animes: cached, cached: true });

  const fullPath = `${DDP.PATH_SEARCH}?keyword=${encodeURIComponent(kw)}`;
  const json = await callDandanplay(cred, DDP.PATH_SEARCH, fullPath);
  const animes = (json.animes || []).slice(0, LIMIT.RESULT_MAX).map(pickSearchItem);

  await writeCache(CACHE.KIND_SEARCH, kw, animes);
  return ok({ animes, cached: false });
}

// action: detail —— 按 animeId 拉详情，补放送状态/更新日/简介
async function handleDetail(cred, animeId) {
  const id = parseInt(animeId, 10);
  if (!id || id <= 0) return fail(ERR.INVALID_PARAM, 'animeId 非法');

  const cached = await readCache(CACHE.KIND_DETAIL, String(id));
  if (cached) return ok({ bangumi: cached, cached: true });

  const signPath = `${DDP.PATH_DETAIL}/${id}`; // 详情路径含 animeId，签名 path 也是它
  const json = await callDandanplay(cred, signPath, signPath);
  const bangumi = pickDetail(json.bangumi || {});

  await writeCache(CACHE.KIND_DETAIL, String(id), bangumi);
  return ok({ bangumi, cached: false });
}

exports.main = async (event) => {
  console.log('[animeMeta] 收到调用', { action: event && event.action, keyword: event && event.keyword, animeId: event && event.animeId });
  try {
    const cred = readCredentials();
    if (!cred) {
      // 环境变量是否读到（只打是否存在，不打值），这是最常见的失败原因
      console.error('[animeMeta] 环境变量缺失', { hasAppId: !!process.env.DDP_APP_ID, hasAppSecret: !!process.env.DDP_APP_SECRET });
      return fail(ERR.MISCONFIGURED, '云函数未配置 DDP_APP_ID / DDP_APP_SECRET 环境变量');
    }

    const action = event && event.action;
    let res;
    if (action === 'search') res = await handleSearch(cred, event.keyword);
    else if (action === 'detail') res = await handleDetail(cred, event.animeId);
    else res = fail(ERR.INVALID_PARAM, `未知 action: ${action}`);

    console.log('[animeMeta] 返回', { ok: res.ok, code: res.code, msg: res.msg, count: res.data && res.data.animes ? res.data.animes.length : undefined, cached: res.data && res.data.cached });
    return res;
  } catch (e) {
    // 上游不可用（限流/超时/网络/无 fetch）——前端提示「稍后重试」，控制台有 msg 真因
    if (e && e._upstream) {
      console.error('[animeMeta] 上游不可用', e.msg);
      return fail(ERR.UPSTREAM_UNAVAILABLE, e.msg);
    }
    // 上游业务失败（success:false）
    if (e && e._bizFail) return fail(ERR.UPSTREAM_ERROR, String(e.message || e));
    // 兜底：打完整堆栈
    console.error('[animeMeta] 未预期异常', e && e.stack ? e.stack : e);
    return fail(ERR.INTERNAL, String((e && e.message) || e));
  }
};
