import express from 'express'
import type { PoolClient, QueryResultRow } from 'pg'
import { pool, query } from './db.ts'
import { decryptText, encryptText } from './crypto.ts'
import { managedOrganizationReadScopeSql } from './organization-scope.ts'

export const WORK_MINUTES_DAY_LIMIT = 24 * 60
export const WORK_MINUTES_STEP = 15

export type WorkHourStatus = 'pending' | 'confirmed'

export function parseWorkMinutes(value: unknown, options: { required?: boolean } = {}) {
  const required = options.required ?? true
  if (value == null || value === '') {
    if (!required) return null
    throw new WorkHoursError('WORK_MINUTES_REQUIRED', '工时不能为空。', 400)
  }
  const minutes = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > WORK_MINUTES_DAY_LIMIT) {
    throw new WorkHoursError('WORK_MINUTES_INVALID', '工时必须是 15 分钟到 24 小时之间的整数分钟。', 400)
  }
  if (minutes % WORK_MINUTES_STEP !== 0) {
    throw new WorkHoursError('WORK_MINUTES_STEP', '工时必须按 0.25 小时递增。', 400)
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
  description: string
  created_at: Date
  updated_at: Date
  project_name?: string
  todo_title?: string
  user_name?: string
  estimated_work_minutes?: number | null
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
    description: row.description ? decryptText(row.description) : '',
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at),
    projectName: row.project_name,
    todoTitle: row.todo_title,
    userName: row.user_name,
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

async function getTodoForWork(client: PoolClient, todoId: number, userId: number, lock = false) {
  const result = await client.query<{
    id: string
    project_id: string
    organization_id: string | null
    owner_user_id: string
    assignee_user_id: string | null
    created_by_user_id: string | null
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
            ${managedOrganizationReadScopeSql('p.organization_id', '$2')} as creator_is_manager
       from todos t join projects p on p.id = t.project_id
      where t.id = $1 ${lock ? 'for update of t' : ''}`,
    [todoId, userId],
  )
  return result.rows[0] ?? null
}

async function insertWorkHoursActivityEvent(client: PoolClient, todo: Awaited<ReturnType<typeof getTodoForWork>>, actorUserId: number, eventType: 'completed' | 'reopened' | 'rejected') {
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

async function loadEntries(userId: number, filters: {
  organizationId?: number
  projectId?: number
  startDate?: string
  endDate?: string
  status?: WorkHourStatus | 'all'
  onlyUser?: boolean
}) {
  const values: unknown[] = [userId]
  const conditions = [
    filters.onlyUser === false
      ? 'true'
      : 'entry.user_id = $1',
    filters.organizationId ? `p.organization_id = $${values.push(filters.organizationId)}` : 'true',
    filters.projectId ? `entry.project_id = $${values.push(filters.projectId)}` : 'true',
    filters.startDate ? `entry.work_date >= $${values.push(filters.startDate)}::date` : 'true',
    filters.endDate ? `entry.work_date <= $${values.push(filters.endDate)}::date` : 'true',
    filters.status && filters.status !== 'all' ? `entry.status = $${values.push(filters.status)}` : 'true',
  ]
  const result = await query<WorkHourRow>(
    `select entry.id, entry.project_id, entry.todo_id, entry.user_id, entry.work_date,
            entry.minutes, entry.status, entry.description, entry.created_at, entry.updated_at,
            p.name as project_name, t.title as todo_title, u.display_name as user_name,
            t.estimated_work_minutes
       from todo_work_hours entry
       join projects p on p.id = entry.project_id
       join todos t on t.id = entry.todo_id and t.project_id = entry.project_id
       join users u on u.id = entry.user_id
      where ${conditions.join(' and ')}
        and (
          p.user_id = $1
          or exists (select 1 from project_memberships pm where pm.project_id = p.id and pm.invited_user_id = $1 and pm.status = 'active')
          or ${managedOrganizationReadScopeSql('p.organization_id', '$1')}
        )
      order by entry.work_date desc, entry.created_at desc, entry.id desc`,
    values,
  )
  return result.rows
}

function summary(entries: WorkHourRow[]) {
  const byProject = new Map<number, { projectId: number; projectName: string; minutes: number; pendingMinutes: number; confirmedMinutes: number }>()
  const byDate = new Map<string, number>()
  const byUser = new Map<number, { userId: number; userName: string; minutes: number }>()
  for (const entry of entries) {
    const projectId = Number(entry.project_id)
    const project = byProject.get(projectId) ?? {
      projectId,
      projectName: entry.project_name ?? '未命名项目',
      minutes: 0,
      pendingMinutes: 0,
      confirmedMinutes: 0,
    }
    project.minutes += Number(entry.minutes)
    if (entry.status === 'pending') project.pendingMinutes += Number(entry.minutes)
    else project.confirmedMinutes += Number(entry.minutes)
    byProject.set(projectId, project)
    const date = formatDate(entry.work_date)
    byDate.set(date, (byDate.get(date) ?? 0) + Number(entry.minutes))
    const userId = Number(entry.user_id)
    const user = byUser.get(userId) ?? { userId, userName: entry.user_name ?? '未记录', minutes: 0 }
    user.minutes += Number(entry.minutes)
    byUser.set(userId, user)
  }
  const totalMinutes = entries.reduce((sum, entry) => sum + Number(entry.minutes), 0)
  return {
    totalMinutes,
    totalHours: totalMinutes / 60,
    confirmedMinutes: entries.filter((entry) => entry.status === 'confirmed').reduce((sum, entry) => sum + Number(entry.minutes), 0),
    pendingMinutes: entries.filter((entry) => entry.status === 'pending').reduce((sum, entry) => sum + Number(entry.minutes), 0),
    projectCount: byProject.size,
    taskCount: new Set(entries.map((entry) => entry.todo_id)).size,
    byProject: [...byProject.values()].sort((a, b) => b.minutes - a.minutes),
    byDate: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, minutes]) => ({ date, minutes, hours: minutes / 60 })),
    byUser: [...byUser.values()].sort((a, b) => b.minutes - a.minutes),
  }
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
    const todo = await getTodoForWork(client, todoId, userId, true)
    if (!todo || !todo.organization_id || !(await projectMember(client, Number(todo.project_id), userId))) {
      throw new WorkHoursError('TODO_NOT_ACCESSIBLE', '待办不存在或你无权访问。', 404)
    }
    if (todo.done) throw new WorkHoursError('TODO_COMPLETED', '已完成任务不能新增工时。', 409)
    if (todo.assignee_user_id && Number(todo.assignee_user_id) !== userId) {
      throw new WorkHoursError('TODO_NOT_ASSIGNED', '只能为自己负责的任务记录工时。', 403)
    }
    if (!todo.assignee_user_id && Number(todo.owner_user_id) !== userId) {
      throw new WorkHoursError('TODO_NOT_ASSIGNED', '任务尚未分配给你。', 403)
    }
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
       returning id, project_id, todo_id, user_id, work_date, minutes, status, description, created_at, updated_at`,
      [Number(todo.project_id), todoId, userId, workDate, minutes, description ? encryptText(description) : ''],
    )
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
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const status = request.query.status === 'pending' || request.query.status === 'confirmed' ? request.query.status : 'all'
      const projectId = request.query.projectId ? positiveId(request.query.projectId) ?? undefined : undefined
      const entries = await loadEntries(userId, { startDate, endDate, status, projectId, onlyUser: true })
      response.json({ entries: entries.map(serializeEntry), summary: summary(entries) })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.post('/my-work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
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
      const todoId = positiveId(request.params.todoId)
      if (!todoId) throw new WorkHoursError('TODO_ID_INVALID', '有效的待办 ID 是必需的。', 400)
      response.status(201).json({ entry: await createWorkHour(userId, todoId, request.body ?? {}) })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.get('/organizations/:organizationId/work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      const organizationId = positiveId(request.params.organizationId)
      if (!organizationId || !(await managedOrganization(userId, organizationId))) {
        response.status(403).json({ error: '只有当前组织的组织管理员可以查看组织工时。' })
        return
      }
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const status = request.query.status === 'pending' || request.query.status === 'confirmed' ? request.query.status : 'all'
      const entries = await loadEntries(userId, { organizationId, startDate, endDate, status, onlyUser: false })
      response.json({ entries: entries.map(serializeEntry), summary: summary(entries) })
    } catch (error) {
      if (!sendWorkHoursError(response, error)) throw error
    }
  })

  router.get('/projects/:projectId/work-hours', async (request, response) => {
    try {
      const userId = await requireUser(request, response, options.getUserId)
      if (!userId) return
      const projectId = positiveId(request.params.projectId)
      if (!projectId || !(await managedProject(userId, projectId))) {
        response.status(403).json({ error: '只有项目所属组织管理员可以查看项目工时。' })
        return
      }
      const startDate = request.query.startDate ? parseWorkDate(request.query.startDate) : undefined
      const endDate = request.query.endDate ? parseWorkDate(request.query.endDate) : undefined
      const status = request.query.status === 'pending' || request.query.status === 'confirmed' ? request.query.status : 'all'
      const entries = await loadEntries(userId, { projectId, startDate, endDate, status, onlyUser: false })
      const project = await query<{ estimated: string | null }>(
        'select sum(estimated_work_minutes)::bigint as estimated from todos where project_id = $1',
        [projectId],
      )
      response.json({
        entries: entries.map(serializeEntry),
        summary: {
          ...summary(entries),
          estimatedMinutes: Number(project.rows[0]?.estimated ?? 0),
          estimatedHours: Number(project.rows[0]?.estimated ?? 0) / 60,
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
      const entryId = positiveId(request.params.entryId)
      if (!entryId) throw new WorkHoursError('ENTRY_ID_INVALID', '有效的工时记录 ID 是必需的。', 400)
      const minutes = request.body.minutes == null && request.body.hours == null
        ? null
        : parseWorkMinutes(request.body.minutes ?? Number(request.body.hours) * 60)
      const workDate = request.body.workDate || request.body.date ? parseWorkDate(request.body.workDate ?? request.body.date) : null
      const client = await pool.connect()
      try {
        await client.query('begin')
        const existing = await client.query<WorkHourRow>(
          'select id, project_id, todo_id, user_id, work_date, minutes, status, description, created_at, updated_at from todo_work_hours where id = $1 for update',
          [entryId],
        )
        const row = existing.rows[0]
        if (!row || Number(row.user_id) !== userId) throw new WorkHoursError('ENTRY_NOT_FOUND', '工时记录不存在。', 404)
        if (row.status !== 'pending') throw new WorkHoursError('ENTRY_CONFIRMED', '已确认工时不能修改。', 409)
        if (minutes == null && !workDate && typeof request.body.description !== 'string') throw new WorkHoursError('ENTRY_EMPTY', '没有可保存的修改。', 400)
        const targetDate = workDate ?? formatDate(row.work_date)
        const targetMinutes = minutes ?? Number(row.minutes)
        await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`work-day:${userId}:${targetDate}`])
        const total = await client.query<{ total: string }>(
          'select coalesce(sum(minutes), 0)::bigint as total from todo_work_hours where user_id = $1 and work_date = $2 and id <> $3',
          [userId, targetDate, entryId],
        )
        if (Number(total.rows[0]?.total ?? 0) + targetMinutes > WORK_MINUTES_DAY_LIMIT) throw new WorkHoursError('WORK_DAY_LIMIT', '同一工作日跨项目累计工时不能超过 24 小时。', 409)
        const updated = await client.query<WorkHourRow>(
          `update todo_work_hours set work_date = $1, minutes = $2, description = $3, updated_at = now()
             where id = $4 returning id, project_id, todo_id, user_id, work_date, minutes, status, description, created_at, updated_at`,
          [targetDate, targetMinutes, typeof request.body.description === 'string' ? (request.body.description.trim() ? encryptText(request.body.description.trim()) : '') : row.description, entryId],
        )
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
      const entryId = positiveId(request.params.entryId)
      const result = await query<{ status: WorkHourStatus; user_id: string }>('delete from todo_work_hours where id = $1 and user_id = $2 and status = \'pending\' returning status, user_id', [entryId, userId])
      if (!result.rows[0]) {
        response.status(409).json({ error: '工时不存在、已确认或不属于当前用户。' })
        return
      }
      response.json({ ok: true })
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
      const todo = await getTodoForWork(client, todoId, userId, true)
      if (!todo || !todo.organization_id) throw new WorkHoursError('TODO_NOT_FOUND', '企业待办不存在。', 404)
      const manager = Boolean(todo.creator_is_manager)
      const creatorId = todo.created_by_user_id ? Number(todo.created_by_user_id) : Number(todo.owner_user_id)
      const assigneeId = todo.assignee_user_id ? Number(todo.assignee_user_id) : null
      if (action === 'submit') {
        if (todo.done || (assigneeId != null && assigneeId !== userId) || (assigneeId == null && Number(todo.owner_user_id) !== userId)) throw new WorkHoursError('TODO_SUBMIT_FORBIDDEN', '只有负责人可以提交自己的进行中任务。', 403)
        await client.query(`update todos set confirmation_status = 'pending_review', needs_revision = false, rejection_reason = null, submitted_at = now(), updated_at = now() where id = $1`, [todoId])
      } else if (action === 'withdraw') {
        if (todo.confirmation_status !== 'pending_review' || (assigneeId != null ? assigneeId !== userId : Number(todo.owner_user_id) !== userId)) throw new WorkHoursError('TODO_WITHDRAW_FORBIDDEN', '只有负责人可以撤回待验收任务。', 403)
        await client.query(`update todos set submitted_at = null, confirmation_status = 'confirmed', needs_revision = false, updated_at = now() where id = $1`, [todoId])
      } else if (action === 'accept') {
        if (creatorId !== userId || todo.confirmation_status !== 'pending_review') throw new WorkHoursError('TODO_ACCEPT_FORBIDDEN', '只有任务创建人可以验收。', 403)
        await client.query(`update todos set done = true, confirmation_status = 'confirmed', needs_revision = false, completed_at = now(), completed_by_user_id = $2, accepted_at = now(), accepted_by_user_id = $2, acceptance_version = acceptance_version + 1, updated_at = now() where id = $1`, [todoId, userId])
        await client.query(`update todo_work_hours set status = 'confirmed', confirmed_by_user_id = $2, confirmed_at = now(), updated_at = now() where todo_id = $1 and status = 'pending'`, [todoId, userId])
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
