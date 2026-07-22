import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AiIntentClassifierError,
  AI_INTENT_CLASSIFIER_SYSTEM_PROMPT,
  buildAiIntentClassificationRequest,
  classifyAiIntentWithModel,
  parseAiIntentClassificationResponse,
  type AiIntentClassificationInput,
} from './ai-intent-classifier.ts'
import type { AiCompletionRequest, AiProviderConfig } from './ai-provider.ts'

const config: AiProviderConfig = {
  apiKey: 'provider-key',
  baseUrl: 'https://ai.example.com',
  maxContextChars: 12_000,
  maxMessageLength: 20_000,
  model: 'provider-model',
}

const input: AiIntentClassificationInput = {
  content: '帮我梳理本周进展，并给出下一步行动建议。',
  shanghaiDate: '2026-07-22',
  sourceContextKind: 'general',
  sourceProjectId: null,
}

test('builds a deterministic bounded semantic-classification request', () => {
  const request = buildAiIntentClassificationRequest(input)

  assert.equal(request.responseFormat, 'json_object')
  assert.equal(request.temperature, 0)
  assert.equal(request.timeoutMs, 8_000)
  assert.equal(request.systemPrompt, AI_INTENT_CLASSIFIER_SYSTEM_PROMPT)
  assert.match(request.messages[0].content, /返回唯一的意图 JSON/u)
  assert.match(request.untrustedContext ?? '', /当前上海日期：2026-07-22/u)
  assert.match(request.untrustedContext ?? '', /来源上下文：general/u)
  assert.match(request.untrustedContext ?? '', /帮我梳理本周进展/u)
  assert.match(request.systemPrompt, /不确定时必须选择 chat/u)
  assert.match(request.systemPrompt, /功能咨询、假设性问题/u)
  assert.match(request.systemPrompt, /昨天、上周、过去/u)
  assert.match(request.systemPrompt, /盘一盘这礼拜都推进了啥/u)
})

test('includes only project context kind and validates context identity', () => {
  const request = buildAiIntentClassificationRequest({
    ...input,
    content: '总结一下今天的项目进展',
    sourceContextKind: 'project',
    sourceProjectId: 17,
  })

  assert.match(request.untrustedContext ?? '', /来源上下文：project/u)
  assert.doesNotMatch(request.untrustedContext ?? '', /项目 ID/u)
  assert.throws(
    () => buildAiIntentClassificationRequest({
      ...input,
      sourceContextKind: 'project',
      sourceProjectId: null,
    }),
    /positive project ID/u,
  )
  assert.throws(
    () => buildAiIntentClassificationRequest({ ...input, sourceProjectId: 17 }),
    /cannot include a project ID/u,
  )
})

test('strictly parses every supported intent shape', () => {
  assert.deepEqual(parseAiIntentClassificationResponse('{"kind":"chat"}'), {
    kind: 'chat',
  })
  assert.deepEqual(
    parseAiIntentClassificationResponse('{"kind":"conversation-analysis"}'),
    { kind: 'conversation-analysis' },
  )
  assert.deepEqual(
    parseAiIntentClassificationResponse('{"kind":"project-summary","period":"daily"}'),
    { kind: 'project-summary', period: 'daily' },
  )
  assert.deepEqual(
    parseAiIntentClassificationResponse('{"kind":"workspace-review","period":"weekly"}'),
    { kind: 'workspace-review', period: 'weekly' },
  )
})

test('returns only the bounded todo classification and rejects model-echoed content', () => {
  assert.deepEqual(
    parseAiIntentClassificationResponse('{"kind":"todo-extraction"}'),
    { kind: 'todo-extraction' },
  )
  assert.throws(
    () => parseAiIntentClassificationResponse('{"kind":"todo-extraction","content":"模型伪造内容"}'),
    /unknown fields/u,
  )
})

test('rejects malformed JSON, unsupported kinds, periods, and extra fields', () => {
  const invalid = [
    '```json\n{"kind":"chat"}\n```',
    '[]',
    '{"kind":"unknown"}',
    '{"kind":"chat","period":"daily"}',
    '{"kind":"project-summary"}',
    '{"kind":"project-summary","period":"monthly"}',
    '{"kind":"workspace-review","period":"weekly","reason":"explicit"}',
  ]

  for (const response of invalid) {
    assert.throws(
      () => parseAiIntentClassificationResponse(response),
      AiIntentClassifierError,
    )
  }
})

test('calls the shared provider and returns the strict parsed intent', async () => {
  const controller = new AbortController()
  const capturedConfigs: AiProviderConfig[] = []
  const capturedRequests: AiCompletionRequest[] = []
  const result = await classifyAiIntentWithModel(config, { ...input, signal: controller.signal }, {
    requestCompletion: async (providerConfig, request) => {
      capturedConfigs.push(providerConfig)
      capturedRequests.push(request)
      return '{"kind":"workspace-review","period":"weekly"}'
    },
  })

  assert.equal(capturedConfigs[0], config)
  assert.equal(capturedRequests[0]?.responseFormat, 'json_object')
  assert.equal(capturedRequests[0]?.temperature, 0)
  assert.equal(capturedRequests[0]?.timeoutMs, 8_000)
  assert.equal(capturedRequests[0]?.signal, controller.signal)
  assert.deepEqual(result, { kind: 'workspace-review', period: 'weekly' })
})

test('propagates provider failures and does not apply a regex fallback', async () => {
  const providerError = new Error('provider timeout')
  await assert.rejects(
    classifyAiIntentWithModel(config, input, {
      requestCompletion: async () => {
        throw providerError
      },
    }),
    (error: unknown) => error === providerError,
  )
})

test('rejects invalid input before calling the provider', async () => {
  let calls = 0
  await assert.rejects(
    classifyAiIntentWithModel(config, { ...input, shanghaiDate: '2026-02-30' }, {
      requestCompletion: async () => {
        calls += 1
        return '{"kind":"chat"}'
      },
    }),
    AiIntentClassifierError,
  )
  assert.equal(calls, 0)
})
