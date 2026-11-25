# 仓库简介（复制粘贴用）

## 1. GitHub 仓库 About 栏（中文，约 60 字）

```
开工前强制预检：先盘点检索工具，再扫开源/插件市场找现成方案，摆出证据表、自我反驳三问，才决定用现成的、去贡献，还是自建。
```

## 2. GitHub About 栏（英文，约 200 字符）

```
A preflight gate for DeepSeek Harness: before an agent builds anything, it must inventory its tools, scan repos/plugin markets/web for prior art, show an evidence table, and challenge its own plan.
```

## 3. 一句话版本（社交媒体 / 海报）

```
别再花两天重写一个已经有 1040 星的轮子 —— 让 agent 动手前先三思。
```

```
Your agent spent two days rebuilding something with 1040 stars. Make it think first.
```

## 4. 稍长版本（README 首段 / 推荐位）

```
dsh-second-thoughts 是 DeepSeek Harness 的一个小插件。它不改搜索、不加模型、不换界面，
只在 agent 动手之前注入一道四步预检：① 盘点此刻真能用的检索通道；② 至少三路扫市场
（开源仓库 / 本生态插件市场 / 网页与社区）；③ 摆出证据表（名称·热度·活跃·能力边界·重合度）；
④ 三问自我反驳。然后按漏斗决定：直接用、去贡献，还是自证空白后自建。

以 hook 实现而非提示词，所以它在长会话里不会被忘掉。
```

## 5. npm / 插件市场 description（单行，≤200 字符，已写入 package.json）

```
开工前强制预检：盘点检索工具 → 扫开源与插件市场 → 摆证据 → 三问自我反驳 → 再决定用现成的还是自建。
```

## 6. Recommended GitHub topics

```
dsh-plugin  deepseek-harness  prior-art  research  workflow  preflight  agent  cordis
```

## 7. 徽章区块（README 顶部可选）

```markdown
![license](https://img.shields.io/badge/license-MIT-green)
![tests](https://img.shields.io/badge/tests-18%20passed-brightgreen)
![deps](https://img.shields.io/badge/dependencies-0-blue)
![node](https://img.shields.io/badge/node-%3E%3D22-informational)
```
