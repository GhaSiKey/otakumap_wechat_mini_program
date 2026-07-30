# 共享追番板 × 弹弹play 数据绑定 —— 集成方案

> 状态：代码已实现，待用户部署云函数 + 真机验证（2026-07-27）
> 前置：弹play API 接入已完成（`animeMeta` 云函数 + 独立搜索/详情验收页，commit fbaf3db）
> 本文档描述如何把「弹play 番剧数据」接入共享追番板的加番与卡片流程。
>
> **实现与原方案的两处偏离**（均用户 2026-07-27 拍板，见 §4.3/§5）：
> ① 搜索选择由「走详情页确认（方案 B）」改为**列表直选**；
> ② 回带字段不含 `airStatus`（列表直选拿不到 isOnAir）。
> 另修复了一个**文档此前漏记的既有 bug**：卡片封面从未渲染真图 `it.cover`，只渲染首字色块——本轮补 `<image>` + binderror 回退（见 §4.4）。

## 0. 定位与边界

- **只借数据，不改共享板的魂**。共享板核心是「我俩追到第几集」，弹play 只负责把封面/集数/放送状态自动带进来，省去手填。
- **来源无关不变**：加番仍以手动 `name` 为主链路，搜不到就手填。弹play 是「可选的自动填充」，不是必经。
- **弹play 覆盖边界**（实测）：日系 ACG + 华语动画 + 日本影视覆盖好；欧美原生影视动画基本没有。搜不到属正常，手填兜底。

## 1. 已定决策（用户 2026-07-27 拍板）

| 决策 | 结论 |
|---|---|
| 自动刷新 | ❌ 不做。加番时抓一次，后续手动改 |
| 覆盖策略 | **只填空字段**：弹play 数据只填 item 现值为空的字段，用户手改过的一律不覆盖（封面也一样） |
| 绑定云函数 | 新增 `bindItemMeta`，与 `updateItem`（用户主动覆盖改）语义分开 |
| airDate 首播日期 | ❌ 不落共享板 item（属详情页信息，共享板门面职责是「追到第几集」） |
| 本轮范围 | 全做：数据层 + 加新番搜索入口 + 老卡片补绑入口 |

## 2. 数据层改动

### 2.1 item 新增字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `sourceId` | number \| null | 弹play animeId。标记「这张卡绑过弹play」，也是刷新入口的钥匙。非主键、可空、来源无关 |

复用已有字段承接弹play 数据：`cover`（封面 https 外链）、`totalEp`（正片集数）、`airStatus`（放送状态）。

### 2.2 airStatus 映射

弹play 详情 `isOnAir`（布尔）→ 共享板 `AIR_STATUS`：
- `true` → `airing`
- `false` → `finished`
- 缺失 → `unknown`

（与 `anime-meta/config.js` 的 `airStatusOf` 同逻辑，服务端 bindItemMeta 内实现，不跨目录 require。）

### 2.3 constants 同步

`ITEM_SHARED_FIELDS` 保持不变（那是 updateItem 的用户可改白名单，sourceId 不该让用户手改）。
`sourceId` 单独在 addItem/bindItemMeta 中处理。前端 config 与云函数 constants 子集同步，有漂移守卫测试兜底。

## 3. 云函数改动

### 3.1 addItem —— 接受 sourceId + 弹play 字段

- 入参新增 `sourceId`（可选，整数或空）、沿用 `cover`。
- `sourceId` 归一：`Number.isInteger` 且 > 0 才存，否则 null。
- 加番去重仍按 `name`（不按 sourceId，因为手动番无 sourceId；且同名不同季应由用户在搜索列表选对，不在此判）。

### 3.2 bindItemMeta（新增）—— 只填空绑定/刷新

职责：把弹play 数据填进「现值为空」的字段，不覆盖用户已有值。

```
入参：{ itemId, meta: { sourceId, cover, totalEp, airStatus } }
返回：ok({ itemId, filledCount, filledFields })  // filledCount 供前端 toast「补全了 N 项」
流程：
  1. 鉴权 + 成员校验（查 board 权威，同 updateItem）
  2. 取 item 当前值
  3. 逐字段判断「空」（见判定表）：
       cover:     item.cover 为 '' 或不存在 → 填 meta.cover
       totalEp:   item.totalEp 为 null → 填 meta.totalEp（经 TOTAL_EP 边界归一）
       airStatus: item.airStatus 为 unknown/空 → 填 meta.airStatus
       sourceId:  总是写入（这是绑定动作的标记，且用户不能手改 sourceId，无覆盖冲突）
       filledFields 只记「本次真正从空填上」的字段（sourceId 不计入 N，它不是「信息补全」）
  4. 无任何可填字段 → 返回 ok({ filledCount: 0 })（幂等，非错误；前端 toast「信息已是最新」）
  5. update + bump board updateTime（红点感知）
```

**「空」的判定表**（关键，决定不覆盖行为）：

| 字段 | 判定为「空」的条件 | 空则填，非空则跳过 |
|---|---|---|
| cover | `!item.cover`（'' 或 undefined） | ✓ |
| totalEp | `item.totalEp == null` | ✓ |
| airStatus | `!item.airStatus \|\| item.airStatus === 'unknown'` | ✓ |
| sourceId | —（总是写，无冲突） | 总是 |

## 4. 前端交互改动

### 4.1 加新番搜索入口（高频）

加番弹层（`showAdd`）顶部加「🔍 搜索番剧自动填充」按钮：
- 点击 → 跳搜索页（复用现有 `anime-search`），搜索页进入「选择模式」。
- 选中某条 → 回带 `{ sourceId, name, cover, totalEp, airStatus }` 到加番弹层，预填表单。
- 用户可再改（如集数），确认时 `addItem` 带上 sourceId + cover。
- 搜不到/不想搜 → 直接手填 name，现有链路不变。

**回带方式**：搜索页用 `wx.navigateTo` 的 `events`（页面间通信）或 `getCurrentPages` 回填。倾向用 `EventChannel`（navigateTo success 拿 eventChannel，搜索页选中时 emit）。

### 4.2 老卡片补绑入口（长尾）

卡片详情弹层（`showDetail`）加「关联番剧信息」入口：
- 仅当 `item.sourceId` 为空时显示「🔗 关联番剧信息」（已绑过则显示「已关联弹play」或「刷新信息」）。
- 点击 → 跳搜索页选择模式 → 选中 → 调 `bindItemMeta`（只填空）。
- 提示用户：只补全空缺信息，你改过的不会被覆盖。

### 4.4 卡片封面渲染（修复文档漏记的既有 bug）

绑定弹play 后 item 有了真封面 `cover`（https 外链），但卡片此前**只渲染首字色块，从不渲染 `it.cover`**——即使有封面也看不到。本轮修复：
- 卡片封面：`<image wx:if="{{it.cover && !coverErrorIds[it.itemId]}}" ... binderror="onItemCoverError">`，加载失败或无封面回退 `<view>` 首字色块。
- `coverErrorIds`（`{itemId:true}`）标记加载失败的封面，避免每次渲染重试闪烁（同头像兜底的教训）。
- `onItemCoverError` 只在首次失败时置标记；补绑成功后 `_onPickedForBind` 精准清该条标记，给新封面一次加载机会。
- 不在 `_load` 无脑清 `coverErrorIds`（对方恒失败的封面会反复重试闪烁），只在补绑/URL 变化时精准清。

### 4.3 搜索页「选择模式」（列表直选，实现定案）

> ⚠️ 原方案 B（走详情页确认）已被列表直选取代（用户 2026-07-27 二次拍板），下方为**实际实现**。

现有 `anime-search` 页 normal 模式是「点击进详情」，pick 模式改为「点击直接选中回带」：
- 来源页 `wx.navigateTo` 跳搜索页带 `mode=pick`（`SEARCH_MODE.PICK`，config 常量，不硬编码）。
- 搜索列表项点击 → **不进详情页**，直接把选中数据 `emit` 回来源页 + `navigateBack`（单层，无 delta:2）。
- 回带字段：`{ sourceId, name, cover, totalEp }` —— **不含 airStatus**。放送状态只有详情接口的 `isOnAir` 才有，列表直选不进详情、拿不到，故不带（用户接受：加番先带名/封面/集数，放送状态需要时进番剧信息弹层手设）。

**EventChannel 链路（单层，最稳）**：来源页 `navigateTo(搜索页, { events: { pickAnime: cb } })` → 搜索页选中时 `getOpenerEventChannel().emit('pickAnime', picked)` → 来源页 `cb` 收到。事件名 `PICK_EVENT` 走 config 常量。只跨一层 navigate，无需中转。

## 5. 交互细节（实现定案 2026-07-27）

1. **列表直选**（取代原方案 B 的详情页确认）
   - 搜索列表项点击 → 直接选中回带 + navigateBack，不进详情页。
   - 理由：加番/补绑是高频轻动作，多一层详情页徒增点击；选错季/版本可回搜索页重选或事后在番剧信息弹层改。
   - 影响：只搜索页感知 `mode=pick`，详情页无需透传（normal 模式才进详情）。
   - 代价：列表直选拿不到 airStatus（仅详情接口有 isOnAir），故不带放送状态，见 §4.3。

2. **加番场景「带出不提交」**：搜番剧回带只预填加番弹层的番名/总集数（封面/sourceId 暂存 `_pickedMeta`），用户可再改名/改集数，点「添加」才随 `addItem` 一并提交。选中 ≠ 提交。

3. **补绑成功 toast 反馈**：`bindItemMeta` 返回 `filledCount`，前端 toast「补全了 N 项信息」（N>0，success 图标）或「信息都已齐全，无需补全」（N=0，普通图标）。成功后清该条 `coverErrorIds` 标记 + `_load` 重拉，卡片封面从首字色块自然变真封面（不额外做动效）。文案全在 `ANIME_BIND_COPY` 配置。

## 6. 测试与验证

- `bindItemMeta` 的「只填空」逻辑抽成纯函数 `mergeMetaFillEmpty(item, meta)`，进 tests 覆盖：
  - 全空 item → 全填
  - 全有值 item → 全不动（只写 sourceId）
  - 部分空 → 只填空的那几个
  - 非法 totalEp → 归一/跳过
- 真机验证：加新番搜索选择、老卡片补绑、只填空不覆盖手改。

## 7. 部署清单（用户操作，⚠️ 阻塞真机验证）

**本轮共享板绑定相关**：
- 新增 `bindItemMeta` 云函数：上传并部署（云端安装依赖）。constants 子集已拷入其目录（与 `_shared-board/constants.js` 一致）。
- 修改 `addItem` 云函数（接受 sourceId）：重新部署。

**弹play API 接入遗留（若上一轮未部署，一并处理）**：
- `animeMeta` 云函数：重新部署（https 修复 + pickDetail 富化）。
- 云函数环境变量 `DDP_APP_ID` / `DDP_APP_SECRET`：在云开发控制台该云函数配置里填（**绝不写进代码/git**）。用完建议去弹play 开发者中心重置 AppSecret。
- 集合 `anime_meta_cache`：新建（搜索/详情结果缓存，6h TTL 逻辑在云函数内）。
- `downloadFile` 合法域名白名单：加封面图源域名（`assets.anixplayer.net`），否则真机加载不出封面（开发者工具「详情 → 域名信息」或小程序后台配）。
- 清理旧详情缓存脏数据（若之前验收期写过）。

## 8. 实施顺序与进度

1. ✅ 数据层：config/constants 加 sourceId，transform 加 `mergeMetaFillEmpty` + tests（127 断言全绿）
2. ✅ 云函数：addItem 改造 + bindItemMeta 新建 + constants 同步（node --check 全过，待部署）
3. ✅ 前端：搜索页 pick 模式（列表直选）→ 加新番搜索入口 → 老卡片补绑入口 → 卡片封面渲染修复
4. ✅ 撤首页「番剧搜索（验收）」临时入口（页面代码保留）+ 文档收尾
5. ⏳ **待用户**：部署云函数（§7）→ 真机验证（加番搜索选择 / 老卡片补绑 / 只填空不覆盖 / 封面真机加载）

## 9. 老卡片补绑功能下架（2026-07-27）

存量老卡片想绑番剧数据的都已手动操作完，补绑（bindItemMeta）不再需要，**已下架**。§3.2 / §4.2 / §6 相关设计作废留档（说明曾经为何有、现在为何下）。

**保留**：加番时的「搜番剧带回数据」链路（`onAddSearchTap` / `_onPickedForAdd`，走 addItem）不受影响；`item.sourceId` 数据字段保留（封面渲染/详情用），只是不再有补绑这条写入路径——没绑过的老卡从此补不上，这正是下架前提（存量已清）。

**删除清单**（本地已删，测试 109 断言全绿）：
- 云函数 `cloudfunctions/bindItemMeta/`（本地目录已删，**待用户在开发者工具删除云端部署**）
- 前端 `cloud-api.js` 的 `bindItemMeta` 定义 + export
- `shared-board.js` 的 `onBindSearchTap` / `_onPickedForBind`
- `shared-board.wxml` 详情弹层「关联番剧信息」入口块；`shared-board.wxss` 的 `.anime-bind-entry` / `--detail`
- `config.js` 的 `ANIME_BIND_COPY.BIND_ENTRY` / `FILLED` / `NOTHING_FILLED` / `BIND_FAIL`（保留加番搜索用的 SEARCH_TITLE/SEARCH_ENTRY/MANUAL_TITLE/EDIT_TITLE/PICKED_HINT/RESELECT）
- `transform.js` 纯函数 `mergeMetaFillEmpty` + 导出 + tests 对应 18 条用例（保留 buildItemViewModel 透出 sourceId 的 3 条）
