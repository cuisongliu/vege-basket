import crypto from 'node:crypto'
import type express from 'express'
import { Router } from 'express'
import { blindIndex, decryptText, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import {
  canManageOrganization,
  hashOrganizationInviteToken,
  isFreshFeishuTimestamp,
  isOrganizationAccessRole,
  matchesOrganizationDeleteConfirmation,
  normalizeOrganizationName,
  normalizeOrganizationWeekStart,
  normalizeOrganizationWeekStartsOn,
  type OrganizationAccessRole,
  verifyFeishuCardSignature,
} from './organization-policy.ts'
import { getAuthenticatedRoleSession, isSystemAdmin } from './roles.ts'
import {
  buildOrganizationInvitationCard,
  buildOrganizationInvitationStatusCard,
} from './organization-cards.ts'

type OrganizationRouterDependencies = {
  generateWeeklySummary: (userId: number, source: string) => Promise<{
    error?: string
    message?: string
    status: number
  }>
  resolveFeishuOpenIdByEmail: (email: string) => Promise<string>
  sendFeishuMessage: (params: {
    content: Record<string, unknown> | string
    msgType: 'interactive' | 'text'
    receiveId: string
    receiveIdType: 'open_id'
  }) => Promise<{ messageId?: string } | void>
}

type OrganizationMembership = {
  access_role: OrganizationAccessRole
  organization_id: string
}

function asyncRoute(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).catch(next)
  }
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function normalizedEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase().slice(0, 160)
}

function displayName(row: { display_name?: string | null; email?: string | null }) {
  return String(row.display_name || row.email || '未知用户')
}

function dateOnly(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

async function requireSession(request: express.Request, response: express.Response) {
  const session = await getAuthenticatedRoleSession(request)
  if (!session) response.status(401).json({ error: 'Unauthorized' })
  return session
}

async function getOrganizationMembership(organizationId: number, userId: number) {
  const result = await query<OrganizationMembership>(
    `
    select organization_id, access_role
    from organization_memberships
    where organization_id = $1 and user_id = $2 and status = 'active'
    `,
    [organizationId, userId],
  )
  return result.rows[0] ?? null
}

async function requireOrganizationMember(
  response: express.Response,
  organizationId: number | null,
  userId: number,
) {
  if (!organizationId) {
    response.status(400).json({ error: 'Valid organization is required' })
    return null
  }
  const membership = await getOrganizationMembership(organizationId, userId)
  if (!membership) response.status(404).json({ error: 'Organization not found' })
  return membership
}

async function requireOrganizationAdmin(
  response: express.Response,
  organizationId: number | null,
  userId: number,
) {
  const membership = await requireOrganizationMember(response, organizationId, userId)
  if (!membership) return null
  if (!canManageOrganization(membership.access_role)) {
    response.status(403).json({ error: 'Organization administrator access is required' })
    return null
  }
  return membership
}

async function lockManagedOrganization(
  client: { query: typeof query },
  organizationId: number,
  userId: number,
) {
  const result = await client.query<{ name: string }>(
    `
    select o.name
    from organizations o
    join organization_memberships m on m.organization_id = o.id
    where o.id = $1 and m.user_id = $2 and m.status = 'active'
      and m.access_role in ('owner', 'admin')
    for update of o, m
    `,
    [organizationId, userId],
  )
  return result.rows[0] ?? null
}

function databaseErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : ''
}

async function writeAudit(
  client: { query: typeof query },
  organizationId: number,
  actorUserId: number | null,
  action: string,
  subjectType: string,
  subjectId = '',
  detail = '',
) {
  await client.query(
    `
    insert into organization_audit_events
      (organization_id, actor_user_id, action, subject_type, subject_id, detail)
    values ($1, $2, $3, $4, $5, $6)
    `,
    [organizationId, actorUserId, action, subjectType, subjectId, encryptText(detail)],
  )
}

async function getOrganizationWeekStartsOn(organizationId: number) {
  const result = await query<{ week_starts_on: number }>(
    'select week_starts_on from organizations where id = $1',
    [organizationId],
  )
  return normalizeOrganizationWeekStartsOn(result.rows[0]?.week_starts_on) ?? 1
}

async function getOrganizationDetail(organizationId: number, userId: number) {
  const membership = await getOrganizationMembership(organizationId, userId)
  if (!membership) return null
  const canManage = canManageOrganization(membership.access_role)
  const [organization, members, projects, testSpaces, todos, packageEvents, bugs, reports, summaries, invitations, attachableProjects, attachableTestSpaces] = await Promise.all([
    query<{
      created_at: Date
      id: string
      name: string
      owner_user_id: string
      week_starts_on: number
    }>('select id, owner_user_id, name, week_starts_on, created_at from organizations where id = $1', [organizationId]),
    query<{
      access_role: OrganizationAccessRole
      display_name: string
      email: string
      joined_at: Date
      roles: string[]
      user_id: string
    }>(
      `
      select m.user_id, m.access_role, m.joined_at, u.email, u.display_name,
        coalesce(array_agg(distinct ur.role order by ur.role) filter (where ur.role is not null), '{}') as roles
      from organization_memberships m
      join users u on u.id = m.user_id
      left join user_roles ur on ur.user_id = u.id
      where m.organization_id = $1 and m.status = 'active'
      group by m.user_id, m.access_role, m.joined_at, u.id
      order by case m.access_role when 'owner' then 0 when 'admin' then 1 else 2 end,
        lower(coalesce(nullif(u.display_name, ''), u.email))
      `,
      [organizationId],
    ),
    query<{
      id: string
      name: string
      open_todo_count: string
      owner_display_name: string
      owner_email: string
      status: string
      todo_count: string
      updated_at: Date
    }>(
      `
      select p.id, p.name, p.status, p.updated_at, owner.email as owner_email,
        owner.display_name as owner_display_name,
        count(distinct t.id) as todo_count,
        count(distinct t.id) filter (where t.done = false) as open_todo_count
      from projects p
      join users owner on owner.id = p.user_id
      left join todos t on t.project_id = p.id
      left join project_memberships mine
        on mine.project_id = p.id and mine.invited_user_id = $3 and mine.status = 'active'
      where p.organization_id = $1 and ($2::boolean or p.user_id = $3 or mine.id is not null)
      group by p.id, owner.id
      order by p.updated_at desc, p.id desc
      `,
      [organizationId, canManage, userId],
    ),
    query<{
      bug_count: string
      id: string
      name: string
      owner_display_name: string
      owner_email: string
      plan_count: string
      updated_at: Date
    }>(
      `
      select s.id, s.name, s.updated_at, owner.email as owner_email,
        owner.display_name as owner_display_name,
        count(distinct p.id) as plan_count,
        count(distinct b.id) as bug_count
      from test_spaces s
      join users owner on owner.id = s.owner_user_id
      left join test_space_memberships mine
        on mine.test_space_id = s.id and mine.user_id = $3 and mine.status = 'active'
      left join test_plans p on p.test_space_id = s.id
      left join test_bugs b on b.test_space_id = s.id
      where s.organization_id = $1 and ($2::boolean or mine.user_id is not null)
      group by s.id, owner.id
      order by s.updated_at desc, s.id desc
      `,
      [organizationId, canManage, userId],
    ),
    query<{
      assignee_display_name: string | null
      assignee_email: string | null
      done: boolean
      due_date: Date
      id: string
      priority: string
      project_id: string
      project_name: string
      title: string
      updated_at: Date
    }>(
      `
      select t.id, t.project_id, p.name as project_name, t.title, t.priority, t.done,
        t.due_date, t.updated_at, assignee.email as assignee_email,
        assignee.display_name as assignee_display_name
      from todos t
      join projects p on p.id = t.project_id
      left join users assignee on assignee.id = t.assignee_user_id
      left join project_memberships mine
        on mine.project_id = p.id and mine.invited_user_id = $3 and mine.status = 'active'
      where p.organization_id = $1 and ($2::boolean or p.user_id = $3 or mine.id is not null)
      order by t.done, t.updated_at desc, t.id desc
      limit 200
      `,
      [organizationId, canManage, userId],
    ),
    query<{
      assignee_display_name: string | null
      assignee_email: string | null
      delivery_date: Date
      id: string
      project_id: string
      project_name: string
      status: string
      title: string
      updated_at: Date
    }>(
      `
      select e.id, e.project_id, p.name as project_name, e.title, e.status,
        e.delivery_date, e.updated_at, assignee.email as assignee_email,
        assignee.display_name as assignee_display_name
      from project_package_events e
      join projects p on p.id = e.project_id
      left join users assignee on assignee.id = e.assignee_user_id
      left join project_memberships mine
        on mine.project_id = p.id and mine.invited_user_id = $3 and mine.status = 'active'
      where p.organization_id = $1 and ($2::boolean or p.user_id = $3 or mine.id is not null)
      order by e.updated_at desc, e.id desc
      limit 200
      `,
      [organizationId, canManage, userId],
    ),
    query<{
      assignee_display_name: string | null
      assignee_email: string | null
      id: string
      priority: string
      severity: string
      status: string
      test_space_id: string
      test_space_name: string
      title: string
      updated_at: Date
    }>(
      `
      select b.id, b.test_space_id, s.name as test_space_name, b.title, b.priority,
        b.severity, b.status, b.updated_at, assignee.email as assignee_email,
        assignee.display_name as assignee_display_name
      from test_bugs b
      join test_spaces s on s.id = b.test_space_id
      left join users assignee on assignee.id = b.assignee_user_id
      left join test_space_memberships mine
        on mine.test_space_id = s.id and mine.user_id = $3 and mine.status = 'active'
      where s.organization_id = $1 and ($2::boolean or mine.user_id is not null or b.assignee_user_id = $3)
      order by b.updated_at desc, b.id desc
      limit 200
      `,
      [organizationId, canManage, userId],
    ),
    query<{
      content: string
      display_name: string
      email: string
      status: string
      submitted_at: Date | null
      updated_at: Date
      user_id: string
      week_start: Date | string
    }>(
      `
      select r.user_id, r.week_start, r.content, r.status, r.updated_at, r.submitted_at,
        u.email, u.display_name
      from organization_weekly_reports r
      join users u on u.id = r.user_id
      where r.organization_id = $1 and ($2::boolean and r.status = 'submitted' or r.user_id = $3)
      order by r.week_start desc, lower(coalesce(nullif(u.display_name, ''), u.email))
      limit 200
      `,
      [organizationId, canManage, userId],
    ),
    canManage ? query<{
      content: string
      created_at: Date
      source_report_count: number
      week_start: Date | string
    }>(
      `select week_start, content, source_report_count, created_at
       from organization_weekly_summaries where organization_id = $1
       order by week_start desc limit 12`,
      [organizationId],
    ) : Promise.resolve({ rows: [] }),
    canManage ? query<{
      created_at: Date
      id: string
      last_error: string
      status: string
      target_email: string
    }>(
      `select id, target_email, status, last_error, created_at
       from organization_invitations where organization_id = $1
         and status <> 'accepted'
       order by created_at desc limit 50`,
      [organizationId],
    ) : Promise.resolve({ rows: [] }),
    query<{ id: string; name: string; status: string }>(
      `select id, name, status from projects
       where user_id = $1 and organization_id is null order by updated_at desc`,
      [userId],
    ),
    query<{ id: string; name: string }>(
      `select id, name from test_spaces
       where owner_user_id = $1 and organization_id is null order by updated_at desc`,
      [userId],
    ),
  ])
  const row = organization.rows[0]
  if (!row) return null
  const taskRows = [
    ...todos.rows.map((task) => ({
      assigneeName: task.assignee_email
        ? String(task.assignee_display_name || task.assignee_email)
        : '',
      id: Number(task.id),
      kind: 'todo' as const,
      projectId: Number(task.project_id),
      projectName: decryptText(task.project_name),
      status: task.done ? 'completed' : 'open',
      title: decryptText(task.title),
      updatedAt: task.updated_at.toISOString(),
    })),
    ...packageEvents.rows.map((task) => ({
      assigneeName: task.assignee_email
        ? String(task.assignee_display_name || task.assignee_email)
        : '',
      id: Number(task.id),
      kind: 'delivery' as const,
      projectId: Number(task.project_id),
      projectName: decryptText(task.project_name),
      status: task.status,
      title: decryptText(task.title),
      updatedAt: task.updated_at.toISOString(),
    })),
    ...bugs.rows.map((task) => ({
      assigneeName: task.assignee_email
        ? String(task.assignee_display_name || task.assignee_email)
        : '',
      id: Number(task.id),
      kind: 'bug' as const,
      projectName: decryptText(task.test_space_name),
      status: task.status,
      title: decryptText(task.title),
      updatedAt: task.updated_at.toISOString(),
    })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

  return {
    accessRole: membership.access_role,
    attachableProjects: attachableProjects.rows.map((project) => ({
      id: Number(project.id),
      name: decryptText(project.name),
      status: project.status,
    })),
    attachableTestSpaces: attachableTestSpaces.rows.map((space) => ({
      id: Number(space.id),
      name: decryptText(space.name),
    })),
    canManage,
    createdAt: row.created_at.toISOString(),
    id: Number(row.id),
    invitations: invitations.rows.map((invite) => ({
      createdAt: invite.created_at.toISOString(),
      id: Number(invite.id),
      lastError: invite.last_error,
      status: invite.status,
      targetEmail: decryptText(invite.target_email),
    })),
    members: members.rows.map((member) => ({
      accessRole: member.access_role,
      displayName: displayName(member),
      id: Number(member.user_id),
      joinedAt: member.joined_at.toISOString(),
      roles: member.roles,
      username: member.email,
    })),
    name: decryptText(row.name),
    ownerUserId: Number(row.owner_user_id),
    projects: projects.rows.map((project) => ({
      id: Number(project.id),
      name: decryptText(project.name),
      openTodoCount: Number(project.open_todo_count),
      ownerName: String(project.owner_display_name || project.owner_email),
      status: project.status,
      todoCount: Number(project.todo_count),
      updatedAt: project.updated_at.toISOString(),
    })),
    reports: reports.rows.map((report) => ({
      content: decryptText(report.content),
      memberName: displayName(report),
      status: report.status,
      submittedAt: report.submitted_at?.toISOString(),
      updatedAt: report.updated_at.toISOString(),
      userId: Number(report.user_id),
      weekStart: dateOnly(report.week_start),
    })),
    summaries: summaries.rows.map((summary) => ({
      content: decryptText(summary.content),
      createdAt: summary.created_at.toISOString(),
      sourceReportCount: summary.source_report_count,
      weekStart: dateOnly(summary.week_start),
    })),
    tasks: taskRows.slice(0, 200),
    testSpaces: testSpaces.rows.map((space) => ({
      bugCount: Number(space.bug_count),
      id: Number(space.id),
      name: decryptText(space.name),
      ownerName: String(space.owner_display_name || space.owner_email),
      planCount: Number(space.plan_count),
      updatedAt: space.updated_at.toISOString(),
    })),
    weekStartsOn: normalizeOrganizationWeekStartsOn(row.week_starts_on) ?? 1,
  }
}

export function createOrganizationRouter(dependencies: OrganizationRouterDependencies) {
  const router = Router()

  router.get('/organizations', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizations = await query<{
      access_role: OrganizationAccessRole
      id: string
      member_count: string
      name: string
    }>(
      `
      select o.id, o.name, mine.access_role,
        count(m.user_id) filter (where m.status = 'active') as member_count
      from organization_memberships mine
      join organizations o on o.id = mine.organization_id
      left join organization_memberships m on m.organization_id = o.id
      where mine.user_id = $1 and mine.status = 'active'
      group by o.id, mine.access_role
      order by lower(o.name), o.id
      `,
      [session.userId],
    )
    const items = organizations.rows.map((organization) => ({
      accessRole: organization.access_role,
      id: Number(organization.id),
      memberCount: Number(organization.member_count),
      name: decryptText(organization.name),
    })).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    response.json({
      canCreate: isSystemAdmin(session.username),
      organizations: items,
    })
  }))

  router.post('/admin/organizations', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    if (!isSystemAdmin(session.username)) {
      response.status(403).json({ error: 'System administrator access is required' })
      return
    }
    const name = normalizeOrganizationName(request.body?.name)
    const ownerUsername = normalizedEmail(request.body.ownerUsername || session.username)
    if (!name || !ownerUsername) {
      response.status(400).json({ error: 'Organization name and owner username are required' })
      return
    }
    const owner = await query<{ id: string }>('select id from users where email = $1', [ownerUsername])
    if (!owner.rows[0]) {
      response.status(404).json({ error: 'Organization owner account not found' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('begin')
      const created = await client.query<{ id: string }>(
        `insert into organizations (owner_user_id, name, name_lookup, created_by_user_id)
         values ($1, $2, $3, $4) returning id`,
        [Number(owner.rows[0].id), encryptText(name), blindIndex(name), session.userId],
      )
      const organizationId = Number(created.rows[0].id)
      await client.query(
        `insert into organization_memberships
          (organization_id, user_id, access_role, status, invited_by_user_id)
         values ($1, $2, 'owner', 'active', $3)`,
        [organizationId, Number(owner.rows[0].id), session.userId],
      )
      await writeAudit(client, organizationId, session.userId, 'organization.created', 'organization', String(organizationId), name)
      await client.query('commit')
      response.status(201).json(await getOrganizationDetail(organizationId, Number(owner.rows[0].id)))
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }))

  router.get('/organizations/:organizationId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!organizationId) {
      response.status(400).json({ error: 'Valid organization is required' })
      return
    }
    const detail = await getOrganizationDetail(organizationId, session.userId)
    if (!detail) {
      response.status(404).json({ error: 'Organization not found' })
      return
    }
    response.json(detail)
  }))

  router.patch('/organizations/:organizationId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationAdmin(response, organizationId, session.userId))) return
    const name = normalizeOrganizationName(request.body?.name)
    if (!name) {
      response.status(400).json({ error: 'Organization name must contain 1 to 80 characters' })
      return
    }

    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await lockManagedOrganization(client, organizationId!, session.userId)
      if (!organization) {
        await client.query('rollback')
        response.status(409).json({ error: 'Organization access changed, reload and try again' })
        return
      }
      const previousName = decryptText(organization.name)
      if (previousName !== name) {
        await client.query(
          `update organizations
           set name = $1, name_lookup = $2, updated_at = now()
           where id = $3`,
          [encryptText(name), blindIndex(name), organizationId],
        )
        await writeAudit(
          client,
          organizationId!,
          session.userId,
          'organization.renamed',
          'organization',
          String(organizationId),
          `${previousName} -> ${name}`,
        )
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      if (databaseErrorCode(error) === '23505') {
        response.status(409).json({ error: 'An organization with this name already exists' })
        return
      }
      throw error
    } finally {
      client.release()
    }

    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.patch('/organizations/:organizationId/week-start', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationAdmin(response, organizationId, session.userId))) return
    const weekStartsOn = normalizeOrganizationWeekStartsOn(request.body?.weekStartsOn)
    if (!weekStartsOn) {
      response.status(400).json({ error: 'Week start must be between Monday and Sunday' })
      return
    }

    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await lockManagedOrganization(client, organizationId!, session.userId)
      if (!organization) {
        await client.query('rollback')
        response.status(409).json({ error: 'Organization access changed, reload and try again' })
        return
      }
      await client.query(
        'update organizations set week_starts_on = $1, updated_at = now() where id = $2',
        [weekStartsOn, organizationId],
      )
      await writeAudit(
        client,
        organizationId!,
        session.userId,
        'organization.week_start_changed',
        'organization',
        String(organizationId),
        String(weekStartsOn),
      )
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.delete('/organizations/:organizationId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationAdmin(response, organizationId, session.userId))) return

    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await lockManagedOrganization(client, organizationId!, session.userId)
      if (!organization) {
        await client.query('rollback')
        response.status(409).json({ error: 'Organization access changed, reload and try again' })
        return
      }
      const organizationName = decryptText(organization.name)
      if (!matchesOrganizationDeleteConfirmation(
        organizationName,
        request.body?.confirmationName,
      )) {
        await client.query('rollback')
        response.status(400).json({ error: 'Enter the full organization name to confirm deletion' })
        return
      }

      const projects = await client.query(
        `update projects set organization_id = null, updated_at = now()
         where organization_id = $1 returning id`,
        [organizationId],
      )
      const testSpaces = await client.query(
        `update test_spaces set organization_id = null, updated_at = now()
         where organization_id = $1 returning id`,
        [organizationId],
      )
      await client.query('delete from organizations where id = $1', [organizationId])
      await client.query('commit')
      response.json({
        deleted: true,
        detachedProjectCount: projects.rowCount ?? 0,
        detachedTestSpaceCount: testSpaces.rowCount ?? 0,
      })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }))

  router.post('/organizations/:organizationId/invitations', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationAdmin(response, organizationId, session.userId))) return
    if (String(process.env.FEISHU_DELIVERY_ENABLED ?? 'true').toLowerCase() === 'false') {
      response.status(503).json({ error: 'Feishu invitation delivery is disabled' })
      return
    }
    const email = normalizedEmail(request.body.email)
    if (!email || !email.includes('@')) {
      response.status(400).json({ error: 'A valid Feishu email is required' })
      return
    }
    const openId = await dependencies.resolveFeishuOpenIdByEmail(email)
    const existingMember = await query<{ id: string }>(
      `select m.user_id as id from organization_memberships m
       join users u on u.id = m.user_id
       where m.organization_id = $1 and m.status = 'active'
         and (u.email = $2 or u.feishu_user_id = $3) limit 1`,
      [organizationId, email, openId],
    )
    if (existingMember.rows[0]) {
      response.status(409).json({ error: 'User is already an organization member' })
      return
    }
    const inviter = await query<{ display_name: string; email: string }>(
      'select display_name, email from users where id = $1',
      [session.userId],
    )
    const organization = await query<{ name: string }>('select name from organizations where id = $1', [organizationId])
    const token = crypto.randomBytes(32).toString('base64url')
    const client = await pool.connect()
    let invitationId: number
    try {
      await client.query('begin')
      await client.query(
        `update organization_invitations set status = 'revoked', responded_at = now()
         where organization_id = $1 and target_email_lookup = $2 and status = 'pending'`,
        [organizationId, blindIndex(email)],
      )
      const invitation = await client.query<{ id: string }>(
        `insert into organization_invitations
          (organization_id, invited_by_user_id, target_email, target_email_lookup,
           target_open_id, token_hash, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + interval '72 hours') returning id`,
        [organizationId, session.userId, encryptText(email), blindIndex(email), openId, hashOrganizationInviteToken(token)],
      )
      invitationId = Number(invitation.rows[0].id)
      await writeAudit(client, organizationId!, session.userId, 'invitation.created', 'organization_invitation', String(invitationId), email)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    try {
      const sent = await dependencies.sendFeishuMessage({
        content: buildOrganizationInvitationCard({
          invitationId,
          inviterName: displayName(inviter.rows[0] ?? {}),
          organizationName: decryptText(organization.rows[0].name),
          token,
        }),
        msgType: 'interactive',
        receiveId: openId,
        receiveIdType: 'open_id',
      })
      await query(
        `update organization_invitations set feishu_message_id = $1, last_error = '' where id = $2`,
        [sent?.messageId ?? '', invitationId],
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Feishu delivery failed'
      await query(
        `update organization_invitations set status = 'delivery_failed', last_error = $1 where id = $2`,
        [message.slice(0, 500), invitationId],
      )
      response.status(502).json({ error: message })
      return
    }
    response.status(201).json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.post('/organizations/:organizationId/username-invitations', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationAdmin(response, organizationId, session.userId))) return
    const username = normalizedEmail(request.body.username)
    if (!username) {
      response.status(400).json({ error: 'Invite username is required' })
      return
    }
    const user = await query<{ id: string }>('select id from users where email = $1', [username])
    if (!user.rows[0]) {
      response.status(404).json({ error: 'Account not found' })
      return
    }
    const targetUserId = Number(user.rows[0].id)
    if (targetUserId === session.userId) {
      response.status(409).json({ error: 'You are already an organization member' })
      return
    }
    const activeMember = await query<{ user_id: string }>(
      `select user_id from organization_memberships
       where organization_id = $1 and user_id = $2 and status = 'active'`,
      [organizationId, targetUserId],
    )
    if (activeMember.rows[0]) {
      response.status(409).json({ error: 'User is already an organization member' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('begin')
      const membership = await client.query(
        `insert into organization_memberships
          (organization_id, user_id, access_role, status, invited_by_user_id, joined_at, removed_at)
         values ($1, $2, 'member', 'active', $3, now(), null)
         on conflict (organization_id, user_id) do update
           set access_role = case
                 when organization_memberships.access_role = 'owner' then 'owner'
                 else 'member'
               end,
               status = 'active',
               invited_by_user_id = excluded.invited_by_user_id,
               joined_at = now(),
               removed_at = null
         where organization_memberships.status <> 'active'
         returning user_id`,
        [organizationId, targetUserId, session.userId],
      )
      if (!membership.rows[0]) {
        await client.query('rollback')
        response.status(409).json({ error: 'User is already an organization member' })
        return
      }
      await writeAudit(client, organizationId!, session.userId, 'member.invited_by_username', 'user', String(targetUserId), username)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    response.status(201).json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.patch('/organizations/:organizationId/members/:userId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    const userId = positiveId(request.params.userId)
    const admin = await requireOrganizationAdmin(response, organizationId, session.userId)
    if (!admin || !userId) return
    const accessRole = request.body.accessRole
    if (!isOrganizationAccessRole(accessRole) || accessRole === 'owner') {
      response.status(400).json({ error: 'Member or administrator role is required' })
      return
    }
    const target = await query<{ access_role: OrganizationAccessRole }>(
      `select access_role from organization_memberships
       where organization_id = $1 and user_id = $2 and status = 'active'`,
      [organizationId, userId],
    )
    if (!target.rows[0] || target.rows[0].access_role === 'owner') {
      response.status(404).json({ error: 'Organization member not found' })
      return
    }
    if (admin.access_role === 'admin' && target.rows[0].access_role === 'admin') {
      response.status(403).json({ error: 'Only the organization owner can change another administrator' })
      return
    }
    await query(
      `update organization_memberships set access_role = $1
       where organization_id = $2 and user_id = $3 and status = 'active'`,
      [accessRole, organizationId, userId],
    )
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.delete('/organizations/:organizationId/members/:userId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    const userId = positiveId(request.params.userId)
    const admin = await requireOrganizationAdmin(response, organizationId, session.userId)
    if (!admin || !userId) return
    const target = await query<{ access_role: OrganizationAccessRole }>(
      `select access_role from organization_memberships
       where organization_id = $1 and user_id = $2 and status = 'active'`,
      [organizationId, userId],
    )
    if (!target.rows[0] || target.rows[0].access_role === 'owner') {
      response.status(409).json({ error: 'Organization owner cannot be removed' })
      return
    }
    if (admin.access_role === 'admin' && target.rows[0].access_role === 'admin') {
      response.status(403).json({ error: 'Only the organization owner can remove another administrator' })
      return
    }
    const ownedResources = await query<{ count: string }>(
      `select (
        (select count(*) from projects where organization_id = $1 and user_id = $2) +
        (select count(*) from test_spaces where organization_id = $1 and owner_user_id = $2)
      )::text as count`,
      [organizationId, userId],
    )
    if (Number(ownedResources.rows[0]?.count ?? 0) > 0) {
      response.status(409).json({ error: 'Transfer projects and test spaces owned by this member before removal' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query(
        `update todos set assignee_user_id = null, assigned_by_user_id = null, assigned_at = null
         where assignee_user_id = $1 and project_id in
           (select id from projects where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `update todos set watcher_user_id = null, watched_by_user_id = null, watched_at = null
         where watcher_user_id = $1 and project_id in
           (select id from projects where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `update todos set reviewer_user_id = null
         where reviewer_user_id = $1 and project_id in
           (select id from projects where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `update project_package_events set assignee_user_id = null, assigned_by_user_id = null, assigned_at = null
         where assignee_user_id = $1 and project_id in
           (select id from projects where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `insert into test_bug_comments (test_bug_id, author_user_id, content)
         select b.id, $3, $4 from test_bugs b
         join test_spaces s on s.id = b.test_space_id
         where s.organization_id = $2 and b.assignee_user_id = $1
           and b.status not in ('closed', 'rejected', 'duplicate')`,
        [userId, organizationId, session.userId, encryptText('负责人已移出组织，系统已清除指派。')],
      )
      await client.query(
        `update test_bugs b set assignee_user_id = null,
           status = case when b.status in ('assigned', 'in_progress', 'reopened') then 'confirmed' else b.status end,
           updated_at = now()
         from test_spaces s
         where s.id = b.test_space_id and s.organization_id = $2 and b.assignee_user_id = $1
           and b.status not in ('closed', 'rejected', 'duplicate')`,
        [userId, organizationId],
      )
      await client.query(
        `delete from project_memberships where invited_user_id = $1 and project_id in
           (select id from projects where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `delete from test_space_memberships where user_id = $1 and test_space_id in
           (select id from test_spaces where organization_id = $2)`,
        [userId, organizationId],
      )
      await client.query(
        `update organization_memberships set status = 'removed', removed_at = now()
         where organization_id = $1 and user_id = $2`,
        [organizationId, userId],
      )
      await writeAudit(client, organizationId!, session.userId, 'member.removed', 'user', String(userId))
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.post('/organizations/:organizationId/projects/:projectId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    const projectId = positiveId(request.params.projectId)
    if (!(await requireOrganizationMember(response, organizationId, session.userId)) || !projectId) return
    const outsideMembers = await query<{ count: string }>(
      `select count(*)::text as count from project_memberships pm
       where pm.project_id = $1 and pm.status in ('pending', 'active')
         and (pm.invited_user_id is null or not exists (
           select 1 from organization_memberships om
           where om.organization_id = $2 and om.user_id = pm.invited_user_id and om.status = 'active'
         ))`,
      [projectId, organizationId],
    )
    if (Number(outsideMembers.rows[0]?.count ?? 0) > 0) {
      response.status(409).json({ error: 'All active project members must join the organization first' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('begin')
      const updated = await client.query(
        `update projects set organization_id = $1, updated_at = now()
         where id = $2 and user_id = $3 and organization_id is null returning id`,
        [organizationId, projectId, session.userId],
      )
      if (!updated.rows[0]) {
        await client.query('rollback')
        response.status(404).json({ error: 'Owned personal project not found' })
        return
      }
      await client.query(
        `update project_invite_links set revoked_at = now()
         where project_id = $1 and revoked_at is null`,
        [projectId],
      )
      await writeAudit(client, organizationId!, session.userId, 'project.attached', 'project', String(projectId))
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.post('/organizations/:organizationId/test-spaces/:spaceId', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    const spaceId = positiveId(request.params.spaceId)
    if (!(await requireOrganizationMember(response, organizationId, session.userId)) || !spaceId) return
    const client = await pool.connect()
    try {
      await client.query('begin')
      const ownedSpace = await client.query<{ id: string }>(
        `select id from test_spaces
         where id = $1 and owner_user_id = $2 and organization_id is null
         for update`,
        [spaceId, session.userId],
      )
      if (!ownedSpace.rows[0]) {
        await client.query('rollback')
        response.status(404).json({ error: 'Owned personal test space not found' })
        return
      }
      const spaceMembers = await client.query<{ user_id: string }>(
        `select user_id from test_space_memberships
         where test_space_id = $1 and status in ('pending', 'active')
         order by user_id
         for share`,
        [spaceId],
      )
      const userIds = spaceMembers.rows.map((row) => Number(row.user_id))
      const organizationMembers = userIds.length > 0
        ? await client.query<{ user_id: string }>(
            `select user_id from organization_memberships
             where organization_id = $1 and user_id = any($2::bigint[]) and status = 'active'
             order by user_id
             for share`,
            [organizationId, userIds],
          )
        : { rows: [] }
      if (organizationMembers.rows.length !== userIds.length) {
        await client.query('rollback')
        response.status(409).json({ error: 'All active test-space members must join the organization first' })
        return
      }
      const updated = await client.query(
        `update test_spaces set organization_id = $1, updated_at = now()
         where id = $2 and owner_user_id = $3 and organization_id is null returning id`,
        [organizationId, spaceId, session.userId],
      )
      if (!updated.rows[0]) {
        await client.query('rollback')
        response.status(404).json({ error: 'Owned personal test space not found' })
        return
      }
      await client.query(
        `update test_space_invite_links set revoked_at = now()
         where test_space_id = $1 and revoked_at is null`,
        [spaceId],
      )
      await writeAudit(client, organizationId!, session.userId, 'test_space.attached', 'test_space', String(spaceId))
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.put('/organizations/:organizationId/weekly-reports/:weekStart', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationMember(response, organizationId, session.userId))) return
    const weekStart = normalizeOrganizationWeekStart(
      request.params.weekStart,
      await getOrganizationWeekStartsOn(organizationId!),
    )
    const content = String(request.body.content ?? '').trim().slice(0, 12_000)
    const status = request.body.status === 'submitted' ? 'submitted' : 'draft'
    if (!weekStart || (status === 'submitted' && !content)) {
      response.status(400).json({ error: 'Valid week and report content are required' })
      return
    }
    await query(
      `insert into organization_weekly_reports
        (organization_id, user_id, week_start, content, status, submitted_at)
       values ($1, $2, $3, $4, $5, case when $5 = 'submitted' then now() else null end)
       on conflict (organization_id, user_id, week_start) do update
         set content = excluded.content, status = excluded.status, updated_at = now(),
           submitted_at = case when excluded.status = 'submitted' then now() else null end`,
      [organizationId, session.userId, weekStart, encryptText(content), status],
    )
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.post('/organizations/:organizationId/weekly-summaries/:weekStart', asyncRoute(async (request, response) => {
    const session = await requireSession(request, response)
    if (!session) return
    const organizationId = positiveId(request.params.organizationId)
    if (!(await requireOrganizationAdmin(response, organizationId, session.userId))) return
    const weekStart = normalizeOrganizationWeekStart(
      request.params.weekStart,
      await getOrganizationWeekStartsOn(organizationId!),
    )
    if (!weekStart) {
      response.status(400).json({ error: 'Valid week is required' })
      return
    }
    const reports = await query<{
      content: string
      display_name: string
      email: string
    }>(
      `select r.content, u.email, u.display_name
       from organization_weekly_reports r join users u on u.id = r.user_id
       where r.organization_id = $1 and r.week_start = $2 and r.status = 'submitted'
       order by lower(coalesce(nullif(u.display_name, ''), u.email))`,
      [organizationId, weekStart],
    )
    if (reports.rows.length === 0) {
      response.status(409).json({ error: 'No submitted weekly reports are available for this week' })
      return
    }
    const source = reports.rows.map((report) => (
      `成员：${displayName(report)}\n周报：\n${decryptText(report.content)}`
    )).join('\n\n---\n\n')
    const generated = await dependencies.generateWeeklySummary(session.userId, source)
    if (!generated.message) {
      response.status(generated.status).json({ error: generated.error ?? 'AI summary failed' })
      return
    }
    await query(
      `insert into organization_weekly_summaries
        (organization_id, week_start, requested_by_user_id, content, source_report_count)
       values ($1, $2, $3, $4, $5)
       on conflict (organization_id, week_start) do update
         set requested_by_user_id = excluded.requested_by_user_id,
           content = excluded.content, source_report_count = excluded.source_report_count,
           updated_at = now()`,
      [organizationId, weekStart, session.userId, encryptText(generated.message), reports.rows.length],
    )
    response.json(await getOrganizationDetail(organizationId!, session.userId))
  }))

  router.post('/integrations/feishu/card-actions', asyncRoute(async (request, response) => {
    const body = request.body && typeof request.body === 'object'
      ? request.body as Record<string, unknown>
      : {}
    const challenge = String(body.challenge ?? '')
    const header = body.header && typeof body.header === 'object'
      ? body.header as Record<string, unknown>
      : {}
    const event = body.event && typeof body.event === 'object'
      ? body.event as Record<string, unknown>
      : body
    const expectedToken = String(process.env.FEISHU_VERIFICATION_TOKEN ?? '')
    const eventToken = String(header.token ?? body.token ?? '')
    if (!expectedToken || eventToken !== expectedToken) {
      response.status(401).json({ error: 'Invalid Feishu verification token' })
      return
    }
    if (challenge) {
      response.json({ challenge })
      return
    }
    const signature = String(request.headers['x-lark-signature'] ?? '')
    const timestamp = String(request.headers['x-lark-request-timestamp'] ?? '')
    const nonce = String(request.headers['x-lark-request-nonce'] ?? '')
    const rawBody = String((request as express.Request & { rawBody?: string }).rawBody ?? '')
    if (!signature || !isFreshFeishuTimestamp(timestamp) || !verifyFeishuCardSignature({
      body: rawBody,
      nonce,
      signature,
      timestamp,
      verificationToken: expectedToken,
    })) {
      response.status(401).json({ error: 'Invalid Feishu callback signature' })
      return
    }
    const eventType = String(header.event_type ?? body.event_type ?? '')
    if (eventType !== 'card.action.trigger') {
      response.json({ ok: true, ignored: true })
      return
    }
    const action = event.action && typeof event.action === 'object'
      ? event.action as Record<string, unknown>
      : {}
    const value = action.value && typeof action.value === 'object'
      ? action.value as Record<string, unknown>
      : {}
    const operator = event.operator && typeof event.operator === 'object'
      ? event.operator as Record<string, unknown>
      : {}
    const invitationId = positiveId(value.invitationId)
    const inviteToken = String(value.token ?? '')
    const inviteAction = String(value.action ?? '')
    const operatorOpenId = String(operator.open_id ?? '')
    const tenantKey = String(operator.tenant_key ?? header.tenant_key ?? '')
    const eventId = String(header.event_id ?? body.event_id ?? '')
    if (!invitationId || !inviteToken || !operatorOpenId || !tenantKey || !eventId || ![
      'organization_invitation_accept',
      'organization_invitation_decline',
    ].includes(inviteAction)) {
      response.status(400).json({ error: 'Invalid organization invitation action' })
      return
    }
    const client = await pool.connect()
    try {
      await client.query('begin')
      const duplicate = await client.query('select event_id from organization_callback_events where event_id = $1', [eventId])
      if (duplicate.rows[0]) {
        await client.query('commit')
        response.json({ toast: { type: 'success', content: '邀请已经处理' } })
        return
      }
      const invitation = await client.query<{
        organization_id: string
        status: string
        target_email: string
        target_open_id: string
        token_hash: string
        expires_at: Date
      }>(
        `select organization_id, status, target_email, target_open_id, token_hash, expires_at
         from organization_invitations where id = $1 for update`,
        [invitationId],
      )
      const row = invitation.rows[0]
      if (!row || row.status !== 'pending') {
        await client.query('rollback')
        response.json({ toast: { type: 'info', content: '邀请已失效或已经处理' } })
        return
      }
      if (row.expires_at.getTime() <= Date.now()) {
        await client.query(`update organization_invitations set status = 'expired' where id = $1`, [invitationId])
        await client.query('commit')
        response.json({ toast: { type: 'warning', content: '邀请已过期' } })
        return
      }
      if (row.target_open_id !== operatorOpenId || row.token_hash !== hashOrganizationInviteToken(inviteToken)) {
        await client.query('rollback')
        response.status(403).json({ error: 'Invitation identity does not match' })
        return
      }
      const organizationId = Number(row.organization_id)
      const organization = await client.query<{ feishu_tenant_key: string; name: string }>(
        'select feishu_tenant_key, name from organizations where id = $1 for update',
        [organizationId],
      )
      const boundTenant = organization.rows[0]?.feishu_tenant_key ?? ''
      if (boundTenant && boundTenant !== tenantKey) {
        await client.query('rollback')
        response.status(403).json({ error: 'Feishu tenant does not match the organization' })
        return
      }
      if (!boundTenant && tenantKey) {
        await client.query('update organizations set feishu_tenant_key = $1 where id = $2', [tenantKey, organizationId])
      }
      let respondedByUserId: number | null = null
      if (inviteAction === 'organization_invitation_accept') {
        const email = normalizedEmail(decryptText(row.target_email))
        const matchedUsers = await client.query<{
          feishu_user_id: string
          id: string
        }>(
          `select id, feishu_user_id from users where feishu_user_id = $1 or email = $2 for update`,
          [operatorOpenId, email],
        )
        if (matchedUsers.rows.length > 1 || (matchedUsers.rows[0]?.feishu_user_id && matchedUsers.rows[0].feishu_user_id !== operatorOpenId)) {
          await client.query('rollback')
          response.status(409).json({ error: 'Feishu identity conflicts with an existing account' })
          return
        }
        if (matchedUsers.rows[0]) {
          respondedByUserId = Number(matchedUsers.rows[0].id)
          await client.query(
            `update users set feishu_user_id = $1, feishu_receive_id_type = 'open_id',
              feishu_email = case when feishu_email = '' then $2 else feishu_email end
             where id = $3`,
            [operatorOpenId, email, respondedByUserId],
          )
        } else {
          const created = await client.query<{ id: string }>(
            `insert into users
              (email, password_hash, display_name, feishu_email, feishu_user_id, feishu_receive_id_type)
             values ($1, '', $2, $1, $3, 'open_id') returning id`,
            [email, email.split('@')[0], operatorOpenId],
          )
          respondedByUserId = Number(created.rows[0].id)
        }
        await client.query(
          `insert into user_roles (user_id, role)
           select $1, 'developer' where not exists (select 1 from user_roles where user_id = $1)
           on conflict do nothing`,
          [respondedByUserId],
        )
        await client.query(
          `insert into organization_memberships
            (organization_id, user_id, access_role, status, invited_by_user_id, joined_at, removed_at)
           select $1, $2, 'member', 'active', invited_by_user_id, now(), null
           from organization_invitations where id = $3
           on conflict (organization_id, user_id) do update
             set access_role = case when organization_memberships.access_role = 'owner' then 'owner' else 'member' end,
               status = 'active', removed_at = null, joined_at = now()`,
          [organizationId, respondedByUserId, invitationId],
        )
      }
      await client.query(
        `update organization_invitations
         set status = $1, responded_by_user_id = $2, responded_at = now(), target_tenant_key = $3
         where id = $4`,
        [inviteAction === 'organization_invitation_accept' ? 'accepted' : 'declined', respondedByUserId, tenantKey, invitationId],
      )
      await client.query(
        `insert into organization_callback_events (event_id, invitation_id) values ($1, $2)`,
        [eventId, invitationId],
      )
      await writeAudit(
        client,
        organizationId,
        respondedByUserId,
        inviteAction === 'organization_invitation_accept' ? 'invitation.accepted' : 'invitation.declined',
        'organization_invitation',
        String(invitationId),
      )
      await client.query('commit')
      const invitationStatus = inviteAction === 'organization_invitation_accept'
        ? 'accepted'
        : 'declined'
      response.json({
        card: buildOrganizationInvitationStatusCard({
          organizationName: decryptText(organization.rows[0].name),
          status: invitationStatus,
        }),
        toast: {
          type: invitationStatus === 'accepted' ? 'success' : 'info',
          content: invitationStatus === 'accepted' ? '已加入组织' : '已拒绝邀请',
        },
      })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }))

  return router
}
