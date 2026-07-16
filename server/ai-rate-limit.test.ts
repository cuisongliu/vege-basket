import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiRateLimiter, readAiRateLimitConfig } from './ai-rate-limit.ts'

test('reads AI rate-limit defaults and valid overrides', () => {
  assert.deepEqual(readAiRateLimitConfig({}), {
    globalLimit: 30,
    perUserLimit: 5,
    windowMs: 60_000,
  })
  assert.deepEqual(readAiRateLimitConfig({
    AI_GLOBAL_RATE_LIMIT: '12',
    AI_RATE_LIMIT: '3',
    AI_RATE_WINDOW_MS: '5000',
  }), {
    globalLimit: 12,
    perUserLimit: 3,
    windowMs: 5_000,
  })
})

test('enforces both per-user and instance-wide request windows', () => {
  let currentTime = 1_000
  const limiter = createAiRateLimiter({
    globalLimit: 3,
    perUserLimit: 2,
    windowMs: 1_000,
  }, () => currentTime)

  assert.equal(limiter.allow(1), true)
  assert.equal(limiter.allow(1), true)
  assert.equal(limiter.allow(1), false)
  assert.equal(limiter.allow(2), true)
  assert.equal(limiter.allow(3), false)

  currentTime += 1_001
  assert.equal(limiter.allow(1), true)
  assert.equal(limiter.allow(3), true)
})
