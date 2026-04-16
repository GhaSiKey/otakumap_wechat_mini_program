# 光栅卡 (lenticular)

## 功能说明

选择多张图片（2-9张），通过倾斜手机体验百叶窗式的图像切换效果。

## 页面路径

```
/packageFeatures/pages/lenticular/lenticular-edit   # 编辑页
/packageFeatures/pages/lenticular/lenticular-preview # 预览页
```

## 核心算法

### 1. 低通滤波

平滑传感器数据，减少噪声和抖动。

```javascript
function applyLowPassFilter(currentValue, previousValue, alpha) {
  return alpha * currentValue + (1 - alpha) * previousValue;
}
```

- `alpha = 0.35`: 值越大越灵敏，越小越平滑

### 2. 角度计算

```javascript
pitch = res.beta;   // 俯仰角：绕X轴 [-180, 180]
roll = res.gamma;   // 横滚角：绕Y轴 [-90, 90]
```

### 3. 图像索引计算

```javascript
const result = engine.update(angle, imageCount, degreesPerImage);
// result.fraction: 当前条纹透明度 [0, 1]
// result.displayIndex: 当前显示的图像索引
```

### 4. CSS Mask 生成

**核心思想**: 百叶窗效果

- 每个条纹独立控制透明度
- 前端条纹先变化，后端条纹后变化（渐进扫过）
- 使用 6-stop 渐变确保边缘锐利

```javascript
function buildMaskStyle(fraction, sensingAxis) {
  // fraction ∈ [0, 1]
  // 生成 stripCount 条条纹的渐变
}
```

**条纹方向**:
- `sensingAxis = 'vertical'` → 使用横条纹（前后倾）
- `sensingAxis = 'horizontal'` → 使用竖条纹（左右倾）

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `FILTER_ALPHA` | 0.35 | 低通滤波系数 |
| `STRIP_COUNT_VERTICAL` | 24 | 竖条纹数量 |
| `STRIP_COUNT_HORIZONTAL` | 36 | 横条纹数量 |
| `SWEEP_SPREAD` | 0.4 | 扫过扩散范围 |
| `degreesPerImage` | 8 | 每张图片的角度跨度 |

## 数据结构

### 编辑页状态

```javascript
{
  images: string[],           // 图片路径列表（最多9张）
  sensingAxis: 'vertical' | 'horizontal',
  degreesPerImage: number,
  showDebug: boolean,
  displayIndex: number,        // 当前显示的图像索引
  nextIndex: number,           // 下一张图像索引
  maskStyle: string,           // CSS mask 样式
  // 调试信息
  filteredPitch: string,
  filteredRoll: string,
  debugBallX: number,
  debugBallY: number,
  // 拖拽排序
  dragging: boolean,
  dragIndex: number,
  dragTargetIndex: number,
}
```

### 预览页接收数据

通过 `app.globalData.lenticularData` 传递：

```javascript
{
  images: string[],
  sensingAxis: string,
  degreesPerImage: number,
  showDebug: boolean,
}
```

## 微信API使用

| API | 用途 |
|-----|------|
| `wx.chooseMedia()` | 选择图片 |
| `wx.startDeviceMotionListening()` | 启动陀螺仪 |
| `wx.onDeviceMotionChange()` | 监听角度变化 |
| `wx.stopDeviceMotionListening()` | 停止陀螺仪 |
| `wx.vibrateShort()` | 拖拽反馈震动 |
| `wx.createSelectorQuery()` | 获取元素位置 |

## 拖拽排序实现

使用 `createSelectorQuery().boundingClientRect()` 获取网格布局位置：

1. `onDragStart`: 记录触摸位置与网格偏移
2. `onDragMove`: 遍历 `_gridRects` 找当前触摸点所在的格子
3. `onDragEnd`: 执行 splice 交换图片顺序

## 视觉效果

```
fraction = 0.0        fraction = 0.5        fraction = 1.0
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│░░░░░░░░░░░░│       │▓▓▓▓▓░░░░░░░│       │████████████│
│░░░░░░░░░░░░│       │░░▓▓▓▓▓▓░░░░░│       │░░░░░░░░░░░░│
│░░░░░░░░░░░░│       │░░░░░▓▓▓▓▓▓░░│       │░░░░░░░░░░░░│
│░░░░░░░░░░░░│       │░░░░░░░░▓▓▓▓│       │░░░░░░░░░░░░│
└─────────────┘       └─────────────┘       └─────────────┘
   全透明              渐进扫过               全不透明
```

## 扩展计划

- [ ] 保存光栅卡配置到本地
- [ ] 分享光栅卡效果
- [ ] 添加更多条纹样式（波纹、渐变等）
