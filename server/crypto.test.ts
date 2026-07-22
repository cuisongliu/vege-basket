import assert from 'node:assert/strict'
import test from 'node:test'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'new'
process.env.APP_ENCRYPTION_KEYS = [
  `old:${Buffer.alloc(32, 13).toString('base64')}`,
  `new:${Buffer.alloc(32, 17).toString('base64')}`,
].join(',')

const { keyedDigest, verifyKeyedDigest } = await import('./crypto.ts')

test('builds a keyed, case-sensitive digest without exposing source text', () => {
  const first = keyedDigest('总结本周进展')

  assert.match(first, /^veges:mac:new:[A-Za-z0-9_-]{43}$/u)
  assert.equal(first, keyedDigest('总结本周进展'))
  assert.notEqual(first, keyedDigest('总结本周进展 '))
  assert.notEqual(first, keyedDigest('总结本周进度'))
  assert.doesNotMatch(first, /总结/u)
})

test('verifies a retained keyed digest after the active key rotates', () => {
  const oldDigest = keyedDigest('同一条待分类消息', 'old')

  assert.match(oldDigest, /^veges:mac:old:[A-Za-z0-9_-]{43}$/u)
  assert.equal(verifyKeyedDigest('同一条待分类消息', oldDigest), true)
  assert.equal(verifyKeyedDigest('被修改的消息', oldDigest), false)
  assert.equal(verifyKeyedDigest('同一条待分类消息', 'veges:mac:missing:abc'), false)
})
