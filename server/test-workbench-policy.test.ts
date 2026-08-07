import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canDeleteTestCase,
  canDeleteTestSubject,
  canEditTestBug,
  canEditTestSubject,
  canDeveloperRejectBug,
  canDeveloperSetBugStatus,
  canManageTestPlan,
  canRemoveTestPlanCase,
  isBugStatus,
  isBugSeverity,
  isTestResult,
  isTestSpaceMembershipStatus,
  normalizeTestSpaceInviteExpiresInMinutes,
  parseOptionalTestSpaceOrganizationId,
} from './test-workbench-policy.ts'

const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const testWorkbenchClientSource = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
const testWorkbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')

test('developer bug transitions stop at pending verification', () => {
  assert.equal(canDeveloperSetBugStatus('assigned', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('reopened', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('pending_confirmation', 'in_progress'), true)
  assert.equal(canDeveloperSetBugStatus('in_progress', 'pending_verification'), true)
  assert.equal(canDeveloperSetBugStatus('pending_verification', 'closed'), false)
  assert.equal(canDeveloperSetBugStatus('new', 'rejected'), false)
  assert.equal(canDeveloperSetBugStatus('pending_confirmation', 'pending_verification'), false)
})

test('developer can reject only Bugs that are not yet being fixed', () => {
  assert.equal(canDeveloperRejectBug('pending_confirmation'), true)
  assert.equal(canDeveloperRejectBug('assigned'), true)
  assert.equal(canDeveloperRejectBug('reopened'), true)
  assert.equal(canDeveloperRejectBug('in_progress'), false)
  assert.equal(canDeveloperRejectBug('pending_verification'), false)
  assert.equal(canDeveloperRejectBug('rejected'), false)
  assert.equal(canDeveloperRejectBug('closed'), false)
  assert.equal(canDeveloperRejectBug('duplicate'), false)
})

test('bug status and comment kind checks include pending confirmation and reject', () => {
  assert.match(schemaSource, /update test_bugs[\s\S]*where status = 'confirmed'/u)
  assert.match(schemaSource, /check \(status in \('new', 'pending_confirmation', 'assigned', 'in_progress', 'pending_verification', 'closed', 'rejected', 'duplicate', 'reopened'\)\)/u)
  assert.match(schemaSource, /check \(kind in \('comment', 'transfer', 'reject'\)\)/u)
})

test('assigned Bugs start in pending confirmation and reject writes a system comment', () => {
  assert.match(testWorkbenchSource, /const status = assigneeUserId \? 'pending_confirmation' : 'new'/u)
  assert.match(testWorkbenchSource, /status = 'pending_confirmation', updated_at = now\(\)/u)
  const rejectRouteStart = testWorkbenchSource.indexOf("router.post('/test-bugs/:bugId/assigned/reject'")
  assert.ok(rejectRouteStart >= 0)
  const rejectRoute = testWorkbenchSource.slice(rejectRouteStart)
  assert.match(rejectRoute, /canDeveloperRejectBug\(bug\.status\)/u)
  assert.match(rejectRoute, /status = 'rejected', updated_at = now\(\)/u)
  assert.match(rejectRoute, /values \(\$1, \$2, \$3, 'reject'\)/u)
  assert.match(rejectRoute, /onTestBugRejected\(/u)
  assert.match(rejectRoute, /for update of b/u)
})

test('developer workbench offers start and reject for pending confirmation Bugs', () => {
  assert.match(testWorkbenchClientSource, /pending_confirmation: '待确认'/u)
  assert.match(testWorkbenchClientSource, /value !== 'pending_confirmation'/u)
  assert.match(testWorkbenchClientSource, /selected\.status === 'pending_confirmation'/u)
  assert.match(testWorkbenchClientSource, /<DialogTitle>驳回 Bug<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /rejectAssignedTestBug\(bug\.id, reason\)/u)
  assert.match(testWorkbenchClientSource, /驳回记录/u)
})

test('assigned Bug selection keeps the current item when parent callbacks refresh counts', () => {
  assert.match(testWorkbenchClientSource, /const onBugsChangeRef = useRef\(onBugsChange\)/u)
  assert.match(testWorkbenchClientSource, /onBugsChangeRef\.current\?\.\(result\.bugs\)/u)
  assert.match(testWorkbenchClientSource, /useEffect\(\(\) => \{\s+onBugsChangeRef\.current = onBugsChange\s+\}, \[onBugsChange\]\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /useEffect\(\(\) => \{\s+fetchAssignedTestBugs\(\)[\s\S]*\}, \[currentUserId, initialBugId, onBugsChange\]\)/u)
})

test('test result and bug status guards reject unknown values', () => {
  assert.equal(isTestResult('blocked'), true)
  assert.equal(isTestResult('success'), false)
  assert.equal(isBugStatus('pending_verification'), true)
  assert.equal(isBugStatus('confirmed'), false)
  assert.equal(isBugStatus('fixed'), false)
  assert.equal(isBugSeverity('major'), true)
  assert.equal(isBugSeverity('fixed'), false)
})

test('only the Bug creator can edit Bug details', () => {
  assert.equal(canEditTestBug(42, 42), true)
  assert.equal(canEditTestBug(42, 7), false)
  assert.equal(canEditTestBug(null, 7), false)
})

test('only the test subject creator can edit or delete it', () => {
  assert.equal(canEditTestSubject(7, 7), true)
  assert.equal(canEditTestSubject(7, 8), false)
  assert.equal(canEditTestSubject(null, 7), false)
  assert.equal(canDeleteTestSubject(7, 7), true)
  assert.equal(canDeleteTestSubject(7, 8), false)
  assert.equal(canDeleteTestSubject(null, 7), false)
})

test('only the test case creator can delete it', () => {
  assert.equal(canDeleteTestCase(7, 7), true)
  assert.equal(canDeleteTestCase(7, 8), false)
  assert.equal(canDeleteTestCase(null, 7), false)
})

test('test case deletion stays creator-scoped and preserves plan snapshots', () => {
  const deleteRouteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/cases/:caseId'")
  const createPlanRouteStart = testWorkbenchSource.indexOf("router.post('/test-spaces/:spaceId/plans'", deleteRouteStart)

  assert.ok(deleteRouteStart >= 0)
  assert.ok(createPlanRouteStart > deleteRouteStart)

  const deleteRoute = testWorkbenchSource.slice(deleteRouteStart, createPlanRouteStart)
  assert.match(deleteRoute, /requireActiveRole\(request, response, 'tester'\)/u)
  assert.match(deleteRoute, /requireSpaceAccess\(response, spaceId, session\.userId, true\)/u)
  assert.match(deleteRoute, /canDeleteTestCase\(createdByUserId, session\.userId\)/u)
  assert.match(deleteRoute, /where id = \$1 and test_space_id = \$2 and created_by_user_id = \$3/u)
  assert.match(schemaSource, /test_case_id bigint references test_cases\(id\) on delete set null/u)
})

test('test case deletion is exposed only when allowed and requires confirmation', () => {
  assert.match(testWorkbenchClientSource, /selected\.canDelete/u)
  assert.match(testWorkbenchClientSource, /<DialogTitle>删除测试用例<\/DialogTitle>/u)
  assert.match(testWorkbenchClientSource, /已加入测试计划的执行快照继续保留/u)
  assert.match(testWorkbenchClientSource, /deleteTestCase\(casePendingDelete\.testSpaceId, casePendingDelete\.id\)/u)
  assert.match(testWorkbenchClientSource, /<Dialog open=\{caseDeleteDialogOpen\} onOpenChange=\{setCaseDeleteDialogOpen\}>/u)
  assert.match(testWorkbenchClientSource, /if \(caseDeleteDialogOpen \|\| !casePendingDelete\) return[\s\S]*setTimeout[\s\S]*setCasePendingDelete\(undefined\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /open=\{Boolean\(casePendingDelete\)\}/u)
  assert.match(testWorkbenchClientSource, /<Dialog open=\{planDeleteDialogOpen\} onOpenChange=\{setPlanDeleteDialogOpen\}>/u)
  assert.match(testWorkbenchClientSource, /if \(planDeleteDialogOpen \|\| !planPendingDelete\) return[\s\S]*setTimeout[\s\S]*setPlanPendingDelete\(undefined\)/u)
  assert.doesNotMatch(testWorkbenchClientSource, /open=\{Boolean\(planPendingDelete\)\}/u)
  assert.match(testWorkbenchClientSource, /<Button variant="outline" onClick=\{\(\) => onArchive\(selected\)\}>归档为基线<\/Button>/u)
})

test('test subject editing uses a dedicated patch route and updates all metadata fields', () => {
  const patchRouteStart = testWorkbenchSource.indexOf("router.patch('/test-spaces/:spaceId/subjects/:subjectId'")
  const deleteRouteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/subjects/:subjectId'")

  assert.ok(patchRouteStart >= 0)
  assert.ok(deleteRouteStart > patchRouteStart)

  const patchRoute = testWorkbenchSource.slice(patchRouteStart, deleteRouteStart)
  assert.match(patchRoute, /Only the test subject creator can edit it/u)
  assert.match(patchRoute, /set name = \$1,\s+name_lookup = \$2,\s+description = \$3,\s+version_label = \$4,\s+environment = \$5/u)
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

test('organization test-space invite links can be created and require member access on acceptance', () => {
  const createRouteStart = testWorkbenchSource.indexOf("router.post('/test-spaces/:spaceId/invite-link'")
  const deleteRouteStart = testWorkbenchSource.indexOf("router.delete('/test-spaces/:spaceId/invite-link'")
  const acceptRouteStart = testWorkbenchSource.indexOf("router.post('/test-space-invite-links/:token/accept'")
  assert.ok(createRouteStart >= 0)
  assert.ok(deleteRouteStart > createRouteStart)
  assert.ok(acceptRouteStart > deleteRouteStart)

  const createRoute = testWorkbenchSource.slice(createRouteStart, deleteRouteStart)
  const acceptRoute = testWorkbenchSource.slice(acceptRouteStart)
  assert.doesNotMatch(createRoute, /Organization test spaces do not use public invite links/u)
  assert.match(acceptRoute, /lockActiveOrganizationMembership\(client, organizationId, session\.userId\)/u)
  assert.match(acceptRoute, /Organization test space invites require active organization membership/u)
})

test('only the plan creator can manage it and remove unexecuted cases', () => {
  assert.equal(canManageTestPlan(7, 7), true)
  assert.equal(canManageTestPlan(7, 8), false)
  assert.equal(canRemoveTestPlanCase(7, 7, 'untested'), true)
  assert.equal(canRemoveTestPlanCase(7, 7, 'passed'), false)
  assert.equal(canRemoveTestPlanCase(7, 8, 'untested'), false)
})
