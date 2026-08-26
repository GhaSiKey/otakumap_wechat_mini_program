# 共享追番板 UI 设计与实现规格 (shared-board-ui)

> 状态：已实现；P2 列表 / 海报双视图已真机验收（2026-08-26），本文以当前代码为准并单独标注未来项
> 定位一句话：**不是进度赛跑，是看清「我俩各追到哪里、现在能一起聊什么」。所有像素服从「陪伴，不是排名」。**

---

## 1. 设计原则与信息架构

### 1.1 设计哲学（一句话）

**把「两个人的进度差」翻译成「一条共同的路上，两个头像的物理距离」——差距是用来感知彼此、找到安全话题的，不是用来分胜负的。**

三条不可违背的落地铁律（从 PRD §5.1 / §9.2 收敛）：

1. **落后方永不受罚**：不用红色、不降饱和、不变灰、不排在后面被「审判」。落后侧游标与领先侧同等清晰。
2. **绿色是奖章不是领先色**：`--td-success-color` 只在「追平/看完」里程碑瞬间点亮，绝不常驻标记跑得快的人。
3. **正向主语**：文案永远说「TA 领先 4 集」「还差 4 集追上 TA」，绝不说「你落后 4 集」。

### 1.2 页面跳转关系图

```
                [首页 pages/index]
                          │ 点「共享追番板」入口卡
                          ▼
              ┌─────────────────────┐
              │  P1 我的板列表页          │◄────────┐
              │  board-list             │          返回
              │  · 我参与的所有板         │          │
              │  · [+ 建板] FAB          │          │
              └────┬─────────┬────────┘          │
            点某个板 │         │ 点 [+ 建板]           │
                    ▼         ▼                     │
      ┌────────────────┐  ┌────────────────┐        │
      │ P2 单个板页        │  │ P4 配对建板流      │       │
      │ shared-board     │  │ (P2 的空板态)     │        │
      │ · 列表/海报双视图   │  │ ① 筹备态番单      │       │
      │ · 下拉刷新         │  │ ② 分享卡片        │───────┘
      │ · [+ 加番]         │  │ ③ 等待呼吸头像    │
      └───┬────────┬───┘  │ ④ TA 来了动画      │
      点某番│        │加番   └────────────────┘
           ▼        ▼
   ┌────────────┐  ┌──────────────┐
   │ P3 单番详情    │  │ 加番 t-popup    │
   │ (t-popup 弹层) │  │ (搜索/手填)     │
   │ · 左右对峙展开 │  └──────────────┘
   │ · 改我进度/状态│
   │ · +1 / 集数轮盘│
   └────────────┘
```

关键决策：
- **P4 配对建板流不是独立页面**，而是 P2 在「只有 1 名成员」时的一种态。这样「建板 → 分享 → 对方进来」是同一页面的状态演进，对方加入瞬间能原地做实体化动效，不发生页面跳转的割裂。
- **P3 单番详情用 `t-popup`**（`placement="bottom"`）半屏弹层而非独立页面：改进度是高频轻操作，弹层比跳页快、可保留 P2 列表上下文。

---

## 2. 逐页设计

### P1 我的板列表页 (`board-list`)

允许一人加入多个板（PRD §5.4），这是必需的一层。

**统一大卡（2026-08-18 重构）：** 一般人只有 1 个板，旧「紧凑列表行」在单板场景留大片空白。改为**统一大卡**——单板不显空、多板堆叠自然，一套结构应对所有数量。每张卡三段纵向：① 头部行（双人同轴头像 + 板名 + 未读红点）② 封面墙（前 N 部番首字色块铺满整宽）③ 底部信息行（番数 · 活跃/等待 + 进入箭头）。

```
┌────────────────────────────────┐
│  共享追番板                          │ ← 系统导航栏（非 custom）
├────────────────────────────────┤
│  ┌────────────────────────────┐   │
│  │ (头)(头)  我俩的番单     🔴   │   │ ← ① 双人同轴头像（重叠）+ 板名 + 未读点(右)
│  │ ┌────┐┌────┐┌────┐┌────┐   │   │
│  │ │ 芙 ││ 药 ││ 葬 ││ +5 │   │   │ ← ② 封面墙：前 4 部首字色块 + 溢出「+N」
│  │ └────┘└────┘└────┘└────┘   │   │
│  │ 12 部番 · 和小王 · 2天前一起追 ›│   │ ← ③ 番数 · 活跃行 + 箭头
│  └────────────────────────────┘   │
│  ┌────────────────────────────┐   │
│  │ (头)(?)  和阿宅的补番坑        │   │ ← 右头像虚线圈=对方未加入
│  │ ┌────┐┌────┐               │   │
│  │ │ 凡 ││ 咒 │               │   │
│  │ └────┘└────┘               │   │
│  │ 5 部番 · 等 TA 点开链接      ›│   │ ← 未配对：等待文案染我方身份色
│  └────────────────────────────┘   │
│  ┌────────────────────────────┐   │
│  │ (头)(头) 📁 和前任的番单       │   │ ← 归档态，整卡降调（去阴影 + 半透明）
│  └────────────────────────────┘   │
│                          ╭─────╮  │
│                          │  +  │  │ ← t-fab 建板入口
│                          ╰─────╯  │
└────────────────────────────────┘
```

**空态（一个板都没有）：** `t-empty` +「还没有共享的番单，和 TA 开一个，一起追番吧」+ `t-button`「建第一个板」。文案走 `BOARD_LIST_COPY`（EMPTY_TITLE/EMPTY_SUB/EMPTY_CTA）。

元素与组件映射：

| 元素 | 组件 / 自绘 | CSS 变量 |
|------|-----------|---------|
| 页面底 | `page` | `--td-bg-color-page` |
| 板卡片容器 | 自绘 `view.board-card`（三段纵向 flex-column） | 底 `--td-bg-color-container`；圆角 `--td-radius-large`；阴影 `--td-shadow-1`；内距 `--td-spacer-2` |
| 双人同轴头像 | 自绘 `view.dual-avatar`（两枚重叠 -12rpx，右压左） | 白描边 `--td-bg-color-container` 勾出重叠边界（暗模式自动取容器色） |
| 头像/首字兜底 | `image.dual-avatar__img` / `view.dual-avatar__fallback` | 兜底底色走 `pickCoverColor`（COVER_PALETTE 深色档扛白字）；`cloud://` 经 `sanitizeAvatar` 净化→走首字，不发失败请求 |
| 对方未加入虚位头像 | 自绘 `view.dual-avatar__ghost`（虚线圆 + `?`） | 边框/文字 `--td-text-color-placeholder` |
| 板名 | `text.board-name`（单行省略） | `--td-text-color-primary`；`--td-font-size-title-medium`；`font-weight:600` |
| 封面墙格 | `image.cover-cell` / `view.cover-cell--ph`（等宽 flex:1，高 120rpx） | 首字底色 `pickCoverColor`；圆角 `--td-radius-default` |
| 封面溢出角标 | 自绘 `view.cover-more`（与封面等宽「+N」灰格） | 底 `--td-bg-color-component`；文字 `--td-text-color-secondary` |
| 番数 | `text.foot-count` | `--td-text-color-primary`；`font-weight:600` |
| 活跃/等待文案 | `text.foot-sub` / `.foot-sub--waiting` | 配对：`--td-text-color-secondary`；未配对等待：`--sb-color-me`（我方身份色，暗示「就差 TA」） |
| 进入箭头 | `text.foot-arrow`（›） | `--td-text-color-placeholder` |
| 未读红点 | 自绘 `view.unread-dot`（板名右侧） | `--td-error-color`（红点=通用未读语义，非落后惩罚，允许用红） |
| 归档卡 | `view.board-card--archived` | 去阴影 + `opacity:0.6` + 📁 前缀（ARCHIVED_PREFIX） |
| 建板 FAB | `t-fab`(icon add) | `--td-brand-color` |

**封面墙数据来源：** `listMyBoards` 云函数按 `cloudfunctions/_shared-board/constants.js` 的 `BOARD_PREVIEW_COVERS`（=4）做 `.limit()` 取番名 + 封面（`previewItems`），并单独 `count()` 拿准确总数 `itemCount`；前端只渲染已截断的 `previewItems`，溢出（itemCount − 预览数）计入「+N」。番剧数据源被墙、封面基本为空，故封面墙实为**首字色块墙**（`pickCoverColor` 取番名首字 + 哈希配色，双方一致零成本）。

**封面墙排序 = 最近活跃优先（2026-08-18）：** 预览查询按 `item.updateTime` 降序取（不是 `createTime`）。`item.updateTime` 在 `addItem`（加番）和 `updateProgress`（+1/改状态）时都会 bump，故封面墙呈现「你俩最近在追/推进的番」，随互动实时变化，与卡片底部「X 前一起追」同一活跃叙事。旧的 `createTime asc` 永远取最早 4 部、永不变化，已废弃。

**封面格定宽不变形：** `.cover-cell` 用 `flex:1 1 0 + max-width:120rpx`——番少时均分值超上限则封顶、左对齐留白（不拉伸变形）；番满（≤4 格 + 「+N」）均分值低于上限则自然铺满。免精算屏宽、免按格数切 class。「+N」角标同样定宽，避免独吞留白拉成宽条。

**身份色变量定义在 `page` 根**（非 `.page`）：`--sb-color-me`/`--sb-color-peer` + RGB 分量 `--sb-me-rgb`/`--sb-peer-rgb`，与 `shared-board`/`board-report` 同源，弹层外也能继承。

**决策留档：** 本轮方向为「B 统一大卡」，数据范围「只封面墙」——**不在列表页显示「N 部能一起聊」**（commonCount 需读全量 items，ROI 低，且更适合放 P2 门面里做仪式感）。旧线框的 avatar-group + 「3 部能一起聊」右置摘要已作废。

交互：点板卡 `navigateTo` 进 P2 带 `boardId`；归档板可点进（只读）；整页下拉刷新重拉板列表；**无显眼删除入口**（退出/解散是 P2 内低调二级操作，PRD §5.4）。

---

### P2 单个板页 · 核心门面 (`shared-board`)

全功能门面，打磨优先级最高。番单提供**完整列表 / 三列海报**双视图：列表用紧凑版同轴集数轴看完整双人进度，海报视图用封面识别提高长番单的扫描效率；两者不是两套数据模型。

**完整列表（LIST，默认）：**

```
┌────────────────────────────────┐
│ ← 我俩的番单              ⟳  ⋯     │ ← 导航栏（⋯=板设置/退出）
├────────────────────────────────┤
│ ┌──┐ 小高    ┌──┐ 小王             │ ← 成员条（头像+昵称，等价不对峙）
│ └──┘         └──┘                  │
│ [▥ 追番小结]       [▦ 海报视图]      │ ← 同排工具胶囊；右侧显示目标视图
├────────────────────────────────┤
│ 一起追                             │ ← 分区标题
│ ┌────────────────────────────┐   │
│ │ 葬送的芙莉莲          [在追]   │   │
│ │ ●━━━━◐····                  │   │ ← 同轴：●我 ◐TA，右端渐隐
│ │ 我 E8 · TA E12 · TA 领先 4    │   │
│ ├────────────────────────────┤   │
│ │ 咒术回战            [追平待更]  │   │
│ │ ·····◉····                  │   │ ← ◉ 两头像重叠
│ │ 我 E24 · TA E24 · 同步 🎉     │   │
│ └────────────────────────────┘   │
│ 还没开追                            │ ← 分区只看「我」的状态
│ ┌────────────────────────────┐   │
│ │ 迷宫饭              [想看]     │   │
│ │ ●·············               │   │ ← 只有我的游标
│ │ 我 E3 · TA 还没翻牌           │   │
│ └────────────────────────────┘   │
│ 追完了 🎉                          │ ← 我看完的番（去「一起」）
│ ┌────────────────────────────┐   │
│ │ 别当欧尼酱了         [看完]    │   │
│ │ ━━━━━━◉ 都看完             │   │
│ └────────────────────────────┘   │
│ 暂缓                               │ ← 我暂缓（先放放，随时回来）
│ 下车了                             │ ← 我下车（退坑，沉底不羞辱）
│                          ╭─────╮  │
│                          │ +番 │  │ ← t-fab 加番
│                          ╰─────╯  │
└────────────────────────────────┘
```

**三列海报（POSTER）：**

```
┌────────────────────────────────┐
│ [▥ 追番小结]       [☷ 列表视图] │ ← 当前为 POSTER，右侧显示目标视图
│ 一起追 · 3部                       │
│ ┌──────┐ ┌──────┐ ┌──────┐       │
│ │ 海报  │ │ 海报  │ │ 首字  │       │ ← 3:4；无图/坏图复用首字色块
│ └──────┘ └──────┘ └──────┘       │ ← 不叠状态贴纸，分区已表达状态
│ 我E6  TA E6  我E20 TA E21 我E7 TA E7│ ← 每张海报下方一条双端关系进度轨
│ 芙莉莲      药屋少女      很长的番名…│ ← 进度在前，番名最多两行
│ 还没开追 · 2部                       │ ← 仍保留 5 分区，不混成无结构海报墙
│ ┌──────┐ ┌──────┐                  │
│ │ 海报  │ │ 海报  │                  │
│ └──────┘ └──────┘                  │
└────────────────────────────────┘
```

双视图规则（2026-08-26）：

- 共同话题提示之后、邀请横幅/归档提示之前放统一工具栏：左侧常驻 `chart-bar + 追番小结`，右侧仅在有番时显示当前视图的目标按钮。LIST 显示 `grid-view + 海报视图`，POSTER 显示 `view-list + 列表视图`，并提供对应 `aria-label`；空番单只保留报告入口。
- 三列海报卡只保留 3:4 封面/首字兜底、海报下方双端关系进度轨和两行番名；不再叠状态贴纸，不塞副信息、更新日、领先措辞或同轴轴，完整信息点卡片打开同一个 P3 详情弹层。
- 关系进度轨明确显示「我 E12」和「TA E14 / TA 未翻牌」，我方使用蓝色、TA 使用紫色，颜色只做身份强化；筹备态只显示我方。两端独立收缩/省略，不使用连续句分隔符。
- 两种视图只渲染当前分支，并共同消费 `buildBoardViewModel()` 产出的 `vm.sections`；共用 `onItemTap`、`coverErrorIds/onItemCoverError`、5 分区锚点和 `syncItemId`，不新增第二份海报 VM、详情或坏图状态。
- 偏好按 `boardId` 存在本机 Storage（`STORAGE_KEY.ITEM_VIEW_PREFIX + boardId`），不写共享数据库、不影响 TA；非法/旧值经 `normalizeItemView()` 回退 LIST。下拉刷新、`onShow` 和进度对账只刷新业务 VM，不重置视图。
- 本轮解决的是**浏览密度和视觉定位**，不宣称解决全部检索/性能问题：不做搜索、筛选、折叠、置顶、排序、分页或虚拟列表。`getBoardDetail.limit(200)` 超过 200 条静默截断仍是独立的数据完整性技术债，后续必须单独修。

分区规则（客户端 `transform.js` 分组，顺序走配置 `SECTION_ORDER` 不硬编码）——**2026-08-19 重构为 5 分区、只看「我」的状态**：

- **归类只看我自己的状态**（`sectionOf(mineStatus)` 单参查 `STATUS_TO_SECTION` 表），TA 的状态只在卡片内双游标/标签体现，不绑架整番分区。所以「我在追、TA 暂缓」仍落「一起追」，不会被拽进暂缓区——契合「陪伴不排名」，一方的消极状态不再压过另一方的积极状态。
- 顺序：**一起追**（watching/caught_up，置顶）→ **还没开追**（want 或我还没翻牌）→ **追完了 🎉**（done）→ **暂缓**（paused）→ **下车了**（dropped，沉底但不羞辱）。
- **暂缓与下车拆成两个独立分区**：暂缓=先放放随时回来，下车=退坑，语义强度不同，不再挤同一格。
- **DONE 标题去「一起」**：只看我的状态，「我追完、TA 还在追」也落此区，故配对态标题为「追完了 🎉」而非「一起追完了」；双人同步追完的高光交给追平动效（`sbSyncGlow`）。筹备态标题走 `SECTION_TITLES_SOLO`（在追/想看/看完了/暂缓/弃番），去关系词中性化。

元素与组件映射：

| 元素 | 组件 / 自绘 | CSS 变量 |
|------|-----------|---------|
| 成员条 | 自绘 `view.member-bar`（两 avatar + 昵称） | 底 `--td-bg-color-container`；内距 `--td-spacer` |
| 「又多一部能一起聊」提示 | `view.common-talk` 可点；`commonCount` 增加时短暂出现，首次进入/数量不变不显示 | `--td-brand-color`；点击滚到 TOGETHER，无则兜底 DONE |
| 分区标题 | `text.section-title`（复用 anime-checklist 风格）+ 数量 | `--td-text-color-placeholder`；`--td-font-size-body-small` |
| 顶部工具胶囊 | `t-icon` + `text` 的原生胶囊按钮 | 报告入口用 `--td-bg-color-container`；视图切换用 `--td-brand-color-light`；目标态文案走 `ITEM_VIEW_SWITCH` |
| 番卡片 | 自绘 `view.item-card` | 底 `--td-bg-color-container`；圆角 `--td-radius-large`；内距 `--td-spacer-2` |
| 海报墙 | `view.poster-grid` + 轻量原生海报卡 | 三列 3:4；不叠状态贴纸；分区表达状态 |
| 海报双端进度 | `view.poster-card__progress` 两端文本 | `--sb-color-me` / `--sb-color-peer`；未翻牌走 placeholder |
| 番名 | `text.item-name` | `--td-text-color-primary`；30rpx |
| 状态标签 | LIST 中的 `t-tag`(variant 随状态) | 见 §6；POSTER 不重复渲染 |
| 集数轴 | **自绘** | 见 §3 |
| 差值文案 | `text.item-diff` | `--td-text-color-secondary`；`--td-font-size-body-small` |
| 加番 FAB | `t-fab` | `--td-brand-color` |

交互：点整卡 → P3 弹层；下拉刷新完成后更新当前 VM；远端变更游标走 §4 滑动动画非瞬移；加番 FAB → 底部加番面板（见 P2.5）；「移出番单」位于 P3 详情弹层底部，走软删除且使用弱化文案，不提供列表左滑入口。

---

### P2.5 加番面板 (`t-popup` 底部弹层)

点 P2 的「+番」FAB 弹出。推荐路径是进入弹弹play搜索页选择番剧，自动带回番名、封面、总集数并异步补拉放送信息；手动填写仍作为兜底，不做手动上传封面。

```
┌────────────────────────────────┐
│  添加番剧                           │
│  ┌──────────────────────────┐  │
│  │ 🔍 搜番剧，一键带出封面·集数  › │  │ ← 推荐路径
│  └──────────────────────────┘  │
│          或手动填写                 │
│  [ 输入番剧名称 ]                   │
│  总集数（选填）       [−] [12] [+] │
│  放送中的番可以先不填，看完再补       │
│  ┌──────────────────────────┐  │
│  │           添加               │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

- 搜索选中后，顶部入口切为封面预览 +「重选」，下方标题变为「确认信息（可修改）」；EventChannel 回带数据，不新增第二个表单页。
- `cover` 只保存外部 HTTPS URL，不落云存储；无图/坏图统一用番名首字 + `COVER_PALETTE` 色块兜底。
- 总集数可手动步进/输入；补拉放送信息最多等待 `AIR_META_WAIT_MS`，超时只提示，不阻塞添加。

| 元素 | 组件 | CSS 变量 |
|------|------|---------|
| 弹层 | `t-popup placement="bottom"` + 公共 `.sheet` | 顶角/底色走公共 sheet 规格 |
| 搜索入口 / 选中预览 | 原生 `view` + `t-icon` / `image` | 品牌浅底；坏图走首字色块 |
| 番名输入 | `t-input` | `--td-text-color-primary` |
| 总集数 | 自绘步进器 + `input type="number"` | 上下限走 `TOTAL_EP_MIN/MAX` |
| 添加按钮 | `t-button theme=primary block` | `--td-brand-color` |

交互与反馈：
- 番名**必填**，空则按钮禁用（`t-button disabled`）。
- 点「添加」→ 等待 `addItem` 云函数成功后关闭弹层并重拉列表；当前未做新增卡片乐观插入，失败用 `wx.showToast` 提示且保留弹层内容。
- **共享去重**：`addItem` 云函数查同板是否已有同名（复用现有个人版 `onAddAnime` 去重思路，扩到共享番单），已存在则 `wx.showToast`「这部番已经在单里啦」。
- 加完这部番默认「我加的、我的进度 E0/想看」，对方那侧显示「TA 还没翻牌」。

---

### P3 单番详情 / 进度编辑 (`t-popup` 弹层)

唯一允许「左右对峙」的地方（PRD §9.1：对峙式降级为单番详情展开态）。用户主动想看清「我 vs TA」细节比对，对抗感可控。

```
┌────────────────────────────────┐
│ ══════════                      │ ← t-popup 顶部拖动条
│         葬送的芙莉莲                 │
│         放送中 · 共 28 集            │ ← airStatus + totalEp（无则不显示集数）
│  ┌────────────┐  ┌─────────────┐  │
│  │    ┌──┐     │  │    ┌──┐     │  │ ← 左右对峙（仅此处允许）
│  │    │我│     │  │    │TA│     │  │
│  │    └──┘     │  │    └──┘     │  │
│  │   E8 / 28   │  │  E12 / 28   │  │
│  │   [在追]    │  │   [在追]    │  │
│  └────────────┘  └─────────────┘  │
│         └─ 相差 4 集 ─┘            │
│  ┌────────────────────────────┐  │
│  │       我看完这集  +1          │  │ ← 主手势按钮（大）
│  └────────────────────────────┘  │
│  当前集数  E8 ▾    状态  在追 ▾    │ ← 点数字弹 picker；点状态弹 action-sheet
│  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈  │
│  移出番单                           │ ← 弱化文字操作，轻确认后软删除
└────────────────────────────────┘
```

| 元素 | 组件 | CSS 变量 |
|------|------|---------|
| 弹层外壳 | `t-popup placement="bottom"` + 公共 `.sheet`（`sheet.wxss`） | 顶角圆角 32rpx；底 `--td-bg-color-container`；顶部拖动条 handle + 上投影分层 |
| 番名 | `text`（可点，旁 `t-icon edit-1`）→ 点击原地切 `t-input` 内联编辑 | `--td-text-color-primary`；`--td-font-size-title-large` |
| 副信息 | `text` | `--td-text-color-secondary` |
| 我/TA 两栏 | 自绘 `view.duel-col` ×2 | 底 `--td-bg-color-secondarycontainer`；圆角 `--td-radius-default` |
| 头像 | 自绘首字色块（`m-fallback big`，身份色 `--sb-color-me/peer`） | — |
| +1 主按钮 | `t-button theme=primary size=large block` | `--td-brand-color` |
| 集数选择（短番） | `t-picker` 滚轮，`totalEp ≤ EP_ROLL_MAX`(24) | 范围 `0..totalEp`（含 0 = 未开追，可回退纠错） |
| 集数选择（长番/无分母） | 独立 `.sheet` + `input type="number"` 直接输入 | 凡人 183、柯南上千不再卡上限；上限交云函数 `clampEp` 兜底 |
| 状态选择 | `t-action-sheet`（6 状态枚举） | — |
| 移出番单 | 原生弱化文字按钮 `.detail-remove` | `--td-text-color-placeholder`；轻确认后软删除 |

交互：
- **主手势 +1**：点击 → 乐观 UI 本地 `ep+1` 立即反映（PRD §10 冷启动应对），集数大字上跳且 `+1` 浮起；云函数 `updateProgress` 回来对账，失败用 `wx.showToast` 提示并重拉服务端权威值。
- **番名改名**：点番名/编辑图标 → 详情弹层内**原地**切成输入框（不再叠第二层弹窗），编辑态隐藏 +1/改集数/改状态操作区避免噪声；保存/取消回展示态。
- **改集数**：短番（有明确总集数且 ≤24）走滚轮可视化；长番/无分母走数字键盘直接输入。点「看到第几集」下钻前先收起详情，避免两层遮罩叠暗、两张白卡摞。
- 点状态 → `t-action-sheet` 六选一；选「弃番」给一次轻确认 `wx.showModal`（去批判感文案「先下车？随时能回来接着追」）。
- **下钻闭环**：集数/状态选择器关闭（confirm/cancel/点遮罩任一路径）后都弹回详情弹层。注意 `t-picker` 的 confirm/cancel **不发** `visible-change`（仅点遮罩发），需在 confirm/cancel 内自行恢复；`t-action-sheet` 三条路径均走 `_trigger` 发 `visible-change`，可统一交给它。两组件机制不同，不可套用同一假设。
- **只能改自己那栏**，TA 栏纯展示不可编辑（对应 §6 `progress.<myOpenid>` 私有写）。

---

### P4 配对建板流（P2 筹备态的演进）

```
① 刚建板 / 等待中                    ② 对方点邀请进入
┌────────────────────────┐          ┌────────────────────────┐
│  我        等 TA 加入  (?) │          │  我              TA    │
│ [追番小结]              │          │ [追番小结] [海报视图] │
│ 就等 TA 来一起追 [邀请 TA]│  分享链接 │ 一起追 / 还没开追…      │
│ 先把想追的番堆进来       │ ───────▶ │ 原筹备番单完整保留       │
│ 想看 / 在追…      [+番]  │          │                    [+番]│
└────────────────────────┘          └────────────────────────┘
```

| 元素 | 当前实现 | CSS 变量 / 动效 |
|------|---------|----------------|
| 筹备态提示 | 原生 `view.invite-banner` + `button open-type="share"`，不使用 `t-empty` | 容器/品牌色走 `--td-*` |
| 虚位头像 | 自绘 `.ghost-seat` | 边框 `--td-text-color-placeholder`；`breathing` 2s 循环 |
| 筹备番单 | 正常渲染列表/海报和加番 FAB；分区标题走 `SECTION_TITLES_SOLO` | 在追/想看/看完了/暂缓/弃番 |
| 加入瞬间 | `.member-joined` + `sbBounceIn` | 回弹 0.4s + `wx.vibrateShort` + 原生 toast |

交互：邀请按钮触发 `onShareAppMessage`，路径携带 `boardId + pairing.token`；对方打开后页面调用 `joinBoard`。原成员通过 `onShow` 重拉，页面在内存中检测 `waiting → paired` 时播放实体化反馈。等待态**不用 loading 转圈**；筹备态不是空壳，允许先加番和追进度。

---

## 3. 同轴集数轴详细规格（门面核心）

参考 worldcup `.prob-bar` 的多段 flex 填充**结构**，但语义不同——prob-bar 是「占比瓜分」，集数轴是「位置定位」。**只借鉴其多段填充结构，不套用其固定深色配色**（worldcup 用自有 `--gold` 等固定色，本功能走 TDesign 亮暗双变量）。

### 3.1 DOM 结构（自绘）

```html
<view class="axis">
  <view class="axis-track"></view>                                    <!-- 底轨（整条路） -->
  <view class="axis-common" style="width:{{commonPercent}}%"></view>  <!-- 0→较落后者：共同走过 -->
  <view class="axis-lead" style="left:{{minePercent}}%;width:{{leadWidth}}%"></view> <!-- 落后→领先：前沿 -->
  <view class="axis-cursor axis-cursor--mine" style="left:{{minePercent}}%"><t-avatar size="xs"/></view>
  <view class="axis-cursor axis-cursor--peer" style="left:{{peerPercent}}%"><t-avatar size="xs"/></view>
  <view wx:if="{{!hasTotalEp}}" class="axis-fade-right"></view>        <!-- 无分母右端渐隐 -->
</view>
```

### 3.2 两种形态

**形态 A · 有分母（已知 totalEp）**：轴是闭合区间 `[0, totalEp]`。游标 `minePercent = mineEp/totalEp*100`。共同走过段（0→min(我,TA)）用 `--td-brand-color-2`；前沿段（落后者→领先者）用 `--td-brand-color`。右端显示 `totalEp` 锚点。

**形态 B · 无分母（MVP 常态）**：轴无右边界，以「跑在最前的人」为动态锚点。领先者 ep 固定落 **~75%**（留右 25% 渐隐），落后者按 `laggerEp/maxEp*75%` 定位。右端 `mask-image` 渐隐暗示「未完待续」，左端可留 `……` 暗示路从更早延伸。锚点 75% 走配置 `AXIS_LEAD_ANCHOR`。

### 3.3 游标定位与重叠

- 游标绝对定位头像，`transform: translateX(-50%)` 中心对齐。
- **z-index 规则**：落后者游标 z-index 更高（压上层），确保落后方永远看得见自己，不被领先者头像盖住——「落后方不受冷落」的像素级落实。
- **追平重叠**：`|minePercent - peerPercent| < 阈值`（如 3%，走配置）时两头像合并为 `◉` 叠加态 + `--td-success-color` 光点，状态标签变「同步」。

### 3.4 差距过大断裂（PRD §9.2）

`|mineEp - peerEp| > BREAK_GAP`（配置，如 12）时：**不等比拉伸**（否则落后者被挤极左像被抛弃），轴中段画断裂波浪 `∿`（`repeating-linear-gradient` 斜纹 + 两侧收窄），两侧各自局部居中，文案「相差 22 集」用 `--td-text-color-secondary` 承担精确信息。

### 3.5 远端进度更新滑动动画（PRD §9.2）

`onShow`/下拉刷新重建 VM 后，LIST 游标通过 `left 0.3s cubic-bezier(0.175,0.885,0.32,1.275)` 过渡到新位置。当前没有比较新旧位置来生成拖影，也不会因远端跨越追平点补播本人的追平庆祝；这保持“被超静默”，并避免页面重进后重复制造里程碑。

### 3.6 样式骨架（引用真实变量）

```css
.axis { position: relative; height: 56rpx; margin: var(--td-spacer) 0; }
.axis-track {
  position: absolute; left: 0; right: 0; top: 50%; height: 8rpx;
  transform: translateY(-50%);
  background: var(--td-bg-color-component); border-radius: var(--td-radius-round);
}
.axis-common { /* 共同走过：低饱和品牌色 */
  position: absolute; left: 0; top: 50%; height: 8rpx; transform: translateY(-50%);
  background: var(--td-brand-color-2); border-radius: var(--td-radius-round);
}
.axis-lead { /* 前沿段：品牌色 */
  position: absolute; top: 50%; height: 8rpx; transform: translateY(-50%);
  background: var(--td-brand-color); border-radius: var(--td-radius-round);
}
.axis-cursor {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  transition: left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); /* §3.5 */
}
.axis-cursor--mine { z-index: 3; }
.axis-cursor--peer { z-index: 2; }  /* 落后者动态提到 z-index:4，见 §3.3 */
.axis-fade-right {
  position: absolute; right: 0; top: 0; bottom: 0; width: 25%;
  -webkit-mask-image: linear-gradient(90deg, #000 0%, transparent 100%);
  background: var(--td-bg-color-container);
}
```

---

## 4. 动效规格（当前实现）

动效名、触发条件和时长以 `shared-board.wxss` / `shared-board.js` 为准；不再引用个人番单页的旧动画名。系统开启“减少动态”时，保留数值和最终状态，关闭非必要位移、缩放、旋转与脉冲；`+1` 浮字直接隐藏，避免停止动画后滞留。

| 场景 | 当前 @keyframes / transition | 时长 | vibrate | 说明 |
|------|-----------------------------|------|---------|------|
| **追平瞬间** | `sbSyncGlow` | 0.5s | ✅ | 本人主动更新后首次追平：LIST/POSTER 当前卡片微缩并闪一次成功绿辉光；同一用户/条目用本机 Storage 防重放 |
| **追平常驻态** | `sbMergedPulse` | 1.6s 循环 | — | LIST 两游标合并为成功绿 `◉`；海报视图不额外叠徽章，保持密度 |
| **+1 即时反馈** | `epBumpKf` + `epPlusFlyKf` | 0.5s / 0.7s | — | P3 集数大字上跳，`+1` 浮起淡出；数值先走乐观 UI，失败重拉权威值 |
| **对方加入** | `sbBounceIn` | 0.4s | ✅ | 页面检测到 waiting→paired 时，虚位头像实体化并提示“TA 来了” |
| **共同话题增加** | `commonTalkFlashKf` | 0.35s | — | `commonCount` 增大时短暂滑入，3.5s 后收起；首次进入不弹 |
| **TA 更新提示** | `peerUpdateInKf` | 0.35s | — | 进板首次结算对方未读进度后滑入，点正文下钻历史，点关闭仅收起 |
| **视图切换** | `sbItemViewIn` | 0.2s | — | LIST/POSTER 只渲染当前分支，切换时轻淡入 |
| **远端进度更新** | 游标 `left` transition | 0.3s | — | `onShow`/下拉刷新重建 VM 后，LIST 游标按回弹曲线滑到新位置 |

**关键：被超静默**——当前没有反超拖影、背景闪、徽章翻转或催更摇摆；这些早期设想不应写成已实现行为。追平只奖励主动更新者，不给落后方视觉惩罚。

---

## 5. 全部状态与边界的视觉

| 状态 | 呈现 | 组件 / 变量 |
|------|------|-----------|
| **空板（刚建）** | 成员条虚位 + 筹备态邀请横幅；番单区提示「先把想追的番加进来」，仍可先加番/追进度 | 原生 `view/button open-type=share` + `t-fab` |
| **等待对方加入** | 虚位头像**呼吸动效**（非转圈）+「就等 TA 来一起追」邀请横幅 | 自绘 `breathing` + `--td-text-color-placeholder` |
| **对方没设进度** | **不画 TA 的 0 游标**，LIST 显示「TA 还没翻牌」，海报进度轨右端同样弱化显示 | `--td-text-color-placeholder` 拟人文案 |
| **对方弃番** | 中性灰游标停在下车集数，摘要显示「TA 已下车（第 N 话）」；当前不提供催更入口 | `--td-text-color-placeholder`（非 error 红） |
| **总集数未知** | 形态 B 相对轴 + 右端渐隐，**不硬造分母不显百分比** | §3.2 形态 B |
| **两人都看完** | 双游标合并为 ◉；分区只看我的状态，归「追完了 🎉」。本人主动更新首次追平时触发一次 `sbSyncGlow` | `--td-success-color` / `--sb-success-glow` |
| **加载中** | 与真实列表卡结构对应的自绘骨架屏，**不用全屏转圈** | `.sb-skeleton` + `skeleton-shimmer` |
| **拉取失败** | 结束 loading 并 `wx.showToast`「加载失败」；当前无离线缓存或页面内重试卡 | 原生 toast |
| **下拉刷新** | 原生下拉，重拉完成后停止刷新；不额外弹「已是最新」toast | `onPullDownRefresh` |
| **进度更新中（乐观 UI）** | 本地立即 +1，云函数未回时**不显 loading**；失败 toast 后 `_load()` 拉服务端权威值还原 | PRD §10 |
| **板已归档** | 顶部 `t-notice-bar`「这个板已归档，只能查看」，隐藏加番 FAB；报告、历史和两种只读视图仍可用 | `t-notice-bar theme=warning` |

---

## 6. 亮/暗双模式配色表

| 语义 | 变量 | 备注 |
|------|------|------|
| 页面底 | `--td-bg-color-page` | |
| 卡片底 | `--td-bg-color-container` | |
| 次级容器（弹层栏） | `--td-bg-color-secondarycontainer` | P3 对峙栏 |
| 轴底轨（未走） | `--td-bg-color-component` | |
| 前沿段/领先前锋 | `--td-brand-color` | 暗色更亮，对比 OK |
| 共同走过/落后侧的路 | `--td-brand-color-2` | ⚠️ 暗模式对比度洞，见下 |
| 追平/看完成就 | `--td-success-color` | **仅里程碑，不常驻** |
| 主文字 | `--td-text-color-primary` | |
| 差值/辅助文字 | `--td-text-color-secondary` | |
| 中性态（弃番/未设） | `--td-text-color-placeholder` | 弃番用这个，非红 |
| 状态标签·在追 | `t-tag theme=primary variant=light` | |
| 状态标签·追平待更 | `t-tag theme=primary variant=light` | 仍属于进行中主态；success 绿只留给追平里程碑 |
| 状态标签·暂缓 | `t-tag theme=warning variant=light` | 暂停语义用暖色提醒 |
| 状态标签·想看/弃番 | `t-tag theme=default variant=light` | 未开始/下车均弱化，不用红色惩罚 |
| 未读红点 | `t-badge`（`--td-error-color`） | 红=未读通用语义，非落后惩罚 |
| ~~落后~~ | ~~`--td-error-color`~~ | **全局禁用于进度表达** |

**暗模式必须注意的对比度洞：**

1. **`--td-brand-color-2` 暗模式≈深蓝 `#173463`，与暗底对比极低**——「共同走过段」和「落后侧的路」几乎糊在一起。应对：暗模式改用 `--td-brand-color-3` 甚至 `-4` 提亮，或加 1rpx `--td-brand-color` 描边，真机暗模式实测后定档。
2. **追平辉光已集中为 `--sb-success-glow`**：亮色与暗色分别在 `page` / 暗色媒体查询中定义，`sbSyncGlow` 与 `sbMergedPulse` 共用；禁止在新动画里另写一套 `rgba(...)`，否则亮暗模式会再次漂移。
3. **`--td-shadow-4` 暗模式缺失**（app.wxss 仅 light 段定义）。板卡阴影统一用 `--td-shadow-1`（亮暗都有），避免用 `-4`。

---

## 7. 数据与交互落地状态

早期交叉检查发现的数据缺口已经逐项收口；以下以当前代码为准，避免把历史“待拍板”继续当成未完成需求。

| 能力 | 当前状态 | 实现口径 |
|------|---------|---------|
| 板列表未读红点 | ✅ 已实现 | `lastViewedAt.<openid>` + `markViewed`；`listMyBoards` 比较 `board.updateTime` 产出 `hasUnread` |
| 板内「TA 更新了」 | ✅ 已实现 | 进板首次基于上次查看时间派生摘要，正文下钻改动历史 |
| 软删除 | ✅ 已实现 | `deleted/deletedBy/deletedAt`；P3 低调“移出番单”，不提供列表左滑 |
| 个性化排序结构 | ✅ 数据结构已定 | `sortOrder.<openid>` 各存各的；当前尚无拖拽排序 UI |
| 追平防重放 | ✅ 已实现 | 本机 `sb_milestone_sync_<itemId>_<openid>`，不占服务端字段 |
| 共同话题数 | ✅ 已实现 | `transform.js` 派生 `commonCount`，数量增加时短暂提示 |
| 昵称设置 | ✅ 已实现 | `updateMemberProfile` 只更新自己；当前主动设置，不做微信资料自动同步 |
| 退出 / 解散 / 归档操作 | ❌ 明确不做 | 数据层不新增 `leaveBoard` / `dissolveBoard`；现有归档态仅兼容历史/预留数据的只读展示 |
| 催更 / 被戳 | ⏳ 未来项 | 当前没有入口、红点或事件集合；若重启需求，再评估独立 `shared_board_nudges` |

## 8. 剩余边界与技术债

1. `getBoardDetail` 当前固定 `.limit(200)`，超过 200 条会静默截断；海报视图只改善扫描密度，**没有**解决数据完整性或超长列表渲染问题。
2. 拖拽排序 UI 尚未实现，虽然 `sortOrder.<openid>` 数据结构已就位；本轮不顺带加排序。
3. 催更和按集短评仍是未来产品项，不得在当前 UI 文档中写成已有入口或灰置占位。
4. 无分母领先锚点 `AXIS_LEAD_ANCHOR=75`、断裂阈值 `BREAK_GAP=12`、追平重叠阈值 `OVERLAP_PCT=3` 均集中在配置层；需要调整时只改权威配置并同步云函数副本。

---

## 附：落地文件与约束对齐

- P1/P2 页面均已落在 `packageFeatures/pages/shared-board/` 分包：`board-list` 与 `shared-board` 独立，亮/暗双模式。
- 集数轴分组/差值/百分比和五分区全部走纯函数 `transform.js`，页面只做渲染与副作用；LIST/POSTER 共用同一 `vm.sections`。
- 规则阈值、视图枚举、目标态文案和海报 copy 进权威 `config.js`；尺寸/动效参数集中为 `--sb-*`，配色优先走 TDesign 变量。云函数报告目录保留逐字配置副本，由测试守卫漂移。
- `shared-board.json` 只注册当前实际消费的 TDesign 组件；本轮没有新增依赖或 npm 配置，不需要重新构建 npm。
- P2 列表/海报双视图已通过真机视觉验收；后续若改 WXML 条件链，必须保持 `wx:if` 与 `wx:else` 紧邻，避免旧基础库 `FLOW_DEPTH`。





