# 测试

纯算法模块（`miniprogram/packageFeatures/utils/mahjong/`）的回归测试。这些模块是纯 CommonJS、不依赖小程序 API，可直接用 Node 跑，**零第三方依赖**（不引 jest/mocha）。

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

## 约定

- 改动 `utils/mahjong/` 下任何算法后，**先跑一遍测试**确认无回归（见 CLAUDE.md 工作流第 4 步）。
- 修 bug 时，先补一条能复现该 bug 的用例，再改代码——确保修复有效且不会再退化。
- 牌例构造：手牌字符串如 `234567m234p78s33z`，`0p` 表示赤 5 筒。每个标准牌型需凑满 4 面子 + 1 雀头（14 张含和牌张）。
