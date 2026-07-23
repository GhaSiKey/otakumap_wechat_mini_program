# 共享追番板 · 阶段二 · 数据层详细设计

> 状态：详细设计（可照此写码）· 版本 v0.1 · 日期 2026-07-22
> 上游：PRD `shared-board.md` v0.1、UI 规格 `shared-board-ui.md` v0.1
> 范围：云数据库两集合 + 权限规则 + 6 个业务云函数 + `packageFeatures/utils/shared-board/{config,transform}.js` + `tests/shared-board.test.js`。**不含页面渲染与副作用代码**（阶段三）。
> 底座：微信云开发，环境 ID 走 `miniprogram/config/cloud.js` 的 `CLOUD_ENV.DEFAULT`（`cloudbase-d1gtv92iac778b581`），探针函数 `getMyOpenid` 已验证连通。

---

## 0. 三条不可动摇的数据层铁律

1. **身份只信服务端**：任何写入 openid 一律取 `cloud.getWXContext().OPENID`，**忽略客户端传入的任何 openid**（防伪造，PRD §7.3）。
2. **读走规则、写全走云函数**：数据库安全规则是**文档级**权限，能表达「限成员可读」，**不能**表达「只准改自己那个子键」（字段级），所以写必须全部经云函数（论证见 §3）。这是官方认证的标准分层。
3. **禁止硬编码**：集合名 / 人数上限 / 状态枚举 / 错误码 / ep 上下界 / token TTL / 各阈值全进 config，云函数侧同源（方案见 §5）。

## 数据模型选型回执（2026-07-22 拍板）

安全规则是文档级权限的事实，引出「进度内嵌 vs 拆独立表」的选择。**已定：方案甲·进度内嵌**（`item.progress: { openid: {...} }`）。理由：① 加番/去重/软删除/配对/共享字段修改本就必须走云函数，拆表只省掉 `updateProgress` 一个函数，不划算；② 门面是双人对比，一条文档拿全双方进度最顺，拆表要 join；③ 写全走云函数是既定原则，云函数用动态 key 只碰自己子键，私有性一样有保证。

---

## 1. 关键修正与决策回执（先读，避免照 PRD 抄错）

| # | 事项 | 结论 | 依据 |
|---|------|------|------|
| A | 权限规则数组判断 | ❌ `.includes()` 不可用（微信规则无此方法），改用 `auth.openid in doc.memberOpenids` | 已核实官方文档，PRD §7.4 已修 |
| B | items 读规则 | 推荐**把 `memberOpenids` 冗余到 item**，规则直接 `auth.openid in doc.memberOpenids`，免 `get()` 读配额（方案 A）；备选反查 board（方案 B）需查询必带 `where(boardId)` | §2.6、§9 O1 |
| C | `sortOrder` 形态 | `{ <openid>: number }`（各存各的，冲突 A 定案） | UI §7.1 |
| D | 软删除字段 | 补 `deleted / deletedBy / deletedAt`（冲突 B 定案） | UI §7.1 |
| E | `+1` 语义 | `updateProgress` 收**绝对 ep**，不用服务端自增（幂等、重试安全） | §4.4 |
| F | 进度模型 | 内嵌（方案甲），非拆表 | 上方回执 |

---

## 2. 集合最终 Schema

云数据库无固定 schema，加字段无需迁移。「预留不返工」的真正含义是：**结构选型（map vs 标量、内嵌 vs 子集合）一次定对**，后续 Should 功能加字段即可，不动既有结构。

### 2.1 集合一：`shared_boards`（板 + 成员，合一）

| 字段 | 类型 | 可空 | 默认 | MVP | 说明 |
|------|------|-----|------|-----|------|
| `_id` | string | 否 | 云生成 | ✅ | 板 ID，分享卡片携带 |
| `_openid` | string | 否 | 云自动写 | ✅ | 建板人（审计，不参与权限判断） |
| `name` | string | 否 | config `DEFAULT_BOARD_NAME` | ✅ | 板名 |
| `members` | Array\<Member> | 否 | 建板时含 owner 一人 | ✅ | 成员数组，长度 ≤ `BOARD_MEMBER_LIMIT` |
| `memberOpenids` | Array\<string> | 否 | `[ownerOpenid]` | ✅ | **扁平冗余**，供读规则 `in` 判断（数组索引） |
| `status` | string | 否 | `'active'` | ✅ | `active` / `full` / `archived` |
| `pairing` | Pairing | 否 | 见 §2.2 | ✅ | 一次性配对 token（防抢坑） |
| `lastViewedAt` | `{ [openid]: Date }` | 是 | `{}` | ⏳Should | 每人上次查看时间，未读红点用 |
| `archivedBy` | string | 是 | `''` | ⏳Should | 谁归档的（退出/解散） |
| `archivedAt` | Date | 是 | `null` | ⏳Should | 归档时间 |
| `createTime` | Date | 否 | `serverDate()` | ✅ | |
| `updateTime` | Date | 否 | `serverDate()` | ✅ | **兼作 lastActiveAt**，任一写路径都 bump |

`Member` 子结构：`{ openid, nickname, avatar, role, joinAt }`。`nickname/avatar` 是加入时快照，可空（无授权为 `''`，前端首字色块兜底）。MVP 不主动刷新；Should 由 `onShow` 比对本地快照，不一致调 `updateMemberProfile` 更新自己那条（结构已支持，不返工）。

### 2.2 `Pairing` 子结构（配对 token）

```js
pairing: {
  token: 'p_a1b2c3...',   // 一次性配对令牌，云函数随机生成（crypto.randomBytes）
  expireAt: Date,         // = 建板时间 + PAIR_TOKEN_TTL_MS
  used: false,            // 第 2 人成功加入后置 true（一次性）
}
```

### 2.3 集合二：`shared_board_items`（共享条目 + 私有进度）

| 字段 | 类型 | 可空 | 默认 | MVP | 说明 |
|------|------|------|-----|-----|------|
| `_id` | string | 否 | 云生成 | ✅ | 条目 ID |
| `boardId` | string | 否 | — | ✅ | 外键，查询/权限反查按它（建索引） |
| `memberOpenids` | Array\<string> | 否 | 建时取板成员快照 | ✅ | **冗余**，供 items 读规则（方案 A，绕开 get()） |
| `name` | string | 否 | — | ✅ | 番名（**共享**，谁都能改） |
| `totalEp` | number\|null | 是 | `null` | ✅ | 总集数，MVP 手动常空（决定进度轴有无分母） |
| `airStatus` | string | 否 | `'unknown'` | ✅ | `airing`/`finished`/`unknown`（影响催更语义） |
| `cover` | string | 是 | `''` | ✅ | 封面 URL，可空；空则前端首字色块（不为占位加字段） |
| `alias` | Array\<string> | 是 | `[]` | ⏳预留 | 别名（来源无关，将来接源填） |
| `addBy` | string | 否 | 建者 openid | ✅ | 谁加的（审计，不参与权限） |
| `progress` | `{ [openid]: Progress }` | 否 | `{ [建者]: 初始进度 }` | ✅ | **私有进度**，openid 为 key，天然隔离 |
| `sortOrder` | `{ [openid]: number }` | 否 | `{ [建者]: createTime }` | ✅ | **各存各的**（冲突 A）。默认取建时戳，保证稳定序 |
| `deleted` | boolean | 否 | `false` | ✅ | 软删除标记（冲突 B） |
| `deletedBy` | string | 是 | `''` | ✅ | 谁移出的（openid） |
| `deletedAt` | Date | 是 | `null` | ✅ | 移出时间 |
| `createTime` | Date | 否 | `serverDate()` | ✅ | |
| `updateTime` | Date | 否 | `serverDate()` | ✅ | 任一字段变更都 bump |

`Progress` 子结构：`{ ep: number(默认0), status: string(默认'want'), updateTime: Date }`。`ep=0` 表示未开追。

> 里程碑防重放（追平/看完动效只放一次）存**客户端** `wx.setStorageSync`（`milestoneShown_<boardId>_<itemId>`），不占服务端字段（UI §8 开放点 #4）。

### 2.4 索引建议

| 集合 | 索引 | 用途 |
|------|------|------|
| `shared_boards` | `memberOpenids`（数组索引，非唯一） | 「我的板列表」`where({ memberOpenids: OPENID })` |
| `shared_board_items` | `boardId`（非唯一） | 拉某板番单；满足方案 B 读规则的查询约束 |
| `shared_board_items` | 复合 `boardId + deleted`（可选） | 默认只拉未删项 |

排序按 `sortOrder.<myOpenid>` 在 transform 客户端做（2 人番单几百条，无需 DB 排序索引）。

### 2.5 催更子集合（Should，MVP 不建，预留结构）

```js
// 集合 shared_board_nudges（Should）
{ _id, boardId, from, to, itemId, createTime, readAt: Date|null }
// 冷却（PRD §5.3，4h/次）：查同 (from,to,itemId) 最近一条，
// now - createTime < NUDGE_COOLDOWN_MS 则拒绝。冷却时长走 config。
```

**划线**：MVP 必需入库 = board 全字段（除 lastViewedAt/archived*）+ item 全字段（除 alias）；Should 预留 = lastViewedAt、archived*、alias、nudges 子集合、updateMemberProfile。全部预留项要么加字段（无迁移）要么加子集合/函数，**不改既有结构**。

### 2.6 权限规则完整 JSON

```json
// shared_boards
{ "read": "auth.openid in doc.memberOpenids", "write": false }
```

```json
// shared_board_items — 方案 A（推荐）：读 item 自带冗余 memberOpenids，无 get()、零额外读配额
{ "read": "auth.openid in doc.memberOpenids", "write": false }
```

```json
// shared_board_items — 方案 B（备选）：反查 board。
// 硬约束：客户端查询必须含 where({ boardId })，否则规则里 doc.boardId 无值、判定失败。
{ "read": "auth.openid in get(`database.shared_boards.${doc.boardId}`).memberOpenids", "write": false }
```

两集合 `write` 恒为 `false`：所有写经云函数。云函数以资源方（管理员）身份操作数据库，不受安全规则约束，改由函数内 `getWXContext` + 校验逻辑保证私有性。

---

## 3. 硬问题攻坚

### 3.1 权限规则表达不了「字段级私有写」，故写必走云函数

微信安全规则能力边界（已核实官方文档）：表达式只有 `== != >= < <= && || !`、`.`、`in`、`get()`（跨文档，最多 3 次/表达式、嵌套≤2、每次计一次读）。**无 `.includes()`、无数组方法、无「本次更新改了哪些字段」的 diff 概念**——规则对一次 `update` 只能整体判 true/false，看不到「客户端只想改 `progress.oABC.ep`」这个意图。

结论：「只准本人改自己子键」这种**字段级 + 身份级**约束，规则天然表达不了。只能靠云函数：`OPENID = getWXContext()` → 动态 key `progress.${OPENID}.*` 定位写，物理上碰不到对方子键。故 **write=false，写全走云函数**。

### 3.2 items 读规则的两条硬约束（若用方案 B）

1. `doc.boardId` **必须出现在查询条件**（`where({ boardId })` 用 `==`），否则 `get()` 路径参数无值，规则判 false，整列表读不出。
2. `get()` 每命中一条 item 计一次读，列表 N 条 = N 次额外读。→ 这是 §9 O1 推荐**冗余 memberOpenids 到 item、改用方案 A** 的原因。

### 3.3 写必走云函数的三条补充论证

- **身份可信**：`getWXContext().OPENID` 客户端伪造不了；规则的 `auth.openid` 只能判定不能改写归属。
- **原子条件写**：防抢坑 / 防并发 3 人（§4.2）依赖 `where(条件).update()` 的原子性 + `stats.updated` 计数。
- **跨字段一致性**：加番去重、bump updateTime、软删除联动等多字段一致更新。

---

## 4. 云函数清单与详细设计

统一返回信封（前端好对账）：

```js
{ ok: true,  code: 'OK',      data: {...} }        // 成功
{ ok: false, code: 'ERR_XXX', msg: '中文提示' }    // 失败
```

统一前置：`const { OPENID } = cloud.getWXContext(); if (!OPENID) return fail(ERR.UNAUTHENTICATED);`
外层统一 `try { ... } catch(e){ return fail(ERR.INTERNAL, e) }`。错误码见 §5（config `ERR`）。

### 4.1 `createBoard` — 建板

- **入参**：`{ name?, profile?: { nickname, avatar } }`
- **校验**：name 长度 ≤ `BOARD_NAME_MAX`
- **核心**：

```js
const token = 'p_' + genToken();                 // crypto.randomBytes(16).toString('hex')
const now = db.serverDate();
const owner = { openid: OPENID, nickname: profile?.nickname || '',
                avatar: profile?.avatar || '', role: MEMBER_ROLE.OWNER, joinAt: now };
const res = await db.collection(COLLECTION.BOARD).add({ data: {
  name: (name || DEFAULT_BOARD_NAME).slice(0, BOARD_NAME_MAX),
  members: [owner], memberOpenids: [OPENID], status: BOARD_STATUS.ACTIVE,
  pairing: { token, expireAt: expireAfter(PAIR_TOKEN_TTL_MS), used: false },
  createTime: now, updateTime: now,
}});
return ok({ boardId: res._id, token });          // 前端拼分享 path
```

- **返回**：`{ boardId, token }`。前端 `onShareAppMessage` 拼 `path=.../shared-board?boardId=${boardId}&token=${token}`。
- **幂等**：非幂等（点建板即建新板，符合语义）。

### 4.2 `joinBoard` — 配对入板（防抢坑 + 防并发，核心难点）

- **入参**：`{ boardId, token, profile? }`；身份取 `OPENID`（忽略客户端传的 openid）
- **token 机制**：`createBoard` 生成随机 token 存 `board.pairing.token`；`expireAt` 过期；第 2 人成功入板置 `used=true`（一次性）；过期/已用需 owner 重新分享（Should：`refreshPairToken`）
- **防并发（原子条件更新）**：

```js
const now = Date.now();
const board = (await db.collection(COLLECTION.BOARD).doc(boardId).get().catch(()=>null))?.data;
if (!board) return fail(ERR.BOARD_NOT_FOUND);
if (board.status === BOARD_STATUS.ARCHIVED) return fail(ERR.BOARD_FULL);
if (board.memberOpenids.includes(OPENID)) return ok({ boardId, rejoin: true }); // 本人重入幂等
if (!board.pairing || board.pairing.token !== token) return fail(ERR.TOKEN_INVALID);
if (board.pairing.used) return fail(ERR.TOKEN_USED);
if (board.pairing.expireAt && +board.pairing.expireAt <= now) return fail(ERR.TOKEN_EXPIRED);
if (board.memberOpenids.length >= BOARD_MEMBER_LIMIT) return fail(ERR.BOARD_FULL);

const _ = db.command;
const guest = { openid: OPENID, nickname: profile?.nickname || '',
                avatar: profile?.avatar || '', role: MEMBER_ROLE.GUEST, joinAt: db.serverDate() };
const upd = await db.collection(COLLECTION.BOARD)
  .where({ _id: boardId, status: BOARD_STATUS.ACTIVE, 'pairing.used': false,
           'pairing.token': token, memberOpenids: _.nin([OPENID]) })
  .update({ data: {
    members: _.push([guest]), memberOpenids: _.addToSet(OPENID),
    'pairing.used': true, status: BOARD_STATUS.FULL, updateTime: db.serverDate(),
  }});
if (upd.stats.updated !== 1) return fail(ERR.BOARD_FULL); // 被抢先/竞态失败
```

- **为什么防得住并发**：两人同扫，`where` 都带 `'pairing.used': false`；数据库对同一文档的匹配更新串行，第一个把 `used` 翻 true 后，第二个 `where` 不再命中，`stats.updated===0`。人数上限 + 一次性 token 双保险。
- **token 的意义**：分享卡片是广播可转发。只判「未满」时任何拿到 boardId 的人都能抢空位；token 让邀请**一次性 + 可过期 + 可撤销**。
- **返回**：`{ boardId, rejoin? }`（前端据 members.length 1→2 触发「TA 来了」动效）

### 4.3 `addItem` — 加番（共享去重）

- **入参**：`{ boardId, name, totalEp?, airStatus?, cover? }`
- **校验**：成员校验 → name 非空且 ≤ `ITEM_NAME_MAX` → 同板未删项去重 → ep/status 用默认
- **核心**：

```js
if (!board.memberOpenids.includes(OPENID)) return fail(ERR.NOT_MEMBER);
const trimmed = name.trim();
if (!trimmed) return fail(ERR.INVALID_PARAM);
const dup = await db.collection(COLLECTION.ITEM).where({ boardId, deleted: false, name: trimmed }).count();
if (dup.total > 0) return fail(ERR.DUPLICATE_ITEM);
const now = db.serverDate();
const res = await db.collection(COLLECTION.ITEM).add({ data: {
  boardId, memberOpenids: board.memberOpenids,      // 冗余，供方案 A 读规则
  name: trimmed, totalEp: (totalEp ?? null),
  airStatus: airStatus || AIR_STATUS.UNKNOWN, cover: cover || '', alias: [], addBy: OPENID,
  progress: { [OPENID]: { ep: 0, status: PROGRESS_STATUS_DEFAULT, updateTime: now } },
  sortOrder: { [OPENID]: Date.now() },
  deleted: false, deletedBy: '', deletedAt: null, createTime: now, updateTime: now,
}});
await db.collection(COLLECTION.BOARD).doc(boardId).update({ data: { updateTime: now } }); // bump 活跃
return ok({ itemId: res._id });
```

- **幂等**：非幂等，但去重让重复点添加不产生脏数据

### 4.4 `updateProgress` — 改自己进度（子字段原子更新 + 对账核心）

- **入参**：`{ itemId, ep, status }`。**ep 是绝对值不是增量**（`+1` 由前端算好目标集数再传，保证幂等/重试安全）
- **校验**：成员 → item 存在未删 → status 合法 → ep clamp（整数、`EP_MIN ≤ ep`；totalEp 已知则 ≤ totalEp，否则 ≤ `EP_MAX_WHEN_UNKNOWN`）。**服务端 clamp 后写入并回传**，前端据此对账
- **核心（动态 key 只碰自己子键）**：

```js
const item = (await db.collection(COLLECTION.ITEM).doc(itemId).get().catch(()=>null))?.data;
if (!item || item.deleted) return fail(ERR.ITEM_NOT_FOUND);
if (!item.memberOpenids.includes(OPENID)) return fail(ERR.NOT_MEMBER);
if (!PROGRESS_STATUS.includes(status)) return fail(ERR.INVALID_STATUS);
const epFinal = clampEp(ep, item.totalEp);        // 与 transform.clampEp 同规则
if (epFinal === null) return fail(ERR.INVALID_EP);
const now = db.serverDate();
await db.collection(COLLECTION.ITEM).doc(itemId).update({ data: {
  [`progress.${OPENID}.ep`]: epFinal,             // ★只定位自己子键
  [`progress.${OPENID}.status`]: status,
  [`progress.${OPENID}.updateTime`]: now, updateTime: now,
}});
return ok({ itemId, mine: { ep: epFinal, status, updateTime: Date.now() } });
```

- **前端对账契约**：`data.mine` 是服务端裁决后的权威值。前端乐观 UI：① 点 +1 本地立即 setData 游标先滑；② 调函数带绝对 ep；③ 回来后 `data.mine.ep` 与乐观值比对，一致落定，不一致（被 clamp）snap 到权威值；④ 失败/超时回滚快照 + toast
- **幂等**：✅ 绝对 ep 写入，重复同值幂等

### 4.5 `updateItem` — 改共享字段

- **入参**：`{ itemId, patch: { name?, totalEp?, airStatus?, cover? } }`（白名单 `ITEM_SHARED_FIELDS`）
- **校验**：成员 → item 存在未删 → 白名单过滤（progress/sortOrder/deleted 等一律剔除，防越权）→ 改名去重
- **核心**：`pickAllowed(patch, ITEM_SHARED_FIELDS)`，改名 trim + 同板去重（排除自身 `_id: _.neq(itemId)`），`update({ ...allow, updateTime })`
- **幂等**：✅ 覆盖式更新

### 4.6 `deleteItem` — 软删除 / 恢复

- **入参**：`{ itemId, deleted = true }`（`deleted:false` 即一键恢复，移出/恢复共用一函数）
- **核心**：

```js
const now = db.serverDate();
await db.collection(COLLECTION.ITEM).doc(itemId).update({ data: {
  deleted: !!deleted, deletedBy: deleted ? OPENID : '',
  deletedAt: deleted ? now : null, updateTime: now,
}});
return ok({ itemId, deleted: !!deleted });
```

- **绝不物理删**（PRD §8.2）：A 移出 B 在追的番，B 进度不蒸发，对方可恢复
- **幂等**：✅

### 4.7 汇总表

| 云函数 | 入参 | 关键校验 | 幂等 | MVP |
|--------|------|---------|------|-----|
| `getMyOpenid`（已有） | — | — | ✅ | ✅ |
| `createBoard` | name?, profile? | name 长度 | ✕(语义) | ✅ |
| `joinBoard` | boardId, token, profile? | 存在/未归档/token/未满/去重 + 原子闸门 | ✅(本人重入) | ✅ |
| `addItem` | boardId, name, totalEp?, airStatus?, cover? | 成员/name/同板去重 | 去重兜底 | ✅ |
| `updateProgress` | itemId, ep, status | 成员/未删/status/ep clamp | ✅ | ✅ |
| `updateItem` | itemId, patch | 成员/白名单/改名去重 | ✅ | ✅ |
| `deleteItem` | itemId, deleted? | 成员/存在 | ✅ | ✅ |

---

## 5. `config.js` 设计与「前端 / 云函数共用」务实方案

### 5.1 常量清单（`packageFeatures/utils/shared-board/config.js`，权威源）

```js
const COLLECTION = { BOARD: 'shared_boards', ITEM: 'shared_board_items', NUDGE: 'shared_board_nudges' };
const BOARD_MEMBER_LIMIT = 2;                    // 人数上限（不写死数字 2）
const BOARD_STATUS  = { ACTIVE: 'active', FULL: 'full', ARCHIVED: 'archived' };
const MEMBER_ROLE   = { OWNER: 'owner', GUEST: 'guest' };
const AIR_STATUS    = { AIRING: 'airing', FINISHED: 'finished', UNKNOWN: 'unknown' };
const PROGRESS_STATUS = ['want', 'watching', 'caught_up', 'paused', 'done', 'dropped'];
const PROGRESS_STATUS_DEFAULT = 'want';
const EP_MIN = 0;                                // 0 = 未开追
const EP_MAX_WHEN_UNKNOWN = 9999;                // 无 totalEp 时上限兜底
const PAIR_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;   // 配对 token 有效期 24h
const DEFAULT_BOARD_NAME = '我俩的番单';
const BOARD_NAME_MAX = 20;
const ITEM_NAME_MAX = 60;
const ITEM_SHARED_FIELDS = ['name', 'totalEp', 'airStatus', 'cover']; // updateItem 白名单
const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000;    // 催更冷却（Should）
const ERR = { OK:'OK', UNAUTHENTICATED:'ERR_UNAUTHENTICATED', INTERNAL:'ERR_INTERNAL',
  INVALID_PARAM:'ERR_INVALID_PARAM', BOARD_NOT_FOUND:'ERR_BOARD_NOT_FOUND', NOT_MEMBER:'ERR_NOT_MEMBER',
  BOARD_FULL:'ERR_BOARD_FULL', TOKEN_INVALID:'ERR_TOKEN_INVALID', TOKEN_EXPIRED:'ERR_TOKEN_EXPIRED',
  TOKEN_USED:'ERR_TOKEN_USED', ITEM_NOT_FOUND:'ERR_ITEM_NOT_FOUND', DUPLICATE_ITEM:'ERR_DUPLICATE_ITEM',
  INVALID_EP:'ERR_INVALID_EP', INVALID_STATUS:'ERR_INVALID_STATUS' };
// 视图层阈值（transform 用，UI §8）
const VIEW = { AXIS_LEAD_ANCHOR: 75, OVERLAP_PCT: 3, BREAK_GAP: 12, BLUR_GAP: 5 };
// 分区（UI §P2，不硬编码顺序）
const SECTION = { TOGETHER:'together', NOT_STARTED:'not_started', PAUSED:'paused', DONE:'done' };
const SECTION_ORDER = [SECTION.TOGETHER, SECTION.NOT_STARTED, SECTION.PAUSED, SECTION.DONE];
// 首字色块调色板（从 TDesign 品牌色阶派生，JS 侧取不到 --td-* 变量，故集中配置）
const COVER_PALETTE = ['#0052D9','#0594FA','#00A870','#ED7B2A','#E34D59','#834EC2','#EBB105'];

module.exports = { COLLECTION, BOARD_MEMBER_LIMIT, BOARD_STATUS, MEMBER_ROLE, AIR_STATUS,
  PROGRESS_STATUS, PROGRESS_STATUS_DEFAULT, EP_MIN, EP_MAX_WHEN_UNKNOWN, PAIR_TOKEN_TTL_MS,
  DEFAULT_BOARD_NAME, BOARD_NAME_MAX, ITEM_NAME_MAX, ITEM_SHARED_FIELDS, NUDGE_COOLDOWN_MS,
  ERR, VIEW, SECTION, SECTION_ORDER, COVER_PALETTE };
```

> `COVER_PALETTE` 用字面色值，是因为 WXSS 的 `--td-*` 变量在 JS 侧取不到。从 TDesign 品牌色阶人工派生并注释来源，属「配置层集中管理」而非「散落硬编码」，符合铁律。真按变量取色需 `wx.getComputedStyle`，Should 阶段再说。

### 5.2 前端 / 云函数共用问题（根因 + 务实方案）

**根因**：微信云函数**每个目录独立打包，只能 `require` 自身目录内文件**，无法 require 到 `miniprogram/` 或别的云函数目录。config 天然没法「一处定义两处 import」。

**务实方案（MVP 够用）**：
1. **权威源** = 前端 `config.js`（transform、页面、测试都从它取）。
2. **云函数侧** = 每个业务函数目录放 `constants.js`，内容是权威源里**服务端子集**的拷贝（`COLLECTION / BOARD_MEMBER_LIMIT / *_STATUS / MEMBER_ROLE / AIR_STATUS / PROGRESS_STATUS / EP_* / PAIR_TOKEN_TTL_MS / *_MAX / ITEM_SHARED_FIELDS / ERR`——**不含** `VIEW/SECTION/COVER_PALETTE` 纯前端项）。
3. **防漂移** = `tests/shared-board.test.js` 加守卫测试：Node 同时 require 前端 config 和某云函数 constants，对**共享子集键值**深比较，不一致就红。测试跑本地磁盘，能同时读两处，无需构建。
4. 减少拷贝点：可在部署脚本 `cp cloudfunctions/_shared-board/constants.js cloudfunctions/<fn>/`，仍由第 3 步兜底。

> 为什么不发私有 npm 包：2 人小工具、常量十来个几乎不变，引私有 registry 是过度设计。拷贝 + 一条深比较测试，把「漂移」变成一次红色测试而非线上事故，成本收益最优。

---

## 6. `transform.js` 纯函数设计（对齐 mahjong/worldcup 风格）

要求：CommonJS、纯函数、**无 `wx.*`/`cloud.*` 依赖**、`module.exports`、可 Node 测。副作用留页面。

```js
clampEp(ep, totalEp)
// 非整/负→null；totalEp 已知则 min(ep,totalEp)；未知则 min(ep, EP_MAX_WHEN_UNKNOWN)。与云函数同规则。

resolvePeer(members, myOpenid) -> peerOpenid | null   // 找出「不是我」的那个；一人时 null

pickCoverColor(name, palette=COVER_PALETTE) -> { char, color }
// 首字色块：char=首字符；color=palette[hash(name)%len]。hash 用稳定算法保证同名恒定同色（可测）。

buildProgressPair(item, myOpenid, peerOpenid) -> {
  mine:{ep,status}, peer:{ep,status}|null, hasPeer, hasTotalEp,
  minePercent, peerPercent,              // 0..100（无分母按 VIEW.AXIS_LEAD_ANCHOR 归一）
  commonPercent, leadWidth,              // 轴分段，对应 UI §3.1 DOM
  lead:'mine'|'peer'|'even'|'none',      // none=对方未翻牌
  diff,                                  // |mineEp-peerEp|，无 peer 时 null
  gapMode:'exact'|'blurred'|'break',     // ≤BLUR_GAP 精确 / >BLUR_GAP 模糊 / >BREAK_GAP 断裂
  isOverlap,                             // |Δpercent|<OVERLAP_PCT → 头像重叠 ◉
}
// 分支：我领先/对方领先/持平/无 totalEp/进度回退(被clamp)/对方未翻牌。只出中性结构，正向文案在页面层。

safeTalkEp(mine, peer) -> number         // 「能安全聊到第几集」=min(mineEp,peerEp)，对方未翻牌为0。核心价值锚点

sectionOf(pair, mine, peer) -> SECTION.*
// 都 done→DONE；任一 paused/dropped 且非都done→PAUSED；至少一人 watching/caught_up→TOGETHER；否则→NOT_STARTED

groupItems(items, myOpenid, peerOpenid) -> [{ sectionKey, items:[vm] }]
// 1)过滤 deleted 2)每条 buildItemViewModel 3)按 sectionKey 归组，组内按 sortOrder[my] 升序（缺省 createTime）
// 4)按 SECTION_ORDER 输出非空组

buildBoardViewModel(board, items, myOpenid) -> {
  boardId, name, status, phase:'waiting'|'paired'|'archived',
  me:{openid,nickname,avatar}, peer:{...}|null,   // peer null→虚位头像/呼吸态
  sections: groupItems(...), commonCount,          // 「N 部能一起聊」
}
```

输入输出示例：

```js
// 我领先有分母
buildProgressPair({ totalEp:28, progress:{me:{ep:12,status:'watching'},pe:{ep:8,status:'watching'}} },'me','pe')
// => { lead:'mine', diff:4, minePercent:~42.9, peerPercent:~28.6, gapMode:'exact', isOverlap:false, ... }
// 无分母：领先者锚 75%
buildProgressPair({ totalEp:null, progress:{me:{ep:8},pe:{ep:12}} },'me','pe')
// => { hasTotalEp:false, peerPercent:75, minePercent:50, lead:'peer', diff:4, ... }
// 对方未翻牌
buildProgressPair({ totalEp:28, progress:{me:{ep:3}} },'me','pe')
// => { peer:null, hasPeer:false, lead:'none', diff:null, ... }
```

---

## 7. `tests/shared-board.test.js`

对齐现有 `worldcup.test.js` 的断言风格（`eq(name, actual, expected)` + 深比较 + 计数 + `process.exit`），零依赖，`node tests/shared-board.test.js` 直接跑。覆盖分支：

- **buildProgressPair**：我领先(lead='mine',diff=4)/对方领先/持平(even,isOverlap=true)/无总集数(hasTotalEp=false,peerPercent=AXIS_LEAD_ANCHOR)/进度回退(ep>totalEp 被 clamp,不超100)/对方未翻牌(peer=null,lead='none')/模糊档(diff>BLUR_GAP)/断裂档(diff>BREAK_GAP)
- **clampEp**：`clampEp(30,28)===28`、`clampEp(-1,null)===null`、`clampEp(5,null)===5`、`clampEp(3.5,null)===null`
- **pickCoverColor**：同名两次 color 相同；char===首字符
- **sectionOf/groupItems**：两人 watching→TOGETHER；一人 want 一人无进度→NOT_STARTED；一方 dropped→PAUSED；都 done→DONE；软删除过滤；组内按 sortOrder[my] 升序；分区顺序===SECTION_ORDER 过滤空组
- **resolvePeer**：2 人板返回对方；1 人板 null
- **safeTalkEp**：min(mine,peer)；对方未翻牌→0
- **config 漂移守卫**：require 云函数 constants 与前端 config，深比较 COLLECTION/BOARD_MEMBER_LIMIT/PROGRESS_STATUS/ERR

`package.json` 的 `test` 追加 `&& node tests/shared-board.test.js`。

---

## 8. 实施顺序建议（每步可独立验证）

1. **建集合 + 权限规则**（控制台）：建两集合，粘 §2.6 规则（先上方案 A），建 §2.4 索引。验证：手插一条含自己 openid 的 board，真机能读、非成员读不到。
2. **config.js + 云函数 constants.js 拷贝**。验证：`node -e "require('./.../config')"` 无语法错。
3. **transform.js + tests**：纯逻辑**完全离线可测**，价值最高风险最低，优先做测绿建立信心。验证：`npm test` 全绿。
4. **云函数逐个上线**（依赖顺序）：createBoard → joinBoard → addItem → updateProgress → updateItem → deleteItem。每个用控制台云函数测试跑通；`joinBoard` 的防并发/token 用**第二个测试微信号**真机走配对，验证：伪造 openid 无效、token 过期/复用被拒、两号同扫只成 1 人。
5. **收尾**：README「纯原生无云开发」改写、architecture、MEMORY 更新集合与云函数清单。

> 顺序要点：**先纯逻辑后云函数**——transform 无云依赖，先测绿；云函数按真实数据流依赖顺序上。

---

## 9. 风险与开放点（需拍板，附推荐）

| # | 开放点 | 推荐 | 理由 |
|---|--------|------|------|
| **O1** | items 读规则用 get() 反查（B）还是冗余 memberOpenids（A） | **方案 A（冗余）** | 免 get() 读配额、免查询必带 boardId、规则更简。代价：入板前已加的番需 joinBoard 批量回填 memberOpenids，量极小 |
| **O2** | deleteItem 兼做恢复的命名歧义 | 单函数 + 参数，注释写清「移出/恢复同源」 | 一个标记位正反两态不必拆两函数 |
| **O3** | sortOrder 拖拽改序 UI 是否进 MVP | **不进**，字段先落，默认 createTime | 主要靠分区，手动拖序锦上添花，字段就位不返工 |
| **O4** | 昵称/头像过时刷新 | **Should** `onShow` 静默 updateMemberProfile | MVP 快照够用，结构已支持 |
| **O5** | token 过期后续期 | **Should** 加 refreshPairToken | MVP 24h 够用，pairing 结构支持续期 |
| **O6** | getUserProfile 需主动授权，可能拿不到头像 | MVP 允许空，前端首字色块兜底 | 避免为头像卡住配对 |
| **O7** | 未读红点 lastViewedAt | 建议**写入提前到 MVP 埋点**，红点 UI 放 Should | 上线即有数据，Should 直接点亮零回填。否则「有来有回」体感打折 |
| **O8** | 免费额度 | 2 人远在额度内，注明按量计费，封面外链不落云存储 | PRD §10，O1 选 A 进一步压读配额 |

---

**落地文件**：权威源 `miniprogram/packageFeatures/utils/shared-board/{config,transform}.js`；测试 `tests/shared-board.test.js`；云函数 `cloudfunctions/{createBoard,joinBoard,addItem,updateProgress,updateItem,deleteItem}/`；环境配置已就位 `miniprogram/config/cloud.js`。


