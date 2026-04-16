# 番剧追踪 (anime-checklist)

## 功能说明

记录用户的追番清单，支持：
- 添加番剧名称
- 标记已看完/未看
- 拖拽排序
- 左右滑动删除
- 分享追番清单

## 页面路径

```
/packageFeatures/pages/anime-checklist/anime-checklist
```

## 数据结构

### animeItem

```typescript
interface animeItem {
  id: string;           // 唯一标识，格式: anime_{timestamp}_{random9}
  name: string;        // 番剧名称
  watched: boolean;    // 是否已看完
  createTime: number;  // 创建时间戳
}
```

### Storage Key

```
anime_checklist_data
```

存储完整的 `animeItem[]` 数组。

## 核心方法

### _updateLists(animeList)

从单一数据源派生出两个子列表并同步到视图。

**参数**:
- `animeList: animeItem[]` - 单一数据源

**逻辑**:
```javascript
const unwatchedList = animeList.filter(item => !item.watched);
const watchedList = animeList.filter(item => item.watched);
this.setData({ animeList, unwatchedList, watchedList, watchedCount: watchedList.length });
this._saveData(animeList);
```

### 动画状态机

```
onToggleWatched(id)
    │
    ├── Phase 1 (0-400ms)
    │   └── checkbox 弹跳 + 卡片闪光
    │   └── setData({ animPhase: 'phase1', animatingId: id })
    │
    ├── Phase 2 (400-750ms) [仅长距离移动]
    │   └── 卡片滑出原列表
    │   └── setData({ animPhase: 'phase2' })
    │
    └── Phase 3 (750-1150ms) [仅长距离移动]
        └── 卡片滑入新列表
        └── setData({ animPhase: 'phase3' })
```

**动画类名**:
- `.anime-item--glow` - 卡片闪光
- `.anime-item--fly-down` / `--fly-up` - 滑出
- `.anime-item--enter-from-top` / `--enter-from-bottom` - 滑入
- `.anim-bounce-in` / `.anim-bounce-out` - checkbox 弹跳

## 界面布局

```
┌─────────────────────────────────────┐
│  输入框: "输入番剧名称，回车添加"    │ [+]│
├─────────────────────────────────────┤
│  已看 3/10 部              [排序]   │
├─────────────────────────────────────┤
│  待追                               │
│  ┌─────────────────────────────┐    │
│  │ ○ 进击的巨人 S4            │    │
│  └─────────────────────────────┘    │
│  ┌─────────────────────────────┐    │
│  │ ○ 鬼灭之刃                 │    │
│  └─────────────────────────────┘    │
│  已看完                             │
│  ┌─────────────────────────────┐    │
│  │ ● 咒术回战                 │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

## API 接口

无后端接口，数据存储在微信本地 Storage。

## 扩展计划

- [ ] 对接 Bangumi API 自动补全番剧名称
- [ ] 云端同步追番数据
- [ ] 追番进度（看到第几集）
- [ ] 番剧评分和评论
