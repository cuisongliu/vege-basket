import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canApplyOrganizationDetail,
  canApplyOrganizationDetailRead,
  mergeOrganizationDetail,
  organizationDetailSectionsForActiveSection,
} from '../src/organization-detail-state'
import type {
  OrganizationDetail,
  OrganizationDetailSection,
  OrganizationProject,
} from '../src/organization-types'

function project(
  id: number,
  options: Partial<OrganizationProject> = {},
): OrganizationProject {
  return {
    canDelete: true,
    canManageMembers: true,
    canManageSettings: true,
    canTransferOwnership: true,
    description: '',
    healthNote: '',
    healthStatus: 'on_track',
    id,
    memberships: [],
    milestones: [],
    name: `Project ${id}`,
    openTodoCount: 0,
    ownerName: 'Owner',
    ownerUserId: 1,
    status: 'active',
    tags: [],
    todoCount: 0,
    updatedAt: '2026-10-09T00:00:00.000Z',
    ...options,
  }
}

function detail(
  sections: OrganizationDetailSection[],
  projects: OrganizationProject[],
): OrganizationDetail {
  return {
    accessRole: 'owner',
    attachableProjects: [],
    attachableTestSpaces: [],
    canManage: true,
    canManageProjectModules: true,
    canManageProjects: true,
    canManageTestEnvironments: true,
    canManageTestSpaces: true,
    canManageWeeklyReports: true,
    canWriteWeeklyReport: false,
    createdAt: '2026-10-09T00:00:00.000Z',
    departedUserIds: [],
    id: 10,
    invitations: [],
    loadedSections: sections,
    members: [],
    name: 'Organization',
    ownerUserId: 1,
    packageMarketPolicy: {} as OrganizationDetail['packageMarketPolicy'],
    projectModules: [],
    projects,
    reports: [],
    summaries: [],
    tasks: [],
    testEnvironments: [],
    testSpaces: [],
    weeklyReportAssignments: [],
    weeklyReportEnabled: true,
    weeklyReportProfiles: [],
    weeklyReportRules: {
      closeDay: 1,
      closeTime: '23:59',
      openDay: 5,
      openTime: '00:00',
    },
    weekStartsOn: 1,
  }
}

test('active organization reads combine overview with the visible section', () => {
  assert.deepEqual(organizationDetailSectionsForActiveSection('overview'), ['overview'])
  assert.deepEqual(organizationDetailSectionsForActiveSection('projects'), ['overview', 'projects'])
  assert.deepEqual(organizationDetailSectionsForActiveSection('members'), ['overview', 'members'])
})

test('canonical detail applies only to the still-selected expected organization', () => {
  const nextDetail = detail(['overview'], [])

  assert.equal(canApplyOrganizationDetail(10, 10, nextDetail), true)
  assert.equal(canApplyOrganizationDetail(10, 11, nextDetail), false)
  assert.equal(canApplyOrganizationDetail(11, 11, nextDetail), false)
})

test('canonical detail invalidates an older read in the same organization', () => {
  const nextDetail = detail(['overview'], [])

  assert.equal(canApplyOrganizationDetailRead(1, 1, 10, 10, nextDetail), true)
  assert.equal(canApplyOrganizationDetailRead(1, 2, 10, 10, nextDetail), false)
  assert.equal(canApplyOrganizationDetailRead(2, 2, 10, 11, nextDetail), false)
})

test('scoped reads do not downgrade a previously complete detail', () => {
  const current = detail([], [project(1)])
  current.loadedSections = undefined
  const overview = detail(['overview'], [project(1)])

  const merged = mergeOrganizationDetail(current, overview)

  assert.equal(merged.loadedSections, undefined)
})

test('overview refresh preserves loaded project members and milestones', () => {
  const membership = {
    createdAt: '2026-10-09T00:00:00.000Z',
    id: 20,
    invitedUserId: 2,
    invitedUsername: 'member@example.com',
    memberName: 'Member',
    projectId: 1,
    role: 'member' as const,
    status: 'active' as const,
  }
  const milestone = {
    acceptanceCriteria: '',
    baselineDate: '2026-10-09',
    createdAt: '2026-10-09T00:00:00.000Z',
    executionNote: '',
    id: 30,
    linkedTodos: [],
    responsibleName: '',
    status: 'pending' as const,
    targetDate: '2026-10-10',
    title: 'Milestone',
    updatedAt: '2026-10-09T00:00:00.000Z',
  }
  const current = detail(['overview', 'projects'], [project(1, {
    memberships: [membership],
    milestones: [milestone],
    todoCount: 1,
  }), project(2)])
  const overview = detail(['overview'], [project(1, {
    memberships: [],
    milestones: [],
    todoCount: 2,
  })])

  const merged = mergeOrganizationDetail(current, overview)

  assert.deepEqual(merged.projects[0].memberships, [membership])
  assert.deepEqual(merged.projects[0].milestones, [milestone])
  assert.equal(merged.projects[0].todoCount, 2)
  assert.deepEqual(merged.projects.map((item) => item.id), [1])
})

test('project section remains authoritative for removals', () => {
  const current = detail(['overview', 'projects'], [project(1, {
    memberships: [{ id: 20 }] as OrganizationProject['memberships'],
    milestones: [{ id: 30 }] as OrganizationProject['milestones'],
  })])
  const projects = detail(['overview', 'projects'], [project(1)])

  const merged = mergeOrganizationDetail(current, projects)

  assert.deepEqual(merged.projects[0].memberships, [])
  assert.deepEqual(merged.projects[0].milestones, [])
})

test('overview and project responses converge regardless of arrival order', () => {
  const loadedProject = project(1, {
    memberships: [{ id: 20 }] as OrganizationProject['memberships'],
    milestones: [{ id: 30 }] as OrganizationProject['milestones'],
    todoCount: 2,
  })
  const initial = detail(['overview'], [project(1, { todoCount: 1 })])
  const overview = detail(['overview'], [project(1, { todoCount: 2 })])
  const projects = detail(['projects'], [loadedProject])

  const overviewThenProjects = mergeOrganizationDetail(
    mergeOrganizationDetail(initial, overview),
    projects,
  )
  const projectsThenOverview = mergeOrganizationDetail(
    mergeOrganizationDetail(initial, projects),
    overview,
  )

  assert.deepEqual(projectsThenOverview.projects, overviewThenProjects.projects)
  assert.equal(projectsThenOverview.projects[0].memberships.length, 1)
  assert.equal(projectsThenOverview.projects[0].milestones.length, 1)
})
