import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'

/** Fake host: capture the registered handler and return a no-op disposer. */
function mount(config) {
  let handler
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    on(event, fn) {
      assert.equal(event, 'agent/pre-step')
      handler = fn
      return () => { handler = undefined }
    },
  }
  const dispose = apply(ctx, config)
  return { handler, dispose, ctx }
}

const enter = (messages) => async () => ({ kind: 'enter', messages })

test('injects exactly one preflight notice for a build instruction', async () => {
  const { handler } = mount({ locale: 'zh' })
  const messages = [{ id: 'u1', role: 'user', content: '帮我做一个安卓端的音频转录工具' }]
  const out = await handler({}, enter(messages))

  assert.equal(out.kind, 'enter')
  assert.equal(out.messages.length, 2, '原消息 + 一条提示')
  const notice = out.messages[1]
  assert.equal(notice.role, 'user')
  assert.equal(notice.source.kind, 'second-thoughts')
  assert.ok(notice.content[0].text.includes('[B2]'))
  assert.ok(Object.isFrozen(notice))
  assert.equal(out.messages[0].id, 'u1', '原消息没有被改动')
})

test('does not inject twice for the same instruction', async () => {
  const { handler } = mount()
  const messages = [{ id: 'u1', role: 'user', content: '帮我设计一个缓存层' }]
  const first = await handler({}, enter(messages))
  assert.equal(first.messages.length, 2)

  // 第二步：模型继续干活，同一条指令还在上下文里
  const second = await handler({}, enter(first.messages))
  assert.equal(second.messages.length, 2, '不应重复注入')
})

test('stays out of the way for non-build instructions', async () => {
  const { handler } = mount()
  const messages = [{ id: 'u1', role: 'user', content: '继续' }]
  const out = await handler({}, enter(messages))
  assert.equal(out.messages.length, 1)
})

test('mode=off mounts nothing', () => {
  const { handler, dispose } = mount({ mode: 'off' })
  assert.equal(handler, undefined)
  assert.equal(typeof dispose, 'function')
})

test('passes the decision through untouched when the step is not enter', async () => {
  const { handler } = mount()
  const decision = { kind: 'skip' }
  const out = await handler({}, async () => decision)
  assert.equal(out, decision)
})

test('survives a host that throws inside next()', async () => {
  const { handler } = mount()
  await assert.rejects(() => handler({}, async () => { throw new Error('boom') }))
})
