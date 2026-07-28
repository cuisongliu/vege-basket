import assert from 'node:assert/strict'
import test from 'node:test'

import { aiIntentRequestErrorMessage } from '../src/ai-intent-error.ts'
import { ApiError } from '../src/api-error.ts'

function apiError(code: string, status = 502) {
  return new ApiError('AI request failed', {
    method: 'POST',
    path: '/api/ai/intent-classifications',
    responseBody: { code, error: 'AI request failed' },
    status,
    statusText: 'Bad Gateway',
  })
}

test('explains AI intent failures without claiming the model did not understand', () => {
  assert.equal(
    aiIntentRequestErrorMessage(apiError('AI_INTENT_CLASSIFICATION_INVALID')),
    '模型返回的意图格式无法读取，请重试。',
  )
  assert.equal(
    aiIntentRequestErrorMessage(apiError('AI_REQUEST_TIMEOUT', 504)),
    '模型响应超时，请重试。',
  )
  assert.equal(
    aiIntentRequestErrorMessage(apiError('AI_REQUEST_FAILED')),
    'AI 服务暂时不可用，请稍后重试。',
  )
})

test('preserves actionable project, rate-limit, configuration, and response guidance', () => {
  assert.equal(
    aiIntentRequestErrorMessage(apiError('AI_PROJECT_REQUIRED', 400)),
    '请先用 @ 选择一个项目，再生成项目总结。',
  )
  assert.equal(
    aiIntentRequestErrorMessage(apiError('AI_RATE_LIMITED', 429)),
    'AI 请求过于频繁，请稍后再试。',
  )
  assert.equal(
    aiIntentRequestErrorMessage(apiError('AI_NOT_CONFIGURED', 503)),
    'AI 服务尚未配置，请联系管理员。',
  )
  assert.equal(
    aiIntentRequestErrorMessage(new Error('AI intent classification response is invalid')),
    'AI 服务返回了无法识别的意图格式，请刷新页面后重试。',
  )
})

test('does not surface intentional request cancellation as a comprehension error', () => {
  assert.equal(
    aiIntentRequestErrorMessage(new DOMException('Aborted', 'AbortError')),
    '',
  )
})
