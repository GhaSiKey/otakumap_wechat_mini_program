# OtakuMap 架构设计文档

## 概述

OtakuMap 是一个微信小程序项目，采用「主包 + 功能分包」架构，核心是番剧追踪和光栅卡两个独立功能模块。

## 架构分层

```
┌─────────────────────────────────────────┐
│              视图层 (WXML)               │
│   页面结构 + 模板语法 + 事件绑定         │
├─────────────────────────────────────────┤
│              逻辑层 (JS)                 │
│   页面逻辑 + 数据状态 + 业务规则         │
├─────────────────────────────────────────┤
│              服务层 (JS)                 │
│   API调用 + 数据转换 + 缓存策略         │
├─────────────────────────────────────────┤
│              基础层                      │
│   微信API + TDesign组件 + 云开发        │
└─────────────────────────────────────────┘
```

## 核心模块

### 1. anime-checklist（番剧追踪）

**设计思想**: 单一数据源 + 派生视图

```
animeList (单一数据源)
    │
    ├── filter → unwatchedList (待追)
    └── filter → watchedList (已看完)
```

**关键实现**:

- `_updateLists()`: 核心派生方法，从 animeList 派生出两个子列表
- 状态管理: `isEditMode`、`animatingId`、`animPhase` 管理 UI 状态
- 动画状态机: 三阶段动画 (phase1→phase2→phase3)
- 持久化: `wx.setStorageSync` 存储到本地

**类比 Android 开发**:

| 微信小程序 | Android |
|-----------|---------|
| `Page.data` | ViewModel + LiveData |
| `this.setData()` | `LiveData.setValue()` |
| `_updateLists()` | Transformations.map() |
| `wx.setStorageSync` | SharedPreferences / Room |

### 2. lenticular（光栅卡）

**设计思想**: 传感器数据 → 信号处理 → 视觉效果

**核心算法** (`lenticular-engine.js`):

```
DeviceMotion API
    │
    ├── 低通滤波 (applyLowPassFilter)
    │   └── alpha = 0.35，平滑噪声
    │
    ├── 角度计算
    │   └── pitch (俯仰) / roll (横滚)
    │
    ├── 图像索引计算
    │   └── degreesPerImage 决定切换灵敏度
    │
    └── CSS Mask 生成
        └── 渐进扫过的条纹渐变
```

**CSS Mask 技术**:

```
buildMaskStyle(fraction, axis)
    │
    ├── 计算每条条纹的 localFraction
    │   └── t=0 的条纹先变化，t=1 的最后变化
    │
    └── 生成 6-stop 渐变
        └── transparent | black | transparent
```

### 3. 全局样式系统

基于 TDesign CSS 变量，支持深色模式：

```css
/* 亮色模式 */
@media (prefers-color-scheme: light) {
  --td-brand-color: #0052d9;
  --td-bg-color-page: #f3f3f3;
}

/* 深色模式 */
@media (prefers-color-scheme: dark) {
  --td-brand-color: #2667d4;
  --td-bg-color-page: #181818;
}
```

## 数据流

### anime-checklist 数据流

```
用户输入 → onAddAnime()
    │
    → 生成 newItem { id, name, watched: false, createTime }
    │
    → animeList = [newItem, ...animeList]
    │
    → _updateLists()
        │
        ├── unwatchedList = animeList.filter(!watched)
        ├── watchedList = animeList.filter(watched)
        │
        → setData({ animeList, unwatchedList, watchedList, ... })
        │
        → _saveData() → wx.setStorageSync()
```

### 光栅卡数据流

```
wx.onDeviceMotionChange(res)
    │
    ├── pitch = res.beta
    ├── roll = res.gamma
    │
    ├── applyLowPassFilter() → 滤波平滑
    │
    ├── engine.update(angle, imageCount, degreesPerImage)
    │   │
    │   ├── fraction = (angle % range) / range
    │   └── displayIndex = floor(angle / degreesPerImage)
    │
    ├── buildMaskStyle(fraction, axis)
    │
    → setData({ maskStyle, displayIndex, ... })
```

## 分包策略

| 分包 | 功能 | 主包依赖 |
|------|------|----------|
| anime-checklist | 番剧追踪 | TDesign 组件 |
| lenticular | 光栅卡 | TDesign 组件 + 传感器 |

分包减小主包体积，用户按需加载。

## 扩展方向

1. **对接 Bangumi API**: 在 services/ 层封装 API 调用，获取番剧详情
2. **云同步**: 使用云开发数据库替代本地 Storage
3. **分享能力**: 番单分享到微信聊天
