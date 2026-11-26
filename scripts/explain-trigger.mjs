/**
 * 解释一条指令为什么会/不会被识别为「执行前调查」候选。
 * 用法：node scripts/explain-trigger.mjs "要检查的文本"
 */
import {
  shouldTrigger,
  resolveConfig,
  isDiscussion,
  REQUEST_PATTERNS,
  MARKET_PATTERNS,
  HOWTO_PATTERNS,
} from '../index.js'

const text = process.argv[2] ?? '帮我做一个下载器'
const cfg = resolveConfig()

const hits = (list) => list.filter((re) => re.test(text)).map((re) => String(re))

console.log('文本:', text)
console.log('长度:', text.length, '| minChars:', cfg.minChars)
console.log('是否候选:', shouldTrigger(text, cfg))
console.log('判为讨论（直接放行）:', isDiscussion(text))
console.log('REQUEST 命中:', hits(REQUEST_PATTERNS))
console.log('MARKET  命中:', hits(MARKET_PATTERNS))
console.log('HOWTO   命中:', hits(HOWTO_PATTERNS))
console.log('extraKeywords:', cfg.extraKeywords.length ? cfg.extraKeywords : '(无)')
