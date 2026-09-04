const https = require('https');
const { ACTION, ANITABI, LIMIT, ERR } = require('./constants');
const { PilgrimageError, isPilgrimageError } = require('./errors');
const { parsePositiveInteger } = require('./transform');

function buildUpstreamUrl(action, bgmSubjectId) {
  const id = parsePositiveInteger(bgmSubjectId);
  if (id === null) throw new PilgrimageError(ERR.INVALID_PARAM, 'bgmSubjectId 必须是正整数');

  if (action === ACTION.GET_SUBJECT_SUMMARY) {
    return new URL(`/bangumi/${id}/lite`, ANITABI.ORIGIN);
  }
  if (action === ACTION.GET_SUBJECT_POINTS) {
    // 不加 haveImage=true：地点搜索需要保留公开接口返回的无图地点，
    // 前端已有无图占位，不能因为缺少参考图而把有效坐标从地图中删掉。
    return new URL(`/bangumi/${id}/points/detail`, ANITABI.ORIGIN);
  }
  throw new PilgrimageError(ERR.INVALID_PARAM, `未知 action: ${String(action || '')}`);
}

// 纵深保护：即使以后调用方误把完整 URL 传进来，也只能访问公开的两类 Anitabi 路径。
function assertAllowedUpstreamUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch (e) {
    throw new PilgrimageError(ERR.INVALID_PARAM, '非法上游 URL');
  }

  const commonAllowed = url.protocol === 'https:'
    && url.hostname === ANITABI.HOSTNAME
    && url.port === ''
    && !url.username
    && !url.password
    && !url.hash;
  if (!commonAllowed) throw new PilgrimageError(ERR.INVALID_PARAM, '上游 URL 不在白名单');

  const isSummary = /^\/bangumi\/[1-9]\d*\/lite$/.test(url.pathname) && url.search === '';
  const isPoints = /^\/bangumi\/[1-9]\d*\/points\/detail$/.test(url.pathname)
    && url.search === '';
  if (!isSummary && !isPoints) throw new PilgrimageError(ERR.INVALID_PARAM, '上游路径不在白名单');
  return url;
}

function classifyResponse(status, body) {
  if (status === 403) {
    throw new PilgrimageError(ERR.UPSTREAM_FORBIDDEN, 'Anitabi 返回 HTTP 403');
  }
  if (status < 200 || status >= 300) {
    throw new PilgrimageError(ERR.UPSTREAM_HTTP, `Anitabi 返回 HTTP ${status}`, { status });
  }
  if (!body || !body.trim()) {
    // 2xx 空 body 不是“作品不存在”的可靠证据，而是异常响应；允许 service
    // 使用 stale 缓存，并让无缓存客户端展示可重试错误态。
    throw new PilgrimageError(ERR.UPSTREAM_NON_JSON, 'Anitabi 返回空响应');
  }
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new PilgrimageError(ERR.UPSTREAM_NON_JSON, 'Anitabi 返回非 JSON 数据');
  }
}

function createRequestJson(options) {
  const opts = options || {};
  const httpsModule = opts.httpsModule || https;
  const timeoutMs = opts.timeoutMs || ANITABI.TIMEOUT_MS;
  const maxBodyBytes = opts.maxBodyBytes || LIMIT.UPSTREAM_BODY_MAX_BYTES;

  return function requestJson(action, bgmSubjectId) {
    const url = assertAllowedUpstreamUrl(buildUpstreamUrl(action, bgmSubjectId));
    return new Promise((resolve, reject) => {
      let settled = false;
      let absoluteTimer = null;
      let req = null;
      const clearAbsoluteTimer = () => {
        if (absoluteTimer !== null) clearTimeout(absoluteTimer);
        absoluteTimer = null;
      };
      const succeed = (value) => {
        if (settled) return;
        settled = true;
        clearAbsoluteTimer();
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearAbsoluteTimer();
        if (isPilgrimageError(error)) reject(error);
        else reject(new PilgrimageError(
          ERR.UPSTREAM_NETWORK,
          `Anitabi 网络请求失败: ${String((error && error.message) || error)}`
        ));
      };

      try {
        req = httpsModule.get(
          url,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              'User-Agent': ANITABI.USER_AGENT,
            },
          },
          (res) => {
            // 先按状态码分类，避免读取/解析 Cloudflare HTML，也确保 403 不会被大小限制掩盖。
            const status = Number(res.statusCode) || 0;
            if (status === 403) {
              if (typeof res.resume === 'function') res.resume();
              fail(new PilgrimageError(ERR.UPSTREAM_FORBIDDEN, 'Anitabi 返回 HTTP 403'));
              return;
            }
            if (status < 200 || status >= 300) {
              if (typeof res.resume === 'function') res.resume();
              fail(new PilgrimageError(
                ERR.UPSTREAM_HTTP,
                `Anitabi 返回 HTTP ${status}`,
                { status }
              ));
              return;
            }

            const declaredLength = Number(res.headers && res.headers['content-length']);
            if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
              if (typeof res.resume === 'function') res.resume();
              fail(new PilgrimageError(
                ERR.UPSTREAM_RESPONSE_TOO_LARGE,
                'Anitabi 响应超过大小限制'
              ));
              return;
            }

            const chunks = [];
            let bytes = 0;
            res.on('data', (chunk) => {
              if (settled) return;
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytes += buffer.length;
              if (bytes > maxBodyBytes) {
                const error = new PilgrimageError(
                  ERR.UPSTREAM_RESPONSE_TOO_LARGE,
                  'Anitabi 响应超过大小限制'
                );
                fail(error);
                if (typeof res.destroy === 'function') res.destroy(error);
                return;
              }
              chunks.push(buffer);
            });
            res.on('error', fail);
            res.on('aborted', () => fail(new PilgrimageError(
              ERR.UPSTREAM_NETWORK,
              'Anitabi 响应中断'
            )));
            res.on('end', () => {
              if (settled) return;
              try {
                const body = Buffer.concat(chunks).toString('utf8');
                succeed(classifyResponse(status, body));
              } catch (error) {
                fail(error);
              }
            });
          }
        );
      } catch (error) {
        fail(error);
        return;
      }

      req.on('error', fail);
      const abortForTimeout = () => {
        const timeoutError = new PilgrimageError(
          ERR.UPSTREAM_TIMEOUT,
          `Anitabi 请求超时(${timeoutMs}ms)`
        );
        fail(timeoutError);
        if (req && typeof req.destroy === 'function') req.destroy(timeoutError);
      };
      // socket timeout 只覆盖空闲连接；独立计时器覆盖 DNS、TLS 与持续慢速回包。
      absoluteTimer = setTimeout(abortForTimeout, timeoutMs);
      if (typeof req.setTimeout === 'function') req.setTimeout(timeoutMs, abortForTimeout);
    });
  };
}

const requestJson = createRequestJson();

module.exports = {
  buildUpstreamUrl,
  assertAllowedUpstreamUrl,
  classifyResponse,
  createRequestJson,
  requestJson,
};
