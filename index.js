/**
 * Host half of the `dsh-second-thoughts` bundle. · 三思而后行
 *
 * Why this exists
 * ---------------
 * Agents (and humans) routinely start building before checking whether the thing
 * already exists. Two failure modes are expensive and both are self-inflicted:
 *
 *   1. Re-inventing a mature project that a two-minute search would have found.
 *   2. Trusting a single source (usually the vendor's own docs) and declaring
 *      "there is no existing solution".
 *
 * A prompt that says "remember to search" does not survive contact with a long
 * session: the model has no duty to obey a rule it can't see at the moment it
 * matters. This plugin makes the check a *step*: on the first step of a new
 * build/design/choose instruction it appends exactly one notice — a preflight
 * protocol the model must answer before it touches anything.
 *
 * Seams used
 * ----------
 *   - `agent/pre-step` (waterfall): read the step's messages, append one
 *     synthetic user-role notice. Same shape as `dsh-plugin-skill-autoroute`.
 *   - No services are injected and no tools are registered, so the plugin
 *     composes with any profile and never blocks startup.
 *
 * The injected message is producer-tagged `{ kind: 'second-thoughts' }` so this
 * plugin never mistakes its own notice for a human instruction.
 *
 * @module dsh-second-thoughts
 */

import { randomUUID } from 'node:crypto'

/** Plugin name shown in loader logs. */
export const name = 'dsh-second-thoughts'

/** Nothing is required from the Host: the notice is plain text. */
export const inject = []

const PRODUCER = 'second-thoughts'

const DEFAULTS = {
  enabled: true,
  /** `brief` = protocol notice, `strict` = protocol + hard gate wording, `off` = disabled. */
  mode: 'brief',
  /** Notice language: `zh` | `en`. */
  locale: 'zh',
  /** Instructions shorter than this never trigger ("继续", "好", "ok"). */
  minChars: 6,
  /** Extra trigger words, appended to the built-in intent lists. */
  extraKeywords: [],
  /** Slash commands carry their own behaviour. */
  skipSlashCommands: true,
}

/** Verbs that mean "the user is asking for something to be built or chosen". */
export const ZH_INTENT = [
  '做一', '做个', '开发', '实现', '设计', '搭建', '写一', '写个', '搞一', '搞个',
  '选型', '架构', '重构', '移植', '改造', '集成', '能不能做', '可行',
]

export const EN_INTENT = [
  'build', 'implement', 'create', 'design', 'architect', 'rewrite', 'port',
  'migrate', 'integrate', 'scaffold', 'choose', 'compare', 'should i',
]

/**
 * 明确在问市场的词。注意「轮子」不在这里：它自己也常出现在元讨论里
 * （「这是不是又重复造轮子」不是要开工），只作为 PAIR_TERMS 与语境词配对。
 */
export const MARKET_HINT = ['开源', '现成', '有没有', '类似', '别人做过', '现有方案']

/**
 * 中性词：单独出现太宽（「把这个插件装上」不该触发），
 * 只有同时出现市场语境词时才视为「在问市场」。
 */
export const PAIR_TERMS = ['插件', '工具', '方案', '库', '框架', '轮子']
export const PAIR_CONTEXT = ['有没有', '现成', '类似', '别人', '市场', '推荐', '哪个', '替代', '对比']

/** Resolve user config into a complete, validated shape. */
export function resolveConfig(raw) {
  const merged = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  const mode = String(merged.mode ?? '').toLowerCase()
  merged.mode = ['brief', 'strict', 'off'].includes(mode) ? mode : 'brief'
  if (merged.mode === 'off') merged.enabled = false
  merged.locale = String(merged.locale ?? 'zh').toLowerCase() === 'en' ? 'en' : 'zh'
  merged.minChars = Number.isFinite(merged.minChars) ? Math.max(0, merged.minChars) : DEFAULTS.minChars
  merged.extraKeywords = Array.isArray(merged.extraKeywords)
    ? merged.extraKeywords.filter((k) => typeof k === 'string' && k)
    : []
  merged.skipSlashCommands = merged.skipSlashCommands !== false
  return merged
}

/** Concatenate the text parts of a message's content. */
export function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
      .map((part) => String(part.text ?? ''))
      .join(' ')
  }
  return ''
}

/**
 * Find the newest human instruction in a step's messages.
 * Messages produced by this plugin are skipped so a notice can never retrigger.
 * @returns {{id: string, text: string}|undefined}
 */
export function lastUserInstruction(messages) {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'user') continue
    if (message?.source?.kind === PRODUCER) continue
    const text = textOf(message).trim()
    if (text) return { id: String(message.id ?? `m${i}`), text }
  }
  return undefined
}

/** Would this instruction benefit from a preflight pass? */
export function shouldTrigger(text, config = DEFAULTS) {
  const instruction = String(text ?? '').trim()
  if (!instruction) return false
  if (config.skipSlashCommands && instruction.startsWith('/')) return false
  if (instruction.length < (config.minChars ?? DEFAULTS.minChars)) return false

  const haystack = instruction.toLowerCase()
  const keywords = [
    ...ZH_INTENT,
    ...EN_INTENT,
    ...MARKET_HINT,
    ...(config.extraKeywords ?? []),
  ]
  if (keywords.some((keyword) => haystack.includes(String(keyword).toLowerCase()))) return true

  // 「插件/工具/方案」这类中性词，必须搭配市场语境才算在问市场
  const hasNeutral = PAIR_TERMS.some((term) => haystack.includes(term.toLowerCase()))
  if (!hasNeutral) return false
  return PAIR_CONTEXT.some((context) => haystack.includes(context.toLowerCase()))
}

const NOTICE_ZH = (strict) => `【三思而后行 · 开工前预检】

这条指令看起来要开工。动手前按顺序做完，并把证据写进回复：

① **盘点通道**：列出此刻真能用的检索手段，逐条实测一次；坏掉的要明说并给替代路径。
   已有工具优先用，别自己另造：证据验真用 \`dsh-plugin-verify\`，专利先例用 \`@mtl-academic/dsh-patent\`，事实核查用 \`dsh-fact-check\`。

② **拆要素**：把需求拆成能力项（并发？持久化？离线？多端同步？权限模型？…），逐项去查。
   按名字搜会漏——同类项目命名千奇百怪；按实现特征搜（代码检索）才抓得住。

③ **五路覆盖**，逐路记下检索式与结果：
   · 仓库搜索（GitHub 等，中英各搜一次）
   · 代码检索（grep.app 一类，按函数名 / 协议名 / 架构词）
   · 包注册表（npm / PyPI / 应用商店）
   · 本生态的插件与技能市场
   · 社区（Discussions / issue / HN / 博客 / 视频）—— 最多先例藏在这一层

④ **摆对照表**：每行一个能力项，每列一个候选，标「命中 / 部分 / 未命中」。
   只看官方口径不算证据，官方文档、营销页、聚合站要交叉验证。

⑤ **声明覆盖与残余风险**：写清查了哪些入口、哪些层没覆盖。
   QQ 群 / 微信群 / 公众号 / B站 这类基本不可检索，必须明说。
   **禁止**把「我没找到」写成「不存在」。

**判定漏斗**：能直接用 → 用并说明理由；差一点 → 提 issue/PR 贡献；确实空白 → 自建，并附检索日志。${strict ? `

【硬门】在给出上述证据之前，不要写入文件、不要执行会改变状态的命令；只读探索可以。` : ""}`

const NOTICE_EN = (strict) => `[Second Thoughts · preflight before building]

This looks like a build / design / choose / port request. Do these in order and put the evidence in your reply:

① **Inventory channels.** List the search tools you actually have right now and self-test each one; name any dead channel and give a substitute.
   Prefer tools that already exist over writing new ones: evidence verification → \`dsh-plugin-verify\`, patent prior art → \`@mtl-academic/dsh-patent\`, fact checking → \`dsh-fact-check\`.

② **Decompose into capability elements** (concurrency? persistence? offline? multi-device sync? permissions? …) and search per element.
   Name-based search misses things — competitors name themselves wildly. Search implementation traits (code search) instead.

③ **Cover five channels**, recording the query and the result for each:
   · repository search (GitHub etc., search in both English and Chinese)
   · code search (grep.app and friends — by function name, protocol, architecture term)
   · package registries (npm / PyPI / app stores)
   · this ecosystem's plugin and skill markets
   · community (Discussions / issues / HN / blogs / videos) — most prior art hides here

④ **Build a matrix**: one row per capability element, one column per candidate, marked hit / partial / miss.
   Vendor docs alone are not evidence; cross-check docs, marketing pages and aggregators.

⑤ **Declare coverage and residual risk**: say which channels you ran and which layers you did not cover.
   QQ / WeChat groups, official accounts and video platforms are effectively unsearchable — say so.
   **Never** write "nothing exists" when you mean "I did not find it".

Funnel: usable as-is → use it and say why; close → open an issue/PR; genuinely empty → build it, and attach the search log.${strict ? `

[Hard gate] Until that evidence is in the reply, do not write files and do not run state-changing commands. Read-only exploration is fine.` : ""}`

/** Build the notice text for one instruction. */
export function composeNotice(config) {
  return config.locale === 'en' ? NOTICE_EN(config.mode === 'strict') : NOTICE_ZH(config.mode === 'strict')
}

/** Deep-freeze a plain message graph, mirroring the Host's own helper. */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

let createUserMessage

/** Prefer the Host's canonical constructor; fall back to a structural twin. */
export async function resolveCreateUserMessage() {
  if (createUserMessage !== undefined) return createUserMessage ?? undefined
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    createUserMessage = typeof mod?.createUserMessage === 'function' ? mod.createUserMessage : null
  } catch {
    createUserMessage = null
  }
  return createUserMessage ?? undefined
}

/** Structural twin of the Host constructor: same fields, fresh uuid, frozen. */
export function fallbackUserMessage({ content, source }) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content,
    source: { kind: PRODUCER, form: 'notice', ...(source ?? {}) },
  })
}

/**
 * Cordis plugin entry.
 * @param {object} ctx host context
 * @param {object} [rawConfig] profile config
 * @returns {() => void} disposer
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const logger = ctx?.logger

  if (!config.enabled) {
    logger?.info?.('[second-thoughts] disabled (mode=%s)', config.mode)
    return () => {}
  }

  const seen = new Set()

  const dispose = ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!decision || decision.kind !== 'enter') return decision
    if (!Array.isArray(decision.messages) || decision.messages.length === 0) return decision

    let target
    try {
      target = lastUserInstruction(decision.messages)
    } catch {
      return decision
    }
    if (!target) return decision
    if (seen.has(target.id)) return decision
    if (!shouldTrigger(target.text, config)) return decision

    seen.add(target.id)
    if (seen.size > 500) {
      const oldest = seen.values().next().value
      if (oldest !== undefined) seen.delete(oldest)
    }

    const make = (await resolveCreateUserMessage()) ?? fallbackUserMessage
    try {
      payload?.signal?.throwIfAborted?.()
      const message = make({
        content: [{ type: 'text', text: composeNotice(config) }],
        source: { kind: PRODUCER, form: 'notice' },
      })
      logger?.debug?.('[second-thoughts] preflight injected for %s chars', target.text.length)
      return { ...decision, messages: [...decision.messages, message] }
    } catch (error) {
      logger?.warn?.('[second-thoughts] injection failed: %s', String(error?.message ?? error))
      return decision
    }
  })

  logger?.info?.('[second-thoughts] armed (mode=%s, locale=%s)', config.mode, config.locale)

  return () => {
    try {
      dispose?.()
    } catch {
      /* disposal is best-effort */
    }
  }
}
