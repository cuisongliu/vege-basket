import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  databasePoolErrorCode,
  registerDatabasePoolErrorHandler,
} from './database-pool-policy.ts'

test('idle PostgreSQL client errors are handled without terminating the process', () => {
  const pool = new EventEmitter()
  const messages: string[] = []
  registerDatabasePoolErrorHandler(pool, (message) => messages.push(message))

  assert.doesNotThrow(() => {
    pool.emit('error', Object.assign(new Error('read timed out'), { code: 'ETIMEDOUT' }))
  })
  assert.deepEqual(messages, [
    '[database] discarded an idle PostgreSQL connection after ETIMEDOUT',
  ])
})

test('database pool diagnostics expose only bounded error codes', () => {
  assert.equal(databasePoolErrorCode({ code: 'ECONNRESET' }), 'ECONNRESET')
  assert.equal(databasePoolErrorCode({ code: 'credential=value' }), 'UNKNOWN')
  assert.equal(databasePoolErrorCode(new Error('contains sensitive details')), 'UNKNOWN')
})
