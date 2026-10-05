import crypto from 'node:crypto'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { decryptText, encryptText } from './crypto.ts'
import type { AiCompletionRequest, AiProviderConfig } from './ai-provider.ts'

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>
type QueryFunction = <T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<QueryResult<T>>
type Database = Queryable | QueryFunction

function runQuery<T extends QueryResultRow = QueryResultRow>(database: Database, text: string, params?: unknown[]) {
  return typeof database === 'function' ? database<T>(text, params) : database.query<T>(text, params)
}

const maxRequestChars = 32_000
const maxResponseChars = 32_000
const maxErrorChars = 4_000

export type AiActivityContext = {
  captureContent?: boolean
  conversationId?: string
  module: string
  operation: string
  relatedType?: string
  relatedId?: string
  sourceProjectIds?: number[]
  turnId?: string
  imageCount?: number
}

export type AiActivityRecord = {
  id: string
  module: string
  operation: string
  status: 'processing' | 'completed' | 'failed' | 'cancelled'
  model: string | null
  relatedType: string | null
  relatedId: string | null
  imageCount: number
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  createdAt: string
}

export type AiActivityDetail = AiActivityRecord & {
  request: string
  response: string
  error: string
}

type ActivityRow = QueryResultRow & {
  id: string
  module: string
  operation: string
  status: AiActivityRecord['status']
  model: string | null
  related_type: string | null
  related_id: string | null
  image_count: number
  started_at: Date | string
  completed_at: Date | string | null
  duration_ms: number | null
  created_at: Date | string
  request_content?: string | null
  response_content?: string | null
  error_content?: string | null
  canonical_user_content?: string | null
  canonical_assistant_content?: string | null
  canonical_error_code?: string | null
}

function bounded(value: string, limit: number) {
  const trimmed = value.trim()
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit - 3)}...`
}

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null
}

function toRecord(row: ActivityRow): AiActivityRecord {
  return {
    id: row.id,
    module: row.module,
    operation: row.operation,
    status: row.status,
    model: row.model,
    relatedType: row.related_type,
    relatedId: row.related_id,
    imageCount: Number(row.image_count ?? 0),
    startedAt: iso(row.started_at)!,
    completedAt: iso(row.completed_at),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    createdAt: iso(row.created_at)!,
  }
}

function toDetail(row: ActivityRow): AiActivityDetail {
  return {
    ...toRecord(row),
    request: row.request_content
      ? decryptText(row.request_content)
      : row.canonical_user_content ? decryptText(row.canonical_user_content) : '',
    response: row.response_content
      ? decryptText(row.response_content)
      : row.canonical_assistant_content ? decryptText(row.canonical_assistant_content) : '',
    error: row.error_content ? decryptText(row.error_content) : row.canonical_error_code ?? '',
  }
}

export function summarizeAiRequest(request: AiCompletionRequest) {
  return JSON.stringify({
    systemPrompt: bounded(request.systemPrompt, 8_000),
    messages: request.messages.slice(-8).map((message) => ({
      role: message.role,
      content: bounded(message.content, 8_000),
    })),
    untrustedContext: request.untrustedContext ? bounded(request.untrustedContext, 12_000) : '',
    imageCount: request.imageParts?.length ?? 0,
    responseFormat: request.responseFormat ?? null,
    temperature: request.temperature ?? null,
    timeoutMs: request.timeoutMs ?? null,
  }, null, 2)
}

export async function startAiActivity(
  database: Database,
  userId: number,
  context: AiActivityContext,
  request: string,
  model?: string,
) {
  const id = crypto.randomUUID()
  const captureContent = context.captureContent !== false
  await runQuery(database,
    `insert into ai_activity_records
      (id, user_id, module, operation, status, model, related_type, related_id,
       conversation_id, turn_id, source_project_ids, request_content, image_count)
     values ($1, $2, $3, $4, 'processing', $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      userId,
      bounded(context.module, 80),
      bounded(context.operation, 120),
      model ?? null,
      context.relatedType ?? null,
      context.relatedId ?? null,
      context.conversationId ?? null,
      context.turnId ?? null,
      [...new Set((context.sourceProjectIds ?? []).filter((id) => Number.isSafeInteger(id) && id > 0))],
      captureContent && request ? encryptText(bounded(request, maxRequestChars)) : null,
      Math.max(0, Math.min(100, Math.trunc(context.imageCount ?? 0))),
    ],
  )
  return { captureContent, id, startedAt: Date.now() }
}

export async function completeAiActivity(
  database: Database,
  activity: { captureContent?: boolean; id: string; startedAt: number },
  response: string,
) {
  await runQuery(database,
    `update ai_activity_records
     set status = 'completed', response_content = $1, completed_at = now(), duration_ms = $2
     where id = $3`,
    [activity.captureContent === false ? null : encryptText(bounded(response, maxResponseChars)), Math.max(0, Date.now() - activity.startedAt), activity.id],
  )
}

export async function failAiActivity(
  database: Database,
  activity: { captureContent?: boolean; id: string; startedAt: number },
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error)
  const cancelled = typeof error === 'object' && error !== null && 'code' in error && error.code === 'AI_REQUEST_CANCELLED'
  await runQuery(database,
    `update ai_activity_records
     set status = $1, error_content = $2, completed_at = now(), duration_ms = $3
     where id = $4`,
    [cancelled ? 'cancelled' : 'failed', encryptText(bounded(message, maxErrorChars)), Math.max(0, Date.now() - activity.startedAt), activity.id],
  )
}

export async function failAiActivityForTurn(
  database: Database,
  userId: number,
  turnId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error)
  const cancelled = typeof error === 'object' && error !== null && 'code' in error && error.code === 'AI_REQUEST_CANCELLED'
  await runQuery(database,
    `update ai_activity_records
        set status = $1,
            error_content = coalesce(error_content, $2),
            completed_at = coalesce(completed_at, now()),
            duration_ms = coalesce(
              duration_ms,
              greatest(0, (extract(epoch from (clock_timestamp() - started_at)) * 1000)::integer)
            )
      where user_id = $3
        and turn_id = $4
        and status in ('processing', 'completed')`,
    [cancelled ? 'cancelled' : 'failed', encryptText(bounded(message, maxErrorChars)), userId, turnId],
  )
}

export async function listAiActivities(
  database: Database,
  userId: number,
  options: { cursor?: string; limit?: number; module?: string; status?: AiActivityRecord['status'] } = {},
) {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)))
  const values: unknown[] = [userId]
  const conditions = ['user_id = $1']
  if (options.cursor) {
    values.push(options.cursor)
    conditions.push(`(created_at, id) < (select created_at, id from ai_activity_records where id = $${values.length} and user_id = $1)`)
  }
  if (options.module) {
    values.push(options.module)
    conditions.push(`module = $${values.length}`)
  }
  if (options.status) {
    values.push(options.status)
    conditions.push(`status = $${values.length}`)
  }
  values.push(limit + 1)
  const result = await runQuery<ActivityRow>(database,
    `select id, module, operation, status, model, related_type, related_id, image_count,
            started_at, completed_at, duration_ms, created_at
       from ai_activity_records
      where ${conditions.join(' and ')}
      order by created_at desc, id desc
      limit $${values.length}`,
    values,
  )
  const rows = result.rows.slice(0, limit)
  return {
    items: rows.map(toRecord),
    nextCursor: result.rows.length > limit ? rows.at(-1)?.id ?? null : null,
  }
}

export async function getAiActivityDetail(database: Database, userId: number, id: string) {
  const result = await runQuery<ActivityRow>(database,
    `select activity.id, activity.module, activity.operation, activity.status, activity.model,
            activity.related_type, activity.related_id, activity.image_count,
            activity.started_at, activity.completed_at, activity.duration_ms, activity.created_at,
            activity.request_content, activity.response_content, activity.error_content,
            turn.user_content as canonical_user_content,
            turn.assistant_content as canonical_assistant_content,
            turn.error_code as canonical_error_code
       from ai_activity_records activity
       left join ai_turns turn
         on turn.id = activity.turn_id
        and turn.conversation_id = activity.conversation_id
       left join ai_conversations conversation
         on conversation.id = activity.conversation_id
        and conversation.user_id = activity.user_id
      where activity.id = $1 and activity.user_id = $2
        and (activity.turn_id is null or turn.id is not null)
        and (activity.conversation_id is null or conversation.id is not null)
        and not exists (
          select 1
          from unnest(activity.source_project_ids) source(project_id)
          where not exists (
            select 1 from projects project
            left join project_memberships membership
              on membership.project_id = project.id
             and membership.invited_user_id = $2
             and membership.status = 'active'
            where project.id = source.project_id
              and (project.user_id = $2 or membership.id is not null)
          )
        )
        and (
          activity.related_type is distinct from 'organization'
          or exists (
            select 1 from organization_memberships membership
            where membership.organization_id = activity.related_id::bigint
              and membership.user_id = $2
              and membership.status = 'active'
          )
        )
        and (
          activity.related_type is distinct from 'bug'
          or exists (
            select 1
            from test_bugs bug
            join test_spaces space on space.id = bug.test_space_id
            left join test_space_memberships membership
              on membership.test_space_id = space.id
             and membership.user_id = $2
             and membership.status = 'active'
            where bug.id = activity.related_id::bigint
              and (
                space.owner_user_id = $2
                or membership.user_id is not null
                or bug.reporter_user_id = $2
                or bug.assignee_user_id = $2
                or exists (
                  select 1
                  from organization_memberships organization_membership
                  join user_roles role
                    on role.user_id = organization_membership.user_id
                   and role.role = 'organization_admin'
                  where organization_membership.organization_id = space.organization_id
                    and organization_membership.user_id = $2
                    and organization_membership.status = 'active'
                    and organization_membership.access_role in ('owner', 'admin')
                )
              )
          )
        )`,
    [id, userId],
  )
  return result.rows[0] ? toDetail(result.rows[0]) : null
}

export async function withAiActivity<T>(params: {
  database: Database
  userId: number
  context: AiActivityContext
  config: AiProviderConfig
  request: AiCompletionRequest
  execute: () => Promise<T>
  responseText: (value: T) => string
}) {
  const activity = await startAiActivity(
    params.database,
    params.userId,
    params.context,
    summarizeAiRequest(params.request),
    params.config.model,
  )
  try {
    const value = await params.execute()
    await completeAiActivity(params.database, activity, params.responseText(value))
    return value
  } catch (error) {
    try { await failAiActivity(params.database, activity, error) } catch { /* preserve provider error */ }
    throw error
  }
}
