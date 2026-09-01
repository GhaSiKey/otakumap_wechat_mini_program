/**
 * 番剧元数据前端策略测试
 *
 * 覆盖搜索 small → 详情 medium 的封面选择规则。这里不拼 CDN URL，
 * 只验证客户端始终采用接口原样返回的详情封面并保留降级路径。
 */
const C = require('../miniprogram/packageFeatures/utils/anime-meta/config');
const ClientApi = require('../miniprogram/packageFeatures/utils/anime-meta/cloud-api');
const ServerCover = require('../cloudfunctions/animeMeta/cover-policy');

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++;
  } else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${JSON.stringify(actual)}\n     期望: ${JSON.stringify(expected)}`);
  }
}

const small = 'https://assets.anixplayer.net/image/poster/small/14360-small-hash.jpg';
const medium = 'https://assets.anixplayer.net/image/poster/medium/14360-different-medium-hash.jpg';

eq('详情 medium 优先于搜索 small', C.preferDetailCover(small, medium), medium);
eq('详情缺图时回退搜索 small', C.preferDetailCover(small, ''), small);
eq('只有详情图时直接采用详情图', C.preferDetailCover('', medium), medium);
eq('封面 URL 会去掉首尾空白', C.preferDetailCover(`  ${small}  `, `  ${medium}  `), medium);
eq('非法封面值安全归一为空', C.preferDetailCover(null, { url: medium }), '');
eq('识别弹弹play搜索 small 图', C.isSearchThumbnailCover(small), true);
eq('medium 不会被误判成搜索缩略图', C.isSearchThumbnailCover(medium), false);
eq('预览原样使用当前最优 URL', C.previewCoverUrl(` ${medium} `), medium);

const timeoutFailure = ClientApi.normalizeCallFailure({
  errCode: -504003,
  errMsg: 'cloud.callFunction:fail Invoking task timed out after 3 seconds FUNCTIONS_TIME_LIMIT_EXCEEDED',
});
eq('CloudBase 3 秒超时不再误报成普通上游错误', timeoutFailure.code, 'ERR_FUNCTION_TIMEOUT');
eq('云函数超时会提取当前秒数供日志提示', timeoutFailure.timeoutSeconds, 3);
eq(
  '普通网络错误仍保持原错误分类',
  ClientApi.normalizeCallFailure({ errMsg: 'cloud.callFunction:fail network error' }).code,
  'ERR_UPSTREAM_UNAVAILABLE'
);

const storedSmall = 'https://assets.anixplayer.net/image/poster/small/14360-34a7dad806748262214bfb81852bd57c.jpg';
const detailMedium = 'https://assets.anixplayer.net/image/poster/medium/14360-c7351ec616e97746a8f34ddaa3525aea.jpg';
eq('存量升级只认同 sourceId 的可信 small', ServerCover.isSearchThumbnailForSource(storedSmall, 14360), true);
eq('存量升级拒绝 sourceId 不匹配的 small', ServerCover.isSearchThumbnailForSource(storedSmall, 99999), false);
eq(
  '存量升级拒绝伪造域名',
  ServerCover.isSearchThumbnailForSource('https://evil.example/image/poster/small/14360-34a7.jpg', 14360),
  false
);
eq('详情升级只认同 sourceId 的 medium', ServerCover.isMediumCoverForSource(detailMedium, 14360), true);
eq('详情升级拒绝把 small 当 medium', ServerCover.isMediumCoverForSource(storedSmall, 14360), false);
eq(
  '候选筛选只含未升级且可信的绑定条目',
  ServerCover.selectUpgradeCandidates(
    [
      { _id: 'small', sourceId: 14360, cover: storedSmall },
      { _id: 'medium', sourceId: 14360, cover: detailMedium },
      { _id: 'manual', sourceId: null, cover: '' },
      { _id: 'mismatch', sourceId: 99999, cover: storedSmall },
    ],
    8
  ).map((item) => item._id),
  ['small']
);
eq(
  '候选筛选遵守单次限量',
  ServerCover.selectUpgradeCandidates(
    [
      { _id: 'a', sourceId: 14360, cover: storedSmall },
      { _id: 'b', sourceId: 14360, cover: storedSmall },
    ],
    1
  ).map((item) => item._id),
  ['a']
);

console.log('\n番剧元数据封面策略测试');
console.log('─'.repeat(40));
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('─'.repeat(40));
}
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
