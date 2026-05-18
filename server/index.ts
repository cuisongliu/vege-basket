import 'dotenv/config'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import { pool, query } from './db.ts'
import { schemaSql } from './schema.ts'

type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'
type Priority = 'high' | 'medium' | 'low'
type SummaryType = 'weekly' | 'monthly'
type UserRow = { id: string; email: string; display_name: string }
type ChatMessage = { role: 'user' | 'assistant'; content: string }
type IncomingChatMessage = { role?: unknown; content?: unknown }

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(cors())
app.use(express.json())

function formatDateTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`
}

function formatDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

function formatUpdatedAt(value: Date | string) {
  const timestamp = formatDateTime(value)
  const [date, time] = timestamp.split(' ')
  const today = formatDate(new Date())
  return date === today ? `今天 ${time.slice(0, 5)}` : timestamp.slice(5, 16)
}

function normalizeEmail(email: unknown) {
  return String(email ?? '').trim().toLowerCase()
}

function sanitizeDisplayName(value: unknown) {
  return String(value ?? '').trim().slice(0, 32)
}

function serializeUser(row: UserRow) {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
  }
}

function getAiEndpoint() {
  const base = process.env.AI_API_BASE ?? ''
  return `${base.replace(/\/$/, '')}/v1/chat/completions`
}

function buildWorkspaceContext(workspace: Awaited<ReturnType<typeof getWorkspace>>) {
  const projectsText = workspace.projects
    .map((project) => {
      const projectTodos = workspace.todos
        .filter((todo) => todo.projectId === project.id)
        .map((todo) => `- [${todo.done ? 'x' : ' '}] ${todo.title} / ${todo.priority} / ${todo.dueDate}`)
        .join('\n')
      const journals = project.journals
        .map((entry) => `- ${entry.createdAt}: ${entry.content}`)
        .join('\n')
      return [
        `项目：${project.name}`,
        `状态：${project.status}`,
        `标签：${project.tags.join('、') || '无'}`,
        `风险：${project.risks.join('；') || '无'}`,
        `日记：\n${journals || '无'}`,
        `待办：\n${projectTodos || '无'}`,
      ].join('\n')
    })
    .join('\n\n')

  const draftsText = workspace.inbox
    .filter((item) => !item.processed)
    .map((item) => `- ${item.createdAt}: ${item.content}`)
    .join('\n')

  return [
    '以下是用户当前 Veges 个人项目工作区上下文。',
    projectsText || '当前还没有项目。',
    `待归档草稿：\n${draftsText || '无'}`,
  ].join('\n\n')
}

function getTokenFromRequest(request: express.Request) {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

async function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString('hex')
  await query(
    `
    insert into sessions (token, user_id, expires_at)
    values ($1, $2, now() + interval '30 days')
    `,
    [token, userId],
  )
  return token
}

async function requireUserId(request: express.Request) {
  const token = getTokenFromRequest(request)
  if (!token) return null

  const result = await query<{ user_id: string }>(
    `
    select user_id
    from sessions
    where token = $1 and expires_at > now()
    `,
    [token],
  )
  return result.rows[0] ? Number(result.rows[0].user_id) : null
}

async function ensureUserId(request: express.Request, response: express.Response) {
  const userId = await requireUserId(request)
  if (!userId) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  return userId
}

function ensureStatus(value: unknown): ProjectStatus {
  if (value === 'active' || value === 'paused' || value === 'completed' || value === 'archived') {
    return value
  }
  return 'active'
}

function ensurePriority(value: unknown): Priority {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

function ensureSummaryType(value: unknown): SummaryType {
  return value === 'monthly' ? 'monthly' : 'weekly'
}

async function getWorkspace(userId: number) {
  const [
    projectsResult,
    journalsResult,
    risksResult,
    todosResult,
    draftsResult,
    summariesResult,
  ] = await Promise.all([
    query<{
      id: string
      name: string
      status: ProjectStatus
      tags: string[]
      created_at: Date
      updated_at: Date
    }>(
      `
      select id, name, status, tags, created_at, updated_at
      from projects
      where user_id = $1
      order by updated_at desc, id desc
      `,
      [userId],
    ),
    query<{ id: string; project_id: string; content: string; created_at: Date }>(
      `
      select id, project_id, content, created_at
      from journal_entries
      where project_id in (select id from projects where user_id = $1)
      order by created_at desc, id desc
      `,
      [userId],
    ),
    query<{ project_id: string; content: string }>(
      `
      select project_id, content
      from risks
      where project_id in (select id from projects where user_id = $1)
      order by created_at desc, id desc
      `,
      [userId],
    ),
    query<{
      id: string
      project_id: string
      title: string
      due_date: Date
      priority: Priority
      done: boolean
    }>(
      `
      select id, project_id, title, due_date, priority, done
      from todos
      where project_id in (select id from projects where user_id = $1)
      order by done asc, due_date asc, id desc
      `,
      [userId],
    ),
    query<{
      id: string
      source: 'manual' | 'feishu'
      content: string
      created_at: Date
      suggested_project_id: string | null
      processed: boolean
    }>(
      `
      select id, source, content, created_at, suggested_project_id, processed
      from draft_items
      where user_id = $1
      order by processed asc, created_at desc, id desc
      `,
      [userId],
    ),
    query<{
      id: string
      project_id: string
      type: SummaryType
      title: string
      period: string
      content: string
      created_at: Date
    }>(
      `
      select id, project_id, type, title, period, content, created_at
      from summaries
      where project_id in (select id from projects where user_id = $1)
      order by created_at desc, id desc
      `,
      [userId],
    ),
  ])

  const journalsByProject = new Map<number, Array<{ id: number; createdAt: string; content: string }>>()
  for (const row of journalsResult.rows) {
    const projectId = Number(row.project_id)
    const rows = journalsByProject.get(projectId) ?? []
    rows.push({
      id: Number(row.id),
      createdAt: formatDateTime(row.created_at),
      content: row.content,
    })
    journalsByProject.set(projectId, rows)
  }

  const risksByProject = new Map<number, string[]>()
  for (const row of risksResult.rows) {
    const projectId = Number(row.project_id)
    risksByProject.set(projectId, [...(risksByProject.get(projectId) ?? []), row.content])
  }

  return {
    projects: projectsResult.rows.map((project) => ({
      id: Number(project.id),
      name: project.name,
      status: project.status,
      createdAt: formatUpdatedAt(project.created_at),
      updatedAt: formatUpdatedAt(project.updated_at),
      tags: project.tags ?? [],
      journals: journalsByProject.get(Number(project.id)) ?? [],
      risks: risksByProject.get(Number(project.id)) ?? [],
    })),
    todos: todosResult.rows.map((todo) => ({
      id: Number(todo.id),
      projectId: Number(todo.project_id),
      title: todo.title,
      dueDate: formatDate(todo.due_date),
      priority: todo.priority,
      done: todo.done,
    })),
    inbox: draftsResult.rows.map((draft) => ({
      id: Number(draft.id),
      source: draft.source,
      content: draft.content,
      createdAt: formatUpdatedAt(draft.created_at),
      suggestedProjectId: draft.suggested_project_id
        ? Number(draft.suggested_project_id)
        : undefined,
      processed: draft.processed,
    })),
    summaries: summariesResult.rows.map((summary) => ({
      id: Number(summary.id),
      projectId: Number(summary.project_id),
      type: summary.type,
      title: summary.title,
      period: summary.period,
      content: summary.content,
      createdAt: formatUpdatedAt(summary.created_at),
    })),
  }
}

function asyncHandler(
  handler: (request: express.Request, response: express.Response) => Promise<void>,
) {
  return (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).catch(next)
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.post('/api/auth/register', asyncHandler(async (request, response) => {
  const email = normalizeEmail(request.body.email)
  const password = String(request.body.password ?? '')

  if (!email || password.length < 6) {
    response.status(400).json({ error: 'Email and a 6+ character password are required' })
    return
  }

  const existing = await query<{ id: string }>(
    'select id from users where email = $1',
    [email],
  )
  if (existing.rows.length > 0) {
    response.status(409).json({ error: 'Email already registered' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await query<UserRow>(
    `
    insert into users (email, password_hash, display_name)
    values ($1, $2, $3)
    returning id, email, display_name
    `,
    [email, passwordHash, email.split('@')[0]],
  )
  const userId = Number(user.rows[0].id)
  const token = await createSession(userId)
  response.status(201).json({
    token,
    user: serializeUser(user.rows[0]),
    workspace: await getWorkspace(userId),
  })
}))

app.post('/api/auth/login', asyncHandler(async (request, response) => {
  const email = normalizeEmail(request.body.email)
  const password = String(request.body.password ?? '')
  const user = await query<UserRow & { password_hash: string }>(
    'select id, email, display_name, password_hash from users where email = $1',
    [email],
  )
  const row = user.rows[0]

  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    response.status(401).json({ error: 'Invalid email or password' })
    return
  }

  const userId = Number(row.id)
  const token = await createSession(userId)
  response.json({
    token,
    user: serializeUser(row),
    workspace: await getWorkspace(userId),
  })
}))

app.get('/api/auth/me', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return

  const user = await query<UserRow>(
    'select id, email, display_name from users where id = $1',
    [userId],
  )
  response.json({
    user: serializeUser(user.rows[0]),
    workspace: await getWorkspace(userId),
  })
}))

app.patch('/api/auth/me', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return

  const displayName = sanitizeDisplayName(request.body.displayName)
  if (!displayName) {
    response.status(400).json({ error: 'Display name is required' })
    return
  }

  const user = await query<UserRow>(
    `
    update users
    set display_name = $1
    where id = $2
    returning id, email, display_name
    `,
    [displayName, userId],
  )
  response.json({ user: serializeUser(user.rows[0]) })
}))

app.get('/api/workspace', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  response.json(await getWorkspace(userId))
}))

app.post('/api/projects', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const name = String(request.body.name ?? '').trim()
  if (!name) {
    response.status(400).json({ error: 'Project name is required' })
    return
  }

  const tags = Array.isArray(request.body.tags) ? request.body.tags.map(String) : ['新项目']
  const result = await query<{ id: string }>(
    `
    insert into projects (user_id, name, status, tags)
    values ($1, $2, 'active', $3)
    returning id
    `,
    [userId, name, tags.length ? tags : ['新项目']],
  )
  const projectId = Number(result.rows[0].id)
  await query(
    `
    insert into journal_entries (project_id, content)
    values ($1, $2)
    `,
    [projectId, '项目已创建。可以从这里开始记录今天的进展、重点内容和最新方案。'],
  )
  response.status(201).json(await getWorkspace(userId))
}))

app.patch('/api/projects/:projectId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const projectId = Number(request.params.projectId)
  const updates: string[] = []
  const values: unknown[] = []

  if (typeof request.body.name === 'string') {
    values.push(request.body.name.trim())
    updates.push(`name = $${values.length}`)
  }
  if (request.body.status) {
    values.push(ensureStatus(request.body.status))
    updates.push(`status = $${values.length}`)
  }
  if (Array.isArray(request.body.tags)) {
    values.push(request.body.tags.map(String))
    updates.push(`tags = $${values.length}`)
  }

  if (updates.length === 0) {
    response.status(400).json({ error: 'No supported fields to update' })
    return
  }

  values.push(projectId, userId)
  await query(
    `
    update projects
    set ${updates.join(', ')}, updated_at = now()
    where id = $${values.length - 1} and user_id = $${values.length}
    `,
    values,
  )
  response.json(await getWorkspace(userId))
}))

app.delete('/api/projects/:projectId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  await query('delete from projects where id = $1 and user_id = $2', [
    Number(request.params.projectId),
    userId,
  ])
  response.json(await getWorkspace(userId))
}))

app.post('/api/projects/:projectId/journals', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const content = String(request.body.content ?? '').trim()
  if (!content) {
    response.status(400).json({ error: 'Journal content is required' })
    return
  }
  const projectId = Number(request.params.projectId)
  const ownsProject = await query<{ id: string }>(
    'select id from projects where id = $1 and user_id = $2',
    [projectId, userId],
  )
  if (ownsProject.rows.length === 0) {
    response.status(404).json({ error: 'Project not found' })
    return
  }
  await query(
    'insert into journal_entries (project_id, content) values ($1, $2)',
    [projectId, content],
  )
  await query('update projects set updated_at = now() where id = $1', [projectId])
  response.status(201).json(await getWorkspace(userId))
}))

app.patch('/api/projects/:projectId/journals/:entryId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const content = String(request.body.content ?? '').trim()
  if (!content) {
    response.status(400).json({ error: 'Journal content is required' })
    return
  }
  const projectId = Number(request.params.projectId)
  await query(
    `
    update journal_entries
    set content = $1
    where id = $2
      and project_id = $3
      and project_id in (select id from projects where user_id = $4)
    `,
    [content, Number(request.params.entryId), projectId, userId],
  )
  await query('update projects set updated_at = now() where id = $1', [projectId])
  response.json(await getWorkspace(userId))
}))

app.delete('/api/projects/:projectId/journals/:entryId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const projectId = Number(request.params.projectId)
  await query(
    `
    delete from journal_entries
    where id = $1
      and project_id = $2
      and project_id in (select id from projects where user_id = $3)
    `,
    [Number(request.params.entryId), projectId, userId],
  )
  await query('update projects set updated_at = now() where id = $1', [projectId])
  response.json(await getWorkspace(userId))
}))

app.post('/api/projects/:projectId/risks', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const projectId = Number(request.params.projectId)
  const ownsProject = await query<{ id: string }>(
    'select id from projects where id = $1 and user_id = $2',
    [projectId, userId],
  )
  if (ownsProject.rows.length === 0) {
    response.status(404).json({ error: 'Project not found' })
    return
  }
  let content = String(request.body.content ?? '').trim()

  if (!content && request.body.journalEntryId) {
    const journal = await query<{ content: string }>(
      'select content from journal_entries where id = $1 and project_id = $2',
      [Number(request.body.journalEntryId), projectId],
    )
    content = journal.rows[0]?.content ?? ''
  }

  if (!content) {
    response.status(400).json({ error: 'Risk content is required' })
    return
  }

  await query(
    `
    insert into risks (project_id, content, journal_entry_id)
    values ($1, $2, $3)
    on conflict (project_id, content) do nothing
    `,
    [projectId, content, request.body.journalEntryId ? Number(request.body.journalEntryId) : null],
  )
  await query('update projects set updated_at = now() where id = $1', [projectId])
  response.status(201).json(await getWorkspace(userId))
}))

app.post('/api/todos', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const title = String(request.body.title ?? '').trim()
  if (!title) {
    response.status(400).json({ error: 'Todo title is required' })
    return
  }
  const projectId = Number(request.body.projectId)
  const ownsProject = await query<{ id: string }>(
    'select id from projects where id = $1 and user_id = $2',
    [projectId, userId],
  )
  if (ownsProject.rows.length === 0) {
    response.status(404).json({ error: 'Project not found' })
    return
  }
  await query(
    `
    insert into todos (project_id, title, due_date, priority)
    values ($1, $2, $3, $4)
    `,
    [
      projectId,
      title,
      request.body.dueDate ? String(request.body.dueDate) : formatDate(new Date()),
      ensurePriority(request.body.priority),
    ],
  )
  response.status(201).json(await getWorkspace(userId))
}))

app.patch('/api/todos/:todoId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  await query(
    `
    update todos
    set done = coalesce($1, done),
        title = coalesce($2, title),
        due_date = coalesce($3, due_date),
        priority = coalesce($4, priority),
        updated_at = now()
    where id = $5
      and project_id in (select id from projects where user_id = $6)
    `,
    [
      typeof request.body.done === 'boolean' ? request.body.done : null,
      typeof request.body.title === 'string' ? request.body.title.trim() : null,
      request.body.dueDate ? String(request.body.dueDate) : null,
      request.body.priority ? ensurePriority(request.body.priority) : null,
      Number(request.params.todoId),
      userId,
    ],
  )
  response.json(await getWorkspace(userId))
}))

app.delete('/api/todos/:todoId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  await query(
    `
    delete from todos
    where id = $1
      and project_id in (select id from projects where user_id = $2)
    `,
    [Number(request.params.todoId), userId],
  )
  response.json(await getWorkspace(userId))
}))

app.post('/api/drafts', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const content = String(request.body.content ?? '').trim()
  if (!content) {
    response.status(400).json({ error: 'Draft content is required' })
    return
  }
  await query(
    `
    insert into draft_items (user_id, source, content, suggested_project_id)
    values ($1, 'manual', $2, $3)
    `,
    [userId, content, request.body.suggestedProjectId ? Number(request.body.suggestedProjectId) : null],
  )
  response.status(201).json(await getWorkspace(userId))
}))

app.post('/api/drafts/:draftId/archive', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const draftId = Number(request.params.draftId)
  const projectId = Number(request.body.projectId)
  const draftResult = await query<{ content: string }>(
    'select content from draft_items where id = $1 and user_id = $2',
    [draftId, userId],
  )
  const draft = draftResult.rows[0]
  if (!draft) {
    response.status(404).json({ error: 'Draft not found' })
    return
  }
  const ownsProject = await query<{ id: string }>(
    'select id from projects where id = $1 and user_id = $2',
    [projectId, userId],
  )
  if (ownsProject.rows.length === 0) {
    response.status(404).json({ error: 'Project not found' })
    return
  }

  await query('insert into journal_entries (project_id, content) values ($1, $2)', [
    projectId,
    `来自今日草稿箱：${draft.content}`,
  ])
  await query('update draft_items set processed = true where id = $1', [draftId])
  await query('update projects set updated_at = now() where id = $1', [projectId])
  response.json(await getWorkspace(userId))
}))

app.post('/api/ai/chat', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return

  const apiKey = process.env.AI_API_KEY
  const model = process.env.AI_MODEL ?? 'deepseek-v3.2'
  if (!apiKey || !process.env.AI_API_BASE) {
    response.status(500).json({ error: 'AI API is not configured' })
    return
  }

  const messages = Array.isArray(request.body.messages)
    ? request.body.messages
        .map((message: IncomingChatMessage): ChatMessage => ({
          role: message?.role === 'assistant' ? 'assistant' : 'user',
          content: String(message?.content ?? '').trim(),
        }))
        .filter((message: ChatMessage) => message.content)
        .slice(-12)
    : []

  if (messages.length === 0) {
    response.status(400).json({ error: 'Messages are required' })
    return
  }

  const workspace = await getWorkspace(userId)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45000)

  try {
    const aiResponse = await fetch(getAiEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              '你是 Veges 内置的个人项目管理 AI Agent。请用简洁中文回答，帮助用户基于项目日记、待办、风险和草稿生成周总结、月总结、风险复盘、下一步行动建议。不要编造没有出现在上下文里的事实；如果信息不足，请说明需要用户补充什么。',
          },
          {
            role: 'system',
            content: buildWorkspaceContext(workspace),
          },
          ...messages,
        ],
      }),
      signal: controller.signal,
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      response.status(502).json({ error: errorText || 'AI request failed' })
      return
    }

    const data = await aiResponse.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    response.json({
      message: content || 'AI 没有返回有效内容，请稍后重试。',
    })
  } finally {
    clearTimeout(timeout)
  }
}))

app.delete('/api/drafts/:draftId', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  await query('delete from draft_items where id = $1 and user_id = $2', [
    Number(request.params.draftId),
    userId,
  ])
  response.json(await getWorkspace(userId))
}))

app.post('/api/summaries', asyncHandler(async (request, response) => {
  const userId = await ensureUserId(request, response)
  if (!userId) return
  const projectId = Number(request.body.projectId)
  const type = ensureSummaryType(request.body.type)
  const projectResult = await query<{
    name: string
    status: ProjectStatus
    risks: string | null
    journal: string | null
    todo: string | null
  }>(
    `
    select
      p.name,
      p.status,
      (select content from risks where project_id = p.id order by created_at desc limit 1) as risks,
      (select content from journal_entries where project_id = p.id order by created_at desc limit 1) as journal,
      (select title from todos where project_id = p.id and done = false order by due_date asc limit 1) as todo
    from projects p
    where p.id = $1 and p.user_id = $2
    `,
    [projectId, userId],
  )
  const project = projectResult.rows[0]
  if (!project) {
    response.status(404).json({ error: 'Project not found' })
    return
  }

  const providedContent = String(request.body.content ?? '').trim()
  if (providedContent) {
    const title = String(
      request.body.title ?? `${formatDate(new Date())} AI 生成总结`,
    )
      .trim()
      .slice(0, 80)
    await query(
      `
      insert into summaries (project_id, type, title, period, content)
      values ($1, $2, $3, $4, $5)
      `,
      [projectId, type, title || `${formatDate(new Date())} AI 生成总结`, 'AI 对话生成', providedContent],
    )
    response.status(201).json(await getWorkspace(userId))
    return
  }

  const content = [
    `## 进展\n${project.journal ?? '本周期暂无新增日记。'}`,
    '## 关键决策\n第一版继续围绕个人项目上下文整理，不扩展团队协作。',
    `## 未解决问题\n${project.todo ?? '暂无明确待办阻塞。'}`,
    `## 风险\n${project.risks ?? '当前没有记录中的高风险。'}`,
    '## 下步建议\n- 优先处理高优先级待办\n- 在明天日记中补充结果',
    `## 状态变化\n项目当前为「${project.status}」。`,
  ].join('\n\n')

  await query(
    `
    insert into summaries (project_id, type, title, period, content)
    values ($1, $2, $3, $4, $5)
    `,
    [
      projectId,
      type,
      `${formatDate(new Date())} ${type === 'weekly' ? '周总结' : '月总结'}`,
      type === 'weekly' ? '当前周' : '当前月',
      content,
    ],
  )
  response.status(201).json(await getWorkspace(userId))
}))

app.use((error: unknown, _request: express.Request, response: express.Response) => {
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
})

await query(schemaSql)

app.listen(port, () => {
  console.log(`API server listening on http://127.0.0.1:${port}`)
})

process.on('SIGINT', async () => {
  await pool.end()
  process.exit(0)
})
