# 测试

项目核心算法、云函数契约和关键页面交互的回归测试。测试使用纯 CommonJS 与轻量 `wx` mock，可直接用 Node 跑，**零第三方测试框架依赖**（不引 jest/mocha）。

> ⚠️ 测试文件放在项目根的 `tests/`，**不要**放进 `miniprogram/`——主包有 2MB 体积限制，测试代码不应进入小程序包。

## 运行

```bash
# 项目根目录
npm test
# 或直接
node tests/mahjong.test.js
```

退出码 0 表示全部通过，非 0 表示有失败用例（CI 可直接用）。

## 用例文件

| 文件 | 覆盖范围 |
|------|----------|
| `mahjong.test.js` | 宝牌三维度计数、符数（平和/七对子）、听牌型判定 |
| `worldcup.test.js` | 世界杯数据变换与展示规则 |
| `shared-board.test.js` 等 | 共享板视图模型、云函数事务与页面流程 |
| `anime-meta.test.js` / `anime-meta-cloud.test.js` | 弹弹play封面策略、请求契约与 Bangumi Subject ID 安全解析 |
| `pilgrimage.test.js` | 巡礼筛选、坐标、Marker、本机收藏与前端 API 封装 |
| `pilgrimage-cloud.test.js` | Anitabi 路径白名单、响应归一、缓存和错误降级 |
| `pilgrimage-pages.test.js` | 巡礼搜索与收藏去重、缺映射空态、地图筛选/选点、图片失败降级与地点详情导航 |

## 约定

- 改动核心规则、云函数返回结构或页面数据流后，**先跑一遍测试**确认无回归（见 CLAUDE.md 工作流第 4 步）。
- 修 bug 时，先补一条能复现该 bug 的用例，再改代码——确保修复有效且不会再退化。
- 牌例构造：手牌字符串如 `234567m234p78s33z`，`0p` 表示赤 5 筒。每个标准牌型需凑满 4 面子 + 1 雀头（14 张含和牌张）。
