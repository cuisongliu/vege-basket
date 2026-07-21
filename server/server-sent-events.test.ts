import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeAiTurnStreamEvent,
  ServerSentEventDecoder,
} from '../shared/server-sent-events.ts'

test('decodes SSE frames across CRLF, UTF-8, and arbitrary chunk boundaries', () => {
  const source = [
    'event: delta\r\n',
    'data: {"append":"你',
    '好"}\r\n\r\n',
    ': heartbeat\n\n',
    'event: completed\n',
    'data: {"ok":true}\n\n',
  ].join('')
  const encoded = new TextEncoder().encode(source)
  const decoder = new ServerSentEventDecoder()
  const events = []
  for (let index = 0; index < encoded.length; index += 3) {
    events.push(...decoder.push(encoded.slice(index, index + 3)))
  }
  events.push(...decoder.finish())

  assert.deepEqual(events, [
    { data: '{"append":"你好"}', event: 'delta' },
    { data: '{"ok":true}', event: 'completed' },
  ])
})

test('joins multiline data and flushes a final frame without a blank line', () => {
  const decoder = new ServerSentEventDecoder()
  const chunk = new TextEncoder().encode('event: progress\ndata: first\ndata: second')
  assert.deepEqual(decoder.push(chunk), [])
  assert.deepEqual(decoder.finish(), [
    { data: 'first\nsecond', event: 'progress' },
  ])
})

test('accepts CR-only server-sent event line endings', () => {
  const decoder = new ServerSentEventDecoder()
  const encoded = new TextEncoder().encode(
    'event: progress\rdata: {"phase":"generating"}\r\r' +
    'event: completed\rdata: {"ok":true}\r\r',
  )

  assert.deepEqual(decoder.push(encoded), [
    { data: '{"phase":"generating"}', event: 'progress' },
    { data: '{"ok":true}', event: 'completed' },
  ])
  assert.deepEqual(decoder.finish(), [])
})

test('rejects malformed nested turn-stream payloads', () => {
  assert.throws(
    () => decodeAiTurnStreamEvent({
      data: JSON.stringify({ result: {}, sequence: 1, type: 'completed' }),
      event: 'completed',
    }),
    /invalid turn result/u,
  )
  assert.throws(
    () => decodeAiTurnStreamEvent({
      data: JSON.stringify({
        conversation: { id: 'missing-fields' },
        mode: 'text',
        sequence: 1,
        turnId: 'turn-id',
        type: 'started',
      }),
      event: 'started',
    }),
    /invalid event/u,
  )
})
