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

// 初筛刻意做宽：后面有模型判断 + 用户确认两道关，多问一句远比漏掉便宜。
test('loose screening: build requests ask', () => {
  const cfg = resolveConfig()
  for (const s of [
    '帮我做一个安卓端的音乐播放器',
    '我想做一个 DSH 插件',
    '给它实现一个断点续传',
    'port this to Kotlin',
  ]) {
    assert.equal(shouldTrigger(s, cfg), true, s)
  }
})

test('loose screening: market questions ask (including the reported wording)', () => {
  const cfg = resolveConfig()
  for (const s of [
    '这个事有没有人已经做过了',
    '我问一个已有的项目这个事有没有人已经做过了',
    '有没有人做过这个',
    '这个别人实现过吗',
    '是不是已经有人做过了',
    '有没有现成的方案',
    '值不值得自己写',
  ]) {
    assert.equal(shouldTrigger(s, cfg), true, s)
  }
})

test('loose screening: discussion also asks (user confirms before working)', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('现在要设计实验，两个子智能体一个用一个不用', cfg), true)
  assert.equal(shouldTrigger('讨论一下这个方案', cfg), true)
})

test('still skips greetings, confirmations and slash commands', () => {
  const cfg = resolveConfig()
  for (const s of ['继续', '好', '好的', '嗯嗯', '谢谢', '收到', 'ok', '/compact', '/model']) {
    assert.equal(shouldTrigger(s, cfg), false, s)
  }
  assert.equal(shouldTrigger('', cfg), false)
  assert.equal(shouldTrigger('嗯', cfg), false)
})

test('extraKeywords act as an exclusion list', () => {
  const cfg = resolveConfig({ extraKeywords: ['别问了'] })
  assert.equal(shouldTrigger('帮我做一个下载器，别问了', cfg), false)
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
    { id: 'n1', role: 'user', content: '【开工前，先问一句】…', source: { kind: 'second-thoughts' } },
    { id: 'u2', role: 'user', content: '顺便加个配置项' },
  ]
  const hit = lastUserInstruction(messages)
  assert.equal(hit.id, 'u2')
})

test('notice defines the four classes and requires a label', () => {
  const zh = composeNotice(resolveConfig())
  for (const marker of ['[N]', '[B1]', '[B2]', '[M]', '第一行', '判不准 → 选 B2', '检索范围']) {
    assert.ok(zh.includes(marker), 'notice should mention ' + marker)
  }
  assert.ok(!zh.includes('dsh-plugin-verify'))

  const en = composeNotice(resolveConfig({ locale: 'en' }))
  assert.ok(en.includes('[B2]'))
  assert.ok(en.includes('coverage statement'))
})

test('fallback message is frozen and self-tagged', () => {
  const message = fallbackUserMessage({ content: [{ type: 'text', text: 'x' }] })
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'second-thoughts')
  assert.ok(Object.isFrozen(message))
  assert.ok(typeof message.id === 'string' && message.id.length > 0)
})
