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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 内嵌技能正文。插件只装这一个包、没有额外 skill 目录时，模型也要知道该怎么做，
 * 所以把 SKILL.md 随包带着，运行时注册进宿主技能目录。
 */
let SKILL_CONTENT = ''
try {
  const here = dirname(fileURLToPath(import.meta.url))
  SKILL_CONTENT = readFileSync(join(here, 'skills', 'second-thoughts', 'SKILL.md'), 'utf8')
} catch {
  SKILL_CONTENT = ''
}

const SKILL_NAME = 'second-thoughts'
const SKILL_DESCRIPTION =
  '开工前的四关协议：把含糊需求写成可验收句、自拟并验证检索源、按能力项召回直到没有新候选、出覆盖声明再决定用现成的还是自建。'
const SKILL_WHEN =
  '用户要「做一个 / 设计 / 选型 / 移植 / 集成」某个东西，或问「有没有现成的 / 别人做过没有」时使用。'

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

这条指令看起来要开工。动手前做完下面四件事，并把结果写进回复（细节见 skill \`second-thoughts\`）：

① **把话说明白**：用户说得含糊，不等于可以随便做。把需求改写成验收句
   ——「当 <触发> 时，应该 <可观察行为>」，并标明哪些默认值是我替他定的。
   同时判定档位：一次性脚本 / 长期工具 / 给别人用的产品 / 工业系统。
   **档位由事情本身决定，不由用户说话的专业程度决定。**

② **自己找源并验证**：不要用固定清单。按这个领域列出候选源（含长尾和新平台），
   每个源拿一个**已知存在的项目**试搜一次——搜不到就标记为不可靠并换掉。
   只报告验证过能用的源；本次新增/失效的源要说出来。

③ **召回直到没有新东西**：把需求拆成能力项，按能力搜而不是按名字搜；
   找到一个同类后顺着它爬（dependents / alternatives / issue 里提到的竞品 / 反向检索）。
   **连续 2 轮没有新候选才停。**

④ **对照表 + 覆盖声明**：每行一个能力项、每列一个候选，标命中/部分/未命中；
   写清查了哪些源、哪些没覆盖（QQ群/微信群/公众号/B站基本不可检索）。
   **禁止把「我没找到」写成「不存在」。**

**判定漏斗**：能直接用 → 用并说明理由；差一点 → 提 issue/PR；确实空白 → 自建，附检索日志。

**交付时**：逐条对照①②里的验收句，标 达成 / 部分 / 未达成——未达成必须明写，不许用「后续可优化」包装成完成。
${strict ? `
【硬门】在给出上述证据之前，不要写入文件、不要执行会改变状态的命令；只读探索可以。` : ""}`

const NOTICE_EN = (strict) => `[Second Thoughts · preflight before building]

This looks like a build / design / choose / port request. Do these four things before touching anything, and put the results in your reply (details in the \`second-thoughts\` skill):

① **Make the ask concrete.** A vague request is not permission to lower the bar. Rewrite it as acceptance sentences
   — "When <trigger>, the system shall <observable behaviour>" — and state which defaults you chose on the user's behalf.
   Also pick the tier: throwaway script / long-lived tool / product for others / industrial system.
   **The tier follows what the thing is for, not how technical the user sounds.**

② **Find and verify your own sources.** No fixed list. Enumerate candidate sources for this domain (including long-tail and new platforms),
   then probe each with a project you know exists — if it cannot find that, mark the source unreliable and replace it.
   Only report sources you verified; announce sources added or found dead.

③ **Recall until nothing new appears.** Decompose the request into capability elements and search by capability, not by name;
   once you find one comparable project, crawl outward (dependents / alternatives / competitors named in issues / reverse search).
   **Stop only after two consecutive rounds with no new candidates.**

④ **Matrix + coverage statement.** One row per capability, one column per candidate, marked hit/partial/miss;
   state which sources you ran and which layers you did not cover.
   **Never** write "nothing exists" when you mean "I did not find it".

Funnel: usable → adopt and say why; close → open an issue/PR; genuinely empty → build, with the search log attached.

**On delivery:** check every acceptance sentence from ① and mark met / partial / not met — unmet must be stated, never dressed up as done.${strict ? `

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

  // 把四关协议注册成内嵌技能（skills 是可选依赖，缺它也不影响提示注入）。
  const skills = typeof ctx.get === 'function' ? ctx.get('skills') : undefined
  if (SKILL_CONTENT && skills && typeof skills.register === 'function') {
    try {
      ctx.effect(() => {
        const dispose = skills.register({
          name: SKILL_NAME,
          description: SKILL_DESCRIPTION,
          whenToUse: SKILL_WHEN,
          source: 'runtime',
          content: SKILL_CONTENT,
        })
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      })
      logger?.info?.('[second-thoughts] skill registered (%d chars)', SKILL_CONTENT.length)
    } catch (error) {
      logger?.warn?.('[second-thoughts] skill registration failed: %s', String(error?.message ?? error))
    }
  }

  return () => {
    try {
      dispose?.()
    } catch {
      /* disposal is best-effort */
    }
  }
}
