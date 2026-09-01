# 一起看（第一版）

## 产品范围

「一起看」是共享番单中的持久子清单，不是新的追番状态，也不按周清空。顶部入口使用短文案
“一起看”，独立页面标题使用更有场景感的“周末一起看”，但功能不限制使用日期。

- 两人已配对的板显示入口；归档后的双人板仍可进入只读清单。
- 入口是板页顶部工具行中的固定小胶囊，点击进入独立页面。
- 任一成员都可以把现有番剧加入或移出清单。
- 清单不记录排期、周次、加入者或“已完成”状态；番剧会一直保留，直到成员主动移出。
- 每次“一起看”选择 `+1 / +2 / +3 / 自定义`，确认后一次更新两人的进度，番剧仍留在清单。

## 数据模型

第一版不新增集合，直接在 `shared_board_items` 文档上增加：

```js
togetherWatch: {
  active: true,
  version: 1,
  updateTime,
  lastAdvance: {
    requestId,
    targetEp,
    changes,
    updateTime
  }
}
```

字段缺失或 `active !== true` 表示不在清单。旧数据无需迁移。

## 云函数

`togetherWatch` 支持两个动作：

- `set`：`{ action, boardId, itemId, active }`
- `advance`：`{ action, boardId, itemId, targetEp, requestId }`

`advance` 在服务端事务中重新读取板、番剧和双方最新进度，并把两人分别推进到
`max(当前进度, targetEp)`。每个 `requestId` 对应的确定性事件文档同时充当持久回执；即使
后续又完成了别的共同推进，较早请求的迟到重试仍返回它自己的原结果，不重复推进。

共同推进写一条 `together_advance` 事件，`payload.changes` 分别记录两人的实际变化；
历史页显示为一次共同操作，周报按成员拆分实际增量。

## 并发约束

共同推进会修改对方进度，因此不能在前端连续调用两次个人 `updateProgress`。
现有个人进度写入也使用 `progress.<openid>.rev` 做版本校验：同一番的快速连点在前端串行折叠，
发现版本冲突时刷新权威数据，不用旧绝对值覆盖新进度。个人进度、板更新时间与历史事件在
同一事务提交；旧版客户端未传 `expectedRev` 时保留兼容路径，新版客户端才启用版本校验。

## 部署

发布小程序前，需要同时上传并部署：

- 新云函数 `togetherWatch`
- 修改后的 `updateProgress`
- 修改后的 `getBoardReport`

建议三者与小程序端同一批发布。`updateProgress` 对未传 `expectedRev` 的旧客户端保留兼容，
因此先部署云函数不会阻断仍在运行的旧小程序包。
