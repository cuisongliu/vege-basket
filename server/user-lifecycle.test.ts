import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isUserAccountStatus, userAccountStatuses } from '../shared/user-lifecycle.ts'

test('account lifecycle statuses are explicit and finite', () => {
  assert.deepEqual(userAccountStatuses, ['active', 'disabled', 'departed'])
  assert.equal(isUserAccountStatus('active'), true)
  assert.equal(isUserAccountStatus('disabled'), true)
  assert.equal(isUserAccountStatus('departed'), true)
  assert.equal(isUserAccountStatus('removed'), false)
})

test('protected authentication rejects non-active accounts', () => {
  const rolesSource = readFileSync(new URL('./roles.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(rolesSource, /u\.account_status = 'active'/u)
  assert.match(appSource, /users\.account_status = 'active'/u)
  assert.match(appSource, /row\.account_status !== 'active'/u)
})

test('offboarding keeps history and records transfer decisions', () => {
  const source = readFileSync(new URL('./account-offboarding.ts', import.meta.url), 'utf8')
  assert.match(source, /account_offboarding_records/u)
  assert.match(source, /account_offboarding_asset_transfers/u)
  assert.match(source, /unassigned/u)
  assert.match(source, /member\.departed/u)
  assert.match(source, /test_bug_comments/u)
  assert.match(source, /该 Bug 已因成员 \$\{departedUserName\} 离职转移给组织管理员/u)
  assert.match(source, /transfer_source\)\s*\n\s*values \(\$1, 'transferred'.*'offboarding'/u)
  assert.match(source, /account_offboarding_notifications/u)
  assert.match(source, /configureAccountOffboardingNotifications/u)
})

test('offboarding recipients receive one aggregated notification per departure', () => {
  const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(serverSource, /account_offboarding_received/u)
  assert.match(serverSource, /你已接收离职成员的资产/u)
  assert.match(appSource, /accountOffboardingReceived/u)
  assert.match(appSource, /离职后的资产/u)
})
