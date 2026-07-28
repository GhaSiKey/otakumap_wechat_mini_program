# 共享追番板 × 弹弹play 数据绑定 —— 集成方案

> 状态：待 review（2026-07-27）
> 前置：弹play API 接入已完成（`animeMeta` 云函数 + 独立搜索/详情验收页，commit fbaf3db）
> 本文档描述如何把「弹play 番剧数据」接入共享追番板的加番与卡片流程。

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

### 4.3 搜索页「选择模式」（走详情确认，方案 B）

现有 `anime-search` 页当前是「点击进详情」，详情页当前是纯展示。选择模式改动：
- 来源页跳搜索页时带 `mode=pick`。
- 搜索列表项点击 → 进详情页（把 `mode=pick` 一路透传给详情页 query）。
- 详情页在 `mode=pick` 时底部显示「选它」按钮；纯浏览态（无 mode）不显示。
- 点「选它」→ 通过 EventChannel 把 `{ sourceId, name, cover, totalEp, airStatus }` emit 回来源页，然后 `navigateBack({ delta: 2 })` 一路退回加番/详情弹层所在页。
- 详情页的 totalEp/airStatus：detail 接口无 episodeCount，故 totalEp 由搜索列表带入详情页的 query（已实现）；airStatus 由详情接口 isOnAir 映射。「选它」回带时两者都要带上。

**EventChannel 链路**：来源页 `navigateTo(搜索页, events)` → 搜索页 `navigateTo(详情页)` 时把来源页的 eventChannel 透传（或详情页选中时反向 emit 经搜索页中转）。倾向：来源页监听 `pickAnime` 事件；详情页「选它」时经 `getOpenerEventChannel` 逐层 emit。具体链路实现时确认（跨两层 navigate 的 EventChannel 需要中转，或改用全局事件/页面栈回写）。

## 5. 交互细节（已定 2026-07-27）

1. **搜索选择走详情页确认**（方案 B）
   - 搜索列表项点击 → 进详情页看清楚（类型/年份/首播/集数/简介等），详情页加「选它」按钮。
   - 点「选它」→ 回带数据给来源页 + navigateBack（一路退回加番/详情弹层）。
   - 理由：呼应「搜索列表展示全、防止选错季/版本」，进详情确认最稳。
   - 影响：搜索页与详情页都要感知「选择模式」（mode=pick 需一路透传：列表页 → 详情页 → 回带）。

2. **加番弹层显示封面预览**：回带预填后，加番弹层显示封面缩略图 + 已填字段（集数/状态），所见即所得，用户确认无误再提交。

3. **补绑成功 toast 反馈**：绑定成功后 toast「已关联，补全了 N 项信息」，N = 实际填充的空字段数（bindItemMeta 返回填充计数）。卡片封面随之从首字色块变真封面（_load 重拉自然刷新，不额外做动效）。

## 6. 测试与验证

- `bindItemMeta` 的「只填空」逻辑抽成纯函数 `mergeMetaFillEmpty(item, meta)`，进 tests 覆盖：
  - 全空 item → 全填
  - 全有值 item → 全不动（只写 sourceId）
  - 部分空 → 只填空的那几个
  - 非法 totalEp → 归一/跳过
- 真机验证：加新番搜索选择、老卡片补绑、只填空不覆盖手改。

## 7. 部署清单（用户操作）

- 新增 `bindItemMeta` 云函数：上传并部署。
- 修改 `addItem` 云函数（接受 sourceId）：重新部署。
- constants 子集拷贝到新云函数目录。

## 8. 实施顺序

1. 数据层：config/constants 加 sourceId 相关，transform 加 `mergeMetaFillEmpty` + tests
2. 云函数：addItem 改造 + bindItemMeta 新建 + constants 同步
3. 前端：搜索页选择模式 → 加新番入口 → 老卡片补绑入口
4. 真机验证 → 撤首页「番剧搜索（验收）」临时入口 → 文档收尾
