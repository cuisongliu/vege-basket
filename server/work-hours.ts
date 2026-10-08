import express from 'express'
import type { PoolClient, QueryResultRow } from 'pg'
import { pool, query } from './db.ts'
import { decryptText, encryptText } from './crypto.ts'
import { managedOrganizationReadScopeSql } from './organization-scope.ts'

export const WORK_MINUTES_DAY_LIMIT = 24 * 60
export const WORK_MINUTES_STEP = 60

export type WorkHourStatus = 'pending' | 'submitted' | 'confirmed'

export function parseWorkMinutes(value: unknown, options: { required?: boolean } = {}) {
  const required = options.required ?? true
  if (value == null || value === '') {
    if (!required) return null
    throw new WorkHoursError('WORK_MINUTES_REQUIRED', '工时不能为空。', 400)
  }
  const minutes = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > WORK_MINUTES_DAY_LIMIT) {
    throw new WorkHoursError('WORK_MINUTES_INVALID', '工时必须是 1 小时到 24 小时之间的整数小时。', 400)
  }
  if (minutes % WORK_MINUTES_STEP !== 0) {
    throw new WorkHoursError('WORK_MINUTES_STEP', '工时必须按整数小时填写。', 400)
  }
  return minutes
}

export function parseWorkDate(value: unknown, fallback = new Date()) {
  const date = value == null || value === ''
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(fallback)
    : String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new WorkHoursError('WORK_DATE_INVALID', '工作日期必须使用 YYYY-MM-DD。', 400)
  }
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new WorkHoursError('WORK_DATE_INVALID', '工作日期不是有效的日历日期。', 400)
  }
  return date
}

export function parseWorkHourEntryIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new WorkHoursError('WORK_HOUR_ENTRY_IDS_INVALID', '请选择 1 到 100 条工时记录。', 400)
  }
  const ids = value.map(positiveId)
  if (ids.some((id) => id == null) || new Set(ids).size !== ids.length) {
    throw new WorkHoursError('WORK_HOUR_ENTRY_IDS_INVALID', '工时记录 ID 必须是互不重复的正整数。', 400)
  }
  return ids as number[]
}

export class WorkHoursError extends Error {
  public readonly code: string
  public readonly status: number
  constructor(
    code: string,
    message: string,
    status = 400,
  ) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'WorkHoursError'
  }
}

type WorkHoursRouterOptions = {
  getUserId?: (request: express.Request) => Promise<number | null>
}

type WorkHourRow = QueryResultRow & {
  id: string
  project_id: string
  todo_id: string
  user_id: string
  work_date: string | Date
  minutes: number
  status: WorkHourStatus
  returned_at?: Date | string | null
  description: string
  created_at: Date
  updated_at: Date
  project_name?: string
  todo_title?: string
  user_name?: string
  estimated_work_minutes?: number | null
  project_created_at?: Date | string
}

type WorkHourTaskRow = QueryResultRow & {
  id: string
  title: string
  assignee_user_id: string | null
  assignee_name: string | null
  done: boolean
  confirmation_status: string
  estimated_work_minutes: number | null
  confirmed_minutes: string
  pending_minutes: string
}

function sendWorkHoursError(response: express.Response, error: unknown) {
  if (error instanceof WorkHoursError) {
    response.status(error.status).json({ error: error.message, code: error.code })
    return true
  }
  return false
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

function formatDate(value: string | Date) {
  if (typeof value === 'string') return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

function formatDateTime(value: Date) {
  return value.toISOString()
}

function parseListPagination(queryParams: express.Request['query']) {
  const rawOffset = Number(queryParams.offset ?? 0)
  const rawLimit = Number(queryParams.limit ?? 10)
  return {
    offset: Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
    limit: Number.isSafeInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 10,
  }
}

function filterWorkHourEntries(entries: WorkHourRow[], rawQuery: unknown) {
  const queryText = typeof rawQuery === 'string' ? rawQuery.trim().toLocaleLowerCase('zh-CN') : ''
  if (!queryText) return entries
  return entries.filter((entry) => [
    entry.description ? decryptText(entry.description) : '',
    entry.user_name ? decryptText(entry.user_name) : '',
    entry.project_name ? decryptText(entry.project_name) : '',
    entry.todo_title ? decryptText(entry.todo_title) : '',
    formatDate(entry.work_date),
    entry.returned_at ? '已退回' : entry.status === 'confirmed' ? '已确认' : entry.status === 'submitted' ? '待确认' : '未提交',
  ].join(' ').toLocaleLowerCase('zh-CN').includes(queryText))
}

function paginateWorkHourEntries(entries: WorkHourRow[], pagination: { offset: number; limit: number }) {
  return {
    entries: entries.slice(pagination.offset, pagination.offset + pagination.limit),
    pagination: { ...pagination, total: entries.length },
  }
}

const WORK_HOUR_SEARCH_CANDIDATE_LIMIT = 2000

type WorkHourFilters = {
  organizationId?: number
  projectId?: number
  todoId?: number
  startDate?: string
  endDate?: string
  status?: WorkHourStatus | 'all'
  onlyUser?: boolean
}

function buildWorkHourScope(userId: number, filters: WorkHourFilters) {
  const values: unknown[] = [userId]
  const conditions = [
    filters.onlyUser === false ? 'true' : 'entry.user_id = $1',
    filters.organizationId ? `p.organization_id = $${values.push(filters.organizationId)}` : 'true',
    filters.projectId ? `entry.project_id = $${values.push(filters.projectId)}` : 'true',
    filters.todoId ? `entry.todo_id = $${values.push(filters.todoId)}` : 'true',
    filters.startDate ? `entry.work_date >= $${values.push(filters.startDate)}::date` : 'true',
    filters.endDate ? `entry.work_date <= $${values.push(filters.endDate)}::date` : 'true',
    filters.status === 'pending'
      ? "entry.status in ('pending', 'submitted')"
      : filters.status === 'confirmed' ? "entry.status = 'confirmed'" : 'true',
    `(
      p.user_id = $1
      or exists (select 1 from project_memberships pm where pm.project_id = p.id and pm.invited_user_id = $1 and pm.status = 'active')
      or exists (select 1 from organization_memberships om where om.organization_id = p.organization_id and om.user_id = $1 and om.status = 'active')
      or ${managedOrganizationReadScopeSql('p.organization_id', '$1')}
    )`,
  ]
  return { values, where: conditions.join(' and ') }
}

async function loadWorkHourPage(userId: number, filters: WorkHourFilters, rawQuery: unknown, pagination: { offset: number; limit: number }) {
  const queryText = typeof rawQuery === 'string' ? rawQuery.trim() : ''
  if (queryText) {
    const candidates = await loadEntries(userId, filters, WORK_HOUR_SEARCH_CANDIDATE_LIMIT + 1)
    const matched = filterWorkHourEntries(candidates, queryText)
    return paginateWorkHourEntries(matched, pagination)
  }
  const scope = buildWorkHourScope(userId, filters)
  const count = await query<{ total: string }>(
    `select count(*)::bigint as total
       from todo_work_hours entry
       join projects p on p.id = entry.project_id
       join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
       join users u on u.id = entry.user_id
      where ${scope.where}`,
    scope.values,
  )
  const pageValues = [...scope.values, pagination.limit, pagination.offset]
  const result = await query<WorkHourRow>(
    `select entry.id, entry.project_id, entry.todo_id, entry.user_id, entry.work_date,
            entry.minutes, entry.status, entry.returned_at, entry.description, entry.created_at, entry.updated_at,
            p.name as project_name, t.title as todo_title, u.display_name as user_name,
            t.estimated_work_minutes
       from todo_work_hours entry
       join projects p on p.id = entry.project_id
       join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
       join users u on u.id = entry.user_id
      where ${scope.where}
      order by entry.work_date desc, entry.created_at desc, entry.id desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues,
  )
  return { entries: result.rows, pagination: { ...pagination, total: Number(count.rows[0]?.total ?? 0) } }
}

async function loadWorkHourSummary(userId: number, filters: WorkHourFilters) {
  const scope = buildWorkHourScope(userId, filters)
  const [totals, byDate, byProject, byUser] = await Promise.all([
    query<{ total_minutes: string; confirmed_minutes: string; pending_minutes: string; task_count: string; project_count: string }>(
      `select coalesce(sum(entry.minutes), 0)::bigint as total_minutes,
              coalesce(sum(entry.minutes) filter (where entry.status = 'confirmed'), 0)::bigint as confirmed_minutes,
              coalesce(sum(entry.minutes) filter (where entry.status <> 'confirmed'), 0)::bigint as pending_minutes,
              count(distinct entry.todo_id)::int as task_count,
              count(distinct entry.project_id)::int as project_count
         from todo_work_hours entry
         join projects p on p.id = entry.project_id
         join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
         join users u on u.id = entry.user_id
        where ${scope.where}`,
      scope.values,
    ),
    query<{ date: string | Date; minutes: string; confirmed_minutes: string; pending_minutes: string }>(
      `select entry.work_date as date,
              coalesce(sum(entry.minutes), 0)::bigint as minutes,
              coalesce(sum(entry.minutes) filter (where entry.status = 'confirmed'), 0)::bigint as confirmed_minutes,
              coalesce(sum(entry.minutes) filter (where entry.status <> 'confirmed'), 0)::bigint as pending_minutes
         from todo_work_hours entry
         join projects p on p.id = entry.project_id
         join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
         join users u on u.id = entry.user_id
        where ${scope.where}
        group by entry.work_date
        order by entry.work_date asc`,
      scope.values,
    ),
    query<{ project_id: string; project_name: string; minutes: string; confirmed_minutes: string; pending_minutes: string; returned_minutes: string; task_count: string }>(
      `select entry.project_id, p.name as project_name,
              coalesce(sum(entry.minutes), 0)::bigint as minutes,
              coalesce(sum(entry.minutes) filter (where entry.status = 'confirmed'), 0)::bigint as confirmed_minutes,
              coalesce(sum(entry.minutes) filter (where entry.status <> 'confirmed'), 0)::bigint as pending_minutes,
              coalesce(sum(entry.minutes) filter (where entry.returned_at is not null), 0)::bigint as returned_minutes,
              count(distinct entry.todo_id)::int as task_count
         from todo_work_hours entry
         join projects p on p.id = entry.project_id
         join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
         join users u on u.id = entry.user_id
        where ${scope.where}
        group by entry.project_id, p.name
        order by minutes desc, entry.project_id asc`,
      scope.values,
    ),
    query<{ user_id: string; user_name: string; minutes: string; confirmed_minutes: string; pending_minutes: string; returned_minutes: string; returned_count: string; project_count: string; task_count: string }>(
      `select entry.user_id, u.display_name as user_name,
              coalesce(sum(entry.minutes), 0)::bigint as minutes,
              coalesce(sum(entry.minutes) filter (where entry.status = 'confirmed'), 0)::bigint as confirmed_minutes,
              coalesce(sum(entry.minutes) filter (where entry.status <> 'confirmed'), 0)::bigint as pending_minutes,
              coalesce(sum(entry.minutes) filter (where entry.returned_at is not null), 0)::bigint as returned_minutes,
              count(*) filter (where entry.returned_at is not null)::int as returned_count,
              count(distinct entry.project_id)::int as project_count,
              count(distinct entry.todo_id)::int as task_count
         from todo_work_hours entry
         join projects p on p.id = entry.project_id
         join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
         join users u on u.id = entry.user_id
        where ${scope.where}
        group by entry.user_id, u.display_name
        order by minutes desc, entry.user_id asc`,
      scope.values,
    ),
  ])
  const totalMinutes = Number(totals.rows[0]?.total_minutes ?? 0)
  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    confirmedMinutes: Number(totals.rows[0]?.confirmed_minutes ?? 0),
    pendingMinutes: Number(totals.rows[0]?.pending_minutes ?? 0),
    projectCount: Number(totals.rows[0]?.project_count ?? 0),
    taskCount: Number(totals.rows[0]?.task_count ?? 0),
    byProject: byProject.rows.map((row) => ({
      projectId: Number(row.project_id),
      projectName: row.project_name ? decryptText(row.project_name) : '未命名项目',
      minutes: Number(row.minutes),
      pendingMinutes: Number(row.pending_minutes),
      confirmedMinutes: Number(row.confirmed_minutes),
      returnedMinutes: Number(row.returned_minutes),
      taskCount: Number(row.task_count),
    })),
    byDate: byDate.rows.map((row) => {
      const minutes = Number(row.minutes)
      return { date: formatDate(row.date), minutes, hours: minutes / 60, pendingMinutes: Number(row.pending_minutes), confirmedMinutes: Number(row.confirmed_minutes) }
    }),
    byUser: byUser.rows.map((row) => ({
      userId: Number(row.user_id),
      userName: row.user_name ? decryptText(row.user_name) : '未记录',
      minutes: Number(row.minutes),
      pendingMinutes: Number(row.pending_minutes),
      confirmedMinutes: Number(row.confirmed_minutes),
      returnedMinutes: Number(row.returned_minutes),
      returnedCount: Number(row.returned_count),
      projectCount: Number(row.project_count),
      taskCount: Number(row.task_count),
    })),
  }
}

function serializeEntry(row: WorkHourRow) {
  return {
    id: Number(row.id),
    projectId: Number(row.project_id),
    todoId: Number(row.todo_id),
    userId: Number(row.user_id),
    workDate: formatDate(row.work_date),
    minutes: Number(row.minutes),
    hours: Number(row.minutes) / 60,
    status: row.status,
    returnedAt: row.returned_at ? formatDateTime(new Date(row.returned_at)) : null,
    description: row.description ? decryptText(row.description) : '',
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    projectName: row.project_name ? decryptText(row.project_name) : undefined,
    todoTitle: row.todo_title ? decryptText(row.todo_title) : undefined,
    userName: row.user_name ? decryptText(row.user_name) : undefined,
    estimatedWorkMinutes: row.estimated_work_minutes == null ? null : Number(row.estimated_work_minutes),
  }
}

async function sessionUserId(request: express.Request) {
  const authorization = request.header('authorization') ?? ''
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
  if (!token) return null
  const result = await query<{ user_id: string }>(
    `select sessions.user_id
       from sessions join users on users.id = sessions.user_id and users.account_status = 'active'
      where sessions.token = $1 and sessions.expires_at > now()`,
    [token],
  )
  return result.rows[0] ? Number(result.rows[0].user_id) : null
}

async function requireUser(request: express.Request, response: express.Response, getUserId: WorkHoursRouterOptions['getUserId']) {
  const userId = getUserId ? await getUserId(request) : await sessionUserId(request)
  if (!userId) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return userId
}

async function requireWorkHoursRole(userId: number) {
  const result = await query<{ allowed: boolean }>(
    `select exists (
       select 1 from user_roles
        where user_id = $1
          and role in ('developer', 'tester', 'organization_admin')
     ) as allowed`,
    [userId],
  )
  if (!result.rows[0]?.allowed) throw new WorkHoursError('WORK_HOURS_ROLE_REQUIRED', '当前账号没有工时权限。', 403)
}

async function lockWorkHoursRole(client: PoolClient, userId: number) {
  const result = await client.query<{ role: string }>(
    `select role
       from user_roles
      where user_id = $1
        and role in ('developer', 'tester', 'organization_admin')
      for update`,
    [userId],
  )
  if (result.rows.length === 0) {
    throw new WorkHoursError('WORK_HOURS_ROLE_REQUIRED', '当前账号没有工时权限。', 403)
  }
  return result.rows.map((row) => row.role)
}

async function lockTodoOrganization(client: PoolClient, todoId: number, userId: number) {
  const organizationResult = await client.query<{ organization_id: string | null }>(
    `select p.organization_id
       from todos t
       join projects p on p.id = t.project_id
      where t.id = $1`,
    [todoId],
  )
  const organizationId = organizationResult.rows[0]?.organization_id
    ? Number(organizationResult.rows[0].organization_id)
    : null
  if (!organizationId) return null
  await client.query('select id from organizations where id = $1 for update', [organizationId])
  const managerResult = await client.query<{ membership_user_id: string; role_user_id: string }>(
    `select membership.user_id as membership_user_id, role.user_id as role_user_id
       from organization_memberships membership
       join user_roles role
         on role.user_id = membership.user_id
        and role.role = 'organization_admin'
      where membership.organization_id = $1
        and membership.user_id = $2
        and membership.status = 'active'
        and membership.access_role in ('owner', 'admin')
      for update of membership, role`,
    [organizationId, userId],
  )
  return { organizationId, isManager: managerResult.rows.length > 0 }
}

async function managedOrganization(userId: number, organizationId: number) {
  const result = await query<{ id: string }>(
    `select organization.id
       from organizations organization
       join organization_memberships membership
         on membership.organization_id = organization.id
        and membership.user_id = $2
        and membership.status = 'active'
        and membership.access_role in ('owner', 'admin')
       join user_roles role
         on role.user_id = $2 and role.role = 'organization_admin'
      where organization.id = $1`,
    [organizationId, userId],
  )
  return Boolean(result.rows[0])
}

async function managedProject(userId: number, projectId: number, client?: PoolClient) {
  const run = client ? client.query.bind(client) : query
  const result = await run<{
    id: string
    organization_id: string | null
    can_manage: boolean
  }>(
    `select p.id, p.organization_id,
            ${managedOrganizationReadScopeSql('p.organization_id', '$2')} as can_manage
       from projects p where p.id = $1`,
    [projectId, userId],
  )
  const row = result.rows[0]
  if (!row || !row.organization_id || !row.can_manage) return null
  return { id: Number(row.id), organizationId: Number(row.organization_id) }
}

async function projectMember(client: PoolClient, projectId: number, userId: number) {
  const result = await client.query<{ owner_user_id: string; member_id: string | null }>(
    `select p.user_id as owner_user_id, pm.id as member_id
       from projects p
       left join project_memberships pm
         on pm.project_id = p.id and pm.invited_user_id = $2 and pm.status = 'active'
      where p.id = $1 for share of p`,
    [projectId, userId],
  )
  const row = result.rows[0]
  return Boolean(row && (Number(row.owner_user_id) === userId || row.member_id))
}

async function organizationMember(client: PoolClient, organizationId: number, userId: number) {
  const result = await client.query(
    `select 1
       from organization_memberships
      where organization_id = $1
        and user_id = $2
        and status = 'active'
      for key share`,
    [organizationId, userId],
  )
  return result.rows.length > 0
}

async function getTodoForWork(client: PoolClient, todoId: number, userId: number, lock = false) {
  const result = await client.query<{
    id: string
    project_id: string
    organization_id: string | null
    owner_user_id: string
    assignee_user_id: string | null
    created_by_user_id: string | null
    project_created_at: Date | string
    done: boolean
    confirmation_status: string
    needs_revision: boolean
    creator_is_manager: boolean
    title: string
    due_date: Date | string
    priority: 'high' | 'medium' | 'low'
  }>(
    `select t.id, t.project_id, p.organization_id, p.user_id as owner_user_id,
            t.assignee_user_id, t.created_by_user_id, t.done, t.confirmation_status,
            t.needs_revision, t.title, t.due_date, t.priority,
            (p.created_at at time zone 'Asia/Shanghai')::date::text as project_created_at,
            ${managedOrganizationReadScopeSql('p.organization_id', '$2')} as creator_is_manager
       from todos t join projects p on p.id = t.project_id
      where t.id = $1 ${lock ? 'for update of t' : ''}`,
    [todoId, userId],
  )
  return result.rows[0] ?? null
}

async function insertWorkHoursActivityEvent(client: PoolClient, todo: Awaited<ReturnType<typeof getTodoForWork>>, actorUserId: number, eventType: 'completed' | 'reopened' | 'rejected' | 'work_hours_added' | 'work_hours_updated' | 'work_hours_deleted' | 'work_hours_submitted') {
  if (!todo) return
  await client.query(
    `insert into todo_activity_events (
       project_id, todo_id, actor_user_id, assignee_user_id, event_type, title, due_date, priority
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      Number(todo.project_id),
      Number(todo.id),
      actorUserId,
      todo.assignee_user_id ? Number(todo.assignee_user_id) : null,
      eventType,
      encryptText(decryptText(todo.title)),
      formatDate(todo.due_date),
      todo.priority,
    ],
  )
}

async function loadEntries(userId: number, filters: WorkHourFilters, maxRows?: number) {
  const scope = buildWorkHourScope(userId, filters)
  const values = [...scope.values]
  const limitSql = maxRows == null ? '' : ` limit $${values.push(maxRows)}`
  const result = await query<WorkHourRow>(
    `select entry.id, entry.project_id, entry.todo_id, entry.user_id, entry.work_date,
            entry.minutes, entry.status, entry.returned_at, entry.description, entry.created_at, entry.updated_at,
            p.name as project_name, t.title as todo_title, u.display_name as user_name,
            t.estimated_work_minutes
       from todo_work_hours entry
       join projects p on p.id = entry.project_id
       join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
       join users u on u.id = entry.user_id
      where ${scope.where}
      order by entry.work_date desc, entry.created_at desc, entry.id desc${limitSql}`,
    values,
  )
  return result.rows
}

function summary(entries: WorkHourRow[]) {
  const byProject = new Map<number, { projectId: number; projectName: string; minutes: number; pendingMinutes: number; confirmedMinutes: number; returnedMinutes: number; taskCount: number }>()
  const projectTasks = new Set<string>()
  const byDate = new Map<string, { minutes: number; pendingMinutes: number; confirmedMinutes: number }>()
  const byUser = new Map<number, { userId: number; userName: string; minutes: number; pendingMinutes: number; confirmedMinutes: number; returnedMinutes: number; returnedCount: number; projects: Set<number>; tasks: Set<string> }>()
  for (const entry of entries) {
    const projectId = Number(entry.project_id)
    const project = byProject.get(projectId) ?? {
      projectId,
      projectName: entry.project_name ? decryptText(entry.project_name) : '未命名项目',
      minutes: 0,
      pendingMinutes: 0,
      confirmedMinutes: 0,
      returnedMinutes: 0,
      taskCount: 0,
    }
    const projectTaskKey = `${projectId}:${entry.todo_id}`
    if (!projectTasks.has(projectTaskKey)) {
      projectTasks.add(projectTaskKey)
      project.taskCount += 1
    }
    project.minutes += Number(entry.minutes)
    if (entry.status !== 'confirmed') project.pendingMinutes += Number(entry.minutes)
    else project.confirmedMinutes += Number(entry.minutes)
    if (entry.returned_at) project.returnedMinutes += Number(entry.minutes)
    byProject.set(projectId, project)
    const date = formatDate(entry.work_date)
    const dateSummary = byDate.get(date) ?? { minutes: 0, pendingMinutes: 0, confirmedMinutes: 0 }
    dateSummary.minutes += Number(entry.minutes)
    if (entry.status !== 'confirmed') dateSummary.pendingMinutes += Number(entry.minutes)
    else dateSummary.confirmedMinutes += Number(entry.minutes)
    byDate.set(date, dateSummary)
    const userId = Number(entry.user_id)
    const user = byUser.get(userId) ?? { userId, userName: entry.user_name ? decryptText(entry.user_name) : '未记录', minutes: 0, pendingMinutes: 0, confirmedMinutes: 0, returnedMinutes: 0, returnedCount: 0, projects: new Set<number>(), tasks: new Set<string>() }
    user.minutes += Number(entry.minutes)
    user.projects.add(projectId)
    user.tasks.add(entry.todo_id)
    if (entry.status !== 'confirmed') user.pendingMinutes += Number(entry.minutes)
    else user.confirmedMinutes += Number(entry.minutes)
    if (entry.returned_at) {
      user.returnedMinutes += Number(entry.minutes)
      user.returnedCount += 1
    }
    byUser.set(userId, user)
  }
  const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.minutes), 0)
  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    confirmedMinutes: entries.filter((entry) => entry.status === 'confirmed').reduce((sum, entry) => sum + Number(entry.minutes), 0),
    pendingMinutes: entries.filter((entry) => entry.status !== 'confirmed').reduce((sum, entry) => sum + Number(entry.minutes), 0),
    projectCount: byProject.size,
    taskCount: new Set(entries.map((entry) => entry.todo_id)).size,
    byProject: [...byProject.values()].sort((a, b) => b.minutes - a.minutes),
    byDate: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value, hours: value.minutes / 60 })),
    byUser: [...byUser.values()].sort((a, b) => b.minutes - a.minutes).map(({ projects, tasks, ...user }) => ({ ...user, projectCount: projects.size, taskCount: tasks.size })),
  }
}

async function loadTaskSummaries(projectId: number, startDate?: string, endDate?: string, status: WorkHourStatus | 'all' = 'all') {
  const result = await query<WorkHourTaskRow>(
    `select t.id, t.title, t.assignee_user_id, assignee.display_name as assignee_name,
            t.done, t.confirmation_status, t.estimated_work_minutes,
            coalesce(sum(case when e.status = 'confirmed' then e.minutes else 0 end), 0)::bigint as confirmed_minutes,
            coalesce(sum(case when e.status <> 'confirmed' then e.minutes else 0 end), 0)::bigint as pending_minutes
       from todos t
       left join users assignee on assignee.id = t.assignee_user_id
       left join todo_work_hours e
         on e.todo_id = t.id
        and ($2::date is null or e.work_date >= $2::date)
        and ($3::date is null or e.work_date <= $3::date)
        and ($4::text = 'all' or ($4::text = 'pending' and e.status in ('pending', 'submitted')) or e.status = $4::text)
      where t.project_id = $1
      group by t.id, assignee.display_name
      order by t.done asc, t.updated_at desc, t.id desc`,
    [projectId, startDate ?? null, endDate ?? null, status],
  )
  return result.rows.map((row) => {
    const confirmedMinutes = Number(row.confirmed_minutes)
    const pendingMinutes = Number(row.pending_minutes)
    return {
      taskId: Number(row.id),
      title: decryptText(row.title),
      assigneeName: row.assignee_name ? decryptText(row.assignee_name) : undefined,
      assigneeUserId: row.assignee_user_id == null ? null : Number(row.assignee_user_id),
      done: row.done,
      confirmationStatus: row.confirmation_status,
      estimatedMinutes: row.estimated_work_minutes == null ? null : Number(row.estimated_work_minutes),
      confirmedMinutes,
      pendingMinutes,
      totalMinutes: confirmedMinutes + pendingMinutes,
    }
  })
}

async function loadOrganizationProjectSummaries(organizationId: number, startDate?: string, endDate?: string, status: WorkHourStatus | 'all' = 'all') {
  const result = await query<QueryResultRow & {
    project_id: string
    project_name: string
    task_count: string
    estimated_minutes: string | null
    confirmed_minutes: string
    pending_minutes: string
    returned_minutes: string
  }>(
    `select p.id as project_id, p.name as project_name,
            coalesce(tasks.task_count, 0)::int as task_count,
            tasks.estimated_minutes,
            coalesce(hours.confirmed_minutes, 0)::bigint as confirmed_minutes,
            coalesce(hours.pending_minutes, 0)::bigint as pending_minutes,
            coalesce(hours.returned_minutes, 0)::bigint as returned_minutes
       from projects p
       left join lateral (
         select count(*)::int as task_count,
                sum(t.estimated_work_minutes)::bigint as estimated_minutes
           from todos t where t.project_id = p.id
       ) tasks on true
       left join lateral (
         select sum(case when e.status = 'confirmed' then e.minutes else 0 end)::bigint as confirmed_minutes,
                sum(case when e.status <> 'confirmed' then e.minutes else 0 end)::bigint as pending_minutes,
                sum(case when e.returned_at is not null then e.minutes else 0 end)::bigint as returned_minutes
           from todo_work_hours e
          where e.project_id = p.id
            and ($2::date is null or e.work_date >= $2::date)
            and ($3::date is null or e.work_date <= $3::date)
            and ($4::text = 'all' or ($4::text = 'pending' and e.status in ('pending', 'submitted')) or e.status = $4::text)
       ) hours on true
      where p.organization_id = $1
      order by p.name asc, p.id asc`,
    [organizationId, startDate ?? null, endDate ?? null, status],
  )
  return result.rows.map((row) => {
    const confirmedMinutes = Number(row.confirmed_minutes)
    const pendingMinutes = Number(row.pending_minutes)
    const returnedMinutes = Number(row.returned_minutes)
    const estimatedMinutes = row.estimated_minutes == null ? null : Number(row.estimated_minutes)
    return {
      projectId: Number(row.project_id),
      projectName: decryptText(row.project_name),
      minutes: confirmedMinutes + pendingMinutes,
      pendingMinutes,
      confirmedMinutes,
      returnedMinutes,
      taskCount: Number(row.task_count),
      estimatedMinutes,
      varianceMinutes: estimatedMinutes == null ? null : confirmedMinutes + pendingMinutes - estimatedMinutes,
    }
  })
}

async function createWorkHour(userId: number, todoId: number, body: Record<string, unknown>) {
  const rawMinutes = body.minutes ?? (body.hours != null ? Number(body.hours) * 60 : null)
  const minutes = parseWorkMinutes(rawMinutes)
  if (minutes == null) throw new WorkHoursError('WORK_MINUTES_REQUIRED', '工时不能为空。', 400)
  const workDate = parseWorkDate(body.workDate ?? body.date)
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await lockTodoOrganization(client, todoId, userId)
      const todo = await getTodoForWork(client, todoId, userId, true)
      if (
        !todo || !todo.organization_id || !organization ||
        Number(todo.organization_id) !== organization.organizationId ||
        !(await organizationMember(client, organization.organizationId, userId))
      ) {
        throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
      }
      if (!todo.assignee_user_id) {
        throw new WorkHoursError('TODO_NOT_ASSIGNED', '待办未设置负责人，无法记录工时。', 403)
      }
      if (!description) throw new WorkHoursError('WORK_DESCRIPTION_REQUIRED', '工作说明不能为空。', 400)
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
      if (workDate > today) throw new WorkHoursError('WORK_DATE_FUTURE', '工作日期不能晚于今天。', 400)
      if (workDate < formatDate(todo.project_created_at)) throw new WorkHoursError('WORK_DATE_BEFORE_PROJECT', '工作日期不能早于项目创建日期。', 400)
      if (todo.done || todo.confirmation_status === 'pending_review') throw new WorkHoursError('TODO_NOT_EDITABLE', '已提交确认的任务不能新增工时。', 409)
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`work-day:${userId}:${workDate}`])
      const existing = await client.query<{ total: string }>(
        `select coalesce(sum(minutes), 0)::bigint as total from todo_work_hours where user_id = $1 and work_date = $2`,
        [userId, workDate],
      )
      if (Number(existing.rows[0]?.total ?? 0) + minutes > WORK_MINUTES_DAY_LIMIT) {
        throw new WorkHoursError('WORK_DAY_LIMIT', '同一工作日跨项目累计工时不能超过 24 小时。', 409)
      }
      const result = await client.query<WorkHourRow>(
        `insert into todo_work_hours (project_id, todo_id, user_id, work_date, minutes, status, description)
         values ($1, $2, $3, $4, $5, 'pending', $6)
         returning id, project_id, todo_id, user_id, work_date, minutes, status, returned_at, description, created_at, updated_at`,
        [Number(todo.project_id), todoId, userId, workDate, minutes, encryptText(description)],
      )
      await insertWorkHoursActivityEvent(client, todo, userId, 'work_hours_added')
      await client.query('commit')
      return serializeEntry(result.rows[0])
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function createWorkHoursRouter(options: WorkHoursRouterOptions = {}) {
  const router = express.Router()

  router.get('/organization-work-hours', (request, response) => {
    const organizationId = positiveId(request.query.organizationId)
    if (!organizationId) {
      response.status(400).json({ error: '有效的组织 ID 是必需的。', code: 'ORGANIZATION_ID_INVALID' })
      return
    }
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(request.query)) {
      if (key !== 'organizationId' && typeof value === 'string') params.set(key, value)
    }
    const suffix = params.toString() ? `?${params.toString()}` : ''
    response.redirect(307, `/api/organizations/${organizationId}/work-hours${suffix}`)
  })

  router.get('/my-work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const status = request.query.status === 'pending' || request.query.status === 'confirmed' ? request.query.status : 'all'
      const projectId = request.query.projectId ? positiveId(request.query.projectId) ?? undefined : undefined
      const pagination = parseListPagination(request.query)
      const filters = { startDate, endDate, status, projectId, onlyUser: true } as const
      const [paged, reportSummary] = await Promise.all([
        loadWorkHourPage(userId, filters, request.query.q, pagination),
        loadWorkHourSummary(userId, filters),
      ])
      response.json({ entries: paged.entries.map(serializeEntry), pagination: paged.pagination, summary: reportSummary })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.post('/my-work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const todoId = positiveId(request.body?.todoId)
      if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
      response.status(201).json({ entry: await createWorkHour(userId, todoId, request.body ?? {}) })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.post('/todos/:todoId/work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const todoId = positiveId(request.params.todoId)
      if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
      response.status(201).json({ entry: await createWorkHour(userId, todoId, request.body ?? {}) })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.get('/todos/:todoId/work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const todoId = positiveId(request.params.todoId)
      if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
      const client = await pool.connect()
      let canReadAll = false
      try {
        const todo = await getTodoForWork(client, todoId, userId)
        const managed = todo ? await managedProject(userId, Number(todo.project_id), client) : null
        const organizationId = todo?.organization_id ? Number(todo.organization_id) : null
        const isOrganizationMember = organizationId
          ? await organizationMember(client, organizationId, userId)
          : false
        const canRead = todo && (isOrganizationMember || await projectMember(client, Number(todo.project_id), userId) || managed)
        const assigneeId = todo?.assignee_user_id
          ? Number(todo.assignee_user_id)
          : todo ? Number(todo.owner_user_id) : null
        canReadAll = Boolean(todo && (managed || Number(todo.created_by_user_id) === userId || assigneeId === userId))
        if (!todo || !todo.organization_id || !canRead) {
          throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
        }
      } finally {
        client.release()
      }
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const entries = await loadEntries(userId, { todoId, startDate, endDate, status: 'all', onlyUser: !canReadAll })
      const offset = Math.max(0, Number.isSafeInteger(Number(request.query.cursor)) ? Number(request.query.cursor) : 0)
      const limit = Math.min(50, Math.max(1, Number.isSafeInteger(Number(request.query.limit)) ? Number(request.query.limit) : 10))
      const filteredEntries = filterWorkHourEntries(entries, request.query.q)
      response.json({
        entries: filteredEntries.slice(offset, offset + limit).map(serializeEntry),
        pagination: { offset, limit, total: filteredEntries.length },
        summary: summary(entries),
      })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  async function updateSelectedWorkHours(
    request: express.Request,
    response: express.Response,
    action: 'submit' | 'accept' | 'return',
  ) {
    const userId = await requireUser(request, response, options.getUserId)
    if (!userId) return
    const todoId = positiveId(request.params.todoId)
    if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
    const entryIds = parseWorkHourEntryIds(request.body?.entryIds)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await lockTodoOrganization(client, todoId, userId)
      await lockWorkHoursRole(client, userId)
      const todo = await getTodoForWork(client, todoId, userId, true)
      const isOrganizationMember = todo?.organization_id
        ? await organizationMember(client, Number(todo.organization_id), userId)
        : false
      if (
        !todo ||
        !todo.organization_id ||
        !organization ||
        Number(todo.organization_id) !== organization.organizationId ||
        (action === 'submit' ? !isOrganizationMember : !organization.isManager)
      ) {
        throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
      }
      const assigneeId = todo.assignee_user_id ? Number(todo.assignee_user_id) : null
      if (action === 'submit' && (todo.done || assigneeId == null || assigneeId !== userId)) {
        throw new WorkHoursError('WORK_HOUR_SUBMIT_FORBIDDEN', '只有负责人可以提交自己进行中任务的工时。', 403)
      }
      if (action !== 'submit' && !organization?.isManager) {
        throw new WorkHoursError('WORK_HOUR_REVIEW_FORBIDDEN', '只有组织管理员可以确认或退回工时。', 403)
      }
      const expectedStatus: WorkHourStatus = action === 'submit' ? 'pending' : 'submitted'
      const selectedOwnerId = null
      const selected = await client.query<{ id: string }>(
        `select id
           from todo_work_hours
          where todo_id = $1
            and id = any($2::bigint[])
            and ($3::bigint is null or user_id = $3::bigint)
            and status = $4::text
          order by id
          for update`,
        [todoId, entryIds, selectedOwnerId, expectedStatus],
      )
      if (selected.rows.length !== entryIds.length) {
        throw new WorkHoursError(
          'WORK_HOUR_SELECTION_STALE',
          action === 'submit'
            ? '部分工时已变更或不属于当前任务，请刷新后重新选择。'
            : '部分待确认工时已变更，请刷新后重新选择。',
          409,
        )
      }
      if (action === 'submit') {
        await client.query(
          `update todo_work_hours
              set status = 'submitted', returned_at = null, updated_at = now()
            where todo_id = $1 and id = any($2::bigint[]) and status = 'pending'`,
          [todoId, entryIds],
        )
        await insertWorkHoursActivityEvent(client, todo, userId, 'work_hours_submitted')
      } else if (action === 'accept') {
        await client.query(
          `update todo_work_hours
              set status = 'confirmed', confirmed_by_user_id = $3,
                  confirmed_at = now(), updated_at = now()
            where todo_id = $1 and id = any($2::bigint[]) and status = 'submitted'`,
          [todoId, entryIds, userId],
        )
      } else {
        await client.query(
          `update todo_work_hours
              set status = 'pending', returned_at = now(), confirmed_by_user_id = null,
                  confirmed_at = null, updated_at = now()
            where todo_id = $1 and id = any($2::bigint[]) and status = 'submitted'`,
          [todoId, entryIds],
        )
      }
      await client.query('commit')
      response.json({ ok: true, updatedCount: entryIds.length })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  router.post('/todos/:todoId/work-hours/submit', async (request, response) => {
    try {
      await updateSelectedWorkHours(request, response, 'submit')
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.post('/todos/:todoId/work-hours/accept', async (request, response) => {
    try {
      await updateSelectedWorkHours(request, response, 'accept')
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.post('/todos/:todoId/work-hours/return', async (request, response) => {
    try {
      await updateSelectedWorkHours(request, response, 'return')
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.post('/todos/:todoId/work-hours/complete', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      const todoId = positiveId(request.params.todoId)
      if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
      const client = await pool.connect()
      try {
        await client.query('begin')
        const organization = await lockTodoOrganization(client, todoId, userId)
        await lockWorkHoursRole(client, userId)
        const todo = await getTodoForWork(client, todoId, userId, true)
        if (
          !todo ||
          !todo.organization_id ||
          !organization ||
          Number(todo.organization_id) !== organization.organizationId ||
          !organization.isManager
        ) {
          throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
        }
        if (!organization?.isManager) {
          throw new WorkHoursError('WORK_HOUR_COMPLETE_FORBIDDEN', '只有组织管理员可以完成任务。', 403)
        }
        if (todo.done) {
          await client.query('commit')
          response.json({ ok: true, autoConfirmedCount: 0 })
          return
        }
        const entries = await client.query<{ id: string; status: WorkHourStatus; returned_at: Date | string | null }>(
          `select id, status, returned_at
             from todo_work_hours
            where todo_id = $1
            order by id
            for update`,
          [todoId],
        )
        if (entries.rows.length === 0) {
          throw new WorkHoursError('WORK_HOUR_REQUIRED_FOR_COMPLETION', '当前任务没有工时记录，不能从工时确认中完成。', 409)
        }
        if (entries.rows.some((entry) => entry.status === 'submitted')) {
          throw new WorkHoursError('WORK_HOUR_PENDING_CONFIRMATION', '请先确认或退回全部待确认工时。', 409)
        }
        if (entries.rows.some((entry) => entry.returned_at != null)) {
          throw new WorkHoursError('WORK_HOUR_RETURNED_UNRESUBMITTED', '存在已退回工时，请修改并重新提交后再完成任务。', 409)
        }
        const pendingIds = entries.rows.filter((entry) => entry.status === 'pending').map((entry) => Number(entry.id))
        if (pendingIds.length > 0) {
          await client.query(
            `update todo_work_hours
                set status = 'confirmed', returned_at = null, confirmed_by_user_id = $2,
                    confirmed_at = now(), updated_at = now()
              where todo_id = $1 and id = any($3::bigint[]) and status = 'pending'`,
            [todoId, userId, pendingIds],
          )
        }
        await client.query(
          `update todos
              set done = true, confirmation_status = 'confirmed', needs_revision = false,
                  completed_at = now(), completed_by_user_id = $2,
                  accepted_at = now(), accepted_by_user_id = $2,
                  acceptance_version = acceptance_version + 1, updated_at = now()
            where id = $1`,
          [todoId, userId],
        )
        await insertWorkHoursActivityEvent(client, todo, userId, 'completed')
        await client.query('commit')
        response.json({ ok: true, autoConfirmedCount: pendingIds.length })
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.get('/organizations/:organizationId/work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const organizationId = positiveId(request.params.organizationId)
      if (!organizationId || !(await managedOrganization(userId, organizationId))) {
        response.status(403).json({ error: '只有当前组织的组织管理员可以查看组织工时。' })
        return
      }
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const status = request.query.status === 'pending' || request.query.status === 'confirmed' ? request.query.status : 'all'
      const pagination = parseListPagination(request.query)
      const filters = { organizationId, startDate, endDate, status, onlyUser: false } as const
      const [paged, reportSummary, projectRows] = await Promise.all([
        loadWorkHourPage(userId, filters, request.query.q, pagination),
        loadWorkHourSummary(userId, filters),
        loadOrganizationProjectSummaries(organizationId, startDate, endDate, status),
      ])
      response.json({ entries: paged.entries.map(serializeEntry), pagination: paged.pagination, summary: { ...reportSummary, byProject: projectRows } })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.get('/projects/:projectId/work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const projectId = positiveId(request.params.projectId)
      if (!projectId || !(await managedProject(userId, projectId))) {
        response.status(403).json({ error: '只有项目所属组织管理员可以查看项目工时。' })
        return
      }
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const status = request.query.status === 'pending' || request.query.status === 'confirmed' ? request.query.status : 'all'
      const filters = { projectId, startDate, endDate, status, onlyUser: false } as const
      const pagination = parseListPagination(request.query)
      const [paged, reportSummary, tasks] = await Promise.all([
        loadWorkHourPage(userId, filters, request.query.q, pagination),
        loadWorkHourSummary(userId, filters),
        loadTaskSummaries(projectId, startDate, endDate, status),
      ])
      const project = await query<{ estimated: string | null }>(
        'select sum(estimated_work_minutes)::bigint as estimated from todos where project_id = $1',
        [projectId],
      )
      const estimatedMinutes = Number(project.rows[0]?.estimated ?? 0)
      response.json({
        entries: paged.entries.map(serializeEntry),
        pagination: paged.pagination,
        summary: {
          ...reportSummary,
          tasks,
          byProject: [{
            projectId,
            projectName: reportSummary.byProject[0]?.projectName ?? '当前项目',
            minutes: reportSummary.totalMinutes,
            pendingMinutes: reportSummary.pendingMinutes,
            confirmedMinutes: reportSummary.confirmedMinutes,
            returnedMinutes: reportSummary.byProject[0]?.returnedMinutes ?? 0,
            taskCount: tasks.length,
            estimatedMinutes,
            varianceMinutes: reportSummary.totalMinutes - estimatedMinutes,
          }],
          estimatedMinutes,
          estimatedHours: estimatedMinutes / 60,
        },
      })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.patch('/my-work-hours/:entryId', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const entryId = positiveId(request.params.entryId)
      if (!entryId) throw new WorkHoursError('ENTRY_ID_INVALID', '有效的工时记录 ID 是必需的。', 400)
      const minutes = request.body.minutes == null && request.body.hours == null
        ? null
        : parseWorkMinutes(request.body.minutes ?? Number(request.body.hours) * 60)
      const workDate = request.body.workDate || request.body.date ? parseWorkDate(request.body.workDate ?? request.body.date) : null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const entryReference = await client.query<{ todo_id: string; user_id: string }>(
          'select todo_id, user_id from todo_work_hours where id = $1',
          [entryId],
        )
        const reference = entryReference.rows[0]
        if (!reference || Number(reference.user_id) !== userId) throw new WorkHoursError('ENTRY_NOT_FOUND', '工时记录不存在。', 404)
        const organization = await lockTodoOrganization(client, Number(reference.todo_id), userId)
        const todo = await getTodoForWork(client, Number(reference.todo_id), userId, true)
        if (
          !todo || !todo.organization_id || !organization ||
          Number(todo.organization_id) !== organization.organizationId ||
          !(await organizationMember(client, organization.organizationId, userId))
        ) {
          throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
        }
        if (todo.done || todo.confirmation_status === 'pending_review') {
          throw new WorkHoursError('TODO_NOT_EDITABLE', '已提交确认的任务不能修改工时。', 409)
        }
        const existing = await client.query<WorkHourRow>(
          "select entry.id, entry.project_id, entry.todo_id, entry.user_id, entry.work_date, entry.minutes, entry.status, entry.returned_at, entry.description, entry.created_at, entry.updated_at, (p.created_at at time zone 'Asia/Shanghai')::date::text as project_created_at from todo_work_hours entry join projects p on p.id = entry.project_id where entry.id = $1 for update of entry",
          [entryId],
        )
        const row = existing.rows[0]
        if (!row || Number(row.user_id) !== userId) throw new WorkHoursError('ENTRY_NOT_FOUND', '工时记录不存在。', 404)
        if (row.status !== 'pending') throw new WorkHoursError('ENTRY_CONFIRMED', '已确认工时不能修改。', 409)
        if (minutes == null && !workDate && typeof request.body.description !== 'string') throw new WorkHoursError('ENTRY_EMPTY', '没有可保存的修改。', 400)
        const targetDate = workDate ?? formatDate(row.work_date)
        const targetMinutes = minutes ?? Number(row.minutes)
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
        if (targetDate > today) throw new WorkHoursError('WORK_DATE_FUTURE', '工作日期不能晚于今天。', 400)
        if (row.project_created_at && targetDate < formatDate(row.project_created_at)) throw new WorkHoursError('WORK_DATE_BEFORE_PROJECT', '工作日期不能早于项目创建日期。', 400)
        if (typeof request.body.description === 'string' && !request.body.description.trim()) throw new WorkHoursError('WORK_DESCRIPTION_REQUIRED', '工作说明不能为空。', 400)
        await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`work-day:${userId}:${targetDate}`])
        const total = await client.query<{ total: string }>(
          'select coalesce(sum(minutes), 0)::bigint as total from todo_work_hours where user_id = $1 and work_date = $2 and id <> $3',
          [userId, targetDate, entryId],
        )
        if (Number(total.rows[0]?.total ?? 0) + targetMinutes > WORK_MINUTES_DAY_LIMIT) throw new WorkHoursError('WORK_DAY_LIMIT', '同一工作日跨项目累计工时不能超过 24 小时。', 409)
        const updated = await client.query<WorkHourRow>(
          `update todo_work_hours set work_date = $1, minutes = $2, description = $3, updated_at = now()
             where id = $4 returning id, project_id, todo_id, user_id, work_date, minutes, status, returned_at, description, created_at, updated_at`,
          [targetDate, targetMinutes, typeof request.body.description === 'string' ? (request.body.description.trim() ? encryptText(request.body.description.trim()) : '') : row.description, entryId],
        )
        await insertWorkHoursActivityEvent(client, todo, userId, 'work_hours_updated')
        await client.query('commit')
        response.json({ entry: serializeEntry(updated.rows[0]) })
      } catch (error) {
        await client.query('rollback')
        if (!sendWorkHoursError(response, error)) throw error
      } finally {
        client.release()
      }
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.delete('/my-work-hours/:entryId', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      await requireWorkHoursRole(userId)
      const entryId = positiveId(request.params.entryId)
      const client = await pool.connect()
      try {
        await client.query('begin')
        const entryReference = await client.query<{ todo_id: string; user_id: string }>(
          'select todo_id, user_id from todo_work_hours where id = $1',
          [entryId],
        )
        const reference = entryReference.rows[0]
        if (!reference || Number(reference.user_id) !== userId) {
          throw new WorkHoursError('ENTRY_NOT_FOUND', '工时不存在、已确认或不属于当前用户。', 409)
        }
        const organization = await lockTodoOrganization(client, Number(reference.todo_id), userId)
        const todo = await getTodoForWork(client, Number(reference.todo_id), userId, true)
        if (
          !todo || !todo.organization_id || !organization ||
          Number(todo.organization_id) !== organization.organizationId ||
          !(await organizationMember(client, organization.organizationId, userId))
        ) {
          throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
        }
        if (todo.done || todo.confirmation_status === 'pending_review') {
          throw new WorkHoursError('TODO_NOT_EDITABLE', '已提交确认的任务不能删除工时。', 409)
        }
        const entry = await client.query<{ status: WorkHourStatus; user_id: string }>(
          'select status, user_id from todo_work_hours where id = $1 for update',
          [entryId],
        )
        const row = entry.rows[0]
        if (!row || Number(row.user_id) !== userId || row.status !== 'pending') {
          throw new WorkHoursError('ENTRY_NOT_FOUND', '工时不存在、已确认或不属于当前用户。', 409)
        }
        await client.query('delete from todo_work_hours where id = $1', [entryId])
        await insertWorkHoursActivityEvent(client, todo, userId, 'work_hours_deleted')
        await client.query('commit')
        response.json({ ok: true })
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  async function transition(request: express.Request, response: express.Response, action: 'submit' | 'withdraw' | 'accept' | 'return' | 'reopen') {
    const userId = await requireUser(request, response, options.getUserId)
    if (!userId) return
    const todoId = positiveId(request.params.todoId)
    if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await lockTodoOrganization(client, todoId, userId)
      await lockWorkHoursRole(client, userId)
      const todo = await getTodoForWork(client, todoId, userId, true)
      if (!todo || !todo.organization_id || !organization || Number(todo.organization_id) !== organization.organizationId) {
        throw new WorkHoursError('TODO_NOT_FOUND', '企业待办不存在。', 404)
      }
      const manager = Boolean(organization?.isManager)
      const creatorId = todo.created_by_user_id ? Number(todo.created_by_user_id) : Number(todo.owner_user_id)
      const assigneeId = todo.assignee_user_id ? Number(todo.assignee_user_id) : null
      if (action === 'submit') {
        if (todo.done || (assigneeId != null && assigneeId !== userId) || (assigneeId == null && Number(todo.owner_user_id) !== userId)) throw new WorkHoursError('TODO_SUBMIT_FORBIDDEN', '只有负责人可以提交自己的进行中任务。', 403)
        await client.query(`update todos set confirmation_status = 'pending_review', needs_revision = false, rejection_reason = null, submitted_at = now(), updated_at = now() where id = $1`, [todoId])
        await insertWorkHoursActivityEvent(client, todo, userId, 'work_hours_submitted')
      } else if (action === 'withdraw') {
        if (todo.confirmation_status !== 'pending_review' || (assigneeId != null ? assigneeId !== userId : Number(todo.owner_user_id) !== userId)) throw new WorkHoursError('TODO_WITHDRAW_FORBIDDEN', '只有负责人可以撤回待确认任务。', 403)
        await client.query(`update todos set submitted_at = null, confirmation_status = 'confirmed', needs_revision = false, updated_at = now() where id = $1`, [todoId])
      } else if (action === 'accept') {
        if (todo.organization_id) throw new WorkHoursError('TODO_ACCEPT_VIA_WORK_HOURS', '企业待办请在工时确认中完成。', 409)
        if (creatorId !== userId || todo.confirmation_status !== 'pending_review') throw new WorkHoursError('TODO_ACCEPT_FORBIDDEN', '只有任务创建人可以确认。', 403)
        await client.query(`update todos set done = true, confirmation_status = 'confirmed', needs_revision = false, completed_at = now(), completed_by_user_id = $2, accepted_at = now(), accepted_by_user_id = $2, acceptance_version = acceptance_version + 1, updated_at = now() where id = $1`, [todoId, userId])
        await insertWorkHoursActivityEvent(client, todo, userId, 'completed')
      } else if (action === 'return') {
        if (creatorId !== userId || todo.confirmation_status !== 'pending_review') throw new WorkHoursError('TODO_RETURN_FORBIDDEN', '只有任务创建人可以退回任务。', 403)
        const reason = typeof request.body.reason === 'string' ? request.body.reason.trim() : ''
        if (!reason) throw new WorkHoursError('TODO_RETURN_REASON', '退回修改必须填写原因。', 400)
        await client.query(`update todos set done = false, confirmation_status = 'confirmed', needs_revision = true, rejection_reason = $2, updated_at = now() where id = $1`, [todoId, encryptText(reason)])
        await insertWorkHoursActivityEvent(client, todo, userId, 'rejected')
      } else {
        if (!todo.done || (!manager && creatorId !== userId)) throw new WorkHoursError('TODO_REOPEN_FORBIDDEN', '只有任务创建人或组织管理员可以重新打开。', 403)
        await client.query(`update todos set done = false, confirmation_status = 'confirmed', needs_revision = false, completed_at = null, completed_by_user_id = null, updated_at = now() where id = $1`, [todoId])
        await insertWorkHoursActivityEvent(client, todo, userId, 'reopened')
      }
      await client.query('commit')
      response.json({ ok: true })
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  for (const [path, action] of [
    ['/todos/:todoId/submit-review', 'submit'],
    ['/todos/:todoId/withdraw-review', 'withdraw'],
    ['/todos/:todoId/accept', 'accept'],
    ['/todos/:todoId/return', 'return'],
    ['/todos/:todoId/reopen', 'reopen'],
  ] as const) {
    router.post(path, async (request, response) => {
      try {
        await transition(request, response, action)
      } catch (error) {
        if (!sendWorkHoursError(response, error)) throw error
      }
    })
  }

  return router
}
