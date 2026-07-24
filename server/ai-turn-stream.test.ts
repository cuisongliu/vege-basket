import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { waitForAiTurnStreamDrain } from './ai-turn-stream.ts'

test('drain wait resolves on drain and removes the close listener', async () => {
  const response = new EventEmitter()
  const waiting = waitForAiTurnStreamDrain(response, 1_000)
  response.emit('drain')

  assert.equal(await waiting, true)
  assert.equal(response.listenerCount('close'), 0)
  assert.equal(response.listenerCount('drain'), 0)
})

test('drain wait resolves on close and removes the drain listener', async () => {
  const response = new EventEmitter()
  const waiting = waitForAiTurnStreamDrain(response, 1_000)
  response.emit('close')

  assert.equal(await waiting, false)
  assert.equal(response.listenerCount('close'), 0)
  assert.equal(response.listenerCount('drain'), 0)
})

test('drain wait abandons a stalled client after a bounded timeout', async () => {
  const response = new EventEmitter()
  const keepEventLoopAlive = setTimeout(() => undefined, 100)

  try {
    assert.equal(await waitForAiTurnStreamDrain(response, 5), false)
    assert.equal(response.listenerCount('close'), 0)
    assert.equal(response.listenerCount('drain'), 0)
  } finally {
    clearTimeout(keepEventLoopAlive)
  }
})
