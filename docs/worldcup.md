# 世界杯赔率页 - 开发文档

## 概述

将 Web 版世界杯赔率页（`hello.github.io/worldcup.html`）完整复刻到 OtakuMap 小程序。展示 2026 FIFA 世界杯各场比赛的胜平负、让球、总进球、半全场、比分等竞彩赔率，配赛程总览日历和比赛详情。

**纯静态展示**：数据为冻结快照，页面不联网、不计算（所有数值由 Web 版的 `build_wc_data.py` 预先算好）。

## 范围与决策

| 决策点 | Web 版 | 小程序方案 | 原因 |
|--------|--------|-----------|------|
| 数据加载 | `fetch` 本地 JSON | 打包进分包，`require` 加载 | 小程序不支持 fetch 本地文件；静态快照无需联网 |
| 详情展示 | 移动端全屏滑入面板 | 页内覆盖层（全屏滑入） | 最还原 H5 体验，数据已在内存无需重新取 |
| 战绩页(simbet) | 顶部 tab 可切换 | 不做，移除战绩 tab | 本次仅复刻赔率页 |

## H5 → 小程序的技术差异处理

| H5 技术 | 小程序处理 |
|---------|-----------|
| `fetch(json)` | 数据文件转为 CommonJS 模块 `data/worldcup-data.js`，`module.exports` 导出，`require` 加载 |
| DOM `innerHTML` 拼接 | 改数据驱动：JS 预处理成可渲染结构 + WXML 模板 `wx:for` |
| 比分 6×6 矩阵（JS 拼 table） | JS 预构建二维数组 `matrix[h][a]`，WXML 双层 `wx:for` 渲染 |
| 半全场排序、热力色温 class | 在 JS 数据预处理阶段算好 `heatClass`，挂到数据字段上 |
| CSS `:root` 变量 | 改 `page { }` 选择器承载 CSS 变量 |
| `color-mix()` | 降级为预设 rgba（小程序不支持） |
| `backdrop-filter: blur` | iOS 支持，Android 部分不支持 → 加纯色兜底背景 |
| 队徽 `<img onerror>` 降级 | `<image>` + `binderror` 事件切占位 emoji |
| Google Fonts (Inter) | 系统字体降级，保留 `font-variant-numeric: tabular-nums` 等宽数字 |
| `window.innerWidth` 判断视图 | 小程序固定移动端形态：日历默认「日期条」，可切「月历」 |
| `scrollIntoView` 滚动到分组 | `wx.pageScrollTo` + `selectorQuery` 取锚点位置 |
| `Escape` 键关闭详情 | 无键盘，靠返回按钮/点遮罩关闭 |

## 文件结构

```
miniprogram/packageFeatures/
├── pages/worldcup/
│   ├── worldcup.js          # 页面逻辑：加载数据、视图状态、详情开关、滚动定位
│   ├── worldcup.wxml        # 页面结构：日历 + 分组卡片列表 + 详情覆盖层
│   ├── worldcup.wxss        # 页面样式（复刻 worldcup.css）
│   └── worldcup.json        # 页面配置
└── utils/worldcup/
    ├── data/
    │   └── worldcup-data.js # 赔率数据快照（CommonJS 模块，约 170KB）
    └── transform.js         # 数据预处理：分组、热力色温、矩阵构建、时间格式化
```

放分包 `packageFeatures`，与现有功能（mahjong/lenticular）一致，主包不受影响。

## 数据结构（来自 worldcup.json）

```
{
  meta: {
    title, crawledAt,      // 赔率截止时间（快照标注）
    analyzedAt,            // AI 分析时间（可空）
    disclaimer,            // 免责声明
  },
  schedule: {              // 赛程总览（日历用）
    totalMatches,          // 总场次（104，含未开赔率的）
    days: [ {
      date,                // YYYY-MM-DD
      md,                  // "6/12"
      weekday,             // "周五"
      total,               // 当天场次
      mainPhase,           // "小组赛"|"32强"|...|"决赛"
      groupRound,          // 小组赛轮次 1/2/3（淘汰赛无）
    } ]
  },
  matches: [ {             // 有赔率的比赛（48 场）
    mid, matchNum, datetime, group, phase,
    home: { name, logo }, away: { name, logo },
    odds: {
      had: { h, d, a },              // 胜平负
      hhad: [ { goalLine, h, d, a } ],// 让球（可多盘）
      ttg: { "0".."7" },             // 总进球
      hafu: { hh, hd, ha, ... },     // 半全场 9 项
      crs: [ { name, odds } ],       // 比分（含"胜其它"等）
    },
    metrics: {             // 客观指标（详情用）
      had: { return, prob: { h, d, a } },  // 返还率 + 去水概率
      ttg/hafu/crs: { return },
    },
    tags: [ "大热盘" ],     // 价值标签
    commentary: {          // AI 点评（可空）
      summary, value,
      plan: { budget, bets: [{market,odds,stake,potential}], note }
    }
  } ]
}
```

## 核心展示逻辑

### 列表
- 按日期分组，每组头显示「日期 周几 + 阶段徽章 + 场次数 + 今天标记」
- 阶段配色：小组赛三轮蓝色系（浅→深），淘汰赛暖色系（青→金）
- 卡片：对阵（队徽+队名）、胜平负三栏、让球核心盘、价值标签、有方案徽章
- 「今天」按手机本地日期实时高亮（不依赖冻结数据）

### 日历（两版可切，默认日期条）
- **日期条**：横向滚动，每格显示日期/周几/阶段短标/场次
- **月历**：按自然月网格，周一为首列
- 点击某天 → 滚动到列表对应分组并高亮闪烁；无赔率的天 → 抖动反馈
- 阶段图例

### 详情覆盖层
- 对阵头（队徽+队名+赛事信息）
- 价值分析：标签、去水概率三色条、各玩法返还率徽章（高/中/低三色）
- AI 点评：综述、价值点、娱乐方案（投注明细）
- 完整赔率：
  - 胜平负/让球/总进球 → 行式键值，最低赔率项高亮，按赔率色温
  - 半全场 → 一行平铺，按赔率升序
  - 比分 → 6×6 热力矩阵（行=主队进球，列=客队进球）+ 「其它」项

### 色温规则（赔率越低越热）
| 赔率 | 档位 | 色 |
|------|------|-----|
| <2 | heat-5 很热 | 暖红 |
| <3.5 | heat-4 热 | 橙 |
| <7 | heat-3 中 | 常规 |
| <20 | heat-2 冷 | 浅蓝 |
| ≥20 | heat-1 很冷 | 深蓝 |

### 返还率等级
| 返还率 | 等级 | 色 |
|--------|------|-----|
| ≥0.85 | high | 绿 |
| ≥0.78 | mid | 黄 |
| <0.78 | low | 红 |

## 入口

首页 `pages/index/index.js` 的 features 数组新增一项，path 指向 `/packageFeatures/pages/worldcup/worldcup`。

## 实现计划

1. 数据层：worldcup.json → CommonJS 模块；transform.js 预处理（分组/色温/矩阵/时间）
2. 页面骨架：worldcup.json 配置 + 首页入口
3. 列表：日期分组 + 卡片
4. 日历：两版 + 切换 + 滚动定位
5. 详情覆盖层：四区块
6. 样式：复刻 worldcup.css，处理小程序差异
7. 验证：开发者工具预览，真机查队徽加载
8. 文档收尾：更新 docs/README、architecture、changelog

## 注意事项

- **分包体积**：数据约 170KB，计入分包（非主包），不影响主包 2MB 限制
- **不引 TDesign**：本页纯自绘，与 lenticular 一致，无需 TDesign 组件
- **暗黑模式**：本页固定深色主题（赛事氛围），不随系统切换——与 mahjong-score 一致
- **队徽远程图**：`<image>` 可直接加载 sporttery.cn 图片，失败降级 emoji；无需配 downloadFile 域名（image 组件不受 request 域名限制）
- **数据时效**：快照数据不会更新，页面头部显著标注「赔率截止时间」

