# 共享追番板 UI 设计规格 (shared-board-ui)

> 状态：设计规格（可落地实现）· 版本 v0.1 · 基于 PRD `docs/shared-board.md` v0.1
> 定位一句话：**不是进度赛跑，是「我俩现在能安全聊到第几集」。所有像素服从「陪伴，不是排名」。**

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
      │ · 同轴双头像列表   │  │ ① 空板 t-empty    │       │
      │ · 下拉刷新         │  │ ② 分享卡片        │───────┘
      │ · [+ 加番]         │  │ ③ 等待呼吸头像    │
      └───┬────────┬───┘  │ ④ TA 来了 bounceIn │
      点某番│        │加番   └────────────────┘
           ▼        ▼
   ┌────────────┐  ┌──────────────┐
   │ P3 单番详情    │  │ 加番 t-popup    │
   │ (t-popup 弹层) │  │ (输入番名)      │
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

```
┌────────────────────────────────┐
│  共享追番板                          │ ← 系统导航栏（非 custom）
├────────────────────────────────┤
│  ┌────────────────────────────┐   │
│  │ 🔴 我俩的番单                │   │ ← 板卡片（未读红点在左上）
│  │ ┌──┐┌──┐   12 部番           │   │
│  │ │头││头│   3 部能一起聊       │   │ ← 双头像 avatar-group + 摘要
│  │ └──┘└──┘   小王 · 2 天前活跃  │   │
│  └────────────────────────────┘   │
│  ┌────────────────────────────┐   │
│  │ 和阿宅的补番坑               │   │ ← 无红点
│  │ ┌──┐┌··┐   5 部番            │   │ ← 右头像虚线=对方未加入
│  │ │头││? │   等 TA 点开链接     │   │
│  │ └──┘└··┘                    │   │
│  └────────────────────────────┘   │
│  ┌────────────────────────────┐   │
│  │ 📁 和前任的番单（已归档）     │   │ ← 归档态，整卡降调
│  └────────────────────────────┘   │
│                          ╭─────╮  │
│                          │  +  │  │ ← t-fab 建板入口
│                          ╰─────╯  │
└────────────────────────────────┘
```

**空态（一个板都没有）：** `t-empty` +「还没有共享的番单，和 TA 开一个，一起追番吧」+ `t-button`「建第一个板」。

元素与组件映射：

| 元素 | 组件 / 自绘 | CSS 变量 |
|------|-----------|---------|
| 页面底 | `page` | `--td-bg-color-page` |
| 板卡片容器 | 自绘 `view.board-card` | 底 `--td-bg-color-container`；圆角 `--td-radius-large`；阴影 `--td-shadow-1`；内距 `--td-spacer-2` |
| 双头像 | `t-avatar-group` + 两 `t-avatar`(small, 轻叠) | 边框 `--td-bg-color-container` 描边分隔 |
| 对方未加入虚位头像 | 自绘 `view.avatar-ghost`（虚线圆 + `?`） | 边框/文字 `--td-text-color-placeholder` |
| 板名 | `text.board-name` | `--td-text-color-primary`；`--td-font-size-title-medium`；`font-weight:600` |
| 番数/摘要 | `text.board-meta` | `--td-text-color-secondary`；`--td-font-size-body-small` |
| 「N 部能一起聊」 | `text.board-common` | `--td-brand-color`（核心价值提示，品牌色强调） |
| 未读红点 | `t-badge dot` | `--td-error-color`（红点=通用未读语义，非落后惩罚，允许用红） |
| 归档卡 | `view.board-card--archived` | `--td-text-color-placeholder` + 去阴影 + 📁 前缀 |
| 建板 FAB | `t-fab`(icon add) | `--td-brand-color` |

交互：点板卡 `navigateTo` 进 P2 带 `boardId`；归档板可点进（只读）；整页下拉刷新重拉板列表；**无显眼删除入口**（退出/解散是 P2 内低调二级操作，PRD §5.4）。

---

### P2 单个板页 · 核心门面 (`shared-board`)

全功能门面，打磨优先级最高。列表用紧凑版同轴集数轴。

```
┌────────────────────────────────┐
│ ← 我俩的番单              ⟳  ⋯     │ ← 导航栏（⋯=板设置/退出）
├────────────────────────────────┤
│ ┌──┐ 小高    ┌──┐ 小王             │ ← 成员条（头像+昵称，等价不对峙）
│ └──┘         └──┘   3 部能一起聊 → │ ← 点「能一起聊」滚到共同看过区
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
│ TA 还没开追                         │ ← 分区
│ ┌────────────────────────────┐   │
│ │ 迷宫饭              [想看]     │   │
│ │ ●·············               │   │ ← 只有我的游标
│ │ 我 E3 · TA 还没翻牌           │   │
│ └────────────────────────────┘   │
│ 一起追完了 🎉                       │ ← 归档分区
│ ┌────────────────────────────┐   │
│ │ 别当欧尼酱了         [看完]    │   │
│ │ ━━━━━━◉ 都看完             │   │
│ └────────────────────────────┘   │
│                          ╭─────╮  │
│                          │ +番 │  │ ← t-fab 加番
│                          ╰─────╯  │
└────────────────────────────────┘
```

分区规则（客户端 `transform.js` 分组，顺序走配置不硬编码）：**一起追**（至少一人 watching/caught_up，置顶）→ **TA/我还没开追**（一方 want 或无进度）→ **暂缓/下车了**（paused/dropped，中性不置底羞辱）→ **一起追完了**（都 done，带 🎉 归档底部）。

元素与组件映射：

| 元素 | 组件 / 自绘 | CSS 变量 |
|------|-----------|---------|
| 成员条 | 自绘 `view.member-bar`（两 avatar + 昵称） | 底 `--td-bg-color-container`；内距 `--td-spacer` |
| 「N 部能一起聊」 | `text` 可点 | `--td-brand-color` |
| 分区标题 | `text.section-title`（复用 anime-checklist 风格） | `--td-text-color-placeholder`；`--td-font-size-body-small` |
| 番卡片 | 自绘 `view.item-card` | 底 `--td-bg-color-container`；圆角 `--td-radius-large`；内距 `--td-spacer-2` |
| 番名 | `text.item-name` | `--td-text-color-primary`；30rpx |
| 状态标签 | `t-tag`(variant 随状态) | 见 §6 |
| 集数轴 | **自绘** | 见 §3 |
| 差值文案 | `text.item-diff` | `--td-text-color-secondary`；`--td-font-size-body-small` |
| 加番 FAB | `t-fab` | `--td-brand-color` |

交互：点整卡 → P3 弹层；下拉刷新配 `t-toast`「已是最新」，远端变更游标走 §4 滑动动画非瞬移；加番 FAB → 底部加番面板（见 P2.5）；左滑番卡 `t-swipe-cell` →「移出番单」（软删除，文案软，不是「删除」）。

---

### P2.5 加番面板 (`t-popup` 底部弹层)

点 P2 的「+番」FAB 弹出。MVP 手动输番名 + 首字色块占位封面（无手动上传）。

```
┌────────────────────────────────┐
│  添加番剧                    ✕    │
│  ┌──────────────────────────┐  │
│  │ 输入番剧名称…                │  │ ← t-input（必填，autofocus）
│  └──────────────────────────┘  │
│  ┌────┐                          │
│  │ 芙 │  预览：首字 + 主题色块      │ ← 输名字时实时预览占位封面
│  └────┘                          │
│  ┌──────────────────────────┐  │
│  │           添加               │  │ ← t-button theme=primary block
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

**封面策略（决策 2026-07-22）：MVP 用「番名首字 + 主题色块」占位，不做手动上传。**
- 理由：① PRD §10 明确「封面优先外链不落云存储」——云存储下载流量吃免费额度最快；② 真实用户抱怨「加番要填一堆信息就懒得加」，手动选图/裁剪/上传是逆需求重活；③ 封面是标准公共资源，将来接 Bangumi（PRD Could）时封面 URL 自动带回，手动上传是为会被自动化取代的操作投工。
- 占位实现：`cover` 字段留空时，番卡/预览用自绘 `view.cover-placeholder`——取番名首字 + 按番名 hash 到一组**主题色**（走配置 `COVER_PALETTE`，不硬编码；从 TDesign 品牌色阶派生，亮暗自适应）。类似很多 App 的默认头像。
- 数据层无需为此加字段：`shared_board_items.cover` 已存在（可空），将来接 Bangumi 直接填 URL 即可，占位逻辑是纯客户端渲染兜底。

| 元素 | 组件 | CSS 变量 |
|------|------|---------|
| 弹层 | `t-popup placement="bottom"` | 圆角顶 `--td-radius-extra-large`；底 `--td-bg-color-container` |
| 番名输入 | `t-input`（`maxlength` 走配置，autofocus） | `--td-text-color-primary` |
| 占位封面预览 | 自绘 `view.cover-placeholder` | 底色取自 `COVER_PALETTE`（配置）；首字 `--td-text-color-anti` |
| 添加按钮 | `t-button theme=primary block` | `--td-brand-color` |

交互与反馈：
- 番名**必填**，空则按钮禁用（`t-button disabled`）。
- 点「添加」→ **乐观 UI**：卡片立即从列表顶部 `enterFromTop` 滑入（§4），云函数 `addItem` 落库；失败 `t-toast` + 回滚。
- **共享去重**：`addItem` 云函数查同板是否已有同名（复用现有个人版 `onAddAnime` 去重思路，扩到共享番单），已存在则 `t-toast`「这部番已经在单里啦」。
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
│  短评（追平后解锁）  🔒            │ ← Should 项，MVP 只留占位不展开
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
| 短评占位 | `t-cell` disabled + `t-icon lock-on` | `--td-text-color-placeholder`（MVP 灰置不可点） |

交互：
- **主手势 +1**：点击 → 乐观 UI 本地 `ep+1` 立即反映（PRD §10 冷启动应对），我的游标回弹滑动，云函数 `updateProgress` 回来对账，失败 `t-toast` 报错并回滚。
- **番名改名**：点番名/编辑图标 → 详情弹层内**原地**切成输入框（不再叠第二层弹窗），编辑态隐藏 +1/改集数/改状态操作区避免噪声；保存/取消回展示态。
- **改集数**：短番（有明确总集数且 ≤24）走滚轮可视化；长番/无分母走数字键盘直接输入。点「看到第几集」下钻前先收起详情，避免两层遮罩叠暗、两张白卡摞。
- 点状态 → `t-action-sheet` 六选一；选「弃番」给一次轻确认 `wx.showModal`（去批判感文案「先下车？随时能回来接着追」）。
- **下钻闭环**：集数/状态选择器关闭（confirm/cancel/点遮罩任一路径）后都弹回详情弹层。注意 `t-picker` 的 confirm/cancel **不发** `visible-change`（仅点遮罩发），需在 confirm/cancel 内自行恢复；`t-action-sheet` 三条路径均走 `_trigger` 发 `visible-change`，可统一交给它。两组件机制不同，不可套用同一假设。
- **只能改自己那栏**，TA 栏纯展示不可编辑（对应 §6 `progress.<myOpenid>` 私有写）。

---

### P4 配对建板流（P2 空板态的演进）

```
① 刚建板（我一个人）              ② 已发出邀请，等待中
┌──────────────────────┐    ┌──────────────────────┐
│  我俩的番单            │    │  我俩的番单            │
├──────────────────────┤    ├──────────────────────┤
│     ( t-empty )      │    │   ┌──┐      ┌ ─ ┐     │
│  番单建好了，就差 TA 了│    │   │我│      · ? ·    │ ← 虚位头像呼吸
│  [ 邀请 TA 加入 ]     │    │   └──┘      └ ─ ┘     │
│   ↑ open-type=share  │    │  链接已发出，等 TA 点开  │
└──────────────────────┘    └──────────────────────┘
③ 对方加入的瞬间：虚位实体化 bounceIn + t-message「TA 来了 🎬」+ vibrate
```

| 元素 | 组件 | CSS 变量 / 动效 |
|------|------|---------------|
| 空板提示 | `t-empty` | `--td-text-color-secondary` |
| 邀请按钮 | `t-button open-type="share"`（PRD §8.1 吃社交链） | `--td-brand-color` |
| 虚位头像 | 自绘 `view.avatar-ghost--breathing` | 边框 `--td-text-color-placeholder`；呼吸见 §4 |
| 加入瞬间 | 复用 `bounceIn` | `cubic-bezier(0.175,0.885,0.32,1.275)` 0.4s |
| 「TA 来了」 | `t-message theme=success` | + `wx.vibrateShort` |

交互：邀请按钮 `open-type="share"`，`onShareAppMessage` 返回 `path` 带 `boardId`；等待态**不用 loading 转圈**（呼吸=在等人，转圈=系统在忙，语义不同）；对方加入检测靠 `onShow` 重拉，发现 `members.length` 从 1 变 2 触发实体化动效。

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

**TA 进度变了游标要「滑过去」，不能瞬移**：`onShow`/下拉刷新拉到新数据后对比旧 `peerPercent`，游标 `left` 加 `transition: left 0.3s cubic-bezier(0.175,0.885,0.32,1.275)`（复用回弹曲线），头像滑动时后拖一条 `--td-brand-color` 半透明拖影（`::after`，opacity 0.3s 衰减）。若跨越追平点，滑动结束接 §4 追平动效。

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

## 4. 动效规格（复用现有动画基因）

全部复用 `anime-checklist.wxss` 已有 `@keyframes`，不新造轮子（PRD §9.3）。

| 场景 | 复用 @keyframes | 时长 | 曲线 | vibrate | 说明 |
|------|----------------|------|------|---------|------|
| **追平瞬间** | `itemGlow`+`cardFlash` | 0.4s | ease | ✅ | 两游标滑向中点→撞上→卡片发光+背景闪+「同步啦」徽章+标签翻「追平!」 |
| **反超瞬间** | 游标 transition + 拖影 | 0.3s | 回弹 | 可选 | 自己游标超 TA 时拖品牌色拖影；**TA 游标无任何负面动效** |
| **对方加入** | `bounceIn` | 0.4s | 回弹 | ✅ | 虚位头像→实体化 |
| **催更·发起方** | — | — | — | ✅ 轻震 | `t-toast`「戳了一下 TA」 |
| **催更·接收方** | `bounceOut` | 0.35s | `cubic-bezier(0.68,-0.55,0.265,1.55)` | 可选 | 进板被戳番卡左右摇摆 + `t-badge` 红点 |
| **两人都看完** | `itemGlow`(一次) | 0.4s | ease | ✅ | 双头像重叠终点 ◉ + 🎉 归档 |
| **远端进度更新** | 游标 transition | 0.3s | 回弹 | — | §3.5 |
| **卡片进入列表** | `enterFromTop` | 0.4s | 回弹 | — | 新加番从上滑入 |

**关键：反超与被超的不对称**——前进永远有奖励动效，被超永远静默，绝不给落后方视觉打击。这是「陪伴不排名」在动效层的落实。

---

## 5. 全部状态与边界的视觉

| 状态 | 呈现 | 组件 / 变量 |
|------|------|-----------|
| **空板（刚建）** | `t-empty`「番单建好了，就差 TA 了」+ [邀请 TA] | `t-empty` + `t-button open-type=share` |
| **等待对方加入** | 虚位头像**呼吸动效**（非转圈）+「链接已发出，等 TA 点开」 | 自绘 breathing + `--td-text-color-placeholder` |
| **对方没设进度** | **不画 0/0 空进度条**，显示「TA 还没翻牌」，轴上只有我一个游标 | `--td-text-color-secondary` 拟人文案 |
| **对方弃番** | 中性灰游标停在下车集数 + 小旗标「TA 在 E6 下车了」，**不消失不变红**，留 [戳 TA 回来] | `--td-text-color-placeholder`（非 error 红） |
| **总集数未知** | 形态 B 相对轴 + 右端渐隐，**不硬造分母不显百分比** | §3.2 形态 B |
| **两人都看完** | 双头像重叠终点 ◉ + 🎉 + `itemGlow` 一次，归「一起追完了」 | `--td-success-color` |
| **加载中** | `t-skeleton` 骨架屏，**不用全屏转圈** | `t-skeleton theme=paragraph` |
| **断网/拉取失败** | `t-result` + [重试]；已缓存数据先渲染，角标提示「未连接，显示上次数据」 | `t-result` + `t-notice-bar` |
| **下拉刷新** | 原生下拉，完成 `t-toast`「已是最新」，有更新则游标滑动 | 原生 + `t-toast` |
| **进度更新中（乐观 UI）** | 本地立即 +1 游标先滑，云函数未回时**不显 loading**，失败才 `t-toast` 回滚 | PRD §10 |
| **催更冷却中** | 催更按钮置灰 +「等等，别催太急」（冷却走配置） | `t-button disabled` + `--td-text-color-disabled` |
| **板已归档** | 全板只读，顶部 `t-notice-bar`「这个板已归档」，隐藏所有编辑入口，**不满屏共同回忆**（PRD §5.4 生死线） | `t-notice-bar theme=warning` |

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
| 状态标签·追平待更 | `t-tag theme=success variant=light` | 里程碑感 |
| 状态标签·暂缓/弃番 | `t-tag theme=default variant=light` | 中性 |
| 未读红点 | `t-badge`（`--td-error-color`） | 红=未读通用语义，非落后惩罚 |
| ~~落后~~ | ~~`--td-error-color`~~ | **全局禁用于进度表达** |

**暗模式必须注意的对比度洞：**

1. **`--td-brand-color-2` 暗模式≈深蓝 `#173463`，与暗底对比极低**——「共同走过段」和「落后侧的路」几乎糊在一起。应对：暗模式改用 `--td-brand-color-3` 甚至 `-4` 提亮，或加 1rpx `--td-brand-color` 描边，真机暗模式实测后定档。
2. **`itemGlow`/`cardFlash` 里 `rgba(0,82,217,0.x)` 是写死值**（anime-checklist.wxss），暗模式辉光偏暗。**踩项目禁止硬编码铁律，复用时必须抽变量** `--sb-glow-color`（亮 `rgba(0,82,217,0.2)`、暗 `rgba(69,130,230,0.35)`），不能直接照搬。
3. **`--td-shadow-4` 暗模式缺失**（app.wxss 仅 light 段定义）。板卡阴影统一用 `--td-shadow-1`（亮暗都有），避免用 `-4`。

---

## 7. ★ 交叉检查：UI 需要但 PRD §6 数据模型缺失的字段

这是给下一阶段数据层设计的直接输入。对照 PRD §6.2 的 schema，以下字段 UI 要用但模型里没有：

| # | UI 需求 | 需要的字段 | 建议归属 | 严重度 |
|---|--------|-----------|---------|--------|
| 1 | 板列表红点/板内未读 | 每成员「上次查看时间」`lastViewedAt.<openid>` | `shared_boards` | 🔴 必需 |
| 2 | 催更红点 + 「被戳」动效 | 催更记录 `{from,to,itemId,createTime}` | 新增子集合 `shared_board_nudges` 或 item 内嵌 | 🔴 必需 |
| 3 | 催更冷却（PRD §5.3，4h/次） | 上次催更时间戳 `lastNudgeAt.<from>.<itemId>` | 随 #2 | 🔴 必需 |
| 4 | 软删除/一键恢复（PRD §8.2） | `deleted` + `deletedBy` + `deletedAt` | `shared_board_items` 顶层 | 🔴 必需（**schema 与云函数不一致**） |
| 5 | 排序各存各的（PRD §8.2） | 每人排序 `sortOrder.<openid>` | ⚠️ §6 现为共享单值，**直接矛盾** | 🟠 需拍板 |
| 6 | 追平/看完动效只放一次 | 里程碑已庆祝标记 `milestoneShown.<openid>.*` | item 内嵌 或客户端本地 | 🟡 建议 |
| 7 | 板列表「最近活跃」摘要 | 板级 `lastActiveAt` | `shared_boards`（`updateTime` 语义需确认含进度更新） | 🟡 建议 |
| 8 | 「N 部能一起聊」计数 | 无需新字段，`transform.js` 派生 | 派生 | 🟢 派生 |
| 9 | 头像/昵称随微信改名更新 | `members[].nickname/avatar` 是加入时快照，会过时 | 需 onShow 更新自己快照 | 🟡 需拍板 |
| 10 | 退出/归档态（PRD §5.4） | `archivedBy`/`archivedAt`（`status:archived` 已有） | `shared_boards` 顶层 | 🟡 建议 |

### 7.1 两条必须回传的硬冲突（PRD 内部自相矛盾）

- **冲突 A（#5）**：§6.2 把 `sortOrder` 设计成**共享顶层单值** `sortOrder: 1000`，但 §8.2 白纸黑字「排序各存各的，从根上消灭排序冲突」。二者不能同时成立。UI 采信 §8.2，则 schema 须改为 `sortOrder: { <openid>: number }`。
- **冲突 B（#4）**：§6.2 的 `shared_board_items` 无任何软删除字段，但 §7.4/§8.2 都要求「软删除 + 一键恢复」。schema 必须补 `deleted/deletedBy/deletedAt`。

---

## 8. 需要产品/开发拍板的开放点

| # | 问题 | 推荐 |
|---|------|------|
| 1 | 排序共享 vs 各存各的（冲突 A） | **各存各的** `sortOrder.<openid>`，符合 §8.2，避免「我拖顺序 TA 也变」 |
| 2 | 催更数据内嵌 vs 独立子集合 | **独立子集合** `shared_board_nudges`，催更是带冷却/已读的事件流，塞 item 会膨胀 |
| 3 | 未读红点粒度 | **板级红点**（P1）由「有变更 > 我的 lastViewedAt」决定；**番级被戳**（P2）由 nudges 未读决定，两套分开 |
| 4 | 里程碑防重放存服务端 vs 本地 | **本地** `wx.setStorageSync`，是「这台设备这个人第一次看到」的体验，不占服务端字段 |
| 5 | 头像昵称过时 | **onShow 若本地快照与 members 不一致，静默更新自己那条** |
| 6 | 无分母领先者锚点 75% vs 66% | **75%**（留 25% 渐隐），走配置 `AXIS_LEAD_ANCHOR`，真机两版对比再定 |
| 7 | 断裂/追平阈值取值 | 初始 `BREAK_GAP=12`、追平重叠 `3%`、精确/模糊分界 `N=5`，全进 `config.js` 真实数据再调 |

---

## 附：落地文件与约束对齐

- 页面落 `packageFeatures/pages/shared-board/`（分包，PRD §7.5），亮/暗双模式。
- P1 板列表倾向独立页 `packageFeatures/pages/board-list/`（比作为 shared-board 的 mode 更清晰，待定）。
- 集数轴分组/差值/百分比计算全部走纯函数 `transform.js`（`buildProgressPair`），可 Node 测试，页面只做渲染与副作用（对齐 PRD §7.5 与 mahjong/worldcup 可测约定）。
- **所有阈值/锚点/冷却/配色分档进 `config.js` 或走 TDesign 变量**，本文出现的每个 3%/75%/12/4h、以及占位封面色板 `COVER_PALETTE`、番名 `maxlength` 都是配置项，不得写死（项目铁律）。
- 本文用到的 TDesign 组件（avatar/avatar-group/badge/button/empty/fab/popup/picker/action-sheet/tag/skeleton/result/notice-bar/swipe-cell/toast/message/dialog/cell）**均已在 `miniprogram_npm` 构建可用，不新增 npm 包，无需重新构建 npm**（PRD §7.1）。

---

**交付说明**：最高优先级是 P2 单个板页 + §3 同轴集数轴（门面核心）。§7 字段清单需在数据层动工前先确认 §8 的开放点，尤其冲突 A/B。





