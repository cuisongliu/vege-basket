import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('delivery todo cleanup is explicit and never part of startup schema', () => {
  const cleanup = readFileSync(new URL('./cleanup-delivery-todo-links.ts', import.meta.url), 'utf8')
  const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
  assert.match(cleanup, /DELIVERY_TODO_LINK_CLEANUP_CONFIRM !== 'YES'/u)
  assert.match(cleanup, /delete from project_package_operation_todos/u)
  assert.match(cleanup, /未删除交付事件或待办/u)
  assert.doesNotMatch(schema, /delete from project_package_operation_todos/u)
})
