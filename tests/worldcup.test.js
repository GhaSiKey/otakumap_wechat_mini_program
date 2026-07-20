/**
 * 世界杯赔率 transform 模块测试
 *
 * 零依赖，用 Node 原生跑：
 *   node tests/worldcup.test.js
 *
 * transform.js 是纯 CommonJS、不依赖小程序 API，可直接在 Node 下验证。
 * 本文件聚焦冠军收官条 buildTournament 的预处理逻辑。
 */
const T = require('../miniprogram/packageFeatures/utils/worldcup/transform');

// ── 极简断言框架（与 mahjong.test.js 一致）──
let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    failures.push(`  ❌ ${name}\n     实际: ${a}\n     期望: ${e}`);
  }
}

// ============================================================
// buildTournament：冠军收官条视图模型
// ============================================================

// 未闭幕 / 空输入 -> null（页面据此 wx:if 不渲染）
eq('未闭幕返回 null', T.buildTournament({ status: 'ongoing' }), null);
eq('空输入返回 null', T.buildTournament(null), null);
eq('缺 status 返回 null', T.buildTournament({ champion: '西班牙' }), null);

// 完整闭幕数据
const full = T.buildTournament({
  status: 'finished',
  champion: '西班牙',
  runnerUp: '阿根廷',
  third: '英格兰',
  fourth: '法国',
  finalNote: '决赛 西班牙 1:0 阿根廷',
  thirdNote: '季军赛 英格兰 6:4 法国',
  headline: '世界杯落幕',
});
eq('冠军名', full.champion, '西班牙');
eq('headline 透传', full.headline, '世界杯落幕');
eq('四强路径 4 项', full.podium.length, 4);
eq('冠军 top 标记', full.podium[0].top, true);
eq('亚军非 top', full.podium[1].top, false);
eq('奖牌顺序', full.podium.map((r) => r.medal), ['🥇', '🥈', '🥉', '4️⃣']);
eq('note 拼接决赛+季军赛', full.note, '决赛 西班牙 1:0 阿根廷 · 季军赛 英格兰 6:4 法国');

// headline 缺省回退
eq('headline 缺省回退', T.buildTournament({ status: 'finished', champion: '西班牙' }).headline, '赛事已闭幕');

// 缺失名次被过滤（如只有前两名）
const partial = T.buildTournament({ status: 'finished', champion: '西班牙', runnerUp: '阿根廷' });
eq('缺失名次被过滤', partial.podium.length, 2);

// 只有决赛备注时 note 不带分隔符
eq('单备注不带分隔符', T.buildTournament({ status: 'finished', finalNote: '决赛 1:0' }).note, '决赛 1:0');

// ============================================================
// 汇总输出
// ============================================================
console.log('\n世界杯 transform 模块测试');
console.log('─'.repeat(40));
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('─'.repeat(40));
}
console.log(`通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
