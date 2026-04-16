# OtakuMap 微信小程序

二次元爱好者的工具箱，提供番剧追踪和光栅卡等实用功能。

## 功能列表

| 功能 | 说明 | 入口 |
|------|------|------|
| 番剧追踪 | 记录追番清单，标记已看完的番剧，支持拖拽排序 | 分包 pages/anime-checklist |
| 光栅卡 | 选择多张图片，倾斜手机体验百叶窗切换效果 | 分包 pages/lenticular |

## 技术栈

- **框架**: 微信小程序 (miniprogram)
- **UI库**: TDesign Miniprogram ^1.5.0
- **云开发**: 微信云开发 (CloudBase)
- **分包策略**: 功能模块放入 subpackages 减小主包体积

## 项目结构

```
otakumap/
├── miniprogram/                    # 小程序主体
│   ├── pages/                      # 主包页面
│   │   ├── index/                  # 首页（功能入口）
│   │   └── example/                # 示例页
│   ├── packageFeatures/            # 分包（功能模块）
│   │   ├── pages/
│   │   │   ├── anime-checklist/     # 番剧追踪
│   │   │   └── lenticular/          # 光栅卡
│   │   └── utils/
│   │       └── lenticular-engine.js # 光栅引擎核心算法
│   ├── components/                  # 公共组件
│   ├── app.js                      # 应用入口
│   ├── app.json                    # 应用配置
│   └── app.wxss                    # 全局样式（TDesign CSS变量）
├── cloudfunctions/                  # 云函数
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
