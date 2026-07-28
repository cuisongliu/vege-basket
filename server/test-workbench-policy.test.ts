import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canDeleteTestSubject,
  canDeveloperSetBugStatus,
  canManageTestPlan,
  canRemoveTestPlanCase,
  isBugStatus,
  isTestResult,
  isTestSpaceMembershipStatus,
  normalizeTestSpaceInviteExpiresInMinutes,
  parseOptionalTestSpaceOrganizationId,
} from './test-workbench-policy.ts'

const testWorkbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')

test('developer bug transitions stop at pending verification', () => {
  assert.equal(canDeveloperSetBugStatus('assigned', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('reopened', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('in_progress', 'pending_verification'), true)
  assert.equal(canDeveloperSetBugStatus('pending_verification', 'closed'), false)
  assert.equal(canDeveloperSetBugStatus('new', 'rejected'), false)
})

test('test result and bug status guards reject unknown values', () => {
  assert.equal(isTestResult('blocked'), true)
  assert.equal(isTestResult('success'), false)
  assert.equal(isBugStatus('pending_verification'), true)
  assert.equal(isBugStatus('fixed'), false)
})

test('test space invitation policy accepts only supported states and expiries', () => {
  assert.equal(isTestSpaceMembershipStatus('pending'), true)
  assert.equal(isTestSpaceMembershipStatus('active'), true)
  assert.equal(isTestSpaceMembershipStatus('removed'), false)
  assert.equal(normalizeTestSpaceInviteExpiresInMinutes(60), 60)
  assert.equal(normalizeTestSpaceInviteExpiresInMinutes(15), 10)
  assert.equal(normalizeTestSpaceInviteExpiresInMinutes('1440'), 1440)
})

test('test space organization selection accepts an active id or no organization', () => {
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(null), { valid: true, value: null })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(''), { valid: true, value: null })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId('12'), { valid: true, value: 12 })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(12), { valid: true, value: 12 })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(0), { valid: false })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId(true), { valid: false })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId('1.5'), { valid: false })
  assert.deepEqual(parseOptionalTestSpaceOrganizationId('invalid'), { valid: false })
})

test('test space organization changes validate membership before updating', () => {
  const membershipLock = testWorkbenchSource.indexOf('lockActiveOrganizationMembership(client, nextOrganizationId')
  const memberValidation = testWorkbenchSource.indexOf('everyCurrentTestSpaceMemberBelongsToOrganization(client, spaceId, nextOrganizationId)')
  const update = testWorkbenchSource.indexOf('set name = $1, organization_id = $2, updated_at = now()')

  assert.notEqual(membershipLock, -1)
  assert.notEqual(memberValidation, -1)
  assert.notEqual(update, -1)
  assert.ok(membershipLock < memberValidation)
  assert.ok(memberValidation < update)
  assert.match(testWorkbenchSource, /status in \('pending', 'active'\)[\s\S]*for share of membership/u)
  assert.match(testWorkbenchSource, /update test_space_invite_links set revoked_at = now\(\)/u)
  assert.match(testWorkbenchSource, /hasOwnProperty\.call\(request\.body \?\? \{\}, 'organizationId'\)/u)
})

test('only the test subject creator can delete it', () => {
  assert.equal(canDeleteTestSubject(7, 7), true)
  assert.equal(canDeleteTestSubject(7, 8), false)
  assert.equal(canDeleteTestSubject(null, 7), false)
})

test('only the plan creator can manage it and remove unexecuted cases', () => {
  assert.equal(canManageTestPlan(7, 7), true)
  assert.equal(canManageTestPlan(7, 8), false)
  assert.equal(canRemoveTestPlanCase(7, 7, 'untested'), true)
  assert.equal(canRemoveTestPlanCase(7, 7, 'passed'), false)
  assert.equal(canRemoveTestPlanCase(7, 8, 'untested'), false)
})
