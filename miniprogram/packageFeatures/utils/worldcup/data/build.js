/**
 * build.js — 世界杯赔率数据同步脚本（Node 直接运行，不参与小程序打包）
 *
 * 作用：读取 hello.github.io 的源 JSON，校验后转成 CommonJS 模块 worldcup-data.js。
 * 用法：node build.js  （在本目录或项目任意位置带路径运行均可）
 *
 * 数据链路：hello.github.io 爬虫 → data/worldcup.json → 本脚本 → worldcup-data.js → 小程序 require
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// 源 JSON 路径。允许用环境变量 WC_SRC 覆盖，避免把绝对路径写死在代码里。
const SRC =
  process.env.WC_SRC ||
  path.join(os.homedir(), 'VSCodeProjects/hello.github.io/data/worldcup.json');

const OUT = path.join(__dirname, 'worldcup-data.js');

function build() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const data = JSON.parse(raw); // 顺带校验 JSON 合法性，非法会抛错中断

  const crawledAt = (data.meta && data.meta.crawledAt) || '未知';

  const header =
    '/**\n' +
    ' * worldcup-data.js — 世界杯赔率数据快照（CommonJS 模块）\n' +
    ' *\n' +
    ' * 由 hello.github.io/data/worldcup.json 转换而来。纯静态数据，不联网。\n' +
    ' * 本文件由 build.js 生成，请勿手改；更新数据请运行 node build.js。\n' +
    ' * 赔率截止：' + crawledAt + '\n' +
    ' */\n';

  fs.writeFileSync(OUT, header + 'module.exports = ' + JSON.stringify(data) + ';\n');

  return { crawledAt, matches: data.matches.length };
}

const r = build();
console.log('[worldcup] 数据已更新 | 赔率截止:', r.crawledAt, '| 场次:', r.matches);
