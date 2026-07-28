import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseAiTodoBatchDeepLink,
  removeAiTodoBatchDeepLink,
} from '../src/ai-todo-deep-link.ts'

test('AI todo batch deep links accept only canonical positive identifiers', () => {
  assert.deepEqual(parseAiTodoBatchDeepLink('?aiTodoBatch=42'), { batchId: 42, status: 'valid' })
  assert.equal(parseAiTodoBatchDeepLink('?aiTodoBatch=0').status, 'invalid')
  assert.equal(parseAiTodoBatchDeepLink('?aiTodoBatch=01').status, 'invalid')
  assert.equal(parseAiTodoBatchDeepLink('').status, 'absent')
})

test('AI todo batch deep links are removed without changing other navigation state', () => {
  assert.equal(removeAiTodoBatchDeepLink({
    hash: '#section',
    pathname: '/',
    search: '?invite=abc&aiTodoBatch=42',
  }), '/?invite=abc#section')
})
