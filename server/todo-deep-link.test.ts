import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseTodoDeepLink,
  removeTodoDeepLink,
  resolveTodoDeepLinkTarget,
  shouldDeferTodoDeepLinkForInvite,
} from '../src/todo-deep-link.ts'

test('parses only positive safe todo IDs', () => {
  assert.deepEqual(parseTodoDeepLink(''), { status: 'absent', todoId: null })
  assert.deepEqual(parseTodoDeepLink('?todo=42'), { status: 'valid', todoId: 42 })
  assert.deepEqual(parseTodoDeepLink('?todo=0'), { status: 'invalid', todoId: null })
  assert.deepEqual(parseTodoDeepLink('?todo=01'), { status: 'invalid', todoId: null })
  assert.deepEqual(parseTodoDeepLink('?todo=1.5'), { status: 'invalid', todoId: null })
  assert.deepEqual(
    parseTodoDeepLink('?todo=9007199254740992'),
    { status: 'invalid', todoId: null },
  )
})

test('removes only the todo query parameter', () => {
  assert.equal(
    removeTodoDeepLink({
      hash: '#section',
      pathname: '/workspace',
      search: '?invite=abc&todo=42&view=all',
    }),
    '/workspace?invite=abc&view=all#section',
  )
})

test('resolves a todo only inside the authenticated project catalog', () => {
  const todos = [
    { id: 41, projectId: 7, title: 'Visible' },
    { id: 42, projectId: 8, title: 'Hidden' },
  ]

  assert.deepEqual(resolveTodoDeepLinkTarget({
    projectIds: [7],
    todoId: 41,
    todos,
  }), todos[0])
  assert.equal(resolveTodoDeepLinkTarget({
    projectIds: [7],
    todoId: 42,
    todos,
  }), null)
  assert.equal(resolveTodoDeepLinkTarget({
    projectIds: [7],
    todoId: 999,
    todos,
  }), null)
})

test('waits for an invite attempt but continues after that invite settles', () => {
  assert.equal(shouldDeferTodoDeepLinkForInvite('invite-1', ''), true)
  assert.equal(shouldDeferTodoDeepLinkForInvite('invite-1', 'invite-1'), false)
  assert.equal(shouldDeferTodoDeepLinkForInvite('', ''), false)
  assert.equal(shouldDeferTodoDeepLinkForInvite('invite-2', 'invite-1'), true)
})
