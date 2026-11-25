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

这条指令看起来要开工（做 / 设计 / 选型 / 移植）。动手之前按顺序做完下面四步，并把**证据写进回复**：

① **盘点工具**：先确认你手上真有哪些检索与核实手段（网页搜索、抓取、代码检索、仓库检索、包管理）。
   不要假设，也不要轻信"某个工具坏了"——先跑一次自检再下结论。不可用的通道要明说，并给出替代路径。

② **扫市场**：至少三路，逐路记录你查过什么：
   · 开源代码与仓库（GitHub 等）——有没有人做过同样的东西；
   · 本生态的插件/技能市场——有没有现成的；
   · 通用网页与社区（含非官方来源、issue、讨论）——社区怎么评价、踩过什么坑。

③ **摆证据**：把命中的东西列成表：名称 · 热度（星/下载）· 最近活跃时间 · 能力边界 · 与本次需求的重合度。
   只用官方口径下结论不算证据；官方文档、营销页、聚合站要交叉验证。

④ **自我反驳**：回答三问——
   · 我的方案比现成的强在哪？说不出就承认重复；
   · 如果只是重复，能不能直接用，或者去贡献而不是另起炉灶？
   · 我漏掉了哪类来源？（社区、反例、已经失败的项目）

**判定漏斗**：能直接用 → 用并说明理由；差一点 → 提 issue/PR 贡献；确实空白 → 自建，并写明"已检索、未找到"的具体范围。

**禁止**：没做完第②步就宣布"没有现成方案"；拿"搜不到"当结论而不交代查了哪些源。${strict ? `

【硬门】在给出上述证据之前，不要写入文件、不要执行会改变状态的命令；需要探索可以只读。` : ''}`

const NOTICE_EN = (strict) => `[Second Thoughts · preflight before building]

This instruction looks like a build / design / choose / port request. Before touching anything, run these four steps and put the evidence in your reply:

① Inventory your tools. Which search, fetch, code-search, repo-search and package tools do you actually have right now?
   Do not assume, and do not trust a single "the search tool is broken" observation — self-test first, name the dead channels, and give an alternative path.

② Scan the market with at least three channels, and record what you queried:
   · open-source code & repositories (GitHub etc.) — has someone already built this?
   · this ecosystem's plugin/skill markets — is there a ready-made one?
   · general web and community (including non-official sources, issues, discussions) — how do people rate it, what breaks?

③ Show evidence in a table: name · traction (stars/downloads) · last activity · capability boundary · overlap with this request.
   Vendor docs alone are not evidence. Cross-check official docs, marketing pages and aggregator sites.

④ Challenge yourself with three questions:
   · Where is my approach better than what exists? If you cannot answer, it is duplication;
   · If it is duplication, can we just use it, or contribute instead of rebuilding?
   · Which source class did I skip? (community, counter-examples, projects that already failed)

Funnel: usable as-is → use it and say why; close but not enough → open an issue/PR; genuinely empty → build it, and state exactly where you looked and found nothing.

Forbidden: declaring "nothing exists" without step ②, and treating "I couldn't find it" as a conclusion without listing the sources you checked.${strict ? `

[Hard gate] Until that evidence is in the reply, do not write files and do not run state-changing commands. Read-only exploration is fine.` : ''}`

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
