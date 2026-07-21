import { decryptText } from './crypto.ts'
import { query } from './db.ts'
import type { PoolClient } from 'pg'
import {
  getAiSummaryPeriod,
  type AiTodoActivityFact,
} from './ai-period-summary.ts'
import {
  AI_WORKSPACE_ACCESS_RECHECK_QUERY,
  AI_WORKSPACE_ACTIVITY_QUERY,
  AI_WORKSPACE_JOURNALS_QUERY,
  AI_WORKSPACE_OPEN_TODOS_QUERY,
  AI_WORKSPACE_PROJECTS_QUERY,
  AI_WORKSPACE_RISKS_QUERY,
  buildAiWorkspaceReviewContext,
  type AiWorkspaceJournalFact,
  type AiWorkspaceOpenTodoFact,
  type AiWorkspaceProjectFact,
  type AiWorkspaceRiskFact,
} from './ai-workspace-review.ts'

type ProjectAccessRole = 'member' | 'owner'
type ProjectStatus = 'active' | 'archived' | 'completed' | 'paused'
type Priority = 'high' | 'low' | 'medium'
type TodoActivityEventType =
  | 'assigned'
  | 'completed'
  | 'confirmed'
  | 'created'
  | 'rejected'
  | 'reopened'

export type AiPeriodActivityRow = {
  actor_display_name: string | null
  actor_email: string | null
  actor_user_id: string | null
  assignee_display_name: string | null
  assignee_email: string | null
  assignee_user_id: string | null
  due_date: Date
  event_type: TodoActivityEventType
  occurred_at: Date
  priority: Priority
  project_name: string
  title: string
  todo_id: string | null
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
})

function formatDate(value: Date | string) {
  const parts = dateFormatter.formatToParts(value instanceof Date ? value : new Date(value))
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

function displayName(email: string | null, name: string | null) {
  return name || email || '未知用户'
}

export function toAiTodoActivityFacts(rows: readonly AiPeriodActivityRow[]) {
  return rows
    .filter((event) => event.todo_id)
    .map((event): AiTodoActivityFact => ({
      actorName: event.actor_user_id
        ? displayName(event.actor_email, event.actor_display_name)
        : undefined,
      assigneeName: event.assignee_user_id
        ? displayName(event.assignee_email, event.assignee_display_name)
        : undefined,
      dueDate: formatDate(event.due_date),
      kind: event.event_type,
      occurredAt: event.occurred_at,
      priority: event.priority,
      projectName: decryptText(event.project_name),
      title: decryptText(event.title),
      todoId: Number(event.todo_id),
    }))
}

export async function loadAiWorkspaceReviewRequest(
  userId: number,
  type: 'daily' | 'weekly',
  maxContextCharacters: number,
) {
  const period = getAiSummaryPeriod(type)
  const projectsResult = await query<{
    access_role: ProjectAccessRole
    id: string
    name: string
    status: ProjectStatus
  }>(AI_WORKSPACE_PROJECTS_QUERY, [userId])
  const projectIds = projectsResult.rows.map((project) => Number(project.id))
  const projects: AiWorkspaceProjectFact[] = projectsResult.rows.map((project) => ({
    accessRole: project.access_role,
    name: decryptText(project.name),
    status: project.status,
  }))
  if (projectIds.length === 0) {
    return {
      ...buildAiWorkspaceReviewContext(period, {
        activity: [],
        journals: [],
        openTodos: [],
        projects,
        risks: [],
      }, maxContextCharacters),
      projectIds,
    }
  }

  const [journalsResult, activityResult, openTodosResult, risksResult] = await Promise.all([
    query<{
      author_display_name: string | null
      author_email: string | null
      content: string
      created_at: Date
      project_name: string
    }>(
      AI_WORKSPACE_JOURNALS_QUERY,
      [userId, projectIds, period.start, period.endExclusive],
    ),
    query<AiPeriodActivityRow>(
      AI_WORKSPACE_ACTIVITY_QUERY,
      [userId, projectIds, period.start, period.endExclusive],
    ),
    query<{
      assignee_display_name: string | null
      assignee_email: string | null
      detail: string
      due_date: Date
      id: string
      priority: Priority
      project_name: string
      title: string
    }>(AI_WORKSPACE_OPEN_TODOS_QUERY, [userId, projectIds]),
    query<{
      content: string
      project_name: string
    }>(AI_WORKSPACE_RISKS_QUERY, [userId, projectIds]),
  ])

  const journals: AiWorkspaceJournalFact[] = journalsResult.rows.map((journal) => ({
    authorName: displayName(journal.author_email, journal.author_display_name),
    content: decryptText(journal.content),
    createdAt: journal.created_at,
    projectName: decryptText(journal.project_name),
  }))
  const openTodos: AiWorkspaceOpenTodoFact[] = openTodosResult.rows.map((todo) => ({
    assigneeName: todo.assignee_email || todo.assignee_display_name
      ? displayName(todo.assignee_email, todo.assignee_display_name)
      : undefined,
    detail: todo.detail ? decryptText(todo.detail) : '',
    dueDate: formatDate(todo.due_date),
    priority: todo.priority,
    projectName: decryptText(todo.project_name),
    title: decryptText(todo.title),
    todoId: Number(todo.id),
  }))
  const risks: AiWorkspaceRiskFact[] = risksResult.rows.map((risk) => ({
    content: decryptText(risk.content),
    projectName: decryptText(risk.project_name),
  }))

  return {
    ...buildAiWorkspaceReviewContext(period, {
      activity: toAiTodoActivityFacts(activityResult.rows),
      journals,
      openTodos,
      projects,
      risks,
    }, maxContextCharacters),
    projectIds,
  }
}

export async function hasAiWorkspaceReviewAccess(
  userId: number,
  projectIds: readonly number[],
) {
  if (projectIds.length === 0) return true
  const uniqueProjectIds = [...new Set(projectIds)]
  const result = await query<{ accessible_count: string }>(
    AI_WORKSPACE_ACCESS_RECHECK_QUERY,
    [userId, uniqueProjectIds],
  )
  return Number(result.rows[0]?.accessible_count ?? 0) === uniqueProjectIds.length
}

export async function writeAiWorkspaceReviewProjectSources(
  client: PoolClient,
  userId: number,
  turnId: string,
  projectIds: readonly number[],
) {
  const uniqueProjectIds = [...new Set(projectIds)].sort((left, right) => left - right)
  for (const projectId of uniqueProjectIds) {
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-project:${projectId}`],
    )
    const project = await client.query<{ owner_user_id: string }>(
      `select user_id as owner_user_id from projects where id = $1 for update`,
      [projectId],
    )
    if (!project.rows[0]) return false
    if (Number(project.rows[0].owner_user_id) !== userId) {
      const membership = await client.query<{ id: string }>(
        `
        select id
        from project_memberships
        where project_id = $1
          and invited_user_id = $2
          and status = 'active'
        for update
        `,
        [projectId, userId],
      )
      if (!membership.rows[0]) return false
    }
  }
  if (uniqueProjectIds.length > 0) {
    await client.query(
      `
      insert into ai_turn_project_sources (turn_id, project_id)
      select $1::uuid, source_project_id
      from unnest($2::bigint[]) source_project_id
      on conflict (turn_id, project_id) do nothing
      `,
      [turnId, uniqueProjectIds],
    )
  }
  return true
}
