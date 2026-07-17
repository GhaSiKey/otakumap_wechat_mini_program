# OtakuMap

二次元爱好者的工具箱微信小程序，提供番剧追踪、光栅卡、日麻点数计算等实用功能。

## 文档

完整文档见 [`docs/`](docs/)：

- [项目说明与功能列表](docs/README.md)
- [架构设计](docs/architecture.md)
- [日麻点数计算器](docs/mahjong-score.md)
- [光栅卡](docs/lenticular.md)
- [番剧追踪](docs/anime-checklist.md)
- [变更日志](docs/changelog.md)

## 开发

```bash
# 纯算法模块测试（零依赖，Node 直接跑）
npm test
```

小程序在微信开发者工具中打开 `miniprogram/`。修改 npm 依赖后需在开发者工具「工具 → 构建 npm」。

开发约束见 [CLAUDE.md](CLAUDE.md)。
