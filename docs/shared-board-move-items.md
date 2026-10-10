# 共享板间搬番（从其他板搬来）

> 状态：已实现（2026-10-10），§8 六项均按推荐执行。代码与离线测试全绿（`move-items-cloud` 47 断言 + `shared-board` 新增 27 断言）；`moveItems` 云函数待用户部署，真机待验收。

## 1. 场景与目标

两人按季度开板：「七月新番」里有新番和长期番；七月番结束后又开了「十月新番」。长期番要在十月板继续追，但不想丢掉七月板里的进度。

目标：在十月板里把七月板的部分番**整部搬过来**。双方的集数、状态、封面、总集数、放送信息、弹弹play 绑定都保留，搬完直接在十月板里接着更新。

前提：来源板和目标板的成员**完全相同**，都是「我和同一个 TA」两个人。

## 2. 范围

做：

- 入口只有一个：目标板加番面板里的「从其他板搬来」。
- 一次可多选、批量搬。
- 目标板里已有重复番的跳过，搬完告诉用户跳过了哪些、为什么。
- 两个板的改动历史各记一条，对方的板列表红点亮起。

不做：

- 从来源板往外推（「搬到其他板」入口）。
- 复制（同一部番在两个板各留一份进度）。
- 重复番的进度合并。
- 一键撤销。搬错了，在七月板用同一个入口搬回去即可。
- 「开新一季」：自动建板并带上双方成员。这是下一步，可以复用本文的 `moveItems`。

## 3. 核心决策：搬，不复制

不新建番剧文档，直接把 `shared_board_items` 上这部番的 `boardId` 从来源板改成目标板。

- **只存一份进度。** 复制会让两个板各有一份进度：在十月板 +1 后，七月板那份就过时了，两份数据从此对不上。
- **成员相同，进度直接可用。** 进度按 openid 内嵌在 `item.progress.<openid>`，两个板成员一致，搬过去不用改进度。
- **`itemId` 不变。** 依赖 itemId 的本机数据会自然延续，比如追平庆祝防重放 `sb_milestone_sync_<itemId>_<openid>`。

## 4. 历史数据怎么处理

事件流 `shared_board_events` 是只追加的，**旧事件不改 `boardId`**。

| 位置 | 搬后表现 |
|---|---|
| 七月板改动历史 | 完整保留，事件里存的是番名快照，照常显示 |
| 七月板追番小结 | 行为类指标（连续追番、神同步、爆肝）不变；快照类指标（一起追完、本命番、近期推得最猛）里，搬走的番找不到了，会被跳过（报告代码已经容错：找不到的番不显示） |
| 十月板追番小结 | 搬来的番从搬家这一刻起，在十月板积累行为数据；过去的推进记录仍算在七月板 |
| 十月板改动历史 | 只多一条「从七月板搬来」的汇总记录，不回溯过去的进度事件 |
| 本机排行（从夯到拉） | 排行只存在本机，按板分开存。七月板排行里这些番会消失；十月板里它们出现在「未排」区。档位不迁移，对方手机上的排行本来也迁不了 |

## 5. 云函数 `moveItems`（新增）

### 5.1 入参与返回

```js
// 入参
{ fromBoardId, toBoardId, itemIds: string[] }

// 返回 data
{
  moved: [{ itemId, name }],                 // 本次搬成功（含重试时已在目标板的）
  skipped: [{ itemId, name, reason }],       // reason: DUPLICATE | NOT_IN_SOURCE
}
```

### 5.2 校验（任一不过整次拒绝，不写库）

1. 有 OPENID；`itemIds` 是非空数组，去重后数量不超过 `MOVE_ITEMS_MAX`；`fromBoardId !== toBoardId`。
2. 两个板都存在，我都是成员，都不是归档板。
3. 两个板的 `memberOpenids` 集合完全相同，且人数等于 `BOARD_MEMBER_LIMIT`。不满足返回新错误码 `ERR_MOVE_MEMBERS_MISMATCH`。
4. 目标板现有未删番数加上本次可搬数，不超过 `BOARD_ITEM_MAX`。超了返回新错误码 `ERR_MOVE_TARGET_FULL`。原因是 `getBoardDetail` 一次只读 200 部且没有固定排序，超出部分会随机看不到。

### 5.3 写入流程（DB 调用次数固定，与搬的部数无关）

1. **分类**：按 `_id in itemIds` 查出这些番，不限定板，分成三类：
   - 已在目标板 → 计为已搬成功（重试幂等），不再写。
   - 在来源板且未删 → 候选。
   - 其他情况（已被删、在别的板）→ 跳过，原因 `NOT_IN_SOURCE`。
2. **查重**：候选和目标板未删的番比较，判定规则见 §8 D2。重复的跳过，原因 `DUPLICATE`。
3. **批量条件更新**：一次 `where({ _id: _.in(ids), boardId: fromBoardId, deleted: false }).update(...)`，写入：
   - `boardId: toBoardId`
   - `memberOpenids`：取目标板的成员列表
   - `movedAt` 和 `updateTime`：取同一个服务端时间

   `boardId` 条件保证并发安全：如果对方同时把同一部番搬走，或刚把它移出番单，这部番就不会被重复处理。
4. **回查**：再按 `boardId === toBoardId` 回查，确认实际搬成功的；没搬成功的计为 `NOT_IN_SOURCE`。
5. **收尾**：至少搬成功一部时，执行（主写已成功，收尾失败只记日志，不改变返回结果）：
   - 两个板都 bump `updateTime`，对方的列表红点会亮。
   - **不写**我的 `lastViewedAt`（实现时改的，与 `renameBoard` 不同）。原因：
     - 目标板：搬完返回板页会触发 `_load → markViewed`，红点自然清掉，不用额外写。
     - 来源板：如果顺手把它标成已读，TA 在七月板剩余番上我还没看过的进度，下次进七月板时「TA 更新了」不会再提示，等于吞掉信息。代价是我自己的七月板卡片会亮一次红点，进去一次就消失。
   - 两个板各追加**一条汇总事件**（见 §6）。

不改动的字段：`progress`、`sortOrder`、`togetherWatch`（见 §8 D3、D4）、`addBy`、`createTime`。

### 5.4 对其他功能的影响（已核对代码）

- **「TA 更新了」信息条会误报，需要修**（`transform.buildPeerUpdates`）。
  - 现有逻辑：对方进度时间晚于我上次查看这个板的时间，就算对方有新动向。
  - 问题：搬来的番带着七月板里的旧进度时间，进十月板会被当成新动向。
  - 修法：只统计晚于 `max(我上次查看, item.movedAt)` 的进度，也就是番搬进来之前的进度不算。
- **来源板页面没刷新、仍在操作已搬走的番**：
  - `togetherWatch` 会校验 `item.boardId === boardId`，直接拒绝，返回 `ITEM_NOT_FOUND`。
  - `updateProgress`、`updateItem`、`deleteItem` 是按番操作的，仍会成功，写到这部番现在所在的十月板。这符合「进度只有一份」的原则，可以接受。
- **板列表封面墙**：按 `item.updateTime` 降序显示。搬来的番会排到十月板封面墙的最前面，与「最近活跃」的含义一致。

## 6. 历史事件

新增两个板级事件类型，每次搬家每个板各一条汇总事件，而不是每部番一条：

| 类型 | 写到 | payload | 历史文案（示例） |
|---|---|---|---|
| `items_move_out` | 来源板 | `{ board: 目标板名快照, items: [{itemId,name}] }` | 把《A》《B》等 3 部番搬到了「十月新番」 |
| `items_move_in` | 目标板 | `{ board: 来源板名快照, items: [{itemId,name}] }` | 从「七月新番」搬来《A》《B》等 3 部番 |

- 板名存快照。板名之后被改，历史仍显示搬家当时的名字。
- 文案片段放进配置，`describeEvent` 只负责产出模板 key 和变量：
  - 番名预览最多 `MOVE_HISTORY_NAME_PREVIEW` 个；
  - 超出部分显示「等 N 部番」；
  - 只搬一部时直接显示番名。
- 报告只消费 `progress` 和 `together_advance` 两类事件，`foldEvents` 只折叠 `progress`，新事件类型不会影响它们。

## 7. 前端交互

### 7.1 入口（P2.5 加番面板）

在「搜番剧」区块下方，加一个同级区块「从其他板搬来」：

- **目标板已配对**：可以点击，跳转到搬番页。用 EventChannel 传入当前板的 `boardId`、板名、`memberOpenids`。
- **筹备态（TA 还没加入）**：灰掉不可点，显示提示「TA 加入后才能从其他板搬番」。
- **归档板**：没有加番面板，自然也没有这个入口。

### 7.2 搬番页 `pages/shared-board/move-items`（分包新页面，2026-10-10 真机走查后改版）

1. **页头**：「搬进「十月新番」」+ 一行说明「双方集数、状态和封面会随番一起带过去」，始终告诉用户往哪搬。
2. **选来源板**：横向胶囊，用 `listMyBoards` 拉取。只列满足三个条件的板：成员集合与当前板相同、不是当前板、不是归档板且有番。默认选中第一个（`listMyBoards` 按最近活跃排序，通常就是上一季的板）。
   - 没有符合条件的板：显示空态「没有可以搬番的板」。
3. **选番**：用 `getBoardDetail` 拉来源板番单，**与板页同一套分区和顺序**（复用 `groupItems`），分区标题即状态，行内不再重复状态标签。
   - 每个分区合在一张卡里，行间细分隔线；行内是勾选框、封面或首字色块、番名、「我 E6 · TA E3」。
   - **不默认勾选**；分区标题右侧「全选 / 取消全选」，受单次上限 `MOVE_ITEMS_MAX` 约束。
   - 目标板里已有的重复番收进最底部的「当前板已有」分区，淡化、不可勾选。
4. **底部固定条**：左侧「已选 N 部」+「清空」，右侧短按钮「搬过来」。目标板名放进确认弹窗标题「搬 N 部番到「十月新番」？」，按钮文案不随板名变长（旧版长文案在窄屏被截断）。
5. **结果**：
   - 全部成功：toast「已搬来 N 部」，返回板页（板页 onShow 自动重拉）。
   - 有跳过：弹窗列出被跳过的番名和原因；有搬成功的则关闭后返回，一部都没搬成则留在本页按最新数据重算。

纯逻辑放进 `transform.js`，便于测试：

- `pickMoveSourceBoards(boards, currentBoard)`
- `buildMoveSections(sourceItems, targetItems, myOpenid, peerOpenid)`：按板页分区分组，重复番单独收进 `duplicates`。

## 8. 决策记录（2026-10-10 全部按推荐确认）

| # | 问题 | 推荐 | 备选 |
|---|---|---|---|
| D1 | 选番页默认勾哪些 | ~~任一方是「在追 / 追平待更 / 暂缓」就勾选~~ → **2026-10-10 真机走查后改为不默认勾选**：用户自己挑，分区标题旁可一键「全选」 | — |
| D2 | 什么算「重复」而跳过 | 同名，**或**同一弹弹play条目（`sourceId` 相同）。名字略有差别的同一部番（例如目标板里叫「芙莉莲」）也能拦住 | 只按同名，与现有加番去重口径一致 |
| D3 | 搬来的番在十月板分区里排在哪 | 保留原排序值，不改 `sortOrder`：长期番一般排在同分区的十月新番前面 | 重置为搬家时间，排到分区末尾 |
| D4 | 「一起看」清单标记是否跟着走 | 跟着走：七月板「一起看」里的番，到十月板仍在「一起看」 | 搬家时清掉 |
| D5 | 七月板小结的快照指标少掉搬走的番，本机排行档位不迁移（见 §4），能否接受 | 接受 | 排行档位在发起人本机迁移。对方手机迁不了，两边会不一致，不推荐 |
| D6 | 数量上限 | 一次最多搬 `MOVE_ITEMS_MAX = 50` 部；目标板总数不超过 `BOARD_ITEM_MAX = 200`，超过时整次拒绝并提示 | 超出时只搬能放下的部分 |

## 9. 改动清单

- **配置**（前端 `config.js` 为权威源，同步到 `_shared-board/constants.js`，并逐字复制到 `getBoardReport`）：
  - `EVENT_TYPE.ITEMS_MOVE_IN/OUT`
  - `ERR.MOVE_MEMBERS_MISMATCH / MOVE_TARGET_FULL`
  - `MOVE_ITEMS_MAX`、`BOARD_ITEM_MAX`、`MOVE_HISTORY_NAME_PREVIEW`
  - `HISTORY_COPY.ACTION.items_move_in/out` 以及文案片段、搬番页文案 `MOVE_COPY`
- **云函数**：新增 `cloudfunctions/moveItems/`（`index.js`、`package.json`，以及从 `_shared-board` 复制的 `constants.js`、`event-log.js`）。
- **transform**：
  - `describeEvent` 新增两个分支
  - `buildPeerUpdates` 加 `movedAt` 过滤
  - 新增 `pickMoveSourceBoards`、`buildMoveSections`
- **前端**：
  - `cloud-api.moveItems`
  - 加番面板入口
  - 新页面 `move-items` 四件套，并注册到 `app.json`
- **测试**：
  - 新增 `tests/move-items-cloud.test.js`（内存版 SDK）。覆盖成员不一致、归档、同板、超上限、重复跳过、`NOT_IN_SOURCE`、重试幂等、并发已搬走、只写约定字段、两条汇总事件，以及副本与权威源逐字一致。
  - `shared-board.test.js` 补充：describeEvent 两个分支、TA 更新条 movedAt 过滤、来源板筛选、候选标记。
- **文档**：
  - 本文改为「已实现」
  - `shared-board-data.md` 补 `movedAt` 字段和 §4.9 `moveItems`
  - `shared-board-ui.md` 补入口和搬番页
- **部署**（由你操作）：
  - 上传新云函数 `moveItems`。
  - `getBoardReport` 跟随配置副本重新部署。
  - 可选：在控制台给 `shared_board_items` 加 `boardId + deleted` 组合索引。
- **体积**：实测分包源码 1207KB → 1240KB（+33KB，含新页面、配置与 transform），加 npm 产物约 1.81MB，上限 2MB。余量已不多，后续功能需留意。

## 9.1 实现要点（落地文件）

| 文件 | 内容 |
|---|---|
| `cloudfunctions/moveItems/index.js` | §5 校验 + 分类 + 判重 + 批量条件更新 + 回查 + 汇总事件 |
| `miniprogram/packageFeatures/pages/shared-board/move-items.*` | 搬番页：来源板胶囊（默认选中最近活跃）→ 按分区勾选（不默认勾选，分区可全选，单次上限 `MOVE_ITEMS_MAX`）→ 确认 → 结果 |
| `shared-board.wxml/js/wxss` | 加番面板「从其他板搬来」入口；`canMoveIn` 由 `transform.canMoveInto(board)` 计算 |
| `utils/shared-board/transform.js` | `sameMembers`、`canMoveInto`、`pickMoveSourceBoards`、`buildMoveSections`；`describeEvent` 搬番分支；`buildPeerUpdates` 的 `movedAt` 过滤 |
| `tests/move-items-cloud.test.js` | 内存版 SDK（支持 `_.in`、批量 update），含并发注入与副本逐字守卫 |

## 10. 风险

- **板详情 200 部读取上限**：§5.2 的总数校验只管搬番这条路径；`addItem` 和 `getBoardDetail` 的上限不在本次范围内。
- **重复番**：同一部番在两个板分别加过、但名字和 `sourceId` 都不一致时，查不出重复，十月板会出现两条。
- **已知排序 bug（本次不修）**：对方看到的分区排序不稳定。`sortOrder` 只给加番人写，对方的排序值会退化成日期对象相减。搬家不会加重这个问题。
