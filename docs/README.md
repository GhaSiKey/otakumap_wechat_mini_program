# OtakuMap 微信小程序

二次元爱好者的工具箱，提供番剧追踪和光栅卡等实用功能。

## 功能列表

| 功能 | 说明 | 入口 |
|------|------|------|
| 番剧追踪 | 记录追番清单，标记已看完的番剧，支持拖拽排序 | 分包 pages/anime-checklist |
| 共享追番板 | 两人共享一份番单，各自维护进度，同轴对比「能安全聊到第几集」 | 分包 pages/shared-board |
| 光栅卡 | 选择多张图片，倾斜手机体验百叶窗切换效果 | 分包 pages/lenticular |
| 日麻点数计算 | 输入手牌自动计算符数、役种和点数 | 分包 pages/mahjong-score |
| 世界杯赔率 | 2026 FIFA 世界杯赔率、赛程日历与赛事详情（静态快照） | 分包 pages/worldcup |

## 技术栈

- **框架**: 微信小程序 (miniprogram)，原生开发；前 4 个功能纯客户端，共享追番板起引入微信云开发
- **UI库**: TDesign Miniprogram ^1.5.0（仅分包使用）
- **分包策略**: 功能模块放入 subpackages 减小主包体积
- **数据存储**: 本地 Storage（番剧清单等纯客户端功能）+ 微信云数据库（共享追番板，跨端共享 + openid 身份）
- **后端**: 微信云开发（云函数 + 云数据库），仅共享追番板使用；环境 ID 配置在 `miniprogram/config/cloud.js`

## 项目结构

```
otakumap/
├── miniprogram/                    # 小程序主体
│   ├── pages/                      # 主包页面
│   │   └── index/                  # 首页（功能入口，纯 CSS 日夜间适配）
│   ├── packageFeatures/            # 分包（功能模块）
│   │   ├── pages/
│   │   │   ├── anime-checklist/     # 番剧追踪
│   │   │   ├── lenticular/          # 光栅卡
│   │   │   ├── mahjong-score/       # 日麻点数计算
│   │   │   └── worldcup/            # 世界杯赔率
│   │   └── utils/
│   │       ├── lenticular-engine.js # 光栅引擎核心算法
│   │       ├── mahjong/             # 日麻计算核心模块
│   │       │   ├── config/          # 配置文件
│   │       │   ├── parser.js        # 手牌解析
│   │       │   ├── fu-calculator.js # 符数计算
│   │       │   ├── yaku-checker.js  # 役种判定
│   │       │   ├── score-calculator.js # 点数计算
│   │       │   └── engine.js        # 核心引擎
│   │       └── worldcup/            # 世界杯数据模块
│   │           ├── data/worldcup-data.js # 赔率数据快照
│   │           └── transform.js     # 数据预处理（分组/色温/矩阵）
│   ├── app.js                      # 应用入口
│   ├── app.json                    # 应用配置
│   └── app.wxss                    # 全局样式（TDesign CSS变量）
├── tests/                          # 纯算法模块的 Node 测试（零依赖）
├── docs/                           # 项目文档
└── project.config.json             # 微信开发者工具配置
```

## 开发指南

### 环境要求

- 微信开发者工具 >= 2.20.1
- Node.js >= 14

### 本地开发

```bash
# 安装依赖（已内置 node_modules）
cd miniprogram
npm install
```

### 测试

纯算法模块（`packageFeatures/utils/mahjong/`）有零依赖的 Node 回归测试，详见 [tests/README.md](../tests/README.md)：

```bash
# 项目根目录
npm test
```

### 分包配置说明

TDesign 组件库通过 `project.config.json` 的 `packNpmRelationList` 配置：

```json
{
  "packageJsonPath": "miniprogram/package.json",
  "miniprogramNpmDistDir": "miniprogram/packageFeatures"
}
```

这使得 TDesign 被构建到 `packageFeatures/miniprogram_npm/` 目录，供分包使用。

### 关键URL

- 微信开发者文档: https://developers.weixin.qq.com/miniprogram/dev/framework/
- TDesign 组件库: https://github.com/Tencent/tdesign-miniprogram
- Bangumi API: https://bangumi.github.io/api/

## 相关项目

| 项目 | 说明 | 地址 |
|------|------|------|
| OtakuMap Web版 | 番剧更新日历（HTML单页） | /Users/shiqigao/VSCodeProjects/hello.github.io/otakumap.html |
| OtakuMap 小程序版 | 本项目 | /Users/shiqigao/WeChatProjects/otakumap |
