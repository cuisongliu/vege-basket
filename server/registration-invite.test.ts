import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

function sourceBetween(start: string, end: string) {
  const startIndex = serverSource.indexOf(start)
  const endIndex = serverSource.indexOf(end, startIndex + start.length)
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`)
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`)
  return serverSource.slice(startIndex, endIndex)
}

test('shared-AI password registration accepts the invite inside the user transaction', () => {
  const registration = sourceBetween(
    'async function registerPasswordUser',
    'async function getProjectAccess',
  )
  const route = sourceBetween(
    "app.post('/api/auth/register'",
    "app.post('/api/auth/login'",
  )
  const insertIndex = registration.indexOf('insert into users')
  const acceptIndex = registration.indexOf('acceptProjectInviteTokenWithClient')
  const commitIndex = registration.indexOf("client.query('commit')")
  const registrationIndex = route.indexOf('registerPasswordUser')
  const sessionIndex = route.indexOf('createSession')

  assert.ok(insertIndex >= 0)
  assert.ok(insertIndex < acceptIndex)
  assert.ok(acceptIndex < commitIndex)
  assert.ok(registrationIndex >= 0)
  assert.ok(registrationIndex < sessionIndex)
  assert.match(
    registration,
    /if \(params\.requireInvite && !inviteAccepted\) \{[\s\S]*?client\.query\('rollback'\)/u,
  )
  assert.doesNotMatch(route, /isActiveProjectInviteToken/u)
})

test('registration invite acceptance locks and validates the live invite record', () => {
  const helper = sourceBetween(
    'async function acceptProjectInviteTokenWithClient',
    'async function acceptProjectInviteToken(',
  )

  assert.match(helper, /l\.revoked_at is null/u)
  assert.match(helper, /l\.expires_at > now\(\)/u)
  assert.match(helper, /for update of l/u)
  assert.match(helper, /verifyProjectInvitePassword\(inviteRow\.password_hash, rawPassword\)/u)
})
