import assert from 'node:assert/strict'
import test from 'node:test'

import { aiTurnFailureDetail } from '../src/ai-turn-error.ts'

test('explains a provider DNS failure instead of showing a generic model error', () => {
  assert.equal(
    aiTurnFailureDetail('AI_BASE_URL_UNRESOLVED'),
    'AI 服务地址暂时无法解析，请检查网络或 DNS 后重试。',
  )
})
test('preserves existing AI turn failure guidance and the unknown fallback', () => {
  assert.equal(aiTurnFailureDetail('AI_REQUEST_TIMEOUT'), '模型响应超时，请重试这条消息。')
  assert.equal(
    aiTurnFailureDetail('AI_TODO_RESPONSE_INVALID'),
    '模型返回的内容无法读取，请重试这条消息。',
  )
  assert.equal(
    aiTurnFailureDetail('AI_TODO_NONE_FOUND'),
    '没有识别到可执行的待办，可以补充更明确的内容后重试。',
  )
  assert.equal(
    aiTurnFailureDetail('UNEXPECTED_ERROR'),
    '模型没有完成这次回复，请重试这条消息。',
  )
})
