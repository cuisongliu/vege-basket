import assert from 'node:assert/strict'
import test from 'node:test'
import { createPackageItemFailureDiagnostic } from './package-item-diagnostics.ts'

const context = {
  eventId: 22,
  itemCount: 3,
  phase: 'persist_package_items' as const,
  projectId: 7,
}

test('reports a missing package event without exposing an internal stack', () => {
  const result = createPackageItemFailureDiagnostic(new Error('Event not found'), context)

  assert.equal(result.status, 404)
  assert.equal(result.body.code, 'PACKAGE_EVENT_NOT_FOUND')
  assert.equal(result.body.details.eventId, 22)
  assert.equal('stack' in result.body.details, false)
})

test('returns safe PostgreSQL diagnostics for package item failures', () => {
  const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'project_package_groups_project_package_event_id_package_name_key',
    detail: 'Key (package_name)=(admin) already exists.',
    table: 'project_package_groups',
  })
  const result = createPackageItemFailureDiagnostic(error, context)

  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'PACKAGE_ITEMS_DATABASE_ERROR')
  assert.equal(result.body.details.databaseCode, '23505')
  assert.equal(result.body.details.databaseDetail, 'Key (package_name)=(admin) already exists.')
})

test('redacts credentials from database details', () => {
  const error = Object.assign(new Error('connection failed'), {
    code: '08006',
    detail: 'postgres://user:password@example.com/db token=secret-value',
  })
  const result = createPackageItemFailureDiagnostic(error, context)

  assert.equal(result.body.details.databaseDetail, '[redacted-url] token=[redacted]')
  assert.doesNotMatch(result.body.details.databaseDetail ?? '', /password|secret-value/)
})

test('does not expose unknown exception messages', () => {
  const result = createPackageItemFailureDiagnostic(
    new Error('APP_ENCRYPTION_KEYS contains secret material'),
    context,
  )

  assert.equal(result.status, 500)
  assert.equal(result.body.code, 'PACKAGE_ITEMS_UNEXPECTED_ERROR')
  assert.equal(result.body.details.reason, '服务端在处理安装包批量写入时发生未分类异常。')
  assert.doesNotMatch(JSON.stringify(result.body), /secret material/)
})
