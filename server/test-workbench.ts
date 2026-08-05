import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import express, { Router } from 'express'
import type { PoolClient } from 'pg'
import { blindIndex, decryptJson, decryptText, encryptJson, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import {
  managedOrganizationReadScopeSql,
  testSpaceMembershipPresentSql,
} from './organization-scope.ts'
import { requireActiveRole } from './roles.ts'
import { parseTestCaseCsv } from './test-case-import.ts'
import {
  canDeleteTestCase,
  canDeleteTestSubject,
  canEditTestBug,
  canEditTestSubject,
  canDeveloperSetBugStatus,
  canManageTestPlan,
  canRemoveTestPlanCase,
  isBugStatus,
  isBugSeverity,
  isTestCaseStatus,
  isTestPlanStatus,
  isTestResult,
  normalizeTestSpaceInviteExpiresInMinutes,
  parseOptionalTestSpaceOrganizationId,
  type BugStatus,
  type TestResult,
} from './test-workbench-policy.ts'

type TestSpaceAccess = 'owner' | 'editor' | 'viewer'
type TestSpaceMembershipStatus = 'pending' | 'active' | 'declined'
type TestSpaceAccessRow = { access_level: TestSpaceAccess }
type TestCaseKind = 'functional' | 'baseline'
type TestWorkbenchNotificationKind =
  | 'test_plan_assigned'
  | 'test_bug_status_changed'
  | 'test_bug_comment_added'

const router = Router()

export type TestBugAssignedEvent = {
  actorUserId: number
  assigneeUserId: number
  assignmentKind: 'assigned' | 'created' | 'transferred'
  bugId: number
  transferReason?: string
}

export type TestPlanAssignedEvent = {
  actorUserId: number
  ownerUserId: number
  planId: number
}

export type TestBugStatusChangedEvent = {
  actorUserId: number
  bugId: number
  nextStatus: BugStatus
  previousStatus: BugStatus
}

export type TestBugCommentAddedEvent = {
  actorUserId: number
  bugId: number
  commentId: number
  mentionedUserIds?: number[]
}

export type TestCaseChangedEvent = {
  actorUserId: number
  caseId: number
}

export type TestExecutionResultChangedEvent = {
  actorUserId: number
  planCaseId: number
}

let onTestBugAssigned: (event: TestBugAssignedEvent) => void = () => {}
let onTestPlanAssigned: (event: TestPlanAssignedEvent) => void = () => {}
let onTestBugStatusChanged: (event: TestBugStatusChangedEvent) => void = () => {}
let onTestBugCommentAdded: (event: TestBugCommentAddedEvent) => void = () => {}
let onTestCaseChanged: (event: TestCaseChangedEvent) => void = () => {}
let onTestExecutionResultChanged: (event: TestExecutionResultChangedEvent) => void = () => {}

export function configureTestWorkbenchNotifications(handlers: {
  onTestBugAssigned: (event: TestBugAssignedEvent) => void
  onTestPlanAssigned: (event: TestPlanAssignedEvent) => void
  onTestBugStatusChanged: (event: TestBugStatusChangedEvent) => void
  onTestBugCommentAdded: (event: TestBugCommentAddedEvent) => void
  onTestCaseChanged: (event: TestCaseChangedEvent) => void
  onTestExecutionResultChanged: (event: TestExecutionResultChangedEvent) => void
}) {
  onTestBugAssigned = handlers.onTestBugAssigned
  onTestPlanAssigned = handlers.onTestPlanAssigned
  onTestBugStatusChanged = handlers.onTestBugStatusChanged
  onTestBugCommentAdded = handlers.onTestBugCommentAdded
  onTestCaseChanged = handlers.onTestCaseChanged
  onTestExecutionResultChanged = handlers.onTestExecutionResultChanged
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength)
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function resolveOrganizationMentionUserIds(organizationId: number | null, content: string) {
  if (!organizationId) return []
  const names = Array.from(content.matchAll(/@([^\s@]+)/gu))
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name))
  if (names.length === 0) return []
  const result = await query<{ id: string }>(
    `
    select distinct u.id
    from organization_memberships membership
    join users u on u.id = membership.user_id
    where membership.organization_id = $1
      and membership.status = 'active'
      and lower(coalesce(nullif(u.display_name, ''), u.email)) = any($2::text[])
    `,
    [organizationId, names.map((name) => name.toLocaleLowerCase())],
  )
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id) && id > 0)
}

function inviteExpiresInMinutes(value: unknown) {
  return normalizeTestSpaceInviteExpiresInMinutes(value)
}

function invitePassword(value: unknown) {
  return text(value, 64)
}

async function verifyInvitePassword(passwordHash: string, value: unknown) {
  if (!passwordHash) return true
  const password = invitePassword(value)
  if (!password) return false
  try {
    return await bcrypt.compare(password, passwordHash)
  } catch {
    return false
  }
}

function optionalDate(value: unknown) {
  const date = text(value, 10)
  if (!date) return null
  const parsed = new Date(`${date}T00:00:00Z`)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw Object.assign(new Error('Date must use YYYY-MM-DD'), { status: 400 })
  }
  return date
}

function isTestCaseKind(value: unknown): value is TestCaseKind {
  return value === 'functional' || value === 'baseline'
}

function customTags(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => text(item, 40))
    .filter(Boolean)
    .slice(0, 12)
}

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).catch(next)
  }
}

async function transaction<T>(handler: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await handler(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function getSpaceAccess(spaceId: number, userId: number) {
  const result = await query<TestSpaceAccessRow>(
    `
    select coalesce(m.access_level, 'viewer') as access_level
    from test_spaces s
    left join test_space_memberships m
      on m.test_space_id = s.id and m.user_id = $2 and m.status = 'active'
    where s.id = $1
      and (${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('s.organization_id', '$2')})
    `,
    [spaceId, userId],
  )
  return result.rows[0]?.access_level ?? null
}

async function userCanBeAssignedInSpace(
  userId: number | null,
  spaceId: number,
  role: 'developer' | 'tester',
) {
  if (!userId) return true
  const result = await query<{ assigned: boolean }>(
    `
    select exists(
      select 1
      from user_roles ur
      where ur.user_id = $1 and (ur.role = $2 or ur.role = 'organization_admin')
        and (
          exists(
            select 1 from test_space_memberships m
            where m.user_id = ur.user_id and m.test_space_id = $3 and m.status = 'active'
          )
          or (
            ($2 = 'developer' or ur.role = 'organization_admin')
            and exists(
              select 1
              from test_spaces s
              join organization_memberships om
                on om.organization_id = s.organization_id
               and om.user_id = ur.user_id
               and om.status = 'active'
              where s.id = $3 and s.organization_id is not null
            )
          )
        )
    ) as assigned
    `,
    [userId, role, spaceId],
  )
  return Boolean(result.rows[0]?.assigned)
}

async function requireProjectAccessForLinking(
  response: express.Response,
  projectId: number | null,
  userId: number,
) {
  if (!projectId) return true
  const projectAccess = await query<{ allowed: boolean }>(
    `
    select exists(
      select 1 from projects p
      left join project_memberships pm on pm.project_id = p.id
        and pm.invited_user_id = $2 and pm.status = 'active'
      where p.id = $1 and (p.user_id = $2 or pm.id is not null)
    ) as allowed
    `,
    [projectId, userId],
  )
  if (!projectAccess.rows[0]?.allowed) {
    response.status(404).json({ error: 'Linked project not found' })
    return false
  }
  return true
}

async function requireSpaceAccess(
  response: express.Response,
  spaceId: number | null,
  userId: number,
  write = false,
) {
  if (!spaceId) {
    response.status(400).json({ error: 'Valid test space is required' })
    return null
  }
  const access = await getSpaceAccess(spaceId, userId)
  if (!access) {
    response.status(404).json({ error: 'Test space not found' })
    return null
  }
  if (write && access === 'viewer') {
    response.status(403).json({ error: 'Editor access is required' })
    return null
  }
  return access
}

async function requireSpaceOwner(
  response: express.Response,
  spaceId: number | null,
  userId: number,
) {
  const access = await requireSpaceAccess(response, spaceId, userId)
  if (!access) return false
  if (access !== 'owner') {
    response.status(403).json({ error: 'Test space owner access is required' })
    return false
  }
  return true
}

async function lockActiveOrganizationMembership(
  client: PoolClient,
  organizationId: number,
  userId: number,
) {
  const membership = await client.query<{ id: string }>(
    `
    select organization.id
    from organizations organization
    join organization_memberships membership
      on membership.organization_id = organization.id
     and membership.user_id = $2
     and membership.status = 'active'
    where organization.id = $1
    for share of organization, membership
    `,
    [organizationId, userId],
  )
  return Boolean(membership.rows[0])
}

async function everyCurrentTestSpaceMemberBelongsToOrganization(
  client: PoolClient,
  spaceId: number,
  organizationId: number,
) {
  const spaceMembers = await client.query<{ user_id: string }>(
    `
    select membership.user_id
    from test_space_memberships membership
    where membership.test_space_id = $1
      and membership.status in ('pending', 'active')
    order by membership.user_id
    for share of membership
    `,
    [spaceId],
  )
  const userIds = spaceMembers.rows.map((row) => Number(row.user_id))
  if (userIds.length === 0) return true
  const organizationMembers = await client.query<{ user_id: string }>(
    `
    select membership.user_id
    from organization_memberships membership
    where membership.organization_id = $1
      and membership.user_id = any($2::bigint[])
      and membership.status = 'active'
    order by membership.user_id
    for share of membership
    `,
    [organizationId, userIds],
  )
  return organizationMembers.rows.length === userIds.length
}

async function getTestSpaceSettings(userId: number) {
  const [spaces, members, invitations, organizations] = await Promise.all([
    query<{
      access_level: TestSpaceAccess
      created_at: Date
      id: string
      name: string
      organization_id: string | null
      organization_name: string | null
      owner_user_id: string
    }>(
      `
      select s.id, s.owner_user_id, s.name, s.organization_id, s.created_at,
        organization.name as organization_name,
        coalesce(mine.access_level, 'viewer') as access_level
      from test_spaces s
      left join test_space_memberships mine
        on mine.test_space_id = s.id and mine.user_id = $1 and mine.status = 'active'
      left join organizations organization on organization.id = s.organization_id
      where ${testSpaceMembershipPresentSql('mine')} or ${managedOrganizationReadScopeSql('s.organization_id')}
      order by s.updated_at desc, s.id desc
      `,
      [userId],
    ),
    query<{
      access_level: TestSpaceAccess
      created_at: Date
      display_name: string
      email: string
      status: TestSpaceMembershipStatus
      test_space_id: string
      user_id: string
    }>(
      `
      select m.test_space_id, m.user_id, m.access_level, m.status, m.created_at,
        u.email, u.display_name
      from test_space_memberships m
      join users u on u.id = m.user_id
      join test_spaces s on s.id = m.test_space_id
      left join test_space_memberships mine
        on mine.test_space_id = m.test_space_id and mine.user_id = $1 and mine.status = 'active'
      where (${testSpaceMembershipPresentSql('mine')} or ${managedOrganizationReadScopeSql('s.organization_id')})
        and m.status <> 'declined'
        and (
          m.status = 'active'
          or mine.access_level = 'owner'
          or ${managedOrganizationReadScopeSql('s.organization_id')}
        )
      order by lower(coalesce(nullif(u.display_name, ''), u.email)), m.user_id
      `,
      [userId],
    ),
    query<{
      access_level: TestSpaceAccess
      created_at: Date
      display_name: string
      email: string
      invited_by_display_name: string | null
      invited_by_email: string | null
      test_space_id: string
      test_space_name: string
    }>(
      `
      select m.test_space_id, m.access_level, m.created_at, s.name as test_space_name,
        invited_by.email as invited_by_email,
        invited_by.display_name as invited_by_display_name,
        invited.email,
        invited.display_name
      from test_space_memberships m
      join test_spaces s on s.id = m.test_space_id
      join users invited on invited.id = m.user_id
      left join users invited_by on invited_by.id = m.invited_by_user_id
      where m.user_id = $1 and m.status = 'pending'
      order by m.created_at desc, m.test_space_id desc
      `,
      [userId],
    ),
    query<{ id: string; name: string }>(
      `
      select organization.id, organization.name
      from organization_memberships membership
      join organizations organization on organization.id = membership.organization_id
      where membership.user_id = $1 and membership.status = 'active'
      order by organization.id
      `,
      [userId],
    ),
  ])

  const membersBySpace = new Map<number, Array<Record<string, unknown>>>()
  for (const row of members.rows) {
    const spaceId = Number(row.test_space_id)
    membersBySpace.set(spaceId, [
      ...(membersBySpace.get(spaceId) ?? []),
      {
        accessLevel: row.access_level,
        createdAt: row.created_at.toISOString(),
        displayName: row.display_name || row.email,
        status: row.status,
        userId: Number(row.user_id),
        username: row.email,
      },
    ])
  }

  return {
    organizations: organizations.rows.map((row) => ({
      id: Number(row.id),
      name: decryptText(row.name),
    })).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    spaces: spaces.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      id: Number(row.id),
      members: membersBySpace.get(Number(row.id)) ?? [],
      name: decryptText(row.name),
      organizationId: row.organization_id ? Number(row.organization_id) : undefined,
      organizationName: row.organization_name ? decryptText(row.organization_name) : undefined,
      ownerUserId: Number(row.owner_user_id),
      accessLevel: row.access_level,
    })),
    invitations: invitations.rows.map((row) => ({
      accessLevel: row.access_level,
      createdAt: row.created_at.toISOString(),
      invitedByName: row.invited_by_display_name || row.invited_by_email || '测试空间所有者',
      spaceId: Number(row.test_space_id),
      spaceName: decryptText(row.test_space_name),
    })),
  }
}

async function getOrCreateCaseFolder(
  client: PoolClient,
  spaceId: number,
  subjectId: number,
  modulePath: string,
) {
  const result = await client.query<{ id: string }>(
    `
    insert into test_case_folders (test_space_id, test_subject_id, name, name_lookup)
    values ($1, $2, $3, $4)
    on conflict (test_subject_id, name_lookup) where name_lookup is not null
    do update set name_lookup = excluded.name_lookup
    returning id
    `,
    [spaceId, subjectId, encryptText(modulePath), blindIndex(modulePath)],
  )
  return Number(result.rows[0].id)
}

async function getTestWorkbench(userId: number) {
  const [
    spaces,
    subjects,
    folders,
    cases,
    plans,
    planSubjects,
    planCases,
    bugs,
    comments,
    users,
    notifications,
  ] = await Promise.all([
    query<{
      access_level: TestSpaceAccess
      created_at: Date
      id: string
      name: string
      owner_user_id: string
    }>(
      `
      select ts.id, ts.owner_user_id, ts.name, ts.created_at,
        coalesce(tsm.access_level, 'viewer') as access_level
      from test_spaces ts
      left join test_space_memberships tsm
        on tsm.test_space_id = ts.id and tsm.user_id = $1 and tsm.status = 'active'
      where ${testSpaceMembershipPresentSql('tsm')} or ${managedOrganizationReadScopeSql('ts.organization_id')}
      order by ts.updated_at desc, ts.id desc
      `,
      [userId],
    ),
    query<{
      created_at: Date
      created_by_user_id: string | null
      description: string
      environment: string
      id: string
      name: string
      test_space_id: string
      version_label: string
    }>(
      `
      select s.*
      from test_subjects s
      join test_spaces space on space.id = s.test_space_id
      left join test_space_memberships m
        on m.test_space_id = s.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by s.updated_at desc, s.id desc
      `,
      [userId],
    ),
    query<{ created_at: Date; id: string; name: string; test_space_id: string; test_subject_id: string }>(
      `
      select f.*
      from test_case_folders f
      join test_spaces space on space.id = f.test_space_id
      left join test_space_memberships m
        on m.test_space_id = f.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by f.name, f.id
      `,
      [userId],
    ),
    query<{
      case_type: string
      case_kind: TestCaseKind
      created_at: Date
      created_by_user_id: string | null
      custom_tags: string
      expected_result: string
      folder_id: string | null
      id: string
      owner_user_id: string | null
      preconditions: string
      priority: string
      remarks: string
      status: string
      steps: string
      test_space_id: string
      test_subject_id: string
      title: string
      updated_at: Date
      version: number
    }>(
      `
      select c.*
      from test_cases c
      join test_spaces space on space.id = c.test_space_id
      left join test_space_memberships m
        on m.test_space_id = c.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by c.updated_at desc, c.id desc
      `,
      [userId],
    ),
    query<{
      created_at: Date
      created_by_user_id: string | null
      ends_on: string | null
      environment: string
      id: string
      name: string
      owner_user_id: string | null
      project_id: string | null
      starts_on: string | null
      status: string
      test_space_id: string
      test_subject_id: string
      updated_at: Date
      version_label: string
    }>(
      `
      select p.*
      from test_plans p
      join test_spaces space on space.id = p.test_space_id
      left join test_space_memberships m
        on m.test_space_id = p.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by p.updated_at desc, p.id desc
      `,
      [userId],
    ),
    query<{ test_plan_id: string; test_subject_id: string }>(
      `
      select ps.test_plan_id, ps.test_subject_id
      from test_plan_subjects ps
      join test_plans p on p.id = ps.test_plan_id
      join test_spaces space on space.id = p.test_space_id
      left join test_space_memberships m
        on m.test_space_id = p.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by ps.test_plan_id, ps.test_subject_id
      `,
      [userId],
    ),
    query<{
      executed_at: Date | null
      executed_by_user_id: string | null
      id: string
      result: string
      result_note: string
      snapshot_case_version: number
      snapshot_expected_result: string
      snapshot_preconditions: string
      snapshot_steps: string
      snapshot_title: string
      test_case_id: string | null
      test_plan_id: string
      test_subject_id: string | null
    }>(
      `
      select pc.*
      from test_plan_cases pc
      join test_plans p on p.id = pc.test_plan_id
      join test_spaces space on space.id = p.test_space_id
      left join test_space_memberships m
        on m.test_space_id = p.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by pc.id
      `,
      [userId],
    ),
    query<{
      actual_result: string
      assignee_user_id: string | null
      created_at: Date
      environment: string
      expected_result: string
      id: string
      priority: string
      reporter_user_id: string | null
      reproduction_steps: string
      severity: string
      status: BugStatus
      test_plan_case_id: string | null
      test_plan_id: string | null
      test_space_id: string
      test_subject_id: string
      title: string
      updated_at: Date
    }>(
      `
      select b.*
      from test_bugs b
      join test_spaces space on space.id = b.test_space_id
      left join test_space_memberships m
        on m.test_space_id = b.test_space_id and m.user_id = $1 and m.status = 'active'
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by b.updated_at desc, b.id desc
      `,
      [userId],
    ),
    query<{
      author_display_name: string | null
      author_email: string | null
      author_user_id: string | null
      content: string
      created_at: Date
      id: string
      kind: string
      test_bug_id: string
      updated_at: Date | null
    }>(
      `
      select c.*, u.email as author_email, u.display_name as author_display_name
      from test_bug_comments c
      join test_bugs b on b.id = c.test_bug_id
      join test_spaces space on space.id = b.test_space_id
      left join test_space_memberships m
        on m.test_space_id = b.test_space_id and m.user_id = $1 and m.status = 'active'
      left join users u on u.id = c.author_user_id
      where ${testSpaceMembershipPresentSql('m')} or ${managedOrganizationReadScopeSql('space.organization_id')}
      order by c.created_at, c.id
      `,
      [userId],
    ),
    query<{ display_name: string; email: string; id: string; roles: string[] }>(
      `
      select u.id, u.email, u.display_name, array_agg(distinct ur.role order by ur.role) as roles
      from users u
      join user_roles ur on ur.user_id = u.id
      where exists(
        select 1
        from test_space_memberships member
        join test_spaces space on space.id = member.test_space_id
        left join test_space_memberships mine
          on mine.test_space_id = member.test_space_id and mine.user_id = $1 and mine.status = 'active'
        where member.user_id = u.id
          and member.status = 'active'
          and (${testSpaceMembershipPresentSql('mine')} or ${managedOrganizationReadScopeSql('space.organization_id')})
      ) or (
        exists(
          select 1 from user_roles developer_role
          where developer_role.user_id = u.id
            and developer_role.role in ('developer', 'organization_admin')
        )
        and exists(
          select 1
          from test_spaces space
          join organization_memberships organization_member
            on organization_member.organization_id = space.organization_id
           and organization_member.user_id = u.id
           and organization_member.status = 'active'
          left join test_space_memberships mine
            on mine.test_space_id = space.id and mine.user_id = $1 and mine.status = 'active'
          where space.organization_id is not null
            and (${testSpaceMembershipPresentSql('mine')} or ${managedOrganizationReadScopeSql('space.organization_id')})
        )
      )
      group by u.id
      order by lower(coalesce(nullif(u.display_name, ''), u.email)), u.id
      `,
      [userId],
    ),
    query<{
      created_at: Date
      kind: TestWorkbenchNotificationKind
      source_id: string
    }>(
      `
      select delivery.kind,
             delivery.source_id,
             coalesce(
               max(delivery.created_at) filter (where delivery.channel = 'in_app'),
               min(delivery.created_at) filter (where delivery.channel = 'feishu')
             ) as created_at
      from notification_deliveries delivery
      where delivery.user_id = $1
        and delivery.kind in (
          'test_plan_assigned',
          'test_bug_status_changed',
          'test_bug_comment_added'
        )
        and (
          (delivery.channel = 'in_app' and delivery.status = 'sent')
          or delivery.channel = 'feishu'
        )
      group by delivery.kind, delivery.source_id
      order by created_at desc, delivery.source_id desc
      limit 200
      `,
      [userId],
    ),
  ])

  const commentsByBug = new Map<number, Array<Record<string, unknown>>>()
  for (const row of comments.rows) {
    const bugId = Number(row.test_bug_id)
    commentsByBug.set(bugId, [
      ...(commentsByBug.get(bugId) ?? []),
      {
        authorName: row.author_display_name || row.author_email || '未知用户',
        authorUserId: row.author_user_id ? Number(row.author_user_id) : undefined,
        canEdit: row.kind !== 'transfer' && row.author_user_id
          ? Number(row.author_user_id) === userId
          : false,
        content: decryptText(row.content),
        createdAt: row.created_at.toISOString(),
        id: Number(row.id),
        kind: row.kind === 'transfer' ? 'transfer' : 'comment',
        updatedAt: (row.updated_at ?? row.created_at).toISOString(),
      },
    ])
  }
  const subjectIdsByPlan = new Map<number, number[]>()
  for (const row of planSubjects.rows) {
    const planId = Number(row.test_plan_id)
    subjectIdsByPlan.set(planId, [...(subjectIdsByPlan.get(planId) ?? []), Number(row.test_subject_id)])
  }

  return {
    bugs: bugs.rows.map((row) => ({
      actualResult: decryptText(row.actual_result),
      assigneeUserId: row.assignee_user_id ? Number(row.assignee_user_id) : undefined,
      canEdit: canEditTestBug(row.reporter_user_id ? Number(row.reporter_user_id) : null, userId),
      comments: commentsByBug.get(Number(row.id)) ?? [],
      createdAt: row.created_at.toISOString(),
      environment: decryptText(row.environment),
      expectedResult: decryptText(row.expected_result),
      id: Number(row.id),
      priority: row.priority,
      reporterUserId: row.reporter_user_id ? Number(row.reporter_user_id) : undefined,
      reproductionSteps: decryptText(row.reproduction_steps),
      severity: row.severity,
      status: row.status,
      testPlanCaseId: row.test_plan_case_id ? Number(row.test_plan_case_id) : undefined,
      testPlanId: row.test_plan_id ? Number(row.test_plan_id) : undefined,
      testSpaceId: Number(row.test_space_id),
      testSubjectId: Number(row.test_subject_id),
      title: decryptText(row.title),
      updatedAt: row.updated_at.toISOString(),
    })),
    cases: cases.rows.map((row) => ({
      canDelete: canDeleteTestCase(row.created_by_user_id ? Number(row.created_by_user_id) : null, userId),
      caseType: row.case_type,
      caseKind: row.case_kind,
      createdAt: row.created_at.toISOString(),
      customTags: decryptJson<string[]>(row.custom_tags, []),
      expectedResult: decryptText(row.expected_result),
      folderId: row.folder_id ? Number(row.folder_id) : undefined,
      id: Number(row.id),
      ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : undefined,
      preconditions: decryptText(row.preconditions),
      priority: row.priority,
      remarks: decryptText(row.remarks),
      status: row.status,
      steps: decryptText(row.steps),
      testSpaceId: Number(row.test_space_id),
      testSubjectId: Number(row.test_subject_id),
      title: decryptText(row.title),
      updatedAt: row.updated_at.toISOString(),
      version: row.version,
    })),
    folders: folders.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      id: Number(row.id),
      name: decryptText(row.name),
      testSpaceId: Number(row.test_space_id),
      testSubjectId: Number(row.test_subject_id),
    })),
    notifications: notifications.rows.map((row) => ({
      createdAt: row.created_at.toISOString(),
      kind: row.kind,
      sourceId: Number(row.source_id),
    })),
    planCases: planCases.rows.map((row) => ({
      executedAt: row.executed_at?.toISOString(),
      executedByUserId: row.executed_by_user_id ? Number(row.executed_by_user_id) : undefined,
      id: Number(row.id),
      result: row.result,
      resultNote: decryptText(row.result_note),
      snapshotCaseVersion: row.snapshot_case_version,
      snapshotExpectedResult: decryptText(row.snapshot_expected_result),
      snapshotPreconditions: decryptText(row.snapshot_preconditions),
      snapshotSteps: decryptText(row.snapshot_steps),
      snapshotTitle: decryptText(row.snapshot_title),
      testCaseId: row.test_case_id ? Number(row.test_case_id) : undefined,
      testPlanId: Number(row.test_plan_id),
      testSubjectId: row.test_subject_id ? Number(row.test_subject_id) : undefined,
    })),
    plans: plans.rows.map((row) => ({
      canManage: canManageTestPlan(row.created_by_user_id ? Number(row.created_by_user_id) : null, userId),
      createdAt: row.created_at.toISOString(),
      createdByUserId: row.created_by_user_id ? Number(row.created_by_user_id) : undefined,
      endsOn: row.ends_on || undefined,
      environment: decryptText(row.environment),
      id: Number(row.id),
      name: decryptText(row.name),
      ownerUserId: row.owner_user_id ? Number(row.owner_user_id) : undefined,
      projectId: row.project_id ? Number(row.project_id) : undefined,
      startsOn: row.starts_on || undefined,
      status: row.status,
      testSpaceId: Number(row.test_space_id),
      testSubjectId: Number(row.test_subject_id),
      testSubjectIds: subjectIdsByPlan.get(Number(row.id)) ?? [Number(row.test_subject_id)],
      updatedAt: row.updated_at.toISOString(),
      versionLabel: decryptText(row.version_label),
    })),
    spaces: spaces.rows.map((row) => ({
      accessLevel: row.access_level,
      createdAt: row.created_at.toISOString(),
      id: Number(row.id),
      name: decryptText(row.name),
      ownerUserId: Number(row.owner_user_id),
    })),
    subjects: subjects.rows.map((row) => ({
      canDelete: canDeleteTestSubject(row.created_by_user_id ? Number(row.created_by_user_id) : null, userId),
      canEdit: canEditTestSubject(row.created_by_user_id ? Number(row.created_by_user_id) : null, userId),
      createdAt: row.created_at.toISOString(),
      description: decryptText(row.description),
      environment: decryptText(row.environment),
      id: Number(row.id),
      name: decryptText(row.name),
      testSpaceId: Number(row.test_space_id),
      versionLabel: decryptText(row.version_label),
    })),
    users: users.rows.map((row) => ({
      displayName: row.display_name || row.email,
      id: Number(row.id),
      roles: row.roles,
      username: row.email,
    })),
  }
}

router.get('/test-workbench', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  response.json(await getTestWorkbench(session.userId))
}))

router.get('/test-spaces/settings', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  response.json(await getTestSpaceSettings(session.userId))
}))

router.post('/test-spaces', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const name = text(request.body.name, 80)
  const organization = parseOptionalTestSpaceOrganizationId(request.body?.organizationId)
  if (!name || !organization.valid) {
    response.status(400).json({ error: 'Test space name and organization must be valid' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (
      organization.value !== null
      && !(await lockActiveOrganizationMembership(client, organization.value, session.userId))
    ) {
      await client.query('rollback')
      response.status(404).json({ error: 'Organization not found' })
      return
    }
    const created = await client.query<{ id: string }>(
      'insert into test_spaces (owner_user_id, name, organization_id) values ($1, $2, $3) returning id',
      [session.userId, encryptText(name), organization.value],
    )
    const spaceId = Number(created.rows[0].id)
    await client.query(
      `
      insert into test_space_memberships
        (test_space_id, user_id, access_level, status, invited_by_user_id, accepted_at)
      values ($1, $2, 'owner', 'active', $2, now())
      `,
      [spaceId, session.userId],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const name = text(request.body.name, 80)
  const hasOrganizationId = Object.prototype.hasOwnProperty.call(request.body ?? {}, 'organizationId')
  const organization = hasOrganizationId
    ? parseOptionalTestSpaceOrganizationId(request.body.organizationId)
    : null
  if (!spaceId || !name || organization?.valid === false) {
    response.status(400).json({ error: 'Valid test space, name, and organization are required' })
    return
  }
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  const client = await pool.connect()
  try {
    await client.query('begin')
    const existing = await client.query<{ organization_id: string | null }>(
      'select organization_id from test_spaces where id = $1 and owner_user_id = $2 for update',
      [spaceId, session.userId],
    )
    if (!existing.rows[0]) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space not found' })
      return
    }
    const currentOrganizationId = existing.rows[0].organization_id
      ? Number(existing.rows[0].organization_id)
      : null
    const nextOrganizationId = organization?.valid ? organization.value : currentOrganizationId
    const organizationChanged = nextOrganizationId !== currentOrganizationId
    if (organizationChanged && nextOrganizationId !== null) {
      if (!(await lockActiveOrganizationMembership(client, nextOrganizationId, session.userId))) {
        await client.query('rollback')
        response.status(404).json({ error: 'Organization not found' })
        return
      }
      if (!(await everyCurrentTestSpaceMemberBelongsToOrganization(client, spaceId, nextOrganizationId))) {
        await client.query('rollback')
        response.status(409).json({ error: 'All active test-space members must join the organization first' })
        return
      }
    }
    await client.query(
      `update test_spaces
       set name = $1, organization_id = $2, updated_at = now()
       where id = $3 and owner_user_id = $4`,
      [encryptText(name), nextOrganizationId, spaceId, session.userId],
    )
    if (organizationChanged && nextOrganizationId !== null) {
      await client.query(
        `update test_space_invite_links set revoked_at = now()
         where test_space_id = $1 and revoked_at is null`,
        [spaceId],
      )
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.json(await getTestSpaceSettings(session.userId))
}))

router.delete('/test-spaces/:spaceId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const confirmationName = text(request.body.confirmationName, 80)
  if (!spaceId || !confirmationName) {
    response.status(400).json({ error: 'Test space name confirmation is required' })
    return
  }
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  const client = await pool.connect()
  try {
    await client.query('begin')
    const existing = await client.query<{ name: string }>(
      'select name from test_spaces where id = $1 and owner_user_id = $2 for update',
      [spaceId, session.userId],
    )
    if (!existing.rows[0]) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space not found' })
      return
    }
    if (decryptText(existing.rows[0].name) !== confirmationName) {
      await client.query('rollback')
      response.status(409).json({ error: 'Test space name confirmation does not match' })
      return
    }
    await client.query('delete from test_spaces where id = $1 and owner_user_id = $2', [spaceId, session.userId])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.json(await getTestSpaceSettings(session.userId))
}))

router.post('/test-spaces/:spaceId/invitations', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  const username = text(request.body.username, 160).toLowerCase()
  const accessLevel = request.body.accessLevel === 'viewer' ? 'viewer' : 'editor'
  if (!username) {
    response.status(400).json({ error: 'Invite username is required' })
    return
  }
  const user = await query<{ id: string }>(
    `
    select u.id
    from users u
    join user_roles ur on ur.user_id = u.id
      and ur.role in ('tester', 'organization_admin')
    where u.email = $1
    `,
    [username],
  )
  if (!user.rows[0]) {
    response.status(404).json({ error: 'Tester account not found' })
    return
  }
  const targetUserId = Number(user.rows[0].id)
  if (targetUserId === session.userId) {
    response.status(409).json({ error: 'Test space owner already has access' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    const space = await client.query<{ organization_id: string | null }>(
      'select organization_id from test_spaces where id = $1 and owner_user_id = $2 for update',
      [spaceId, session.userId],
    )
    if (!space.rows[0]) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space not found' })
      return
    }
    const organizationId = space.rows[0].organization_id
      ? Number(space.rows[0].organization_id)
      : null
    if (
      organizationId
      && !(await lockActiveOrganizationMembership(client, organizationId, targetUserId))
    ) {
      await client.query('rollback')
      response.status(400).json({ error: 'Organization test spaces can invite only active organization members' })
      return
    }
    const invited = await client.query(
      `
      insert into test_space_memberships
        (test_space_id, user_id, access_level, status, invited_by_user_id, accepted_at, declined_at)
      values ($1, $2, $3, 'pending', $4, null, null)
      on conflict (test_space_id, user_id) do update
        set access_level = excluded.access_level,
            status = 'pending',
            invited_by_user_id = excluded.invited_by_user_id,
            accepted_at = null,
            declined_at = null,
            created_at = now()
      where test_space_memberships.status <> 'active'
        and test_space_memberships.access_level <> 'owner'
      returning user_id
      `,
      [spaceId, targetUserId, accessLevel, session.userId],
    )
    if (!invited.rows[0]) {
      await client.query('rollback')
      response.status(409).json({ error: 'User is already a test space member' })
      return
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.status(201).json(await getTestSpaceSettings(session.userId))
}))

router.patch('/test-spaces/:spaceId/members/:userId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const userId = positiveId(request.params.userId)
  const accessLevel = request.body.accessLevel === 'viewer' ? 'viewer' : 'editor'
  if (!spaceId || !userId) {
    response.status(400).json({ error: 'Valid test space and user are required' })
    return
  }
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  const updated = await query(
    `
    update test_space_memberships
    set access_level = $1
    where test_space_id = $2 and user_id = $3 and access_level <> 'owner'
    returning user_id
    `,
    [accessLevel, spaceId, userId],
  )
  if (!updated.rows[0]) {
    response.status(404).json({ error: 'Test space member not found' })
    return
  }
  response.json(await getTestSpaceSettings(session.userId))
}))

router.delete('/test-spaces/:spaceId/members/:userId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const userId = positiveId(request.params.userId)
  if (!spaceId || !userId) {
    response.status(400).json({ error: 'Valid test space and user are required' })
    return
  }
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  const removed = await query(
    `
    delete from test_space_memberships
    where test_space_id = $1 and user_id = $2 and access_level <> 'owner'
    returning user_id
    `,
    [spaceId, userId],
  )
  if (!removed.rows[0]) {
    response.status(404).json({ error: 'Test space member not found' })
    return
  }
  response.json(await getTestSpaceSettings(session.userId))
}))

router.post('/test-space-invitations/:spaceId/accept', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!spaceId) {
    response.status(400).json({ error: 'Valid test space is required' })
    return
  }
  const accepted = await query(
    `
    update test_space_memberships
    set status = 'active', accepted_at = now(), declined_at = null
    where test_space_id = $1 and user_id = $2 and status = 'pending'
    returning test_space_id
    `,
    [spaceId, session.userId],
  )
  if (!accepted.rows[0]) {
    response.status(404).json({ error: 'Test space invitation not found' })
    return
  }
  response.json({ settings: await getTestSpaceSettings(session.userId), workbench: await getTestWorkbench(session.userId) })
}))

router.post('/test-space-invitations/:spaceId/decline', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!spaceId) {
    response.status(400).json({ error: 'Valid test space is required' })
    return
  }
  const declined = await query(
    `
    update test_space_memberships
    set status = 'declined', declined_at = now(), accepted_at = null
    where test_space_id = $1 and user_id = $2 and status = 'pending'
    returning test_space_id
    `,
    [spaceId, session.userId],
  )
  if (!declined.rows[0]) {
    response.status(404).json({ error: 'Test space invitation not found' })
    return
  }
  response.json(await getTestSpaceSettings(session.userId))
}))

router.post('/test-spaces/:spaceId/invite-link', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  const password = invitePassword(request.body.password)
  const passwordHash = password ? await bcrypt.hash(password, 12) : ''
  const expiresInMinutes = inviteExpiresInMinutes(request.body.expiresInMinutes)
  const accessLevel = request.body.accessLevel === 'viewer' ? 'viewer' : 'editor'
  const client = await pool.connect()
  try {
    await client.query('begin')
    const space = await client.query<{ organization_id: string | null }>(
      'select organization_id from test_spaces where id = $1 and owner_user_id = $2 for update',
      [spaceId, session.userId],
    )
    if (!space.rows[0]) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space not found' })
      return
    }
    await client.query(
      `update test_space_invite_links set revoked_at = now() where test_space_id = $1 and revoked_at is null`,
      [spaceId],
    )
    const created = await client.query<{ expires_at: Date; token: string }>(
      `
      insert into test_space_invite_links
        (test_space_id, owner_user_id, token, password_hash, access_level, expires_at)
      values ($1, $2, $3, $4, $5, now() + ($6::integer * interval '1 minute'))
      returning token, expires_at
      `,
      [spaceId, session.userId, crypto.randomBytes(24).toString('base64url'), passwordHash, accessLevel, expiresInMinutes],
    )
    await client.query('commit')
    response.status(201).json({
      accessLevel,
      expiresAt: created.rows[0].expires_at.toISOString(),
      expiresInMinutes,
      passwordRequired: Boolean(passwordHash),
      token: created.rows[0].token,
    })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}))

router.delete('/test-spaces/:spaceId/invite-link', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceOwner(response, spaceId, session.userId))) return
  await query(
    `update test_space_invite_links set revoked_at = now() where test_space_id = $1 and revoked_at is null`,
    [spaceId],
  )
  response.json({ ok: true })
}))

router.get('/test-space-invite-links/:token', asyncRoute(async (request, response) => {
  const token = text(request.params.token, 128)
  const invite = await query<{ password_hash: string }>(
    `
    select password_hash
    from test_space_invite_links
    where token = $1 and revoked_at is null and expires_at > now()
    limit 1
    `,
    [token],
  )
  if (!invite.rows[0]) {
    response.status(404).json({ error: 'Test space invite link not found' })
    return
  }
  response.json({ passwordRequired: Boolean(invite.rows[0].password_hash), valid: true })
}))

router.post('/test-space-invite-links/:token/verify', asyncRoute(async (request, response) => {
  const token = text(request.params.token, 128)
  const invite = await query<{ password_hash: string }>(
    `
    select password_hash
    from test_space_invite_links
    where token = $1 and revoked_at is null and expires_at > now()
    limit 1
    `,
    [token],
  )
  if (!invite.rows[0]) {
    response.status(404).json({ error: 'Test space invite link not found' })
    return
  }
  if (!(await verifyInvitePassword(invite.rows[0].password_hash, request.body.password))) {
    response.status(401).json({ error: 'Invite password is incorrect' })
    return
  }
  response.json({ passwordRequired: Boolean(invite.rows[0].password_hash), valid: true })
}))

router.post('/test-space-invite-links/:token/accept', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const token = text(request.params.token, 128)
  const client = await pool.connect()
  try {
    await client.query('begin')
    const inviteLookup = await client.query<{
      access_level: TestSpaceAccess
      owner_user_id: string
      password_hash: string
      test_space_id: string
    }>(
      `
      select test_space_id, owner_user_id, password_hash, access_level
      from test_space_invite_links
      where token = $1 and revoked_at is null and expires_at > now()
      limit 1
      `,
      [token],
    )
    const lookupRow = inviteLookup.rows[0]
    if (!lookupRow) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space invite link not found' })
      return
    }
    const space = await client.query<{ organization_id: string | null }>(
      'select organization_id from test_spaces where id = $1 for update',
      [Number(lookupRow.test_space_id)],
    )
    if (!space.rows[0]) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space not found' })
      return
    }
    const organizationId = space.rows[0].organization_id
      ? Number(space.rows[0].organization_id)
      : null
    if (organizationId && !(await lockActiveOrganizationMembership(client, organizationId, session.userId))) {
      await client.query('rollback')
      response.status(403).json({ error: 'Organization test space invites require active organization membership' })
      return
    }
    const invite = await client.query<{
      access_level: TestSpaceAccess
      owner_user_id: string
      password_hash: string
      test_space_id: string
    }>(
      `
      select test_space_id, owner_user_id, password_hash, access_level
      from test_space_invite_links
      where token = $1 and test_space_id = $2 and revoked_at is null and expires_at > now()
      limit 1
      for update
      `,
      [token, Number(lookupRow.test_space_id)],
    )
    const row = invite.rows[0]
    if (!row) {
      await client.query('rollback')
      response.status(404).json({ error: 'Test space invite link not found' })
      return
    }
    if (!(await verifyInvitePassword(row.password_hash, request.body.password))) {
      await client.query('rollback')
      response.status(401).json({ error: 'Invite password is incorrect' })
      return
    }
    await client.query(
      `
      insert into test_space_memberships
        (test_space_id, user_id, access_level, status, invited_by_user_id, accepted_at, declined_at)
      values ($1, $2, $3, 'active', $4, now(), null)
      on conflict (test_space_id, user_id) do update
        set access_level = case
              when test_space_memberships.access_level = 'owner' then 'owner'
              when test_space_memberships.status = 'active' then test_space_memberships.access_level
              else excluded.access_level
            end,
            status = 'active',
            invited_by_user_id = excluded.invited_by_user_id,
            accepted_at = now(),
            declined_at = null
      `,
      [Number(row.test_space_id), session.userId, row.access_level, Number(row.owner_user_id)],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.json({ settings: await getTestSpaceSettings(session.userId), workbench: await getTestWorkbench(session.userId) })
}))

router.post('/test-spaces/:spaceId/subjects', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
  const name = text(request.body.name, 100)
  if (!name) {
    response.status(400).json({ error: 'Test subject name is required' })
    return
  }
  await query(
    `
    insert into test_subjects
      (test_space_id, created_by_user_id, name, name_lookup, description, version_label, environment)
    values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      spaceId,
      session.userId,
      encryptText(name),
      blindIndex(name),
      encryptText(text(request.body.description, 2000)),
      encryptText(text(request.body.versionLabel, 80)),
      encryptText(text(request.body.environment, 160)),
    ],
  )
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/subjects/:subjectId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const subjectId = positiveId(request.params.subjectId)
  if (!subjectId) {
    response.status(400).json({ error: 'Valid test subject is required' })
    return
  }
  if (!(await requireSpaceAccess(response, spaceId, session.userId))) return
  const name = text(request.body.name, 100)
  if (!name) {
    response.status(400).json({ error: 'Test subject name is required' })
    return
  }
  const subject = await query<{ created_by_user_id: string | null }>(
    'select created_by_user_id from test_subjects where id = $1 and test_space_id = $2',
    [subjectId, spaceId],
  )
  if (!subject.rows[0]) {
    response.status(404).json({ error: 'Test subject not found' })
    return
  }
  const createdByUserId = subject.rows[0].created_by_user_id
    ? Number(subject.rows[0].created_by_user_id)
    : null
  if (!canEditTestSubject(createdByUserId, session.userId)) {
    response.status(403).json({ error: 'Only the test subject creator can edit it' })
    return
  }
  try {
    const updated = await query(
      `
      update test_subjects
      set name = $1,
        name_lookup = $2,
        description = $3,
        version_label = $4,
        environment = $5,
        updated_at = now()
      where id = $6 and test_space_id = $7 and created_by_user_id = $8
      returning id
      `,
      [
        encryptText(name),
        blindIndex(name),
        encryptText(text(request.body.description, 2000)),
        encryptText(text(request.body.versionLabel, 80)),
        encryptText(text(request.body.environment, 160)),
        subjectId,
        spaceId,
        session.userId,
      ],
    )
    if (!updated.rows[0]) {
      response.status(409).json({ error: 'Test subject ownership changed; refresh and try again' })
      return
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      response.status(409).json({ error: 'Test subject name already exists in this test space' })
      return
    }
    throw error
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.delete('/test-spaces/:spaceId/subjects/:subjectId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const subjectId = positiveId(request.params.subjectId)
  if (!subjectId) {
    response.status(400).json({ error: 'Valid test subject is required' })
    return
  }
  if (!(await requireSpaceAccess(response, spaceId, session.userId))) return
  const subject = await query<{ created_by_user_id: string | null }>(
    'select created_by_user_id from test_subjects where id = $1 and test_space_id = $2',
    [subjectId, spaceId],
  )
  if (!subject.rows[0]) {
    response.status(404).json({ error: 'Test subject not found' })
    return
  }
  const createdByUserId = subject.rows[0].created_by_user_id
    ? Number(subject.rows[0].created_by_user_id)
    : null
  if (!canDeleteTestSubject(createdByUserId, session.userId)) {
    response.status(403).json({ error: 'Only the test subject creator can delete it' })
    return
  }
  const deleted = await query(
    'delete from test_subjects where id = $1 and test_space_id = $2 and created_by_user_id = $3 returning id',
    [subjectId, spaceId, session.userId],
  )
  if (!deleted.rows[0]) {
    response.status(409).json({ error: 'Test subject ownership changed; refresh and try again' })
    return
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.post('/test-spaces/:spaceId/folders', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
  const subjectId = positiveId(request.body.testSubjectId)
  const name = text(request.body.name, 240)
  if (!subjectId || !name) {
    response.status(400).json({ error: 'Folder name and test subject are required' })
    return
  }
  const subject = await query('select id from test_subjects where id = $1 and test_space_id = $2', [subjectId, spaceId])
  if (!subject.rows[0]) {
    response.status(404).json({ error: 'Test subject not found' })
    return
  }
  const lookup = blindIndex(name)
  const duplicate = await query(
    'select id from test_case_folders where test_subject_id = $1 and name_lookup = $2',
    [subjectId, lookup],
  )
  if (duplicate.rows[0]) {
    response.status(409).json({ error: 'Case folder already exists' })
    return
  }
  await query(
    `insert into test_case_folders (test_space_id, test_subject_id, name, name_lookup) values ($1, $2, $3, $4)`,
    [spaceId, subjectId, encryptText(name), lookup],
  )
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/folders/:folderId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const folderId = positiveId(request.params.folderId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !folderId) return
  const name = text(request.body.name, 240)
  if (!name) {
    response.status(400).json({ error: 'Folder name is required' })
    return
  }
  const folder = await query<{ test_subject_id: string }>(
    'select test_subject_id from test_case_folders where id = $1 and test_space_id = $2',
    [folderId, spaceId],
  )
  if (!folder.rows[0]) {
    response.status(404).json({ error: 'Case folder not found' })
    return
  }
  const lookup = blindIndex(name)
  const duplicate = await query(
    'select id from test_case_folders where test_subject_id = $1 and name_lookup = $2 and id <> $3',
    [folder.rows[0].test_subject_id, lookup, folderId],
  )
  if (duplicate.rows[0]) {
    response.status(409).json({ error: 'Case folder already exists' })
    return
  }
  await query(
    'update test_case_folders set name = $1, name_lookup = $2 where id = $3 and test_space_id = $4',
    [encryptText(name), lookup, folderId, spaceId],
  )
  response.json(await getTestWorkbench(session.userId))
}))

router.delete('/test-spaces/:spaceId/folders/:folderId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const folderId = positiveId(request.params.folderId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !folderId) return
  const folder = await query<{ id: string; test_subject_id: string }>(
    'select id, test_subject_id from test_case_folders where id = $1 and test_space_id = $2',
    [folderId, spaceId],
  )
  if (!folder.rows[0]) {
    response.status(404).json({ error: 'Case folder not found' })
    return
  }
  await transaction(async (client) => {
    await client.query(
      'update test_cases set folder_id = null, updated_at = now() where folder_id = $1 and test_space_id = $2 and test_subject_id = $3',
      [folderId, spaceId, folder.rows[0].test_subject_id],
    )
    await client.query(
      'delete from test_case_folders where id = $1 and test_space_id = $2',
      [folderId, spaceId],
    )
  })
  response.json(await getTestWorkbench(session.userId))
}))

router.post('/test-spaces/:spaceId/cases', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
  const subjectId = positiveId(request.body.testSubjectId)
  let folderId = positiveId(request.body.folderId)
  const modulePath = text(request.body.modulePath, 240)
  const title = text(request.body.title, 160)
  if (!subjectId || !title) {
    response.status(400).json({ error: 'Case title and test subject are required' })
    return
  }
  const subject = await query('select id from test_subjects where id = $1 and test_space_id = $2', [subjectId, spaceId])
  if (!subject.rows[0]) {
    response.status(404).json({ error: 'Test subject not found' })
    return
  }
  if (folderId) {
    const folder = await query(
      'select id from test_case_folders where id = $1 and test_space_id = $2 and test_subject_id = $3',
      [folderId, spaceId, subjectId],
    )
    if (!folder.rows[0]) {
      response.status(404).json({ error: 'Case folder not found' })
      return
    }
  }
  const priority = ['high', 'medium', 'low'].includes(request.body.priority) ? request.body.priority : 'medium'
  const caseType = ['functional', 'regression', 'smoke', 'security', 'performance'].includes(request.body.caseType)
    ? request.body.caseType
    : 'functional'
  const caseKind = isTestCaseKind(request.body.caseKind) ? request.body.caseKind : 'functional'
  const tags = customTags(request.body.customTags)
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (modulePath) folderId = await getOrCreateCaseFolder(client, spaceId!, subjectId, modulePath)
    await client.query(
      `
      insert into test_cases
        (test_space_id, test_subject_id, folder_id, title, preconditions, steps, expected_result,
         remarks, priority, case_type, case_kind, custom_tags, status, created_by_user_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13)
      `,
      [
        spaceId,
        subjectId,
        folderId,
        encryptText(title),
        encryptText(text(request.body.preconditions, 5000)),
        encryptText(text(request.body.steps, 10000)),
        encryptText(text(request.body.expectedResult, 10000)),
        encryptText(text(request.body.remarks, 5000)),
        priority,
        caseType,
        caseKind,
        encryptJson(tags),
        session.userId,
      ],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.post(
  '/test-spaces/:spaceId/cases/import',
  express.text({ limit: '2mb', type: ['text/csv', 'text/plain'] }),
  asyncRoute(async (request, response) => {
    const session = await requireActiveRole(request, response, 'tester')
    if (!session) return
    const spaceId = positiveId(request.params.spaceId)
    if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
    const subjectId = positiveId(request.query.testSubjectId)
    if (!subjectId) {
      response.status(400).json({ error: 'Valid test subject is required' })
      return
    }
    const subject = await query(
      'select id from test_subjects where id = $1 and test_space_id = $2',
      [subjectId, spaceId],
    )
    if (!subject.rows[0]) {
      response.status(404).json({ error: 'Test subject not found' })
      return
    }
    const parsed = parseTestCaseCsv(typeof request.body === 'string' ? request.body : '')
    if (request.query.preview === 'true') {
      response.json({ preview: parsed.preview })
      return
    }

    const client = await pool.connect()
    try {
      await client.query('begin')
      const folderIds = new Map<string, number>()
      for (const row of parsed.rows) {
        let folderId = folderIds.get(row.modulePath)
        if (!folderId) {
          folderId = await getOrCreateCaseFolder(client, spaceId!, subjectId, row.modulePath)
          folderIds.set(row.modulePath, folderId)
        }
        await client.query(
          `
          insert into test_cases
            (test_space_id, test_subject_id, folder_id, title, preconditions, steps,
             expected_result, remarks, priority, case_type, case_kind, custom_tags, status, created_by_user_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'functional', 'functional', $10, 'active', $11)
          `,
          [
            spaceId,
            subjectId,
            folderId,
            encryptText(row.title),
            encryptText(row.preconditions),
            encryptText(row.steps),
            encryptText(row.expectedResult),
            encryptText(row.remarks),
            row.priority,
            encryptJson(row.customTags),
            session.userId,
          ],
        )
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    response.status(201).json({
      importedCount: parsed.rows.length,
      workbench: await getTestWorkbench(session.userId),
    })
  }),
)

router.patch('/test-spaces/:spaceId/cases/:caseId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const caseId = positiveId(request.params.caseId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !caseId) return
  const current = await query<{
    case_kind: TestCaseKind
    case_type: string
    custom_tags: string
    created_by_user_id: string | null
    expected_result: string
    folder_id: string | null
    preconditions: string
    priority: string
    remarks: string
    status: string
    steps: string
    test_subject_id: string
    title: string
  }>('select title, preconditions, steps, expected_result, remarks, status, folder_id, priority, case_type, case_kind, custom_tags, test_subject_id, created_by_user_id from test_cases where id = $1 and test_space_id = $2', [caseId, spaceId])
  if (!current.rows[0]) {
    response.status(404).json({ error: 'Test case not found' })
    return
  }
  const row = current.rows[0]
  const title = request.body.title === undefined ? decryptText(row.title) : text(request.body.title, 160)
  if (!title) {
    response.status(400).json({ error: 'Case title is required' })
    return
  }
  const status = isTestCaseStatus(request.body.status) ? request.body.status : row.status
  let folderId = request.body.folderId === undefined
    ? (row.folder_id ? Number(row.folder_id) : null)
    : positiveId(request.body.folderId)
  const modulePath = request.body.modulePath === undefined
    ? undefined
    : text(request.body.modulePath, 240)
  if (folderId) {
    const folder = await query(
      `select id from test_case_folders where id = $1 and test_space_id = $2 and test_subject_id = (select test_subject_id from test_cases where id = $3)`,
      [folderId, spaceId, caseId],
    )
    if (!folder.rows[0]) {
      response.status(400).json({ error: 'Case folder is invalid' })
      return
    }
  }
  const priority = ['high', 'medium', 'low'].includes(request.body.priority)
    ? request.body.priority
    : row.priority
  const caseType = ['functional', 'regression', 'smoke', 'security', 'performance'].includes(request.body.caseType)
    ? request.body.caseType
    : row.case_type
  const caseKind = isTestCaseKind(request.body.caseKind) ? request.body.caseKind : row.case_kind
  const tags = request.body.customTags === undefined
    ? decryptJson<string[]>(row.custom_tags, [])
    : customTags(request.body.customTags)
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (modulePath !== undefined) {
      folderId = modulePath
        ? await getOrCreateCaseFolder(client, spaceId!, Number(row.test_subject_id), modulePath)
        : null
    }
    await client.query(
      `
      update test_cases set
        title = $1, preconditions = $2, steps = $3, expected_result = $4, remarks = $5,
        status = $6, folder_id = $7, priority = $8, case_type = $9,
        case_kind = $10, custom_tags = $11, updated_at = now()
      where id = $12 and test_space_id = $13
      `,
      [
        encryptText(title),
        encryptText(request.body.preconditions === undefined ? decryptText(row.preconditions) : text(request.body.preconditions, 5000)),
        encryptText(request.body.steps === undefined ? decryptText(row.steps) : text(request.body.steps, 10000)),
        encryptText(request.body.expectedResult === undefined ? decryptText(row.expected_result) : text(request.body.expectedResult, 10000)),
        encryptText(request.body.remarks === undefined ? decryptText(row.remarks) : text(request.body.remarks, 5000)),
        status,
        folderId,
        priority,
        caseType,
        caseKind,
        encryptJson(tags),
        caseId,
        spaceId,
      ],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  if (row.created_by_user_id && Number(row.created_by_user_id) !== session.userId) {
    onTestCaseChanged({ actorUserId: session.userId, caseId })
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.delete('/test-spaces/:spaceId/cases/:caseId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const caseId = positiveId(request.params.caseId)
  if (!caseId) {
    response.status(400).json({ error: 'Valid test case is required' })
    return
  }
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
  const testCase = await query<{ created_by_user_id: string | null }>(
    'select created_by_user_id from test_cases where id = $1 and test_space_id = $2',
    [caseId, spaceId],
  )
  if (!testCase.rows[0]) {
    response.status(404).json({ error: 'Test case not found' })
    return
  }
  const createdByUserId = testCase.rows[0].created_by_user_id
    ? Number(testCase.rows[0].created_by_user_id)
    : null
  if (!canDeleteTestCase(createdByUserId, session.userId)) {
    response.status(403).json({ error: 'Only the test case creator can delete it' })
    return
  }
  const deleted = await query(
    `delete from test_cases
     where id = $1 and test_space_id = $2 and created_by_user_id = $3
     returning id`,
    [caseId, spaceId, session.userId],
  )
  if (!deleted.rows[0]) {
    response.status(409).json({ error: 'Test case ownership changed; refresh and try again' })
    return
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.post('/test-spaces/:spaceId/plans', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
  const subjectIds = Array.isArray(request.body.testSubjectIds)
    ? Array.from(new Set((request.body.testSubjectIds as unknown[]).map(positiveId).filter((id): id is number => id !== null)))
    : []
  const legacySubjectId = positiveId(request.body.testSubjectId)
  if (subjectIds.length === 0 && legacySubjectId) subjectIds.push(legacySubjectId)
  const name = text(request.body.name, 160)
  const caseIds = Array.isArray(request.body.caseIds)
    ? Array.from(new Set((request.body.caseIds as unknown[]).map(positiveId).filter((id): id is number => id !== null)))
    : []
  const startsOn = optionalDate(request.body.startsOn)
  const endsOn = optionalDate(request.body.endsOn)
  const projectId = positiveId(request.body.projectId)
  if (subjectIds.length === 0 || !name || caseIds.length === 0 || (startsOn && endsOn && startsOn > endsOn)) {
    response.status(400).json({ error: 'Plan name, test subjects, valid dates, and at least one case are required' })
    return
  }
  if (!(await requireProjectAccessForLinking(response, projectId, session.userId))) return
  const selectedSubjects = await query(
    'select id from test_subjects where test_space_id = $1 and id = any($2::bigint[])',
    [spaceId, subjectIds],
  )
  if (selectedSubjects.rows.length !== subjectIds.length) {
    response.status(400).json({ error: 'Every selected test subject must belong to the test space' })
    return
  }
  const ownerUserId = positiveId(request.body.ownerUserId)
  if (!(await userCanBeAssignedInSpace(ownerUserId, spaceId!, 'tester'))) {
    response.status(400).json({ error: 'Plan owner must be a tester in this test space' })
    return
  }
  const selectedCases = await query<{
    expected_result: string
    id: string
    preconditions: string
    steps: string
    test_subject_id: string
    title: string
    version: number
  }>(
    `
    select id, title, preconditions, steps, expected_result, version, test_subject_id
    from test_cases
    where test_space_id = $1
      and test_subject_id = any($2::bigint[])
      and status = 'active'
      and id = any($3::bigint[])
    order by array_position($3::bigint[], id)
    `,
    [spaceId, subjectIds, caseIds],
  )
  if (selectedCases.rows.length !== caseIds.length) {
    response.status(400).json({ error: 'Every selected case must be active and belong to the selected test subjects' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    const created = await client.query<{ id: string }>(
      `
      insert into test_plans
        (test_space_id, test_subject_id, project_id, name, version_label, environment, starts_on, ends_on,
         status, owner_user_id, created_by_user_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)
      returning id
      `,
      [
        spaceId,
        subjectIds[0],
        projectId,
        encryptText(name),
        encryptText(text(request.body.versionLabel, 80)),
        encryptText(text(request.body.environment, 160)),
        startsOn,
        endsOn,
        ownerUserId,
        session.userId,
      ],
    )
    const planId = Number(created.rows[0].id)
    for (const subjectId of subjectIds) {
      await client.query(
        'insert into test_plan_subjects (test_plan_id, test_space_id, test_subject_id) values ($1, $2, $3) on conflict do nothing',
        [planId, spaceId, subjectId],
      )
    }
    for (const testCase of selectedCases.rows) {
      await client.query(
        `
        insert into test_plan_cases
          (test_plan_id, test_case_id, test_subject_id, snapshot_title, snapshot_preconditions, snapshot_steps,
           snapshot_expected_result, snapshot_case_version)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          planId,
          Number(testCase.id),
          Number(testCase.test_subject_id),
          testCase.title,
          testCase.preconditions,
          testCase.steps,
          testCase.expected_result,
          testCase.version,
        ],
      )
    }
    await client.query('commit')
    if (ownerUserId && ownerUserId !== session.userId) {
      onTestPlanAssigned({ actorUserId: session.userId, ownerUserId, planId })
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/plans/:planId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const planId = positiveId(request.params.planId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !planId) return
  if (!isTestPlanStatus(request.body.status)) {
    response.status(400).json({ error: 'Valid plan status is required' })
    return
  }
  const updated = await query(
    'update test_plans set status = $1, updated_at = now() where id = $2 and test_space_id = $3 returning id',
    [request.body.status, planId, spaceId],
  )
  if (!updated.rows[0]) {
    response.status(404).json({ error: 'Test plan not found' })
    return
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/plans/:planId/details', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const planId = positiveId(request.params.planId)
  if (!planId) {
    response.status(400).json({ error: 'Valid test plan is required' })
    return
  }
  if (!(await requireSpaceAccess(response, spaceId, session.userId))) return
  const plan = await query<{
    created_by_user_id: string | null
    owner_user_id: string | null
    test_subject_id: string
  }>(
    'select created_by_user_id, owner_user_id, test_subject_id from test_plans where id = $1 and test_space_id = $2',
    [planId, spaceId],
  )
  if (!plan.rows[0]) {
    response.status(404).json({ error: 'Test plan not found' })
    return
  }
  const createdByUserId = plan.rows[0].created_by_user_id
    ? Number(plan.rows[0].created_by_user_id)
    : null
  const previousOwnerUserId = plan.rows[0].owner_user_id
    ? Number(plan.rows[0].owner_user_id)
    : null
  if (!canManageTestPlan(createdByUserId, session.userId)) {
    response.status(403).json({ error: 'Only the test plan creator can edit it' })
    return
  }
  const name = text(request.body.name, 160)
  const startsOn = optionalDate(request.body.startsOn)
  const endsOn = optionalDate(request.body.endsOn)
  const projectId = positiveId(request.body.projectId)
  const caseIds = Array.isArray(request.body.caseIds)
    ? Array.from(new Set((request.body.caseIds as unknown[]).map(positiveId).filter((id): id is number => id !== null)))
    : []
  const subjectIds = Array.isArray(request.body.testSubjectIds)
    ? Array.from(new Set((request.body.testSubjectIds as unknown[]).map(positiveId).filter((id): id is number => id !== null)))
    : []
  const legacySubjectId = positiveId(request.body.testSubjectId)
  if (subjectIds.length === 0 && legacySubjectId) subjectIds.push(legacySubjectId)
  if (!name || (startsOn && endsOn && startsOn > endsOn)) {
    response.status(400).json({ error: 'Plan name and valid dates are required' })
    return
  }
  if (subjectIds.length === 0) {
    response.status(400).json({ error: 'At least one test subject is required' })
    return
  }
  if (!(await requireProjectAccessForLinking(response, projectId, session.userId))) return
  const selectedSubjects = await query(
    'select id from test_subjects where test_space_id = $1 and id = any($2::bigint[])',
    [spaceId, subjectIds],
  )
  if (selectedSubjects.rows.length !== subjectIds.length) {
    response.status(400).json({ error: 'Every selected test subject must belong to the test space' })
    return
  }
  const ownerUserId = positiveId(request.body.ownerUserId)
  if (!(await userCanBeAssignedInSpace(ownerUserId, spaceId!, 'tester'))) {
    response.status(400).json({ error: 'Plan owner must be a tester in this test space' })
    return
  }
  const selectedCases = caseIds.length ? await query<{
    expected_result: string
    id: string
    preconditions: string
    steps: string
    test_subject_id: string
    title: string
    version: number
  }>(
    `
    select id, title, preconditions, steps, expected_result, version, test_subject_id
    from test_cases
    where test_space_id = $1
      and test_subject_id = any($2::bigint[])
      and status = 'active'
      and id = any($3::bigint[])
    order by array_position($3::bigint[], id)
    `,
    [spaceId, subjectIds, caseIds],
  ) : { rows: [] }
  if (selectedCases.rows.length !== caseIds.length) {
    response.status(400).json({ error: 'Every appended case must be active and belong to the selected test subjects' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `
      update test_plans set
        name = $1, version_label = $2, environment = $3, starts_on = $4, ends_on = $5,
        owner_user_id = $6, project_id = $7, test_subject_id = $8, updated_at = now()
      where id = $9 and test_space_id = $10 and created_by_user_id = $11
      `,
      [
        encryptText(name),
        encryptText(text(request.body.versionLabel, 80)),
        encryptText(text(request.body.environment, 160)),
        startsOn,
        endsOn,
        ownerUserId,
        projectId,
        subjectIds[0],
        planId,
        spaceId,
        session.userId,
      ],
    )
    await client.query('delete from test_plan_subjects where test_plan_id = $1', [planId])
    for (const subjectId of subjectIds) {
      await client.query(
        'insert into test_plan_subjects (test_plan_id, test_space_id, test_subject_id) values ($1, $2, $3) on conflict do nothing',
        [planId, spaceId, subjectId],
      )
    }
    for (const testCase of selectedCases.rows) {
      await client.query(
        `
        insert into test_plan_cases
          (test_plan_id, test_case_id, test_subject_id, snapshot_title, snapshot_preconditions, snapshot_steps,
           snapshot_expected_result, snapshot_case_version)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (test_plan_id, test_case_id) do nothing
        `,
        [
          planId,
          Number(testCase.id),
          Number(testCase.test_subject_id),
          testCase.title,
          testCase.preconditions,
          testCase.steps,
          testCase.expected_result,
          testCase.version,
        ],
      )
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  if (ownerUserId && ownerUserId !== session.userId && ownerUserId !== previousOwnerUserId) {
    onTestPlanAssigned({ actorUserId: session.userId, ownerUserId, planId })
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.delete('/test-spaces/:spaceId/plans/:planId/cases/:planCaseId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const planId = positiveId(request.params.planId)
  const planCaseId = positiveId(request.params.planCaseId)
  if (!planId || !planCaseId) {
    response.status(400).json({ error: 'Valid test plan and plan case are required' })
    return
  }
  if (!(await requireSpaceAccess(response, spaceId, session.userId))) return
  const planCase = await query<{ created_by_user_id: string | null; result: TestResult }>(
    `
    select p.created_by_user_id, pc.result
    from test_plan_cases pc
    join test_plans p on p.id = pc.test_plan_id
    where pc.id = $1 and p.id = $2 and p.test_space_id = $3
    `,
    [planCaseId, planId, spaceId],
  )
  if (!planCase.rows[0]) {
    response.status(404).json({ error: 'Test plan case not found' })
    return
  }
  const createdByUserId = planCase.rows[0].created_by_user_id
    ? Number(planCase.rows[0].created_by_user_id)
    : null
  if (!canManageTestPlan(createdByUserId, session.userId)) {
    response.status(403).json({ error: 'Only the test plan creator can remove cases' })
    return
  }
  if (!canRemoveTestPlanCase(createdByUserId, session.userId, planCase.rows[0].result)) {
    response.status(409).json({ error: 'Only unexecuted cases can be removed from a test plan' })
    return
  }
  await query(
    `
    delete from test_plan_cases pc
    using test_plans p
    where pc.id = $1 and pc.test_plan_id = p.id and p.id = $2
      and p.test_space_id = $3 and p.created_by_user_id = $4 and pc.result = 'untested'
    `,
    [planCaseId, planId, spaceId, session.userId],
  )
  response.json(await getTestWorkbench(session.userId))
}))

router.delete('/test-spaces/:spaceId/plans/:planId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const planId = positiveId(request.params.planId)
  if (!planId) {
    response.status(400).json({ error: 'Valid test plan is required' })
    return
  }
  if (!(await requireSpaceAccess(response, spaceId, session.userId))) return
  const plan = await query<{ created_by_user_id: string | null }>(
    'select created_by_user_id from test_plans where id = $1 and test_space_id = $2',
    [planId, spaceId],
  )
  if (!plan.rows[0]) {
    response.status(404).json({ error: 'Test plan not found' })
    return
  }
  const createdByUserId = plan.rows[0].created_by_user_id
    ? Number(plan.rows[0].created_by_user_id)
    : null
  if (!canManageTestPlan(createdByUserId, session.userId)) {
    response.status(403).json({ error: 'Only the test plan creator can delete it' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      'update test_bugs set test_plan_case_id = null, test_plan_id = null, updated_at = now() where test_plan_id = $1 and test_space_id = $2',
      [planId, spaceId],
    )
    await client.query(
      'delete from test_plans where id = $1 and test_space_id = $2 and created_by_user_id = $3',
      [planId, spaceId, session.userId],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/plan-cases/:planCaseId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const planCaseId = positiveId(request.params.planCaseId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !planCaseId) return
  if (!isTestResult(request.body.result)) {
    response.status(400).json({ error: 'Valid test result is required' })
    return
  }
  const client = await pool.connect()
  try {
    await client.query('begin')
    const updated = await client.query<{ test_plan_id: string }>(
      `
      update test_plan_cases pc set
        result = $1, result_note = $2, executed_by_user_id = $3, executed_at = now()
      from test_plans p
      where pc.id = $4 and p.id = pc.test_plan_id and p.test_space_id = $5
      returning pc.test_plan_id
      `,
      [request.body.result, encryptText(text(request.body.resultNote, 5000)), session.userId, planCaseId, spaceId],
    )
    if (!updated.rows[0]) {
      await client.query('rollback')
      response.status(404).json({ error: 'Plan case not found' })
      return
    }
    await client.query(
      `
      update test_plans
      set status = case when status = 'draft' then 'in_progress' else status end,
          updated_at = now()
      where id = $1
      `,
      [Number(updated.rows[0].test_plan_id)],
    )
    await client.query('commit')
    onTestExecutionResultChanged({ actorUserId: session.userId, planCaseId })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.post('/test-spaces/:spaceId/bugs', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true))) return
  const subjectId = positiveId(request.body.testSubjectId)
  const title = text(request.body.title, 160)
  let planId = positiveId(request.body.testPlanId)
  const planCaseId = positiveId(request.body.testPlanCaseId)
  if (!subjectId || !title) {
    response.status(400).json({ error: 'Bug title and test subject are required' })
    return
  }
  const subject = await query('select id from test_subjects where id = $1 and test_space_id = $2', [subjectId, spaceId])
  if (!subject.rows[0]) {
    response.status(404).json({ error: 'Test subject not found' })
    return
  }
  if (planCaseId) {
    const execution = await query<{ test_plan_id: string; test_subject_id: string | null }>(
      `
      select pc.test_plan_id, coalesce(pc.test_subject_id, c.test_subject_id) as test_subject_id
      from test_plan_cases pc
      join test_plans p on p.id = pc.test_plan_id
      left join test_cases c on c.id = pc.test_case_id
      where pc.id = $1 and p.test_space_id = $2
      `,
      [planCaseId, spaceId],
    )
    if (
      !execution.rows[0] ||
      (planId && Number(execution.rows[0].test_plan_id) !== planId) ||
      Number(execution.rows[0].test_subject_id) !== subjectId
    ) {
      response.status(400).json({ error: 'Linked plan execution is invalid' })
      return
    }
    planId = Number(execution.rows[0].test_plan_id)
  }
  if (planId && !planCaseId) {
    const plan = await query(
      `
      select p.id
      from test_plans p
      join test_plan_subjects ps on ps.test_plan_id = p.id
      where p.id = $1 and p.test_space_id = $2 and ps.test_subject_id = $3
      `,
      [planId, spaceId, subjectId],
    )
    if (!plan.rows[0]) {
      response.status(400).json({ error: 'Linked test plan is invalid' })
      return
    }
  }
  const severity = ['blocker', 'critical', 'major', 'minor', 'trivial'].includes(request.body.severity)
    ? request.body.severity
    : 'major'
  const priority = ['high', 'medium', 'low'].includes(request.body.priority) ? request.body.priority : 'medium'
  const assigneeUserId = positiveId(request.body.assigneeUserId)
  if (!(await userCanBeAssignedInSpace(assigneeUserId, spaceId!, 'developer'))) {
    response.status(400).json({ error: 'Bug assignee must be a developer in this test space' })
    return
  }
  const status = assigneeUserId ? 'assigned' : 'new'
  const insertedBug = await query<{ id: string }>(
    `
    insert into test_bugs
      (test_space_id, test_subject_id, test_plan_id, test_plan_case_id, title, severity, priority,
       status, environment, reproduction_steps, expected_result, actual_result, reporter_user_id, assignee_user_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    returning id
    `,
    [
      spaceId,
      subjectId,
      planId,
      planCaseId,
      encryptText(title),
      severity,
      priority,
      status,
      encryptText(text(request.body.environment, 500)),
      encryptText(text(request.body.reproductionSteps, 10000)),
      encryptText(text(request.body.expectedResult, 10000)),
      encryptText(text(request.body.actualResult, 10000)),
      session.userId,
      assigneeUserId,
    ],
  )
  if (assigneeUserId && insertedBug.rows[0]) {
    onTestBugAssigned({
      actorUserId: session.userId,
      assigneeUserId,
      assignmentKind: 'created',
      bugId: Number(insertedBug.rows[0].id),
    })
  }
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/bugs/:bugId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const bugId = positiveId(request.params.bugId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !bugId) return
  const current = await query<{
    actual_result: string
    assignee_user_id: string | null
    environment: string
    expected_result: string
    priority: string
    reporter_user_id: string | null
    reproduction_steps: string
    severity: string
    status: BugStatus
    title: string
  }>(
    `select status, assignee_user_id, reporter_user_id, title, severity, priority,
            environment, reproduction_steps, expected_result, actual_result
       from test_bugs where id = $1 and test_space_id = $2`,
    [bugId, spaceId],
  )
  if (!current.rows[0]) {
    response.status(404).json({ error: 'Bug not found' })
    return
  }
  const currentBug = current.rows[0]
  const hasDetailEdit = [
    'title',
    'severity',
    'priority',
    'environment',
    'reproductionSteps',
    'expectedResult',
    'actualResult',
  ].some((field) => request.body[field] !== undefined)
  const reporterUserId = currentBug.reporter_user_id ? Number(currentBug.reporter_user_id) : null
  if (hasDetailEdit && !canEditTestBug(reporterUserId, session.userId)) {
    response.status(403).json({ error: 'Only the Bug creator can edit its details' })
    return
  }
  const title = request.body.title === undefined ? currentBug.title : text(request.body.title, 160)
  if (request.body.title !== undefined && !title) {
    response.status(400).json({ error: 'Bug title is required' })
    return
  }
  const severity = request.body.severity === undefined
    ? currentBug.severity
    : (isBugSeverity(request.body.severity) ? request.body.severity : null)
  const priority = request.body.priority === undefined
    ? currentBug.priority
    : (['high', 'medium', 'low'].includes(request.body.priority) ? request.body.priority : null)
  if (!severity || !priority) {
    response.status(400).json({ error: 'Bug severity or priority is invalid' })
    return
  }
  const status = isBugStatus(request.body.status) ? request.body.status : current.rows[0].status
  const assigneeUserId = request.body.assigneeUserId === undefined
    ? currentBug.assignee_user_id
    : positiveId(request.body.assigneeUserId)
  const normalizedAssigneeUserId = assigneeUserId ? Number(assigneeUserId) : null
  const previousAssigneeUserId = currentBug.assignee_user_id
    ? Number(currentBug.assignee_user_id)
    : null
  if (!(await userCanBeAssignedInSpace(normalizedAssigneeUserId, spaceId!, 'developer'))) {
    response.status(400).json({ error: 'Bug assignee must be a developer in this test space' })
    return
  }
  await query(
    `update test_bugs set title = $1, severity = $2, priority = $3, environment = $4,
            reproduction_steps = $5, expected_result = $6, actual_result = $7,
            status = $8, assignee_user_id = $9, updated_at = now()
       where id = $10 and test_space_id = $11`,
    [
      request.body.title === undefined ? currentBug.title : encryptText(title),
      severity,
      priority,
      request.body.environment === undefined ? currentBug.environment : encryptText(text(request.body.environment, 500)),
      request.body.reproductionSteps === undefined ? currentBug.reproduction_steps : encryptText(text(request.body.reproductionSteps, 10000)),
      request.body.expectedResult === undefined ? currentBug.expected_result : encryptText(text(request.body.expectedResult, 10000)),
      request.body.actualResult === undefined ? currentBug.actual_result : encryptText(text(request.body.actualResult, 10000)),
      status,
      normalizedAssigneeUserId,
      bugId,
      spaceId,
    ],
  )
  if (
    normalizedAssigneeUserId &&
    normalizedAssigneeUserId !== previousAssigneeUserId
  ) {
    onTestBugAssigned({
      actorUserId: session.userId,
      assigneeUserId: normalizedAssigneeUserId,
      assignmentKind: 'assigned',
      bugId,
    })
  }
  if (
    status !== currentBug.status &&
    (status === 'pending_verification' || status === 'reopened')
  ) {
    onTestBugStatusChanged({
      actorUserId: session.userId,
      bugId,
      nextStatus: status,
      previousStatus: currentBug.status,
    })
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.post('/test-spaces/:spaceId/bugs/:bugId/comments', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const bugId = positiveId(request.params.bugId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !bugId) return
  const content = text(request.body.content, 5000)
  if (!content) {
    response.status(400).json({ error: 'Comment is required' })
    return
  }
  const bug = await query('select id from test_bugs where id = $1 and test_space_id = $2', [bugId, spaceId])
  if (!bug.rows[0]) {
    response.status(404).json({ error: 'Bug not found' })
    return
  }
  const insertedComment = await query<{ id: string }>(
    'insert into test_bug_comments (test_bug_id, author_user_id, content) values ($1, $2, $3) returning id',
    [bugId, session.userId, encryptText(content)],
  )
  if (insertedComment.rows[0]) {
    onTestBugCommentAdded({
      actorUserId: session.userId,
      bugId,
      commentId: Number(insertedComment.rows[0].id),
    })
  }
  response.status(201).json(await getTestWorkbench(session.userId))
}))

router.patch('/test-spaces/:spaceId/bugs/:bugId/comments/:commentId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const bugId = positiveId(request.params.bugId)
  const commentId = positiveId(request.params.commentId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !bugId || !commentId) return
  const content = text(request.body.content, 5000)
  if (!content) {
    response.status(400).json({ error: 'Comment is required' })
    return
  }
  const result = await query(
    `
    update test_bug_comments c
       set content = $1,
           updated_at = now()
      from test_bugs b
     where c.id = $2
       and c.test_bug_id = b.id
       and b.id = $3
       and b.test_space_id = $4
       and c.author_user_id = $5
       and c.kind = 'comment'
     returning c.id
    `,
    [encryptText(content), commentId, bugId, spaceId, session.userId],
  )
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Editable comment not found' })
    return
  }
  response.json(await getTestWorkbench(session.userId))
}))

router.delete('/test-spaces/:spaceId/bugs/:bugId/comments/:commentId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'tester')
  if (!session) return
  const spaceId = positiveId(request.params.spaceId)
  const bugId = positiveId(request.params.bugId)
  const commentId = positiveId(request.params.commentId)
  if (!(await requireSpaceAccess(response, spaceId, session.userId, true)) || !bugId || !commentId) return
  const result = await query(
    `
    delete from test_bug_comments c
     using test_bugs b
     where c.id = $1
       and c.test_bug_id = b.id
       and b.id = $2
       and b.test_space_id = $3
       and c.author_user_id = $4
       and c.kind = 'comment'
     returning c.id
    `,
    [commentId, bugId, spaceId, session.userId],
  )
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Deletable comment not found' })
    return
  }
  response.json(await getTestWorkbench(session.userId))
}))

async function getAssignedBugs(userId: number) {
  const bugs = await query<{
    actual_result: string
    assignee_display_name: string | null
    assignee_email: string | null
    assignee_user_id: string | null
    created_at: Date
    environment: string
    expected_result: string
    id: string
    priority: string
    reporter_display_name: string | null
    reporter_email: string | null
    reporter_user_id: string | null
    reproduction_steps: string
    severity: string
    status: BugStatus
    test_plan_id: string | null
    test_plan_name: string | null
    test_space_id: string
    test_space_name: string
    test_subject_id: string
    test_subject_name: string
    title: string
    updated_at: Date
    organization_id: string | null
    organization_admin_access: boolean
  }>(
    `
    select b.id, b.test_space_id, b.test_subject_id, b.test_plan_id,
      b.reporter_user_id, b.assignee_user_id, b.title, b.severity, b.priority,
      b.status, b.environment, b.reproduction_steps, b.expected_result, b.actual_result,
      b.created_at, b.updated_at,
      space.organization_id as organization_id,
      space.name as test_space_name,
      subject.name as test_subject_name,
      plan.name as test_plan_name,
      reporter.display_name as reporter_display_name, reporter.email as reporter_email,
      assignee.display_name as assignee_display_name, assignee.email as assignee_email,
      ${managedOrganizationReadScopeSql('space.organization_id')} as organization_admin_access
    from test_bugs b
    join test_spaces space on space.id = b.test_space_id
    join test_subjects subject on subject.id = b.test_subject_id
    left join test_plans plan on plan.id = b.test_plan_id
    left join users reporter on reporter.id = b.reporter_user_id
    left join users assignee on assignee.id = b.assignee_user_id
    where (
      b.assignee_user_id = $1 and b.status not in ('closed', 'rejected', 'duplicate')
    ) or ${managedOrganizationReadScopeSql('space.organization_id')}
    order by b.updated_at desc, b.id desc
    `,
    [userId],
  )
  const comments = await query<{
    author_display_name: string | null
    author_email: string | null
    author_user_id: string | null
    assignee_user_id: string | null
    organization_admin_access: boolean
    content: string
    created_at: Date
    id: string
    kind: string
    test_bug_id: string
    updated_at: Date | null
  }>(
    `
    select c.*, b.assignee_user_id,
      ${managedOrganizationReadScopeSql('space.organization_id')} as organization_admin_access,
      u.email as author_email, u.display_name as author_display_name
    from test_bug_comments c
    join test_bugs b on b.id = c.test_bug_id
    join test_spaces space on space.id = b.test_space_id
    left join users u on u.id = c.author_user_id
    where (
      b.assignee_user_id = $1 and b.status not in ('closed', 'rejected', 'duplicate')
    ) or ${managedOrganizationReadScopeSql('space.organization_id')}
    order by c.created_at, c.id
    `,
    [userId],
  )
  const commentsByBug = new Map<number, Array<Record<string, unknown>>>()
  for (const row of comments.rows) {
    const bugId = Number(row.test_bug_id)
    commentsByBug.set(bugId, [
      ...(commentsByBug.get(bugId) ?? []),
      {
        authorName: row.author_display_name || row.author_email || '未知用户',
        authorUserId: row.author_user_id ? Number(row.author_user_id) : undefined,
        canEdit: row.kind !== 'transfer' && row.author_user_id
          ? Number(row.author_user_id) === userId && (
            Number(row.assignee_user_id) === userId || row.organization_admin_access
          )
          : false,
        content: decryptText(row.content),
        createdAt: row.created_at.toISOString(),
        id: Number(row.id),
        kind: row.kind === 'transfer' ? 'transfer' : 'comment',
        updatedAt: (row.updated_at ?? row.created_at).toISOString(),
      },
    ])
  }
  const organizationIds = Array.from(new Set(
    bugs.rows
      .map((row) => row.organization_id ? Number(row.organization_id) : null)
      .filter((id): id is number => id != null && Number.isSafeInteger(id) && id > 0),
  ))
  const members = organizationIds.length > 0
    ? await query<{ id: string; name: string; organization_id: string }>(
      `
      select distinct membership.organization_id, u.id,
        coalesce(nullif(u.display_name, ''), u.email) as name
      from organization_memberships membership
      join users u on u.id = membership.user_id
      where membership.organization_id = any($2::bigint[])
        and membership.status = 'active'
        and exists(
          select 1
          from user_roles organization_admin_role
          where organization_admin_role.user_id = $1
            and organization_admin_role.role = 'organization_admin'
        )
      order by membership.organization_id, name, u.id
      `,
      [userId, organizationIds],
    )
    : { rows: [] as Array<{ id: string; name: string; organization_id: string }> }
  const membersByOrganization = new Map<number, Array<{ id: number; name: string }>>()
  for (const row of members.rows) {
    const organizationId = Number(row.organization_id)
    membersByOrganization.set(organizationId, [
      ...(membersByOrganization.get(organizationId) ?? []),
      { id: Number(row.id), name: row.name },
    ])
  }
  const transferCandidates = organizationIds.length > 0
    ? await query<{ id: string; name: string; organization_id: string }>(
      `
      select distinct membership.organization_id, u.id,
        coalesce(nullif(u.display_name, ''), u.email) as name
      from organization_memberships membership
      join users u on u.id = membership.user_id
      where membership.organization_id = any($1::bigint[])
        and membership.status = 'active'
        and exists(
          select 1
          from user_roles eligible_role
          where eligible_role.user_id = membership.user_id
            and eligible_role.role in ('developer', 'organization_admin')
        )
      order by membership.organization_id, name, u.id
      `,
      [organizationIds],
    )
    : { rows: [] as Array<{ id: string; name: string; organization_id: string }> }
  const transferCandidatesByOrganization = new Map<number, Array<{ id: number; name: string }>>()
  for (const row of transferCandidates.rows) {
    const organizationId = Number(row.organization_id)
    transferCandidatesByOrganization.set(organizationId, [
      ...(transferCandidatesByOrganization.get(organizationId) ?? []),
      { id: Number(row.id), name: row.name },
    ])
  }
  return {
    members: [],
    bugs: bugs.rows.map((row) => ({
      actualResult: decryptText(row.actual_result),
      assigneeName: row.assignee_display_name || row.assignee_email || undefined,
      assigneeUserId: row.assignee_user_id ? Number(row.assignee_user_id) : undefined,
      canComment: Number(row.assignee_user_id) === userId || Boolean(row.organization_admin_access),
      canManage: Number(row.assignee_user_id) === userId,
      canTransfer: (Number(row.assignee_user_id) === userId || (
        !row.assignee_user_id && row.organization_admin_access
      )) &&
        Boolean(row.organization_id) &&
        !['closed', 'rejected', 'duplicate'].includes(row.status),
      comments: commentsByBug.get(Number(row.id)) ?? [],
      createdAt: row.created_at.toISOString(),
      environment: decryptText(row.environment),
      expectedResult: decryptText(row.expected_result),
      id: Number(row.id),
      organizationMembers: row.organization_id
        ? membersByOrganization.get(Number(row.organization_id)) ?? []
        : [],
      priority: row.priority,
      reporterName: row.reporter_display_name || row.reporter_email || undefined,
      reporterUserId: row.reporter_user_id ? Number(row.reporter_user_id) : undefined,
      reproductionSteps: decryptText(row.reproduction_steps),
      severity: row.severity,
      status: row.status,
      testPlanId: row.test_plan_id ? Number(row.test_plan_id) : undefined,
      testPlanName: row.test_plan_name ? decryptText(row.test_plan_name) : undefined,
      testSpaceId: Number(row.test_space_id),
      testSpaceName: decryptText(row.test_space_name),
      testSubjectId: Number(row.test_subject_id),
      testSubjectName: decryptText(row.test_subject_name),
      title: decryptText(row.title),
      transferCandidates: row.organization_id
        ? (transferCandidatesByOrganization.get(Number(row.organization_id)) ?? [])
          .filter((member) => !row.assignee_user_id || member.id !== Number(row.assignee_user_id))
        : [],
      updatedAt: row.updated_at.toISOString(),
    })),
  }
}

async function getAssignedBugCommentAccess(userId: number, bugId: number) {
  const result = await query<{
    assignee_user_id: string | null
    organization_id: string | null
    organization_admin_access: boolean
  }>(
    `
    select b.assignee_user_id, space.organization_id,
      ${managedOrganizationReadScopeSql('space.organization_id')} as organization_admin_access
    from test_bugs b
    join test_spaces space on space.id = b.test_space_id
    where b.id = $2
      and (b.assignee_user_id = $1 or ${managedOrganizationReadScopeSql('space.organization_id')})
    limit 1
    `,
    [userId, bugId],
  )
  return result.rows[0] ?? null
}

router.get('/test-bugs/assigned', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'developer')
  if (!session) return
  response.json(await getAssignedBugs(session.userId))
}))

router.post('/test-bugs/:bugId/assigned/transfer', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'developer')
  if (!session) return
  const bugId = positiveId(request.params.bugId)
  const assigneeUserId = positiveId(request.body.assigneeUserId)
  const reason = String(request.body.reason ?? '').trim()
  if (!bugId || !assigneeUserId || reason.length > 1000) {
    response.status(400).json({ error: 'Valid Bug, assignee, and transfer reason are required' })
    return
  }

  const transfer = await transaction(async (client) => {
    const lockedBug = await client.query<{
      assignee_display_name: string | null
      assignee_email: string | null
      assignee_user_id: string | null
      organization_id: string | null
      organization_admin_access: boolean
      status: BugStatus
    }>(
      `
      select b.assignee_user_id, b.status, space.organization_id,
        ${managedOrganizationReadScopeSql('space.organization_id', '$2')} as organization_admin_access,
        assignee.display_name as assignee_display_name,
        assignee.email as assignee_email
      from test_bugs b
      join test_spaces space on space.id = b.test_space_id
      left join users assignee on assignee.id = b.assignee_user_id
      where b.id = $1
      for update of b
      `,
      [bugId, session.userId],
    )
    const bug = lockedBug.rows[0]
    if (!bug) {
      throw Object.assign(new Error('Assigned Bug not found'), { status: 404 })
    }
    const assigningUnassignedBug = !bug.assignee_user_id
    if (assigningUnassignedBug && !bug.organization_admin_access) {
      throw Object.assign(new Error('Assigned Bug not found'), { status: 404 })
    }
    if (!assigningUnassignedBug && Number(bug.assignee_user_id) !== session.userId) {
      throw Object.assign(new Error('Assigned Bug not found'), { status: 404 })
    }
    if (!assigningUnassignedBug && (assigneeUserId === session.userId || !reason)) {
      throw Object.assign(new Error('Bug transfer requires another assignee and a reason'), { status: 400 })
    }
    if (!bug.organization_id) {
      throw Object.assign(new Error('Only organization Bugs can be transferred'), { status: 409 })
    }
    if (['closed', 'rejected', 'duplicate'].includes(bug.status)) {
      throw Object.assign(new Error('Terminal Bugs cannot be transferred'), { status: 409 })
    }

    const target = await client.query<{ display_name: string | null; email: string; id: string }>(
      `
      select u.id, u.email, u.display_name
      from organization_memberships membership
      join users u on u.id = membership.user_id
      join user_roles eligible_role
        on eligible_role.user_id = membership.user_id
       and eligible_role.role in ('developer', 'organization_admin')
      where membership.organization_id = $1
        and membership.user_id = $2
        and membership.status = 'active'
      limit 1
      for share of membership, eligible_role
      `,
      [Number(bug.organization_id), assigneeUserId],
    )
    const nextAssignee = target.rows[0]
    if (!nextAssignee) {
      throw Object.assign(new Error('Bug assignee must be an active organization developer'), { status: 400 })
    }

    await client.query(
      `update test_bugs
       set assignee_user_id = $1, status = 'assigned', updated_at = now()
       where id = $2`,
      [assigneeUserId, bugId],
    )
    if (!assigningUnassignedBug) {
      const previousAssigneeName = bug.assignee_display_name || bug.assignee_email || '未知成员'
      const nextAssigneeName = nextAssignee.display_name || nextAssignee.email
      const transferComment = [
        `将 Bug 从「${previousAssigneeName}」转移给「${nextAssigneeName}」。`,
        '',
        `转移理由：${reason}`,
      ].join('\n')
      await client.query(
        `insert into test_bug_comments (test_bug_id, author_user_id, content, kind)
         values ($1, $2, $3, 'transfer')`,
        [bugId, session.userId, encryptText(transferComment)],
      )
    }

    return { assigneeUserId, assigningUnassignedBug }
  })

  onTestBugAssigned({
    actorUserId: session.userId,
    assigneeUserId: transfer.assigneeUserId,
    assignmentKind: transfer.assigningUnassignedBug ? 'assigned' : 'transferred',
    bugId,
    transferReason: transfer.assigningUnassignedBug ? undefined : reason,
  })
  response.json(await getAssignedBugs(session.userId))
}))

router.patch('/test-bugs/:bugId/assigned', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'developer')
  if (!session) return
  const bugId = positiveId(request.params.bugId)
  if (!bugId || !isBugStatus(request.body.status)) {
    response.status(400).json({ error: 'Valid bug and status are required' })
    return
  }
  const current = await query<{ status: BugStatus }>(
    'select status from test_bugs where id = $1 and assignee_user_id = $2',
    [bugId, session.userId],
  )
  if (!current.rows[0]) {
    response.status(404).json({ error: 'Assigned bug not found' })
    return
  }
  if (!canDeveloperSetBugStatus(current.rows[0].status, request.body.status)) {
    response.status(409).json({ error: 'Developer cannot perform this bug transition' })
    return
  }
  await query('update test_bugs set status = $1, updated_at = now() where id = $2 and assignee_user_id = $3', [
    request.body.status,
    bugId,
    session.userId,
  ])
  if (request.body.status === 'pending_verification' || request.body.status === 'reopened') {
    onTestBugStatusChanged({
      actorUserId: session.userId,
      bugId,
      nextStatus: request.body.status,
      previousStatus: current.rows[0].status,
    })
  }
  response.json(await getAssignedBugs(session.userId))
}))

router.post('/test-bugs/:bugId/assigned/comments', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'developer')
  if (!session) return
  const bugId = positiveId(request.params.bugId)
  const content = text(request.body.content, 5000)
  if (!bugId || !content) {
    response.status(400).json({ error: 'Bug and comment are required' })
    return
  }
  const bug = await getAssignedBugCommentAccess(session.userId, bugId)
  if (!bug) {
    response.status(404).json({ error: 'Assigned bug not found' })
    return
  }
  const mentionedUserIds = bug.organization_admin_access
    ? await resolveOrganizationMentionUserIds(
      bug.organization_id ? Number(bug.organization_id) : null,
      content,
    )
    : []
  const insertedComment = await query<{ id: string }>(
    'insert into test_bug_comments (test_bug_id, author_user_id, content) values ($1, $2, $3) returning id',
    [bugId, session.userId, encryptText(content)],
  )
  if (insertedComment.rows[0]) {
    onTestBugCommentAdded({
      actorUserId: session.userId,
      bugId,
      commentId: Number(insertedComment.rows[0].id),
      mentionedUserIds,
    })
  }
  response.status(201).json(await getAssignedBugs(session.userId))
}))

router.patch('/test-bugs/:bugId/assigned/comments/:commentId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'developer')
  if (!session) return
  const bugId = positiveId(request.params.bugId)
  const commentId = positiveId(request.params.commentId)
  const content = text(request.body.content, 5000)
  if (!bugId || !commentId || !content) {
    response.status(400).json({ error: 'Bug and comment are required' })
    return
  }
  const result = await query(
    `
    update test_bug_comments c
       set content = $1,
           updated_at = now()
      from test_bugs b
      join test_spaces space on space.id = b.test_space_id
     where c.id = $2
       and c.test_bug_id = b.id
       and b.id = $3
       and (b.assignee_user_id = $4 or ${managedOrganizationReadScopeSql('space.organization_id', '$4')})
       and c.author_user_id = $4
       and c.kind = 'comment'
     returning c.id
    `,
    [encryptText(content), commentId, bugId, session.userId],
  )
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Editable assigned comment not found' })
    return
  }
  response.json(await getAssignedBugs(session.userId))
}))

router.delete('/test-bugs/:bugId/assigned/comments/:commentId', asyncRoute(async (request, response) => {
  const session = await requireActiveRole(request, response, 'developer')
  if (!session) return
  const bugId = positiveId(request.params.bugId)
  const commentId = positiveId(request.params.commentId)
  if (!bugId || !commentId) {
    response.status(400).json({ error: 'Bug and comment are required' })
    return
  }
  const result = await query(
    `
    delete from test_bug_comments c
     using test_bugs b
     join test_spaces space on space.id = b.test_space_id
     where c.id = $1
       and c.test_bug_id = b.id
       and b.id = $2
       and (b.assignee_user_id = $3 or ${managedOrganizationReadScopeSql('space.organization_id', '$3')})
       and c.author_user_id = $3
       and c.kind = 'comment'
     returning c.id
    `,
    [commentId, bugId, session.userId],
  )
  if (!result.rows[0]) {
    response.status(404).json({ error: 'Deletable assigned comment not found' })
    return
  }
  response.json(await getAssignedBugs(session.userId))
}))

export { router as testWorkbenchRouter }
