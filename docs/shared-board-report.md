# 共享追番板 · 追番小结 / 周报 —— 设计与实现

> 状态：已实现，270 断言绿（2026-08-09）；待用户上传部署 `getBoardReport` 云函数
> 前置：阶段一改动历史事件流（`shared_board_events` 集合 + 埋点）已上线（commit ec8682f）
> 本文档描述「追番小结」报告页（`board-report`）的定位、数据分类、数据层函数与页面结构。

## 0. 定位与边界

- **不是排名，是「我俩这阵子一起追番的样子」**。基调是陪伴回顾，不是进度赛跑、不比谁快。
- **快照式报告**：进页面拉一次 `getBoardReport`，服务端取全事件 + items，复用 `transform.buildReportModel` 一次算好返回。无 watch、无自动刷新，重进即最新。
- **入口**：单板门面（`shared-board`）常驻横条「📊 追番小结」，下钻到 `board-report`。用中性色（非 TA 紫），归档态也可看，不设 phase 限制。
- **报告页零 TDesign**：纯原生渲染（柱状图为 CSS 自绘），与主包轻量策略一致。

## 1. 两类数据（关键设计）

报告数据分两类，决定了「首报是否残缺」与「显隐规则」：

| 类别 | 来源 | 覆盖 | 显隐策略 |
|---|---|---|---|
| **A 类快照** | `items.progress` 当前状态 | 任何板都能算，首报不残缺 | 常驻 |
| **B 类叙事** | `shared_board_events` 事件流 | 仅埋点后（约 2026-08-03 起）有 | show-if-present：缺则隐藏对应块 + footnote 说明起记时间 |

- A 类：累计统计（一起追了/追完/共同）、本命番 Hero、个人小结（各状态封面条 + 追了多少话）。
- B 类：变化区（推得最猛 / 环比 momentum）、每日柱状图、名场面三章（连续追番 / 神同步 / 单日爆肝）、「我最近在推」。

`hasBehaviorData` 统一控制 B 类块显隐；`emptyWindow`（有埋点但近窗零推进且 streak 断）走「这阵子歇脚」空态文案。

## 2. 报告数据层（transform.js 纯函数）

全部纯函数：**不读时钟**（`nowMs` 由页面传 `Date.now()`）、**不拼文案**（措辞在 `config.REPORT_COPY`），只产出结构化数据。按天指标显式带 `tzOffsetMin`，把 UTC 时间戳归本地日再分桶。

| 函数 | 产出 | 归属 |
|---|---|---|
| `localDayIndex(ms, tz)` | 本地日序号（凌晨追番正确归当天） | 基础 |
| `dayIndexToMD(dayIndex, tz)` | `{ m, d }` 还原月日 | 基础 |
| `dayIndexToWeekday(dayIndex, tz)` | 本地星期几 `0~6`（与 `AIR_DAY_LABELS` 同序），供柱状图轴标 + 判周末 | 基础 |
| `daysTogether(board, nowMs, tz)` | 一起追番第 N 天 | A |
| `cumulativeStats(...)` | 一起追了 / 追完 / 共同话数 | A |
| `mostInvestedItem(items, me, peer)` | 本命番 Hero（合计集数最高，弃番集数不计） | A |
| `doneTogetherItems(...)` | 一起追完的番封面条 | A |
| `personalSummary(items, me, stripLimit)` | 个人：各状态计数 + 封面条 + `footprint`（我一共追了多少话） | A |
| `windowProgress` / `momentumOf` | 近 7 天 vs 前 7 天推进环比方向 | B |
| `recentItemsProgress(...)` | 推得最猛的番（双人合计推进降序 top N） | B |
| `dailyProgressSeries(...)` | 每日柱状图 `{ bars:[{dayIndex,me,peer,total}], max }` | B |
| `currentStreakInfo(...)` | 连续追番 `{ days, startDay }`（Duolingo 式宽限） | B |
| `syncInfo(...)` | 神同步 `{ count, lastDay, lastItemId, lastItemName }` | B |
| `bingePeak(...)` | 单日爆肝峰值 | B |
| `myRecentProgress(...)` | 我一人近窗推进（区别于双人「推得最猛」） | B |
| `buildReportModel(...)` | 上述汇总为一个 model | 汇总 |

**纪律**：`transform.js` 禁 `Date.now()` / `Math.random()` / 无参 `new Date()`（会破坏纯函数可测性与云端复用）。`new Date(ms)`（显式毫秒）允许，`dayIndexToMD`/`dayIndexToWeekday` 即用它。

## 3. getBoardReport 云函数

- **transform-in-cloud-function**：`config.js` / `transform.js` **逐字节复制**进 `cloudfunctions/getBoardReport/`，测试用 `fs.readFileSync` 做漂移守卫，保证前后端同源。**每次改前端 config/transform 后必须 `cp` 覆盖云端副本**，否则守卫测试红。
- **nowMs 来自客户端**：`event.nowMs`（客户端 `Date.now()`）为准，服务端时钟仅兜底——streak 判「今天」需可信本地时钟，云机房时区不可信。
- 服务端取事件时间下界 `LOOKBACK_DAYS`（90 天），防老板拉爆。

## 4. 页面结构（board-report，五块）

| 块 | 内容 | 数据类 |
|---|---|---|
| ① 头部 | 双人色块 · 一起追番第 N 天 | A |
| ② 变化区 | 推得最猛（双人）+ 每日柱状图 + 环比 | B |
| ③ 名场面 | 三徽章：连续追番 / 神同步 / 单日爆肝 | B |
| ④ 一路追来 | 本命番 Hero + 三统计格 + 追完封面条 | A |
| ⑤ 你自己 | 我最近在推 + 我一共追了多少话 + 各状态封面条 | A（+ 我最近在推为 B） |

- **柱状图轴标**：两行——上行周X（查 `AIR_DAY_LABELS`，不硬编码）、下行日期数字；周末（周六/日）用对方色加重区分。柱顶圆角只加在最顶那段（`chart-seg--top`），柱底贴基线保持直角。
- **封面兜底**：`it.cover`（https）有且未 error 才渲染真图，否则 `pickCoverColor(name)` 首字色块；`cloud://` 在数据层净化为空（云存储公开读需付费套餐，连自己都读不到）。

## 5. 配置项（config.REPORT）

规则参数集中在 `config.REPORT`，措辞集中在 `config.REPORT_COPY`，wxml/js 零硬编码：

- `TZ_OFFSET_MINUTES:480`（UTC+8 本地日分桶）、`WINDOW_DAYS:7`（环比窗口）、`MOMENTUM_STABLE_BAND:1`（稳定带）
- `STREAK_GRACE_DAYS:1`（连续宽限）、`LOOKBACK_DAYS:90`（服务端回溯上界）
- `RECENT_ITEMS_LIMIT:5`、`DONE_STRIP_LIMIT:8`、`PERSONAL_STRIP_LIMIT:6`、`PERSONAL_RECENT_LIMIT:4`、`CHART_DAYS:14`（各展示条数上限）

## 6. 待办

- **[用户] 上传部署 `getBoardReport` 云函数**（右键「上传并部署：云端安装依赖」）——数据层多轮迭代后未重新部署，预览到的仍是旧结构。
- 真机预览：重点看最窄机型下 14 列柱状图两行轴标是否挤压（挤则星期改单字 / 隔列显示）。
