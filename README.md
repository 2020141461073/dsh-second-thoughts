# 三思而后行 · dsh-second-thoughts

![license](https://img.shields.io/badge/license-MIT-green)
![tests](https://img.shields.io/badge/tests-18%20passed-brightgreen)
![dependencies](https://img.shields.io/badge/dependencies-0-blue)
![node](https://img.shields.io/badge/node-%3E%3D22-informational)

> 给 DeepSeek Harness（以及任何跑 DSH 的 agent）装的**开工前预检门**：
> 动手之前，先盘点自己有什么检索工具、先看市面上有没有现成方案、先摆证据、先自我反驳一遍。

[English](#english) · [安装](#安装) · [它拦什么](#它拦什么) · [配置](#配置) · [设计取舍](#设计取舍) · [同类工具](#同类工具)

---

## 为什么会有这个插件

源于一次真实的翻车记录：

有人（就是作者本人）花了整整两天，从零设计并实现了一个「在安卓手机上运行、让 AI 自己写脚本自己执行」的项目：
画了架构图、选好了 proot、写了能力桥、跑通了端到端、还发了好几版 APK。

做完之后才想起来去搜一下。

> GitHub 上搜 "deepseek harness android"：**540 个仓库**。
> 其中一个 **1040 星**，描述里写着「引擎内嵌 App 进程 · 读屏操作 App · 改系统设置 · 可选 Shizuku」——
> 也就是我那份「0.2 路线图」的全部内容，人家三个月前就做完了。

更讽刺的是：**搜索工具一直就在工具列表里**（`multi_search` / `advanced_search` / `platform_search`）。
我只试了一个坏掉的搜索接口，就断定「搜不了」，然后绕过它自己手写爬虫。

问题从来不是能力不足，是**没有「开工前先查」这道工序**。

写作 prompt 解决不了这件事——模型在长会话里没有义务遵守一条它当下看不见的规矩。
所以这个插件把「三思」做成了一道**工序**：每次收到看起来要开工的指令，它会在这一步里塞进一张预检清单，
让 agent 必须回答「我查了什么、查到了什么」，然后才允许动手。

---

## 它怎么工作

不是"看到关键词就拦"，而是三段：

```
① 候选识别（插件）：只挑出「可能是执行前调查」的步骤
        ↓
② 自己判断（模型）：这一步到底要不要先调查？
        ↓
③ 先问一句（模型）：要不要走一轮全面预检？
        ↓
   用户同意 → 走四关        用户说不用 → 直接干
```

**判断权在模型，决定权在你。** 插件只负责提醒"该问一句了"，不做判决。

触发候选取三种显式意图（明确要我动手 / 明确问市面 / 明确问怎么做）。
讨论、评审、「设计实验」、「评估一下」、短句、斜杠命令都不进候选。

触发后要求四关：

| 关 | 要求 |
|---|---|
| ① **把话说明白** | 把含糊需求改写成验收句「当 <触发> 时，应该 <可观察行为>」，标明替用户定了什么；判定档位（脚本 / 工具 / 产品 / 工业）——**档位由事情决定，不由说话的专业程度决定** |
| ② **自己找源并验证** | 不用固定清单。按领域列候选源（含长尾与新平台），每个源拿一个**已知存在的项目**试搜，搜不到就标为不可靠并换掉 |
| ③ **召回直到没有新东西** | 按能力项检索，不按名字；找到一个后顺着 dependents / alternatives / issue 提及继续爬；**连续 2 轮无新候选才停** |
| ④ **对照表 + 覆盖声明** | 能力项 × 候选矩阵；写清哪些源没覆盖；**禁止把「没找到」写成「不存在」** |

交付时再对一次账：逐条对照第①关的验收句，标 达成 / 部分 / 未达成，**未达成必须明写**。

`strict` 模式额外加一道硬门：证据没出来之前不许写文件、不许执行改变状态的命令。

## 安装

**从 GitHub 源码安装**（目前唯一已发布的渠道）：

```bash
dsh plugin --profile web add github:2020141461073/dsh-second-thoughts
```

在你的 DSH 里也可以直接说：`帮我装 github:2020141461073/dsh-second-thoughts`。

装完重启 DSH，日志里应出现：

```
[second-thoughts] armed (mode=brief, locale=zh)
```

> npm 包（`dsh-second-thoughts`）暂未发布：npm 注册被风控拦住了。
> 发布之后会增加 `dsh plugin --profile web add dsh-second-thoughts` 这条更短的命令，
> 并出现在 DSH 内置插件中心。源码安装不受影响，且能拿到最新提交。

---

## 配置

写在 profile 的 patch 层（`<DSH_PROFILE_DIR>/cordis.patch.yml`）：

```yaml
- id: dsh-second-thoughts
  config:
    mode: brief            # brief | strict | off
    locale: zh             # zh | en
    minChars: 6            # 太短的指令不触发
    extraKeywords: []      # 追加触发词
    skipSlashCommands: true
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `brief` | `brief` 只给流程；`strict` 额外加硬门；`off` 关闭 |
| `locale` | `zh` | 提示语言 |
| `minChars` | `6` | 指令短于此不触发，避免「继续」被拦 |
| `extraKeywords` | `[]` | 追加触发词，不会替换内置词表 |
| `skipSlashCommands` | `true` | 斜杠命令自带行为，不拦 |

---

## 实测：五个对照实验

这套协议是测出来的，不是想出来的。

| # | 做法 | 结果 |
|---|---|---|
| 1 | 4 个任务，A 组无协议 / B 组有协议 | 对照组 0/2 提到已有方案；实验组 1/2 |
| 2-3 | 用真实翻车任务重跑（安卓跑 DSH、B站下载器） | 对照 0/2；实验 2/2，其中一个精确命中 |
| 4 | 换成**预训练之后才出现**的冷门插件（★27–40）作标准答案 | 对照 0/4 点名方案；实验 **4/4** 点名（精确命中 1/4） |
| 5 | 2×2 交叉：前置动作 × 协议 | 有协议 **8/8** 点名方案；无协议 **0/8**。前置动作无可检测效果 |

三条结论：

1. **协议有效**：不加协议的 8 次运行，全部从零设计；加了协议的 8 次，全部去查了市面。
2. **「先停顿 20 秒」没用**：单独做（2 次）和叠加在协议上（4 次）都没有改变结果。已从设计里删掉。
3. **0 结果必须换词重搜**：实验里有个 agent 只搜了「便签墙」得到 0 结果，就写「未发现现成插件」，而生态里确实有 `notewall`。这条已写进 skill 的 ②b。

> 全部原始输出（16 次运行的逐条评分）留在实验目录，不随包发布。

## 不重复造的东西

这个插件的全部主张就是「先查有没有现成的」，所以它自己也不该重造。以下能力**已经有成熟实现，本插件直接指向它们，不重新发明**：

| 能力 | 现成的 | 说明 |
|---|---|---|
| 证据验真（URL / npm / GitHub 探测、带行号引用） | [`dsh-plugin-verify`](https://www.npmjs.com/package/dsh-plugin-verify) | 校验引用真伪，别自己写抓取器 |
| 专利先例检索 | [`@mtl-academic/dsh-patent`](https://www.npmjs.com/package/@mtl-academic/dsh-patent) | 动笔前检索专利、给三档结论 |
| 事实核查 | [`dsh-fact-check`](https://www.npmjs.com/package/dsh-fact-check) | 先定型再取证 |
| 文献综述方法学（PRISMA、引文追踪） | 现成 skills（如 `lit-review-agent`、`patent-prior-art`） | 学术场景直接复用，不要照搬 |

**本插件只补一块空白**：工程场景下的「这个功能有没有人做过」——把要素分解、五路覆盖、对照表、残余风险声明固化成一道开工前的工序。

> 方法学参照：专利检索的「要素分解 → claim chart」骨架（比学术 PRISMA 更贴合工程，因为工程没有引文图和受控词表），但**不照搬**——工程的判据是功能重合度而非新颖性，停止准则是成本与覆盖而非饱和。

## 设计取舍

**为什么是 hook 不是 skill。**
skill 是「模型想起来才会读」的文档；hook 是「每一步都必然发生」的工序。
`agent/pre-step` 是 Host 的官方接缝，改动只作用于这一步的消息，不碰会话记录、不碰系统提示。

**为什么不是又一个搜索工具。**
搜索工具已经够多了（DSH 自带 `web_search` / `web_fetch`，社区还有 free-search、deepread 等）。
缺的不是「能搜」，是「记得搜」和「搜完要摆证据」。这个插件不提供搜索能力，只提供工序。

**为什么信息这么具体（三路来源、证据表、三问）。**
因为模糊的提醒会被敷衍成「我查过了」。要求具体到「列成表」「说出你漏了哪类来源」，
agent 才会真的掉头去查，而不是嘴上说查了。

**为什么只拦「看起来要开工」的指令。**
每条消息都拦会让人迅速关掉它。窄触发 + 强约束，比宽触发 + 弱约束活得久。

---

## 同类工具

生态里已有几个相邻的实现，选择时可以参考：

| 工具 | 做什么 | 与本插件的关系 |
|---|---|---|
| `dsh-plugin-skill-autoroute` | 每条指令自动路由一遍技能目录 | 管「先看技能」，不管「先看市场」；两者可叠加 |
| `dsh-search-pull` | 提醒 agent 回答前先联网搜一下 | 只管「搜」，不管「有没有人做过」和「要不要自建」 |
| `dsh-fact-check` | 事实核查型调研技能 | 管单点事实，不管工程重复 |
| **`dsh-second-thoughts`** | 开工前的完整预检：工具盘点 → 三路市场扫描 → 证据表 → 自我反驳 → 判定漏斗 | 本插件 |

它们不冲突，建议一起装：`autoroute` 管技能，`search-pull` 管单步搜索，本插件管「要不要开工」。

---

## 开发

```bash
node --test test/*.test.mjs
```

11 个用例覆盖：配置归一化、中英触发词、静音规则、消息解析、提示内容完整性、注入消息的结构与冻结。

## License

MIT

---

<a id="english"></a>
## English

A preflight gate for agents running DeepSeek Harness.

Before an agent builds anything, it must: **① inventory the search/verification tools it actually has,
② scan at least three channels (open-source repos, this ecosystem's plugin markets, general web + community),
③ present an evidence table (name · traction · last activity · capability boundary · overlap),
④ answer three self-challenge questions — then decide: adopt, contribute, or build (with a stated search scope).**

It is a hook, not a prompt: on the first step of any build/design/choose instruction it injects exactly one
protocol notice, so the rule cannot be forgotten mid-session. Short follow-ups, greetings and slash commands
are never intercepted.

Install with `dsh plugin add dsh-second-thoughts`, restart, done.
