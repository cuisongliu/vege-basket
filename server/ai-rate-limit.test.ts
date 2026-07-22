import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAiConcurrencyLimiter,
  createAiRateLimiter,
  readAiRateLimitConfig,
} from './ai-rate-limit.ts'

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
  assert.equal(limiter.canAllow(1), true)
  assert.equal(limiter.allow(1), true)
  assert.equal(limiter.canAllow(1), false)
  assert.equal(limiter.allow(1), false)
  assert.equal(limiter.allow(2), true)
  assert.equal(limiter.allow(3), false)

  currentTime += 1_001
  assert.equal(limiter.allow(1), true)
  assert.equal(limiter.allow(3), true)
})

test('bounds concurrent work per user and across the application instance', () => {
  const limiter = createAiConcurrencyLimiter({ globalLimit: 3, perUserLimit: 2 })
  const releaseFirst = limiter.acquire(1)
  const releaseSecond = limiter.acquire(1)
  const releaseThird = limiter.acquire(2)

  assert.equal(typeof releaseFirst, 'function')
  assert.equal(typeof releaseSecond, 'function')
  assert.equal(typeof releaseThird, 'function')
  assert.equal(limiter.acquire(1), null)
  assert.equal(limiter.acquire(3), null)

  releaseFirst?.()
  releaseFirst?.()
  const releaseFourth = limiter.acquire(3)
  assert.equal(typeof releaseFourth, 'function')
  releaseSecond?.()
  releaseThird?.()
  releaseFourth?.()
})
