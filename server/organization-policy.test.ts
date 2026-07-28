import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canManageOrganization,
  hashOrganizationInviteToken,
  isFreshFeishuTimestamp,
  matchesOrganizationDeleteConfirmation,
  normalizeOrganizationName,
  normalizeOrganizationWeekStart,
  normalizeOrganizationWeekStartsOn,
  verifyFeishuCardSignature,
} from './organization-policy.ts'
import { isSystemAdmin } from './roles.ts'

const organizationsSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')

test('system administrator access requires an explicit username configuration', () => {
  const previous = process.env.VEGES_ADMIN_USERNAMES
  try {
    delete process.env.VEGES_ADMIN_USERNAMES
    assert.equal(isSystemAdmin('admin'), false)

    process.env.VEGES_ADMIN_USERNAMES = ' owner@example.com, ops@example.com '
    assert.equal(isSystemAdmin('OWNER@example.com'), true)
    assert.equal(isSystemAdmin('admin'), false)
  } finally {
    if (previous === undefined) delete process.env.VEGES_ADMIN_USERNAMES
    else process.env.VEGES_ADMIN_USERNAMES = previous
  }
})

test('organization administrators are separate from ordinary members', () => {
  assert.equal(canManageOrganization('owner'), true)
  assert.equal(canManageOrganization('admin'), true)
  assert.equal(canManageOrganization('member'), false)
  assert.equal(canManageOrganization(null), false)
})

test('organization names are trimmed and limited to 80 characters', () => {
  assert.equal(normalizeOrganizationName('  测试组织  '), '测试组织')
  assert.equal(normalizeOrganizationName(''), null)
  assert.equal(normalizeOrganizationName('a'.repeat(80)), 'a'.repeat(80))
  assert.equal(normalizeOrganizationName('a'.repeat(81)), null)
})

test('organization deletion requires the exact full organization name', () => {
  assert.equal(matchesOrganizationDeleteConfirmation('Sealos 项目组', 'Sealos 项目组'), true)
  assert.equal(matchesOrganizationDeleteConfirmation('Sealos 项目组', 'sealos 项目组'), false)
  assert.equal(matchesOrganizationDeleteConfirmation('Sealos 项目组', ' Sealos 项目组 '), false)
  assert.equal(matchesOrganizationDeleteConfirmation('Sealos 项目组', null), false)
})

test('organization deletion detaches owned resources inside the transaction', () => {
  assert.match(organizationsSource, /update projects set organization_id = null, updated_at = now\(\)/u)
  assert.match(organizationsSource, /update test_spaces set organization_id = null, updated_at = now\(\)/u)
  assert.match(organizationsSource, /delete from organizations where id = \$1/u)
})

test('organization test-space attachment locks the space before validating members', () => {
  const routeStart = organizationsSource.indexOf("router.post('/organizations/:organizationId/test-spaces/:spaceId'")
  const routeEnd = organizationsSource.indexOf("router.put('/organizations/:organizationId/weekly-reports", routeStart)
  const routeSource = organizationsSource.slice(routeStart, routeEnd)
  const spaceLock = routeSource.indexOf('for update')
  const memberLock = routeSource.indexOf("status in ('pending', 'active')")
  const update = routeSource.indexOf('update test_spaces set organization_id = $1')

  assert.notEqual(routeStart, -1)
  assert.notEqual(routeEnd, -1)
  assert.ok(spaceLock >= 0 && spaceLock < memberLock)
  assert.ok(memberLock < update)
  assert.match(routeSource, /organization_id = \$1 and user_id = any\(\$2::bigint\[\]\) and status = 'active'/u)
})

test('organization detail omits invitations after the recipient joins', () => {
  assert.match(
    organizationsSource,
    /from organization_invitations where organization_id = \$1\s+and status <> 'accepted'/u,
  )
})

test('organization reporting dates normalize to the configured start weekday', () => {
  assert.equal(normalizeOrganizationWeekStart('2026-07-21'), '2026-07-20')
  assert.equal(normalizeOrganizationWeekStart('2026-07-26'), '2026-07-20')
  assert.equal(normalizeOrganizationWeekStart('2026-07-24', 3), '2026-07-22')
  assert.equal(normalizeOrganizationWeekStart('2026-07-24', 7), '2026-07-19')
  assert.equal(normalizeOrganizationWeekStart('invalid'), null)
  assert.equal(normalizeOrganizationWeekStartsOn(1), 1)
  assert.equal(normalizeOrganizationWeekStartsOn(7), 7)
  assert.equal(normalizeOrganizationWeekStartsOn(0), null)
})

test('organization invite tokens are stored as one-way hashes', () => {
  const token = 'invite-token'
  assert.notEqual(hashOrganizationInviteToken(token), token)
  assert.equal(hashOrganizationInviteToken(token), hashOrganizationInviteToken(token))
})

test('Feishu card signatures validate the raw request body', () => {
  const body = JSON.stringify({ event: { action: 'accept' } })
  const nonce = 'nonce'
  const timestamp = '1784621717'
  const verificationToken = 'verification-token'
  const signature = crypto
    .createHash('sha1')
    .update(`${timestamp}${nonce}${verificationToken}${body}`)
    .digest('hex')
  assert.equal(verifyFeishuCardSignature({ body, nonce, signature, timestamp, verificationToken }), true)
  assert.equal(verifyFeishuCardSignature({ body: `${body} `, nonce, signature, timestamp, verificationToken }), false)
  assert.equal(verifyFeishuCardSignature({ body, nonce, signature: '', timestamp, verificationToken }), false)
})

test('Feishu card action routes require signatures after challenge handling', () => {
  assert.match(
    organizationsSource,
    /if \(!signature \|\| !isFreshFeishuTimestamp\(timestamp\) \|\| !verifyFeishuCardSignature\(/u,
  )
})

test('Feishu callbacks outside the five-minute replay window are rejected', () => {
  assert.equal(isFreshFeishuTimestamp('1000', 1_000_000), true)
  assert.equal(isFreshFeishuTimestamp('1000', 1_301_000), false)
})
