import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, formatApiErrorDiagnostic } from '../src/api-error.ts'

test('formats HTTP status, request target, and JSON response details', () => {
  const error = new ApiError('安装包记录保存失败', {
    method: 'POST',
    path: '/api/projects/7/package-timeline/events/22/packages',
    responseBody: {
      error: '安装包记录保存失败',
      code: 'PACKAGE_ITEMS_DATABASE_ERROR',
      requestId: 'request-123',
      details: {
        databaseCode: '23505',
        phase: 'persist_package_items',
      },
    },
    status: 409,
    statusText: 'Conflict',
  })

  const message = formatApiErrorDiagnostic(error, '安装包记录保存失败，请稍后再试。')

  assert.match(message, /HTTP 状态：409 Conflict/)
  assert.match(message, /POST \/api\/projects\/7\/package-timeline\/events\/22\/packages/)
  assert.match(message, /PACKAGE_ITEMS_DATABASE_ERROR/)
  assert.match(message, /request-123/)
})

test('preserves non-API errors without inventing an HTTP response', () => {
  const message = formatApiErrorDiagnostic(new Error('Network disconnected'), '保存失败。')

  assert.equal(message, '保存失败。\n错误：Network disconnected')
})
