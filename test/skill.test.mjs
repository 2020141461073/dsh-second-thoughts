import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const skill = readFileSync(join(here, '..', 'skills', 'second-thoughts', 'SKILL.md'), 'utf8')

test('skill carries the four gates', () => {
  for (const marker of ['把需求写成能验收的话', '自己找源，并且验证源', '召回，直到没有新东西', '判定与声明', '交付对账']) {
    assert.ok(skill.includes(marker), `skill should mention ${marker}`)
  }
})

test('skill requires three rephrasings before concluding none exists', () => {
  assert.ok(skill.includes('换词重搜'), 'skill must require rephrasing')
  assert.ok(skill.includes('三组'))
  assert.ok(skill.includes('未见'))
})

test('skill keeps the anti-pattern list', () => {
  for (const bad of ['需求含糊就做简单点', '证据齐全']) {
    assert.ok(skill.includes(bad), `skill should warn about ${bad}`)
  }
})
