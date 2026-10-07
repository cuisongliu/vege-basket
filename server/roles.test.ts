import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getActiveWorkspaceRole,
  getSelectableWorkspaceRoles,
  hasOrganizationAdminRole,
} from '../src/user-roles.ts'
import type { AuthUser, UserRole } from '../src/api.ts'
import {
  canAssumeUserRole,
  getSwitchableUserRoles,
  isUserRole,
  isSwitchableUserRole,
} from './roles.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const roleSelectionSource = readFileSync(
  new URL('../src/components/user-role-dialogs.tsx', import.meta.url),
  'utf8',
).split('export function UserRoleManagementDialog')[0]

test('organization administrator is an additive capability, not a switchable role', () => {
  assert.equal(isSwitchableUserRole('organization_admin'), false)
  assert.deepEqual(
    getSwitchableUserRoles(['organization_admin']),
    ['developer', 'tester'],
  )
})

test('login and account identity selection share role-based workspace options', () => {
  assert.match(roleSelectionSource, /getSelectableWorkspaceRoles\(user\.roles, user\.isSystemAdmin\)\.map/u)
  assert.match(appSource, /getSelectableWorkspaceRoles\(user\.roles, user\.isSystemAdmin\)/u)
  assert.doesNotMatch(appSource, /onOpenOrganization/u)
  assert.doesNotMatch(appSource, /onOpenPlatform/u)
})

test('management identity is available only with the assigned organization administrator role', () => {
  const cases: [UserRole[], UserRole[]][] = [
    [['developer'], ['developer']],
    [['tester'], ['tester']],
    [['developer', 'tester'], ['developer', 'tester']],
    [['organization_admin'], ['developer', 'tester', 'organization_admin']],
    [['tester', 'organization_admin'], ['developer', 'tester', 'organization_admin']],
    [[], []],
  ]
  for (const [roles, expected] of cases) {
    assert.deepEqual(getSelectableWorkspaceRoles(roles), expected)
  }
})

test('system administrator status exposes only its dedicated management identity', () => {
  const user: Pick<AuthUser, 'activeRole' | 'roles' | 'isSystemAdmin'> = {
    activeRole: 'developer', roles: ['developer'], isSystemAdmin: true,
  }
  assert.equal(hasOrganizationAdminRole(user.roles), false)
  assert.deepEqual(getSelectableWorkspaceRoles(user.roles, user.isSystemAdmin), ['developer', 'platform_admin'])
  assert.equal(getActiveWorkspaceRole(user, 'organization'), 'developer')
  assert.equal(getActiveWorkspaceRole(user, 'platform'), 'platform_admin')
})

test('management identity follows the authorized view without changing the session persona', () => {
  for (const activeRole of ['developer', 'tester'] as const) {
    const user = { activeRole, roles: ['organization_admin'] as UserRole[], isSystemAdmin: false }
    assert.equal(getActiveWorkspaceRole(user, 'organization'), 'organization_admin')
    assert.equal(getActiveWorkspaceRole(user, 'search'), activeRole)
    assert.equal(user.activeRole, activeRole)
    assert.equal(getActiveWorkspaceRole({ ...user, roles: [activeRole] }, 'organization'), activeRole)
  }
})

test('organization administrator can assume every business role', () => {
  assert.equal(canAssumeUserRole(['organization_admin'], 'developer'), true)
  assert.equal(canAssumeUserRole(['organization_admin'], 'tester'), true)
  assert.equal(canAssumeUserRole(['tester'], 'developer'), false)
})

test('developer navigation keeps the test workbench hidden until the tester persona is active', () => {
  assert.match(
    appSource,
    /const canNavigateToTestWorkbench = authUser\?\.activeRole === 'tester'/u,
  )
  assert.match(appSource, /if \(view === 'testing'\) return user\.activeRole === 'tester'/u)
  assert.match(
    appSource,
    /return user\.activeRole === 'developer' && SHOW_DEVELOPER_ASSIGNED_BUGS_MODULE/u,
  )
  assert.doesNotMatch(appSource, /testerWorkspaceViews/u)
})

test('tester navigation keeps shared daily work inside the test-workbench shell', () => {
  assert.match(appSource, /onOpenMyWork=\{openMyWork\}/u)
  assert.match(appSource, /onOpenMyWorkHours=\{openMyWorkHours\}/u)
  assert.match(appSource, /onOpenProjectBasket=\{\(\) => setView\('search'\)\}/u)
  assert.match(appSource, /onOpenTestWorkbench=\{\(\) => setView\('testing'\)\}/u)
  assert.match(appSource, /return renderTesterWorkspaceShell\(mainWorkspace, false\)/u)
  assert.match(appSource, /<TesterWorkspaceShell/u)
  assert.match(appSource, /selectedOrganizationId !== null \|\| authUser\?\.activeRole === 'tester'/u)
  const testWorkbenchSource = readFileSync(new URL('../src/components/test-workbench.tsx', import.meta.url), 'utf8')
  const testerWorkspaceShellSource = testWorkbenchSource
    .split('export function TesterWorkspaceShell')[1]
    .split('export function TestWorkbench')[0]
  assert.match(testWorkbenchSource, /项目篮子/u)
  assert.match(testWorkbenchSource, /我的待办/u)
  assert.match(testWorkbenchSource, /我的工时/u)
  assert.match(testWorkbenchSource, /<TesterNavigationGroup label="工作入口">/u)
  assert.match(testWorkbenchSource, /<TesterNavigationGroup label="当前测试空间">/u)
  assert.match(testWorkbenchSource, /<TesterNavigationGroup label="协作">/u)
  assert.match(
    testWorkbenchSource,
    /label="当前测试空间">[\s\S]*?用例管理[\s\S]*?测试计划[\s\S]*?Bug 追踪[\s\S]*?<\/TesterNavigationGroup>/u,
  )
  assert.match(testWorkbenchSource, /activeWorkspaceNavigation === 'my_work'/u)
  assert.match(appSource, /view === 'notifications'\s*\? 'notifications'/u)
  assert.match(testWorkbenchSource, /aria-current=\{activeWorkspaceNavigation === 'notifications' \? 'page'/u)
  assert.doesNotMatch(testerWorkspaceShellSource, /fetchTestWorkbench/u)
  assert.equal([...testWorkbenchSource.matchAll(/<TesterWorkspaceFrame\b/gu)].length, 2)
  assert.equal([...testWorkbenchSource.matchAll(/<TesterSharedNavigation\b/gu)].length, 2)
})

test('tester persona keeps capability-authorized weekly report and AI views available', () => {
  const canUseViewSource = appSource
    .split('function canUseViewForUser')[1]
    .split('function sameAuthContext')[0]
  assert.doesNotMatch(canUseViewSource, /activeRole === 'tester'.*return false/su)
  assert.doesNotMatch(canUseViewSource, /weekly_report|view === 'ai'/u)
})

test('tester identity hides project delivery while developer identity retains it', () => {
  assert.match(appSource, /const canViewProjectDelivery = Boolean\(authUser && authUser\.activeRole !== 'tester'\)/u)
  assert.match(appSource, /canViewProjectDelivery=\{canViewProjectDelivery\}/u)
  assert.match(appSource, /projectDetailTab === 'packages' && !canViewProjectDelivery/u)
})

test('role changes invalidate notification requests and apply persona filtering', () => {
  assert.match(appSource, /notificationRefreshRequestIdRef\.current \+= 1/u)
  assert.match(appSource, /notificationRefreshPromiseRef\.current = null/u)
  assert.match(appSource, /setNotifications\(emptyNotifications\)/u)
  assert.match(appSource, /notificationRoleRef\.current === requestedRole/u)
  assert.match(appSource, /filterNotificationsForRole\([\s\S]*?requestedRole === 'tester'/u)
  assert.match(appSource, /if \(notificationRoleRef\.current !== requestedRole\) return/u)
  assert.match(appSource, /resetNotificationsForRole\(role\)[\s\S]*?void refreshNotifications\(\)/u)
})

test('delivery is no longer an account role', () => {
  assert.equal(isUserRole('delivery'), false)
  assert.equal(isSwitchableUserRole('delivery'), false)
})
