# 变更日志

格式: `[日期] 版本 - 变更描述`

## [2026-07-23] v1.4.1 - 共享追番板体验优化

### 优化

- **头像失败兜底**：不开云存储时对方读不到 `cloud://` 头像，`image binderror` 回退昵称首字色块（成员条 + 板列表）；仅头像 URL 变化才重试，避免每次刷新闪烁
- **弹窗统一**：抽 `sheet.wxss` 公共外壳（拖动条 handle + 顶角大圆角 + 上投影），board-list / shared-board 各底部弹层共用；统一支持点遮罩关闭
- **消除弹窗叠加**：番名改为详情弹层内原地编辑（替代独立编辑弹层）；集数选择器 / 状态选择器下钻前先收起详情，避免两层白底遮罩叠加难区分
- **集数编辑分流**：总集数 ≤ `EP_ROLL_MAX`(24) 的短番走滚轮（可视化好），长番 / 无分母（如凡人 183）走数字键盘直接输入，不再卡在 99 上限

### 修复

- 番剧卡片集数轴游标 `z-index` 逃逸盖住加番 FAB：给 `.item-card` 建立层叠上下文（`position:relative;z-index:0`）关回卡片内
- 详情下钻选集器/状态选择器后详情弹层无法回弹：补 `visible-change` 闭环（注意 t-picker confirm/cancel 不发 visible-change，需在 confirm/cancel 内自恢复；t-action-sheet 走 `_trigger` 可统一交给 visible-change）

## [2026-07-23] v1.4.0 - 共享追番板（首个云开发功能）

### 新增

- 共享追番板 (shared-board)：两人共享一份番单，各自维护进度，同轴双头像对比「能安全聊到第几集」
  - **首次引入微信云开发**（前 4 个功能纯客户端）：环境 `cloudbase-d1gtv92iac778b581`
  - 数据层 (packageFeatures/utils/shared-board/)
    - config.js：集合名/人数上限/状态枚举/错误码/阈值/配色全集中，禁硬编码
    - transform.js：进度对比、分区、首字色块、集数轴百分比等纯逻辑（可 Node 测试，63 断言）
    - cloud-api.js：云函数调用统一封装
  - 云函数 (cloudfunctions/)：createBoard/joinBoard/addItem/updateProgress/updateItem/deleteItem/listMyBoards/getBoardDetail/updateMemberProfile/markViewed + getMyOpenid
    - 读走权限规则、写全走云函数；进度私有靠动态 key `progress.${OPENID}` + 可信身份
    - joinBoard 一次性 token + 原子条件更新防抢坑防并发
  - 页面 (packageFeatures/pages/shared-board/)
    - P1 板列表（我参与的板 + 建板 + 未读红点 + 骨架屏）
    - P2 单板门面（同轴双头像集数轴 + 分区 + 加番 + 筹备态单人可用）
    - P3 进度详情弹层（+1 主手势 + 选集器 + 状态切换 + 弃番确认）
    - 头像昵称设置（chooseAvatar + nickname，微信不能自动读取）
    - 追平/对方加入里程碑动效（复用 anime-checklist 动画基因）
  - 数据来源无关设计：Bangumi/TMDB 被墙，MVP 手动输入，接入做成可替换适配层

### 说明

- 外部数据源调研：Bangumi(api.bgm.tv)、TMDB 均被墙（云函数在境内也够不着）；弹弹play 国内可用但禁未授权商用。详见 shared-board.md §6.3

## [2026-06-16] v1.3.0 - 世界杯赔率页

### 新增

- 世界杯赔率功能 (worldcup)，复刻自 hello.github.io 的 worldcup.html
  - 数据模块 (packageFeatures/utils/worldcup/)
    - worldcup-data.js：2026 FIFA 世界杯赔率快照（CommonJS 模块，48 场比赛 + 34 天赛程）
    - transform.js：数据预处理（日期分组、赔率色温、比分矩阵、半全场排序、时间格式化）
  - 页面功能 (packageFeatures/pages/worldcup/)
    - 赛程总览日历：日期条 / 月历两版可切，点击某天滚动定位并高亮
    - 按日期分组的比赛卡片：对阵、胜平负、让球核心盘、价值标签
    - 比赛详情全屏覆盖层：去水概率三色条、返还率徽章、AI 点评与娱乐方案、完整赔率（胜平负/让球/总进球/半全场/比分 6×6 热力矩阵）
    - 「今天」按手机本地日期实时高亮
  - 阶段配色：小组赛蓝色系（按轮次深浅），淘汰赛暖色系（随晋级升温）

### 说明

- 纯静态快照展示，不联网、不计算；数据更新需重新转换 JSON 覆盖 worldcup-data.js
- 数据约 82KB，计入分包，不影响主包体积

## [2026-06-16] v1.2.0 - 脱离 quickstart 模板 & 代码质量整改

### 变更

- 日麻算法模块迁移：`miniprogram/utils/mahjong/` → `miniprogram/packageFeatures/utils/mahjong/`
  - 原因：该模块仅被分包的 mahjong-score 页面使用，放在主包会触发微信「主包内存在主包未使用的 JS」告警，且占用主包体积
  - 同步更新页面 require 路径与测试 import 路径

### 清理（脱离云开发 quickstart 模板）

- 删除示例页 `pages/example/` 及其注册
- 删除示例弹窗组件 `components/cloudTipModal/`
- 删除整个 `images/` 目录（1.2M，全为模板/示例遗留，无任何存活引用）
- 删除云函数 `cloudfunctions/` 及部署脚本 `uploadCloudFunction.sh`
- 删除孤儿文件 `envList.js`
- 精简 `app.js`：移除无用的云开发初始化，保留光栅卡数据传递的 globalData
- 清理 `project.config.json`：移除 cloudfunctionRoot、cloudfunctionTemplateRoot、失效的 condition 入口，projectname 改为 otakumap
- 根 README 从云开发指引替换为 OtakuMap 项目说明

### 修复（微信代码质量检查）

- ✅ 主包不再存在未使用的 JS 文件
- ✅ 图片资源超 200K 告警消除（冗余资源已清空）

## [2026-06-16] v1.1.1 - 日麻宝牌计算修复

### 修复

- 宝牌计算逻辑修正 (utils/mahjong/)
  - `countDora` 不再把赤宝牌混入返回值，只统计「指示牌命中的宝牌」，赤宝牌作为独立维度由调用方统计
  - 修复 engine.js 宝牌汇总的减法补丁导致的错误：
    - 仅有赤宝牌、无表宝牌指示牌时，`dora` 算出负数、`total` 漏算赤牌
    - 立直但未输入里宝牌指示牌时，`uraDora` 算出负数、`total` 漏算
  - 宝牌三维度 (表/里/赤) 现为各自独立统计后相加，互不重叠

### 清理

- 删除 score-calculator.js 中未被调用的 `countAllDora` 死代码

## [2026-04-16] v1.1.0 - 日麻点数计算器

### 新增

- 日麻点数计算器功能 (mahjong-score)
  - 核心算法模块 (utils/mahjong/)
    - 手牌解析与面子分割算法
    - 符数计算 (副底/雀头/面子/听牌型)
    - 40+役种判定 (含役满/双倍役满)
    - 点数计算 (满贯系统/本场/供托)
  - 配置驱动设计
    - 役种配置 (yaku.js)
    - 符数规则 (fu-rules.js)
    - 点数速查表 (score-table.js)
    - 霓虹夜鸦主题 (theme.js)
  - 页面功能
    - 场况设置 (场风/自风/胡牌方式)
    - 立直系统 (立直/双立直/一发)
    - 宝牌指示牌 (表宝牌/里宝牌)
    - 手牌输入与牌选择器
    - 计算结果展示

## [2026-04-16] v1.0.0 - 初始化

### 新增

- 项目初始化，基于微信云开发模板
- 番剧追踪功能 (anime-checklist)
  - 单数据源 + 派生列表架构
  - 三阶段动画状态机
  - 拖拽排序
  - 左右滑动删除
- 光栅卡功能 (lenticular)
  - 百叶窗 CSS Mask 效果
  - 设备陀螺仪体感
  - 低通滤波平滑
  - 拖拽排序图片
- TDesign Miniprogram UI 组件库
- 深色模式支持

### 技术栈

- 微信小程序
- TDesign Miniprogram ^1.5.0
- 微信云开发 (CloudBase)
