# 圣地巡礼功能设计

> 状态：功能已实现，待云端部署与真机验收（分支 `codex/pilgrimage-feature`）
>
> 数据来源：弹弹play负责作品搜索与 Bangumi Subject ID 线索；Anitabi 负责巡礼作品摘要和地点数据。
> 重要边界：不调用 Bangumi API，不抓取 Anitabi 主站内部数据，不维护人工作品映射。

## 1. 功能范围

首版包含三项核心能力：

1. **圣地巡礼作品搜索**：复用现有 `animeMeta` 云函数和弹弹play搜索，用户选择作品后再解析其 Bangumi Subject ID。
2. **番剧收藏**：收藏已成功关联 Anitabi 的作品，使用本地 Storage 保存；同时保存最近浏览，方便再次进入。
3. **巡礼地点搜索**：在已选作品的 Anitabi 公共 API 点位中，按地点中文名、原名、来源和集数筛选，并支持地图/列表两种浏览方式。

首版不包含：

- Bangumi API 或对 Bangumi 国内域名的任何请求。
- 人工映射后台、用户提交映射或标题模糊猜测。
- Anitabi 全站作品搜索、主站 HTML 抓取、`/d/g*.json` 内部数据或内部 API。
- 全站“附近所有作品”聚合、轨迹记录和到访打卡。
- 对比拍照、到访打卡和跨设备收藏同步。

## 2. 关键决策

### 2.1 作品 ID 解析

弹弹play搜索结果的 `sourceId` 是弹弹play animeId；`bangumiId` 是弹弹play新版异构作品 ID，二者都不能直接作为 Anitabi 的路径参数。

用户选择搜索结果后，请求弹弹play详情，并在 `animeMeta` 服务端：

1. 优先从 `bangumiUrl` 提取 `/subject/{正整数}`。
2. 回退到 `onlineDatabases[].url` 中符合白名单域名的链接。
3. 仅接受 `bgm.tv` 和 `bangumi.tv`，不跟随或请求该 URL。
4. 返回裁剪后的 `bgmSubjectId: number | null`，不向前端暴露原始数据库链接。

缺少或冲突的映射直接按空态处理：

```text
暂未找到该作品的圣地巡礼数据
```

不写人工映射表，不让用户提交候选，也不按标题扫描 Anitabi ID。

### 2.2 Anitabi 公共 API 完整性

使用两个公开端点：

- `/bangumi/{subjectId}/lite`
- `/bangumi/{subjectId}/points/detail`（保留无图但有坐标的地点）

`points/detail` 可能只返回公开 API 的点位子集。云端点位 DTO 同时保留：

- `returnedCount`：本次公共详情接口返回数。
- `sourceCount`：上游本次响应中的原始条数。
- `truncated`：是否触发客户端 500 条安全上限。
- `pointsLength`：`lite` 声明的完整地图点位数。

当 `truncated=true`，或可信的 `pointsLength` 大于 `returnedCount` 时，文案使用“公共接口提供 N 个地点 · 完整地图 M 个”，不能宣称当前列表为全部地点。摘要和点位采用独立缓存；若实际返回数暂时大于旧摘要声明数，以本次实际返回为准，避免产生倒挂文案。

### 2.3 空态与错误态

以下情况是**空态**：

- 弹弹play详情没有可解析的 `bgmSubjectId`。
- Anitabi 明确返回没有该作品或 `pointsLength` 为 0。
- 标题证据明显冲突，无法信任映射。

以下情况是**错误态**，必须提供重试，不能伪装成空态：

- 云函数未配置或未部署。
- 上游超时、403、5xx、非 JSON 响应。
- 图片或点位响应结构异常。

## 3. 页面与交互

### 3.1 作品发现页 `pilgrimage-search`

页面目标是“从一部番开始”，首屏保持一个主任务：搜索作品。

- 顶部搜索框：输入番名，调用现有弹弹play搜索。
- 最近浏览：横向作品封面轨道。
- 我的收藏：展示已验证且用户收藏的巡礼作品。
- 搜索结果：海报、番名、类型、年份、集数；不为列表每一项提前请求详情或 Anitabi，避免 N+1 请求。
- 点击结果：先取弹弹play详情解析 ID，再进入地图页；缺映射进入空态。
- 点击收藏/最近项：直接使用已保存的 `bgmSubjectId` 进入地图页。

### 3.2 地图页 `pilgrimage-map`

- 顶部显示作品信息、收藏开关和地点搜索框。
- 地图/列表切换共享同一套筛选状态。
- 集数筛选横向滚动，包含“全部”和稳定排序后的集数标签。
- 地图使用原生 `<map>`；标记 ID 使用独立数字索引，不强转 Anitabi 字符串 ID。
- 点击 Marker 选中地点，下方显示地点摘要并可进入详情。
- 地点搜索只过滤已获取的当前作品点位，不向上游发送关键词。
- “查看全部”只调整已加载巡礼点的地图视野，不读取设备当前位置。
- 成功打开作品后写入最近浏览；收藏只保存在本机。

### 3.3 地点详情页 `spot-detail`

- 展示 `h360` 参考截图；无图时展示明确占位。
- 展示中文名/原名、作品名、集数和时间、坐标。
- 保留 `origin` 和 `originURL`，支持复制来源链接。
- 导航按钮调用 `wx.openLocation`。
- 展示巡礼礼仪提醒：遵守现场规则、不进入私人区域、不影响当地居民。
- 同集地点以横向列表展示，点击后在当前详情页切换。

## 4. 视觉系统

视觉延续现有 TDesign 蓝色体系，加入克制的旅行手账感：

| 角色 | 规则 |
|---|---|
| 页面背景 | 复用 `--td-bg-color-page`，亮暗模式分别适配 |
| 主色 | 复用 `--td-brand-color`，用于搜索、地图选中态和主按钮 |
| 收藏色 | 独立珊瑚语义变量，只用于已收藏状态 |
| 容器 | 白/深色容器，18–24rpx 圆角，避免多层嵌套卡片 |
| 图片 | 番剧海报 3:4；地点截图 16:9；列表使用 `h160`，详情使用 `h360` |
| 地图 | 地图为主视觉，筛选和详情不遮挡主要地图内容 |
| 字体 | 复用全局 PingFang SC/TDesign 字号令牌，主标题 32–36rpx，正文 24–28rpx |

所有文案、Storage key、数量限制、默认坐标和页面路径集中在 `utils/pilgrimage/config.js`；页面 WXSS 只引用全局或功能级 CSS 变量。

## 5. 数据流与模块

```text
pilgrimage-search
  ├─ animeMeta.search(keyword)
  └─ animeMeta.detail(sourceId)
        └─ bgmSubjectId
              ↓
pilgrimageData.getSubjectSummary(bgmSubjectId)
              ↓
pilgrimageData.getSubjectPoints(bgmSubjectId)
              ↓
transform/filter/marker view model
              ↓
pilgrimage-map → spot-detail
```

目录：

```text
miniprogram/packageFeatures/pages/pilgrimage/
  pilgrimage-search.*
  pilgrimage-map.*
  spot-detail.*

miniprogram/packageFeatures/utils/pilgrimage/
  config.js
  cloud-api.js
  transform.js
  geo.js
  storage.js

cloudfunctions/pilgrimageData/
  index.js
  constants.js
  upstream.js
  cache.js
  service.js
  transform.js
```

## 6. 缓存与存储

- `pilgrimage_cache`：云端缓存 Anitabi 摘要和点位，缓存失败不阻断上游请求。
- `lite.modified`：随摘要保留供界面/后续增量策略使用；当前按 TTL 刷新，上游瞬时异常时允许返回未过度陈旧的缓存。
- 本地收藏：只保存作品摘要和 ID。
- 最近浏览：去重、按最近时间排序并限制条数。
- 不永久搬运 Anitabi 图片到云存储；只保存上游 URL。

## 7. 坐标与导航边界

- Anitabi `geo` 按 `[latitude, longitude]` 解析并做范围校验。
- 原始数据按 GPS/WGS84 保存；传入微信地图前，仅中国大陆坐标派生 GCJ-02，境外保持不变。
- 小程序不读取设备当前位置，也不申请位置权限。
- 详情页导航只把用户选中的公开点位坐标交给 `wx.openLocation`，不读取或保存用户位置。

## 8. 署名与上线限制

- 地点详情必须展示 `origin`；有 `originURL` 时提供“复制来源链接”操作。
- 地图与详情界面明确注明数据来自 Anitabi，并遵守其开放 API 和 CC BY-NC-SA 4.0 要求。
- 若小程序存在广告、付费或商业推广，上线前需取得 Anitabi 的书面许可。
- 云端和真机必须分别验证 `api.anitabi.cn`、`image.anitabi.cn` 的可达性；403 视为服务错误，不视为无数据。
- 地点图片加载失败时，界面只显示“暂时无法加载”的占位，不把网络或域名配置问题误报成“没有参考图”；不得通过抓取 Anitabi 主站规避访问限制。

## 9. 部署与验收清单

1. 重新部署 `animeMeta` 云函数（包含 Subject ID 解析和旧详情缓存的首次懒刷新）；保留已有 `DDP_APP_ID` / `DDP_APP_SECRET` 环境变量。
2. 上传并部署新云函数 `pilgrimageData`，选择“云端安装依赖”，超时时间至少覆盖其 8 秒上游超时。
3. 新建仅云函数使用的数据库集合 `pilgrimage_cache`；集合暂时缺失不会阻断查询，但不会获得缓存与旧数据降级能力。
4. 在小程序后台的“开发管理 → 开发设置 → 服务器域名”中，把 `https://image.anitabi.cn` 和 `https://assets.anixplayer.net` 加入 `downloadFile` 合法域名。开发者工具里关闭域名校验只对本地调试有效，不能替代后台配置。
5. 真机分别验收：缺映射空态、Anitabi 403 错误态、地图/列表筛选、收藏持久化、来源署名和固定地点导航。
