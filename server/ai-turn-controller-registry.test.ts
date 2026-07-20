import assert from 'node:assert/strict'
import test from 'node:test'

import { AiTurnControllerRegistry } from './ai-turn-controller-registry.ts'

test('cancel only aborts the controller registered for the cancelled lease', () => {
  const registry = new AiTurnControllerRegistry()
  const original = new AbortController()
  const retry = new AbortController()

  registry.register('turn-1', 'lease-original', original)
  registry.register('turn-1', 'lease-retry', retry)

  assert.equal(registry.abort('turn-1', 'lease-original'), true)
  assert.equal(original.signal.aborted, true)
  assert.equal(retry.signal.aborted, false)

  registry.release('turn-1', 'lease-original', original)
  assert.equal(registry.abort('turn-1', 'lease-retry'), true)
  assert.equal(retry.signal.aborted, true)
})
