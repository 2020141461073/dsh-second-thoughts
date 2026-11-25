import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composeNotice,
  fallbackUserMessage,
  lastUserInstruction,
  resolveConfig,
  shouldTrigger,
  textOf,
} from '../index.js'

test('resolves defaults and coerces bad input', () => {
  const cfg = resolveConfig(undefined)
  assert.equal(cfg.mode, 'brief')
  assert.equal(cfg.locale, 'zh')
  assert.equal(cfg.enabled, true)

  const bad = resolveConfig({ mode: 'nonsense', locale: 'fr', minChars: -3, extraKeywords: 'x' })
  assert.equal(bad.mode, 'brief')
  assert.equal(bad.locale, 'zh')
  assert.equal(bad.minChars, 0)
  assert.deepEqual(bad.extraKeywords, [])
})

test('mode=off disables the plugin', () => {
  assert.equal(resolveConfig({ mode: 'off' }).enabled, false)
})

test('triggers on build/design/choose instructions in both languages', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('帮我做一个安卓端的音乐播放器', cfg), true)
  assert.equal(shouldTrigger('这个功能怎么设计比较好', cfg), true)
  assert.equal(shouldTrigger('port this to Kotlin', cfg), true)
  assert.equal(shouldTrigger('选型：sqlite 还是 room', cfg), true)
})

test('triggers when the user literally asks about the market', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('市面上有没有类似的现成插件', cfg), true)
  assert.equal(shouldTrigger('这个开源项目靠谱吗', cfg), true)
  assert.equal(shouldTrigger('推荐一个能用的插件', cfg), true)
  assert.equal(shouldTrigger('这些方案对比一下', cfg), true)
})

test('neutral words alone do not trigger (live false positive)', () => {
  const cfg = resolveConfig()
  // 真实误触发：「你先自己给自己把这个插件装上」
  assert.equal(shouldTrigger('做完了吗，你先自己给自己把这个插件装上', cfg), false)
  assert.equal(shouldTrigger('把这个工具装一下', cfg), false)
  assert.equal(shouldTrigger('这个方案我看过了', cfg), false)
})

test('stays silent for short follow-ups, slash commands and plain questions', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('继续', cfg), false)
  assert.equal(shouldTrigger('好', cfg), false)
  assert.equal(shouldTrigger('/compact', cfg), false)
  assert.equal(shouldTrigger('今天天气怎么样', cfg), false)
  assert.equal(shouldTrigger('', cfg), false)
})

test('extraKeywords extend triggering without replacing defaults', () => {
  const cfg = resolveConfig({ extraKeywords: ['重新写一遍'] })
  assert.equal(shouldTrigger('把这段重新写一遍', cfg), true)
  assert.equal(shouldTrigger('帮我搭建一个东西', cfg), true)
})

test('textOf handles string and block content', () => {
  assert.equal(textOf({ content: 'plain' }), 'plain')
  assert.equal(
    textOf({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }),
    'a b',
  )
  assert.equal(textOf({}), '')
})

test('lastUserInstruction skips the plugin own notice and picks the newest human message', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '帮我做一个插件' },
    { id: 'a1', role: 'assistant', content: '好的' },
    { id: 'n1', role: 'user', content: '【三思而后行】…', source: { kind: 'second-thoughts' } },
    { id: 'u2', role: 'user', content: '顺便加个配置项' },
  ]
  const hit = lastUserInstruction(messages)
  assert.equal(hit.id, 'u2')
  assert.equal(hit.text, '顺便加个配置项')
})

test('lastUserInstruction returns undefined when only our notice is present', () => {
  const messages = [
    { id: 'n1', role: 'user', content: '【三思而后行】…', source: { kind: 'second-thoughts' } },
  ]
  assert.equal(lastUserInstruction(messages), undefined)
})

test('notice carries the four steps and the funnel', () => {
  const zh = composeNotice(resolveConfig())
  for (const marker of ['盘点工具', '扫市场', '摆证据', '自我反驳', '判定漏斗']) {
    assert.ok(zh.includes(marker), `notice should mention ${marker}`)
  }
  const strict = composeNotice(resolveConfig({ mode: 'strict' }))
  assert.ok(strict.includes('硬门'))
  const en = composeNotice(resolveConfig({ locale: 'en' }))
  assert.ok(en.includes('Inventory your tools'))
  assert.ok(en.includes('Challenge yourself'))
})

test('fallback message is frozen and self-tagged', () => {
  const message = fallbackUserMessage({ content: [{ type: 'text', text: 'x' }] })
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'second-thoughts')
  assert.ok(Object.isFrozen(message))
  assert.ok(typeof message.id === 'string' && message.id.length > 0)
})
