import assert from 'node:assert/strict'
import test from 'node:test'

import { buildConfirmedTodoInsertQuery } from './ai-todo-confirmation.ts'

test('casts repeated todo confirmation user parameters as bigint', () => {
  const query = buildConfirmedTodoInsertQuery({
    assigneeUserId: 12,
    createdByUserId: 7,
    detail: 'encrypted-detail',
    dueDate: '2026-07-21',
    moduleId: null,
    priority: 'medium',
    projectId: 3,
    title: 'encrypted-title',
  })

  assert.doesNotMatch(query.text, /\$7(?!::bigint)/u)
  assert.doesNotMatch(query.text, /\$8(?!::bigint)/u)
  assert.deepEqual(query.values, [
    3,
    'encrypted-title',
    'encrypted-detail',
    '2026-07-21',
    'medium',
    null,
    7,
    12,
  ])
})
