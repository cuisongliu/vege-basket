import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodeAiConversationCursor,
  encodeAiConversationCursor,
} from './ai-conversation-cursor.ts'

test('conversation cursors preserve PostgreSQL microsecond precision', () => {
  const id = '8d45ee26-04a0-4ef2-bbe6-9e30e68d9909'
  const lastTurnAt = '2026-07-20T12:34:56.123456Z'

  assert.deepEqual(
    decodeAiConversationCursor(encodeAiConversationCursor(lastTurnAt, id)),
    { id, lastTurnAt },
  )
})
