import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyAiConversationTurnIntent,
} from '../src/api.ts'

const turnId = '11111111-1111-4111-8111-111111111111'

test('client requests server semantic classification before sending the canonical turn', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  let requestBody: Record<string, unknown> = {}
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      intent: { kind: 'workspace-review', period: 'weekly' },
      turnId,
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }

  const result = await classifyAiConversationTurnIntent({
    attachments: [],
    content: '换个角度看看我这礼拜都推进了什么，再排一下接下来的动作。',
    contextKind: 'general',
    projectId: null,
    turnId,
  })

  assert.equal(requestBody.turnId, turnId)
  assert.equal(requestBody.contextKind, 'general')
  assert.deepEqual(result, {
    intent: { kind: 'workspace-review', period: 'weekly' },
    turnId,
  })
})

test('client rejects a tampered or malformed semantic classification response', async (context) => {
  const originalFetch = globalThis.fetch
  context.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async () => new Response(JSON.stringify({
    intent: { kind: 'chat', reason: 'untrusted extra field' },
    turnId,
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })

  await assert.rejects(
    classifyAiConversationTurnIntent({
      attachments: [],
      content: '普通问题',
      contextKind: 'general',
      projectId: null,
      turnId,
    }),
    /classification is invalid/u,
  )
})
