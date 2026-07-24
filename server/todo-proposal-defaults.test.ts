import assert from 'node:assert/strict'
import test from 'node:test'

import { defaultTodoProposalDueDate } from '../src/todo-proposal-defaults.ts'

test('defaults an undated pending proposal to the current Shanghai date', () => {
  assert.equal(
    defaultTodoProposalDueDate(null, 'pending', new Date('2026-07-20T16:30:00.000Z')),
    '2026-07-21',
  )
})

test('preserves inferred and historical proposal dates', () => {
  const now = new Date('2026-07-20T16:30:00.000Z')

  assert.equal(defaultTodoProposalDueDate('2026-07-25', 'pending', now), '2026-07-25')
  assert.equal(defaultTodoProposalDueDate(null, 'confirmed', now), null)
  assert.equal(defaultTodoProposalDueDate(null, 'discarded', now), null)
})
