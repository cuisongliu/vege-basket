import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  reassignBugsForVerifierLoss,
} from './test-bug-verifiers.ts'

const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(
  new URL('./migrations/20261009_test_bug_verifiers.sql', import.meta.url),
  'utf8',
)
const verifierSource = readFileSync(new URL('./test-bug-verifiers.ts', import.meta.url), 'utf8')
const workbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/test-workbench-api.ts', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
const notificationSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const accountOffboardingSource = readFileSync(new URL('./account-offboarding.ts', import.meta.url), 'utf8')
const platformAdminSource = readFileSync(new URL('./platform-admins.ts', import.meta.url), 'utf8')
const organizationSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const platformPermissionSource = readFileSync(new URL('./platform-admins.ts', import.meta.url), 'utf8')

test('Bug verifier schema and migration preserve eligible reporters and timeline identities', () => {
  for (const source of [schemaSource, migrationSource]) {
    assert.match(source, /verifier_user_id bigint references users\(id\) on delete set null/u)
    assert.match(source, /membership\.access_level in \('owner', 'editor'\)/u)
    assert.match(source, /role\.role in \('tester', 'organization_admin'\)/u)
    assert.match(source, /previous_verifier_user_id bigint references users\(id\) on delete set null/u)
    assert.match(source, /next_verifier_user_id bigint references users\(id\) on delete set null/u)
    assert.match(source, /'verifier_transferred'/u)
  }
  assert.match(schemaSource, /idx_test_bugs_verifier_id/u)
  assert.match(migrationSource, /^begin;[\s\S]*commit;\s*$/u)
})

test('verifier eligibility and authority stay separate from ordinary editor access', () => {
  assert.match(verifierSource, /account\.account_status = 'active'/u)
  assert.match(verifierSource, /membership\.status = 'active'/u)
  assert.match(verifierSource, /membership\.access_level in \('owner', 'editor'\)/u)
  assert.match(verifierSource, /if \(currentVerifierUserId === userId\) return true/u)
  assert.match(verifierSource, /space\.owner_user_id = \$2/u)
  assert.match(verifierSource, /membership\.access_role in \('owner', 'admin'\)/u)
  assert.doesNotMatch(verifierSource, /membership\.access_level = 'editor'\) as allowed/u)
})

test('verifier loss transfers to the fallback without changing Bug status', async () => {
  const calls: Array<{ params?: unknown[]; sql: string }> = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ params, sql })
      if (sql.includes('from test_bugs')) return { rows: [{ id: '41', status: 'pending_verification' }] }
      if (sql.includes('select account.id')) return { rows: [{ id: '9' }] }
      return { rows: [] }
    },
  }
  const result = await reassignBugsForVerifierLoss(client as never, {
    actorUserId: 2,
    spaceId: 3,
    verifierUserId: 7,
  })
  assert.deepEqual(result, [{
    bugId: 41,
    nextStatus: 'pending_verification',
    nextVerifierUserId: 9,
    previousStatus: 'pending_verification',
    previousVerifierUserId: 7,
  }])
  const update = calls.find((call) => call.sql.includes('update test_bugs'))
  assert.deepEqual(update?.params, [9, 'pending_verification', '41', 7])
  assert.equal(calls.filter((call) => call.sql.includes("'status_changed'")).length, 0)
})

test('verifier loss without a fallback clears the verifier and returns pending verification', async () => {
  const calls: Array<{ params?: unknown[]; sql: string }> = []
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ params, sql })
      if (sql.includes('from test_bugs')) return { rows: [{ id: '42', status: 'pending_verification' }] }
      if (sql.includes('select account.id')) return { rows: [] }
      return { rows: [] }
    },
  }
  const result = await reassignBugsForVerifierLoss(client as never, {
    actorUserId: 2,
    spaceId: 3,
    verifierUserId: 7,
  })
  assert.equal(result[0]?.nextVerifierUserId, null)
  assert.equal(result[0]?.nextStatus, 'pending_confirmation')
  assert.ok(calls.some((call) => call.sql.includes("'verifier_transferred'")))
  assert.ok(calls.some((call) => call.sql.includes("'status_changed'")))
})

test('verifier loss preserves closed Bug history without writing', async () => {
  const statements: string[] = []
  const client = {
    async query(sql: string) {
      statements.push(sql)
      if (sql.includes('from test_bugs')) return { rows: [{ id: '42', status: 'closed' }] }
      return { rows: [] }
    },
  }
  assert.deepEqual(await reassignBugsForVerifierLoss(client as never, { actorUserId: 2, spaceId: 3, verifierUserId: 7 }), [])
  assert.equal(statements.some((sql) => /^\s*(update|insert|delete)/iu.test(sql)), false)
})

test('Bug verifier routes recheck locked authority and expose dedicated client operations', () => {
  assert.match(workbenchSource, /bugs\/:bugId\/verifier/u)
  assert.match(workbenchSource, /bugs\/:bugId\/verification-result/u)
  assert.match(workbenchSource, /lockBugVerifierSpace\(client, spaceId\)/u)
  assert.match(workbenchSource, /canTransferBugVerifier\(client, spaceId, session\.userId/u)
  assert.match(workbenchSource, /isEligibleBugVerifier\(client, spaceId, verifierUserId\)/u)
  assert.match(workbenchSource, /canResolveBugVerification\(bug\.status, nextStatus, authorized\)/u)
  assert.match(apiSource, /export function updateTestBugVerifier/u)
  assert.match(apiSource, /export function resolveTestBugVerification/u)
  assert.match(clientSource, /<Label>验证人<Select/u)
  assert.match(clientSource, /bug\.canResolveVerification/u)
  assert.match(clientSource, /event\.eventType === 'verifier_transferred'/u)
})

test('status notifications resolve the canonical verifier instead of the reporter', () => {
  assert.match(notificationSource, /coalesce\(\$4::bigint, b\.verifier_user_id\) as recipient_user_id/u)
  assert.match(notificationSource, /recipient\.id = coalesce\(\$4::bigint, b\.verifier_user_id\)/u)
  assert.match(notificationSource, /delete from notification_deliveries where kind = 'test_bug_status_changed' and source_id = \$1/u)
})

test('membership, role, account, and organization removal revoke verifier assignments', () => {
  assert.match(workbenchSource, /reassignBugsForVerifierLoss\(client,[\s\S]*verifierUserId: userId/u)
  assert.match(organizationSource, /reassignBugsForVerifierLoss\(client,[\s\S]*verifierUserId: userId/u)
  assert.match(accountOffboardingSource, /reassignBugsForVerifierLossAcrossSpaces\(client/u)
  assert.match(platformAdminSource, /reassignBugsForVerifierLossAcrossSpaces\(client/u)
})

test('role changes retain verifier assignments while an eligible role remains', () => {
  assert.match(
    platformPermissionSource,
    /if \(!roles\.includes\('tester'\) && !roles\.includes\('organization_admin'\)\) \{[\s\S]*reassignBugsForVerifierLossAcrossSpaces\(client/u,
  )
})

test('cross-space verifier cleanup locks every organization before space rows', () => {
  const organizationLock = verifierSource.indexOf("select id from organizations where id = any($1::bigint[]) order by id for share")
  const spaceLockLoop = verifierSource.indexOf('for (const space of spaces.rows)')
  assert.ok(organizationLock > 0)
  assert.ok(spaceLockLoop > organizationLock)
  assert.match(verifierSource, /where bug\.verifier_user_id = \$1\s+order by space\.id/u)
})
