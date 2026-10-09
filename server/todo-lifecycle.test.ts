import assert from 'node:assert/strict'
import test from 'node:test'
import { canDiscardTodo, canReopenTodo, getTodoDisplayStatus } from '../src/todo-lifecycle.ts'

test('personal projects map lifecycle states without organization review status', () => {
  assert.deepEqual(getTodoDisplayStatus({ confirmationStatus: 'pending_review', done: false, todoStatus: 'open' }, false), {
    label: '进行中',
    marker: 'open',
  })
  assert.deepEqual(getTodoDisplayStatus({ confirmationStatus: 'confirmed', done: true, todoStatus: 'completed' }, false), {
    label: '已完成',
    marker: 'done',
  })
  assert.deepEqual(getTodoDisplayStatus({ confirmationStatus: 'confirmed', done: false, todoStatus: 'discarded' }, false), {
    label: '已废弃',
    marker: 'discarded',
  })
})

test('organization projects retain their pending-review display state', () => {
  assert.deepEqual(getTodoDisplayStatus({ confirmationStatus: 'pending_review', done: false, todoStatus: 'open' }, true), {
    label: '待确认',
    marker: 'review',
  })
})

test('organization todos can only discard without recorded work and reopen after discard', () => {
  assert.equal(canDiscardTodo({ recordedWorkMinutes: 0, todoStatus: 'open' }, true), true)
  assert.equal(canDiscardTodo({ recordedWorkMinutes: 60, todoStatus: 'open' }, true), false)
  assert.equal(canDiscardTodo({ recordedWorkMinutes: 0, todoStatus: 'completed' }, true), false)
  assert.equal(canReopenTodo({ todoStatus: 'discarded' }), true)
  assert.equal(canReopenTodo({ todoStatus: 'completed' }), false)
})

test('personal todos allow discard but only discarded tasks can reopen', () => {
  assert.equal(canDiscardTodo({ recordedWorkMinutes: 0, todoStatus: 'open' }, false), true)
  assert.equal(canReopenTodo({ todoStatus: 'discarded' }), true)
  assert.equal(canReopenTodo({ todoStatus: 'completed' }), false)
})
