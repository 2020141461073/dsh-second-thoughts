import assert from 'node:assert/strict'
import test from 'node:test'

import {
  composeNotice,
  fallbackUserMessage,
  isDiscussion,
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

test('triggers on explicit build requests', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('帮我做一个安卓端的音乐播放器', cfg), true)
  assert.equal(shouldTrigger('我想做一个 DSH 插件，能把对话导出成图片', cfg), true)
  assert.equal(shouldTrigger('给它实现一个断点续传', cfg), true)
  assert.equal(shouldTrigger('port this to Kotlin', cfg), true)
})

test('triggers on explicit market questions', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('市面上有没有类似的现成插件', cfg), true)
  assert.equal(shouldTrigger('这个东西有没有人做过', cfg), true)
  assert.equal(shouldTrigger('值不值得自己写一个', cfg), true)
  assert.equal(shouldTrigger('has anyone already built this', cfg), true)
})

test('triggers on explicit how-to questions', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('这个功能怎么设计比较好', cfg), true)
  assert.equal(shouldTrigger('如何实现一个断点续传', cfg), true)
})

test('stays silent on discussion, review and evaluation', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('现在要设计实验，两个子智能体一个用一个不用', cfg), false)
  assert.equal(shouldTrigger('讨论一下这个方案是否可行', cfg), false)
  assert.equal(shouldTrigger('评估一下实验结果', cfg), false)
  assert.equal(shouldTrigger('你觉得这个设计有什么问题', cfg), false)
  assert.equal(shouldTrigger('选型：sqlite 还是 room', cfg), false)
  assert.equal(shouldTrigger('这个开源项目靠谱吗', cfg), false)
})

test('stays silent for short follow-ups and slash commands', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('继续', cfg), false)
  assert.equal(shouldTrigger('好', cfg), false)
  assert.equal(shouldTrigger('/compact', cfg), false)
  assert.equal(shouldTrigger('', cfg), false)
})

test('neutral nouns never trigger on their own', () => {
  const cfg = resolveConfig()
  assert.equal(shouldTrigger('做完了吗，你先自己给自己把这个插件装上', cfg), false)
  assert.equal(shouldTrigger('这个方案我看过了', cfg), false)
  assert.equal(shouldTrigger('轮子太多了', cfg), false)
})

test('isDiscussion classifies meta talk', () => {
  assert.equal(isDiscussion('我们讨论一下架构'), true)
  assert.equal(isDiscussion('设计实验怎么做'), true)
  assert.equal(isDiscussion('帮我做一个下载器'), false)
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

test('notice carries the four gates and the funnel', () => {
  const zh = composeNotice(resolveConfig())
  for (const marker of ['把话说明白', '自己找源并验证', '召回直到没有新东西', '覆盖声明', '判定漏斗']) {
    assert.ok(zh.includes(marker), `notice should mention ${marker}`)
  }
  assert.ok(zh.includes('已知存在的项目'))
  assert.ok(zh.includes('连续 2 轮'))
  assert.ok(zh.includes('我没找到'))
  assert.ok(!zh.includes('dsh-plugin-verify'))
  assert.ok(!zh.includes('dsh-fact-check'))
  const strict = composeNotice(resolveConfig({ mode: 'strict' }))
  assert.ok(strict.includes('硬门'))
  const en = composeNotice(resolveConfig({ locale: 'en' }))
  assert.ok(en.includes('Find and verify your own sources'))
  assert.ok(en.includes('Recall until nothing new'))
})

test('fallback message is frozen and self-tagged', () => {
  const message = fallbackUserMessage({ content: [{ type: 'text', text: 'x' }] })
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'second-thoughts')
  assert.ok(Object.isFrozen(message))
  assert.ok(typeof message.id === 'string' && message.id.length > 0)
})
