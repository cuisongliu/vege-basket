import assert from 'node:assert/strict'
import test from 'node:test'
import { AiTurnStreamTerminalError, sendAiConversationTurn } from '../src/api.ts'
import type { AiTurnRunResponse } from '../src/types.ts'

const result: AiTurnRunResponse = {
  conversation: {
    contextKind: 'general',
    createdAt: '2026-07-21T03:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
    lastTurnAt: '2026-07-21T03:00:01.000Z',
    projectId: null,
    projectName: null,
    title: 'Streaming test',
    updatedAt: '2026-07-21T03:00:01.000Z',
  },
  outcome: null,
  turn: {
    assistantContent: '你好',
    attachments: [],
    attemptCount: 1,
    completedAt: '2026-07-21T03:00:01.000Z',
    createdAt: '2026-07-21T03:00:00.000Z',
    errorCode: null,
    id: '22222222-2222-4222-8222-222222222222',
    intentKind: 'chat',
    outcome: null,
    status: 'completed',
    turnNo: 1,
    updatedAt: '2026-07-21T03:00:01.000Z',
    userContent: 'hello',
  },
}

function streamResponse(events: Array<[string, Record<string, unknown>]>) {
  return new Response(events.map(([event, payload]) => (
    `event: ${event}\ndata: ${JSON.stringify({ ...payload, type: event })}\n\n`
  )).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
    status: 200,
  })
}

test('client turn stream exposes deltas and returns only the canonical completed result', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => streamResponse([
    ['started', { mode: 'text', sequence: 1, turnId: result.turn.id }],
    ['progress', { phase: 'generating', sequence: 2, turnId: result.turn.id }],
    ['delta', { append: '你', sequence: 3, turnId: result.turn.id }],
    ['delta', { append: '好', sequence: 4, turnId: result.turn.id }],
    ['completed', { result, sequence: 5 }],
  ])
  const deltas: string[] = []
  const phases: string[] = []

  const response = await sendAiConversationTurn({
    attachments: [],
    content: 'hello',
    contextKind: 'general',
    conversationId: result.conversation.id,
    projectId: null,
    turnId: result.turn.id,
  }, {
    onDelta: (delta) => deltas.push(delta),
    onProgress: (phase) => phases.push(phase),
  })

  assert.deepEqual(deltas, ['你', '好'])
  assert.deepEqual(phases, ['generating'])
  assert.deepEqual(response, result)
})

test('client treats a failed stream event with canonical data as a known terminal result', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  const failed = {
    ...result,
    turn: {
      ...result.turn,
      assistantContent: null,
      completedAt: null,
      errorCode: 'AI_REQUEST_TIMEOUT',
      status: 'failed' as const,
    },
  }
  globalThis.fetch = async () => streamResponse([
    ['started', { mode: 'progress', sequence: 1, turnId: result.turn.id }],
    ['failed', {
      error: { code: 'AI_REQUEST_TIMEOUT', message: 'AI request timed out' },
      result: failed,
      sequence: 2,
      turnId: result.turn.id,
    }],
  ])

  const response = await sendAiConversationTurn({
    attachments: [],
    content: 'extract todos',
    contextKind: 'general',
    conversationId: result.conversation.id,
    projectId: null,
    turnId: result.turn.id,
  })

  assert.equal(response.turn.status, 'failed')
  assert.equal(response.turn.errorCode, 'AI_REQUEST_TIMEOUT')
})

test('client preserves a known failed terminal event without canonical payload', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => streamResponse([
    ['started', { mode: 'text', sequence: 1, turnId: result.turn.id }],
    ['failed', {
      error: { code: 'AI_RESPONSE_INCOMPLETE', message: 'AI response ended early' },
      result: null,
      sequence: 2,
      turnId: result.turn.id,
    }],
  ])

  await assert.rejects(
    sendAiConversationTurn({
      attachments: [],
      content: 'hello',
      contextKind: 'general',
      conversationId: result.conversation.id,
      projectId: null,
      turnId: result.turn.id,
    }),
    (error: unknown) =>
      error instanceof AiTurnStreamTerminalError &&
      error.event === 'failed' &&
      error.code === 'AI_RESPONSE_INCOMPLETE',
  )
})

test('client rejects a stream that closes before a terminal event', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => streamResponse([
    ['started', { mode: 'text', sequence: 1, turnId: result.turn.id }],
    ['delta', { append: 'partial', sequence: 2, turnId: result.turn.id }],
  ])

  await assert.rejects(
    sendAiConversationTurn({
      attachments: [],
      content: 'hello',
      contextKind: 'general',
      conversationId: result.conversation.id,
      projectId: null,
      turnId: result.turn.id,
    }),
    /ended before the turn was confirmed/u,
  )
})
