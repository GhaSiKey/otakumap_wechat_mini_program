# 番剧追踪 (anime-checklist)

## 功能说明

番剧追踪页使用弹弹play 的真实番剧元数据，并在本地保存个人观看进度：

- 搜索番剧后自动带入名称、封面、总集数、年份、评分和放送信息
- 支持手动输入，兼容迁移旧版追番清单
- 记录当前看到第几集，支持快捷前进/回退
- 按想看、在追、看完筛选，支持排序、删除和分享
- 封面加载失败时显示首字占位，亮色/暗色主题均可用

## 页面路径

```
/packageFeatures/pages/anime-checklist/anime-checklist
```

## 数据结构

本地 Storage key 仍为 `anime_checklist_data`，写入版本化 envelope：

```typescript
interface AnimeChecklistItem {
  id: string;
  sourceId: number | null;      // 弹弹play animeId
  name: string;
  cover: string;
  typeDesc: string;
  year: string;
  startDate: string;
  rating: number;
  totalEp: number | null;
  currentEp: number;
  status: 'want' | 'watching' | 'caught_up' | 'paused' | 'done' | 'dropped';
  watched: boolean;             // 旧模板兼容字段，由 status 派生
  airStatus: 'airing' | 'finished' | 'unknown';
  airDay: number | null;        // 0=周日，1=周一…6=周六
  createTime: number;
  updateTime: number;
}
```

旧版裸数组 `{ id, name, watched, createTime }[]` 会在读取时归一化为版本 2，缺失的元数据使用安全默认值。当前进度属于用户本地记录，真实接口只提供番剧总集数和放送信息。

## 真实数据链路

页面通过 `utils/anime-meta/cloud-api.js` 调用 `animeMeta` 云函数。点击“搜索番剧自动添加”进入 `anime-search` 的 `pick` 模式，选中结果后通过 EventChannel 返回；随后按 `sourceId` 补拉详情，优先使用详情 medium 封面，失败时保留搜索结果。

搜索或详情服务不可用时不影响已保存清单，手动输入仍可使用。封面 URL 只使用接口原值，不自行拼接清晰度路径。

## 交互与状态

页面顶部展示全部数量、在追数量、看完数量和平均完成度。每张卡片展示真实封面、放送信息、进度条及“看到下一集”操作；已知总集数时进度不会超过 100%，未知总集数显示当前集数。排序模式收敛为上移、下移和删除操作。

空清单提供搜索引导；筛选无结果时显示分类空态；封面失败回退到首字色块。所有颜色使用 TDesign CSS 变量并适配暗色模式。

## 相关代码

- 页面：`miniprogram/packageFeatures/pages/anime-checklist/`
- 数据归一化：`miniprogram/packageFeatures/utils/anime-checklist/transform.js`
- 展示配置：`miniprogram/packageFeatures/utils/anime-checklist/config.js`
- 元数据接口：`miniprogram/packageFeatures/utils/anime-meta/cloud-api.js`
