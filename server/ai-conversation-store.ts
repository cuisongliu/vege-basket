import crypto from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'

import {
  assertAiConversationContextMatches,
  buildAiSummaryOutcome,
  buildAiTurnModelContent,
  createAiConversationContext,
  deriveAiConversationTitle,
  encryptAiConversationTitle,
  encryptAiTurnAttachments,
  encryptAiTurnContent,
  isAiTurnRetryable,
  serializeAiConversation,
  serializeAiTurn,
  type AiConversationApiDto,
  type AiConversationContext,
  type AiTurnApiDto,
  type AiTurnAttachment,
  type AiTurnIntentKind,
} from './ai-conversations.ts'
import { decryptText, encryptText, verifyKeyedDigest } from './crypto.ts'
import { pool } from './db.ts'
import type { AiChatMessage } from './ai-provider.ts'
import {
  decodeAiConversationCursor,
  encodeAiConversationCursor,
} from './ai-conversation-cursor.ts'
import {
  buildAiClassificationContent,
  type AiInputIntent,
} from '../shared/ai-input-intent.ts'
import { buildAiWorkspaceTurnSourceAccessPredicate } from './ai-workspace-review.ts'
import { consumeAiIntentClassification } from './ai-intent-routing-store.ts'

const aiTurnLeaseMs = 120_000
const modelHistoryCompletedTurns = 3

type Queryable = Pick<PoolClient, 'query'>

type AiConversationRow = QueryResultRow & {
  contextKind: AiConversationContext['contextKind']
  createdAt: Date | string
  cursorLastTurnAt?: string
  id: string
  lastTurnAt: Date | string
  nextTurnNo: number
  projectId: string | null
  projectName: string | null
  title: string
  updatedAt: Date | string
  userId: string
}

type AiTurnRow = QueryResultRow & {
  assistantContent: string | null
  attemptCount: number
  completedAt: Date | string | null
  conversationId: string
  createdAt: Date | string
  errorCode: string | null
  id: string
  intentKind: AiTurnIntentKind
  intentPayload: string | null
  leaseToken: string | null
  status: AiTurnApiDto['status']
  turnNo: number
  updatedAt: Date | string
  userContent: string
}

type AiTurnAttachmentMetadataRow = QueryResultRow & {
  contentCharacters: number
  id: string
  mediaType: string
  name: string
  ordinal: number
  sizeBytes: number
  turnId: string
}

type AiTurnAttachmentRow = AiTurnAttachmentMetadataRow & {
  content: string
}

type AiTurnArtifactRow = {
  proposalBatchId: string | null
  proposalStatus: string | null
  summaryId: string | null
}

export type AiConversationListItemDto = AiConversationApiDto & {
  projectName: string | null
}

export type AiTurnDetailDto = AiTurnApiDto & {
  errorCode: string | null
  outcome:
    | { type: 'summary'; summaryId: number }
    | { batchId: number; status: string; type: 'todo-proposals' }
    | null
}

export type AiConversationPageDto = {
  conversations: AiConversationListItemDto[]
  nextCursor: string | null
}

export type AiTurnPageDto = {
  conversation: AiConversationListItemDto
  nextBeforeTurn: number | null
  turns: AiTurnDetailDto[]
}

export type StartAiTurnInput = {
  attachments: readonly AiTurnAttachment[]
  context: AiConversationContext
  conversationId: string
  turnId: string
  userContent: string
  userId: number
}

export type AiTurnExecution = {
  attachments: AiTurnAttachment[]
  context: AiConversationContext
  conversationId: string
  history: AiChatMessage[]
  intent: AiInputIntent
  intentKind: AiTurnIntentKind
  leaseToken: string
  modelContent: string
  projectId: number | null
  turnId: string
  turnNo: number
  userContent: string
}

export type StartedAiTurn = {
  conversation: AiConversationListItemDto
  duplicate: boolean
  execution: AiTurnExecution | null
  turn: AiTurnDetailDto
}

export class AiConversationStoreError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'AiConversationStoreError'
    this.code = code
    this.status = status
  }
}

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new AiConversationStoreError('AI_ID_INVALID', `${field} must be a UUID`, 400)
  }
}

function safeErrorCode(value: string) {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(normalized) ? normalized : 'AI_REQUEST_FAILED'
}

function conversationAccessPredicate(alias = 'c', userParameter = '$2') {
  return `(
    ${alias}.context_kind <> 'project'
    or exists (
      select 1
      from projects access_project
      left join project_memberships access_membership
        on access_membership.project_id = access_project.id
       and access_membership.invited_user_id = ${userParameter}
       and access_membership.status = 'active'
      where access_project.id = ${alias}.project_id
        and (access_project.user_id = ${userParameter} or access_membership.id is not null)
    )
  )`
}

async function hasProjectAccess(
  client: Queryable,
  projectId: number,
  userId: number,
  lockProject = false,
) {
  const result = await client.query<{ id: string }>(
    `
    select p.id
    from projects p
    left join project_memberships pm
      on pm.project_id = p.id
     and pm.invited_user_id = $2
     and pm.status = 'active'
    where p.id = $1
      and (p.user_id = $2 or pm.id is not null)
    limit 1
    ${lockProject ? 'for key share of p' : ''}
    `,
    [projectId, userId],
  )
  return Boolean(result.rows[0])
}

function conversationSelectSql() {
  return `
    select c.id,
           c.user_id as "userId",
           c.project_id as "projectId",
           c.context_kind as "contextKind",
           c.title,
           c.next_turn_no as "nextTurnNo",
           c.created_at as "createdAt",
           c.updated_at as "updatedAt",
           c.last_turn_at as "lastTurnAt",
           to_char(
             c.last_turn_at at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
           ) as "cursorLastTurnAt",
           p.name as "projectName"
    from ai_conversations c
    left join projects p on p.id = c.project_id
  `
}

async function getAccessibleConversationRow(
  client: Queryable,
  conversationId: string,
  userId: number,
  forUpdate = false,
) {
  const result = await client.query<AiConversationRow>(
    `${conversationSelectSql()}
    where c.id = $1
      and c.user_id = $2
      and ${conversationAccessPredicate()}
    ${forUpdate ? 'for update of c' : ''}
    `,
    [conversationId, userId],
  )
  return result.rows[0] ?? null
}

async function getOwnedConversationRow(
  client: Queryable,
  conversationId: string,
  userId: number,
  forUpdate = false,
) {
  const result = await client.query<AiConversationRow>(
    `${conversationSelectSql()}
    where c.id = $1 and c.user_id = $2
    ${forUpdate ? 'for update of c' : ''}
    `,
    [conversationId, userId],
  )
  return result.rows[0] ?? null
}

function conversationDto(row: AiConversationRow): AiConversationListItemDto {
  return {
    ...serializeAiConversation({
      contextKind: row.contextKind,
      createdAt: row.createdAt,
      id: row.id,
      lastTurnAt: row.lastTurnAt,
      projectId: row.projectId ? Number(row.projectId) : null,
      title: row.title,
      updatedAt: row.updatedAt,
    }),
    projectName: row.projectName ? decryptText(row.projectName) : null,
  }
}

function encodeConversationCursor(row: AiConversationRow) {
  const value = row.cursorLastTurnAt ?? new Date(row.lastTurnAt).toISOString()
  return encodeAiConversationCursor(value, row.id)
}

function decodeConversationCursor(cursor: string | undefined) {
  if (!cursor) return null
  try {
    return decodeAiConversationCursor(cursor)
  } catch {
    throw new AiConversationStoreError('AI_CURSOR_INVALID', 'Conversation cursor is invalid', 400)
  }
}

export async function listAiConversations(
  userId: number,
  options: { cursor?: string; limit?: number } = {},
): Promise<AiConversationPageDto> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 30), 1), 50)
  const cursor = decodeConversationCursor(options.cursor)
  const params: unknown[] = [userId]
  const cursorWhere = cursor
    ? (() => {
        params.push(cursor.lastTurnAt, cursor.id)
        return 'and (c.last_turn_at, c.id) < ($2::timestamptz, $3::uuid)'
      })()
    : ''
  params.push(limit + 1)
  const result = await pool.query<AiConversationRow>(
    `${conversationSelectSql()}
    where c.user_id = $1
      and ${conversationAccessPredicate('c', '$1')}
      ${cursorWhere}
    order by c.last_turn_at desc, c.id desc
    limit $${params.length}
    `,
    params,
  )
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit)
  return {
    conversations: rows.map(conversationDto),
    nextCursor: hasMore && rows.length > 0 ? encodeConversationCursor(rows.at(-1)!) : null,
  }
}

async function loadAttachmentMetadataRows(client: Queryable, turnIds: readonly string[]) {
  if (turnIds.length === 0) return []
  const result = await client.query<AiTurnAttachmentMetadataRow>(
    `
    select id,
           turn_id as "turnId",
           ordinal,
           name,
           media_type as "mediaType",
           size_bytes as "sizeBytes",
           content_characters as "contentCharacters"
    from ai_turn_attachments
    where turn_id = any($1::uuid[])
    order by turn_id, ordinal
    `,
    [turnIds],
  )
  return result.rows
}

async function loadAttachmentRows(client: Queryable, turnIds: readonly string[]) {
  if (turnIds.length === 0) return []
  const result = await client.query<AiTurnAttachmentRow>(
    `
    select id,
           turn_id as "turnId",
           ordinal,
           name,
           media_type as "mediaType",
           size_bytes as "sizeBytes",
           content_characters as "contentCharacters",
           content
    from ai_turn_attachments
    where turn_id = any($1::uuid[])
    order by turn_id, ordinal
    `,
    [turnIds],
  )
  return result.rows
}

function turnDto(
  row: AiTurnRow & AiTurnArtifactRow,
  attachments: readonly AiTurnAttachmentMetadataRow[],
): AiTurnDetailDto {
  const serialized = serializeAiTurn({
    assistantContent: row.assistantContent,
    attemptCount: Number(row.attemptCount),
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    id: row.id,
    intentKind: row.intentKind,
    status: row.status,
    turnNo: Number(row.turnNo),
    updatedAt: row.updatedAt,
    userContent: row.userContent,
  }, attachments.map((attachment) => ({
    id: Number(attachment.id),
    mediaType: attachment.mediaType,
    name: attachment.name,
    ordinal: Number(attachment.ordinal),
    sizeBytes: Number(attachment.sizeBytes),
  })))
  const summaryOutcome = buildAiSummaryOutcome(
    row.intentKind,
    row.summaryId ? Number(row.summaryId) : null,
  )
  const outcome = summaryOutcome ?? (row.proposalBatchId
      ? {
          batchId: Number(row.proposalBatchId),
          status: row.proposalStatus ?? 'pending',
          type: 'todo-proposals' as const,
        }
      : null)
  return { ...serialized, errorCode: row.errorCode, outcome }
}

async function getAiTurnRow(client: Queryable, turnId: string, userId: number) {
  const result = await client.query<AiTurnRow & AiTurnArtifactRow>(
    `
    select t.id,
           t.conversation_id as "conversationId",
           t.turn_no as "turnNo",
           t.intent_kind as "intentKind",
           t.intent_payload as "intentPayload",
           t.status,
           t.user_content as "userContent",
           t.assistant_content as "assistantContent",
           t.error_code as "errorCode",
           t.attempt_count as "attemptCount",
           t.lease_token as "leaseToken",
           t.created_at as "createdAt",
           t.updated_at as "updatedAt",
           t.completed_at as "completedAt",
           s.id as "summaryId",
           b.id as "proposalBatchId",
           b.status as "proposalStatus"
    from ai_turns t
    left join summaries s on s.source_turn_id = t.id and s.type <> 'reply'
    left join ai_todo_proposal_batches b on b.source_turn_id = t.id
    where t.id = $1
      and ${buildAiWorkspaceTurnSourceAccessPredicate('t', '$2')}
    `,
    [turnId, userId],
  )
  return result.rows[0] ?? null
}

export async function getAiConversationTurns(
  userId: number,
  conversationId: string,
  options: { beforeTurn?: number; limit?: number } = {},
): Promise<AiTurnPageDto> {
  assertUuid(conversationId, 'conversationId')
  const conversation = await getAccessibleConversationRow(pool, conversationId, userId)
  if (!conversation) throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 40), 1), 100)
  const params: unknown[] = [conversationId]
  const beforeWhere = Number.isSafeInteger(options.beforeTurn) && Number(options.beforeTurn) > 0
    ? (() => {
        params.push(Number(options.beforeTurn))
        return 'and t.turn_no < $2'
      })()
    : ''
  params.push(userId)
  const sourceAccessParameter = `$${params.length}`
  params.push(limit + 1)
  const result = await pool.query<AiTurnRow & AiTurnArtifactRow>(
    `
    select t.id,
           t.conversation_id as "conversationId",
           t.turn_no as "turnNo",
           t.intent_kind as "intentKind",
           t.intent_payload as "intentPayload",
           t.status,
           t.user_content as "userContent",
           t.assistant_content as "assistantContent",
           t.error_code as "errorCode",
           t.attempt_count as "attemptCount",
           t.lease_token as "leaseToken",
           t.created_at as "createdAt",
           t.updated_at as "updatedAt",
           t.completed_at as "completedAt",
           s.id as "summaryId",
           b.id as "proposalBatchId",
           b.status as "proposalStatus"
    from ai_turns t
    left join summaries s on s.source_turn_id = t.id and s.type <> 'reply'
    left join ai_todo_proposal_batches b on b.source_turn_id = t.id
    where t.conversation_id = $1
      ${beforeWhere}
      and ${buildAiWorkspaceTurnSourceAccessPredicate('t', sourceAccessParameter)}
    order by t.turn_no desc
    limit $${params.length}
    `,
    params,
  )
  const hasMore = result.rows.length > limit
  const rows = result.rows.slice(0, limit).reverse()
  const attachmentRows = await loadAttachmentMetadataRows(pool, rows.map((row) => row.id))
  return {
    conversation: conversationDto(conversation),
    nextBeforeTurn: hasMore && rows.length > 0 ? Number(rows[0].turnNo) : null,
    turns: rows.map((row) => turnDto(
      row,
      attachmentRows.filter((attachment) => attachment.turnId === row.id),
    )),
  }
}

function readAiTurnIntent(
  value: string | null,
  intentKind: AiTurnIntentKind,
  userContent: string,
  attachments: readonly AiTurnAttachment[],
): AiInputIntent {
  if (!value) {
    if (intentKind === 'todo-extraction') {
      const content = buildAiClassificationContent(userContent, attachments).trim()
      if (!content) throw new AiConversationStoreError('AI_TURN_INTENT_INVALID', 'AI turn intent is invalid', 500)
      return { content, kind: intentKind }
    }
    if (intentKind === 'project-summary' || intentKind === 'workspace-review') {
      const period = /(?:日报|日总结|今日|今天)/u.test(userContent) ? 'daily' : 'weekly'
      return { kind: intentKind, period }
    }
    return { kind: intentKind }
  }

  try {
    const parsed = JSON.parse(decryptText(value)) as Record<string, unknown>
    if (parsed.kind !== intentKind) throw new Error('intent kind mismatch')
    if (intentKind === 'project-summary') {
      if (parsed.period !== 'daily' && parsed.period !== 'weekly') throw new Error('invalid period')
      return { kind: intentKind, period: parsed.period }
    }
    if (intentKind === 'workspace-review') {
      if (parsed.period !== 'daily' && parsed.period !== 'weekly') throw new Error('invalid period')
      return { kind: intentKind, period: parsed.period }
    }
    if (intentKind === 'todo-extraction') {
      if (typeof parsed.content !== 'string' || !parsed.content.trim()) throw new Error('invalid todo content')
      return { content: parsed.content, kind: intentKind }
    }
    return { kind: intentKind }
  } catch (error) {
    if (error instanceof AiConversationStoreError) throw error
    throw new AiConversationStoreError('AI_TURN_INTENT_INVALID', 'AI turn intent is invalid', 500)
  }
}

async function loadTurnExecution(
  userId: number,
  conversationId: string,
  turnId: string,
  leaseToken: string,
): Promise<AiTurnExecution> {
  const conversation = await getAccessibleConversationRow(pool, conversationId, userId)
  if (!conversation) throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  const turnResult = await pool.query<AiTurnRow>(
    `
    select id,
           conversation_id as "conversationId",
           turn_no as "turnNo",
           intent_kind as "intentKind",
           intent_payload as "intentPayload",
           status,
           user_content as "userContent",
           assistant_content as "assistantContent",
           error_code as "errorCode",
           attempt_count as "attemptCount",
           lease_token as "leaseToken",
           created_at as "createdAt",
           updated_at as "updatedAt",
           completed_at as "completedAt"
    from ai_turns
    where id = $1
      and conversation_id = $2
      and status = 'processing'
      and lease_token = $3
      and lease_until > now()
    `,
    [turnId, conversationId, leaseToken],
  )
  const turn = turnResult.rows[0]
  if (!turn) {
    throw new AiConversationStoreError('AI_TURN_NOT_PROCESSING', 'AI turn is not processing', 409)
  }
  const currentAttachmentRows = await loadAttachmentRows(pool, [turnId])
  const attachments = currentAttachmentRows.map((attachment) => ({
    content: decryptText(attachment.content),
    mediaType: attachment.mediaType,
    name: decryptText(attachment.name),
    sizeBytes: Number(attachment.sizeBytes),
  }))
  const priorResult = await pool.query<AiTurnRow>(
    `
    select id,
           conversation_id as "conversationId",
           turn_no as "turnNo",
           intent_kind as "intentKind",
           intent_payload as "intentPayload",
           status,
           user_content as "userContent",
           assistant_content as "assistantContent",
           error_code as "errorCode",
           attempt_count as "attemptCount",
           lease_token as "leaseToken",
           created_at as "createdAt",
           updated_at as "updatedAt",
           completed_at as "completedAt"
    from ai_turns
    where conversation_id = $1
      and turn_no < $2
      and status = 'completed'
      and ${buildAiWorkspaceTurnSourceAccessPredicate('ai_turns', '$3')}
    order by turn_no desc
    limit $4
    `,
    [conversationId, turn.turnNo, userId, modelHistoryCompletedTurns],
  )
  const priorRows = priorResult.rows.reverse()
  const priorAttachments = await loadAttachmentRows(pool, priorRows.map((row) => row.id))
  const history = priorRows.flatMap<AiChatMessage>((row) => {
    const turnAttachments = priorAttachments
      .filter((attachment) => attachment.turnId === row.id)
      .map((attachment) => ({
        content: decryptText(attachment.content),
        mediaType: attachment.mediaType,
        name: decryptText(attachment.name),
        sizeBytes: Number(attachment.sizeBytes),
      }))
    return [
      {
        content: buildAiTurnModelContent(decryptText(row.userContent), turnAttachments),
        role: 'user' as const,
      },
      {
        content: decryptText(row.assistantContent ?? ''),
        role: 'assistant' as const,
      },
    ]
  })
  const context = createAiConversationContext(
    conversation.contextKind,
    conversation.projectId ? Number(conversation.projectId) : null,
  )
  const userContent = decryptText(turn.userContent)
  const intent = readAiTurnIntent(
    turn.intentPayload,
    turn.intentKind,
    userContent,
    attachments,
  )
  return {
    attachments,
    context,
    conversationId,
    history,
    intent,
    intentKind: turn.intentKind,
    leaseToken,
    modelContent: buildAiTurnModelContent(userContent, attachments),
    projectId: context.projectId,
    turnId,
    turnNo: Number(turn.turnNo),
    userContent,
  }
}

async function assertSameTurnPayload(
  client: Queryable,
  turn: AiTurnRow,
  input: StartAiTurnInput,
) {
  if (
    turn.conversationId !== input.conversationId ||
    decryptText(turn.userContent) !== input.userContent
  ) {
    throw new AiConversationStoreError('AI_TURN_ID_REUSED', 'Turn ID was reused with different content', 409)
  }
  const rows = await loadAttachmentRows(client, [turn.id])
  const matches = rows.length === input.attachments.length && rows.every((row, index) => {
    const attachment = input.attachments[index]
    return attachment &&
      row.ordinal === index &&
      decryptText(row.name) === attachment.name &&
      row.mediaType === attachment.mediaType &&
      Number(row.sizeBytes) === attachment.sizeBytes &&
      decryptText(row.content) === attachment.content
  })
  if (!matches) {
    throw new AiConversationStoreError('AI_TURN_ID_REUSED', 'Turn ID was reused with different attachments', 409)
  }
}

export async function startAiTurn(
  input: StartAiTurnInput,
  allowNewTurn: () => boolean,
): Promise<StartedAiTurn> {
  assertUuid(input.conversationId, 'conversationId')
  assertUuid(input.turnId, 'turnId')
  const client = await pool.connect()
  let leaseToken: string | null = null
  let duplicate = false
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [input.conversationId],
    )
    if (input.context.projectId) {
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`ai-project:${input.context.projectId}`],
      )
    }
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-cancel-user:${input.userId}`],
    )
    const cancellation = await client.query<{ conversationId: string }>(
      `
      select conversation_id as "conversationId"
      from ai_turn_cancellations
      where user_id = $1 and turn_id = $2
        and created_at >= now() - interval '10 minutes'
      for update
      `,
      [input.userId, input.turnId],
    )
    if (
      cancellation.rows[0] &&
      cancellation.rows[0].conversationId !== input.conversationId
    ) {
      throw new AiConversationStoreError(
        'AI_TURN_ID_REUSED',
        'Turn ID was reused with a different conversation',
        409,
      )
    }
    if (cancellation.rows[0]) {
      throw new AiConversationStoreError('AI_REQUEST_CANCELLED', 'AI turn was cancelled', 409)
    }
    const deletedConversation = await client.query<{ userId: string }>(
      `
      select user_id as "userId"
      from ai_conversation_tombstones
      where conversation_id = $1
      `,
      [input.conversationId],
    )
    if (deletedConversation.rows[0]) {
      throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
    }
    let conversation = await getOwnedConversationRow(client, input.conversationId, input.userId, true)
    if (conversation) {
      const storedContext = createAiConversationContext(
        conversation.contextKind,
        conversation.projectId ? Number(conversation.projectId) : null,
      )
      assertAiConversationContextMatches(storedContext, input.context)
      if (storedContext.projectId && !await hasProjectAccess(client, storedContext.projectId, input.userId)) {
        throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
      }
    }

    if (conversation) {
      await client.query(
        `
        update ai_turns
        set status = 'failed',
            error_code = 'AI_REQUEST_STALE',
            lease_token = null,
            lease_until = null,
            updated_at = now()
        where conversation_id = $1
          and status = 'processing'
          and lease_until <= now()
        `,
        [input.conversationId],
      )
    }

    const duplicateResult = await client.query<AiTurnRow>(
      `
      select id,
             conversation_id as "conversationId",
             turn_no as "turnNo",
             intent_kind as "intentKind",
             intent_payload as "intentPayload",
             status,
             user_content as "userContent",
             assistant_content as "assistantContent",
             error_code as "errorCode",
             attempt_count as "attemptCount",
             lease_token as "leaseToken",
             created_at as "createdAt",
             updated_at as "updatedAt",
             completed_at as "completedAt"
      from ai_turns
      where id = $1
      for update
      `,
      [input.turnId],
    )
    const existingTurn = duplicateResult.rows[0]
    if (existingTurn) {
      await assertSameTurnPayload(client, existingTurn, input)
      duplicate = true
    } else {
      const classified = await consumeAiIntentClassification(client, {
        attachments: input.attachments,
        requestedContext: input.context,
        turnId: input.turnId,
        userContent: input.userContent,
        userId: input.userId,
      }, { decryptText, digestMatches: verifyKeyedDigest })
      const classifiedIntent = classified.intent
      if (!conversation) {
        if (
          input.context.projectId &&
          !await hasProjectAccess(client, input.context.projectId, input.userId, true)
        ) {
          throw new AiConversationStoreError('AI_PROJECT_NOT_FOUND', 'Project not found', 404)
        }
      }
      if (!allowNewTurn()) {
        throw new AiConversationStoreError('AI_RATE_LIMITED', 'AI rate limit exceeded', 429)
      }
      if (!conversation) {
        const inserted = await client.query<AiConversationRow>(
          `
          insert into ai_conversations (
            id, user_id, project_id, context_kind, title
          )
          values ($1, $2, $3, $4, $5)
          returning id,
                    user_id as "userId",
                    project_id as "projectId",
                    context_kind as "contextKind",
                    title,
                    next_turn_no as "nextTurnNo",
                    created_at as "createdAt",
                    updated_at as "updatedAt",
                    last_turn_at as "lastTurnAt",
                    null::text as "projectName"
          `,
          [
            input.conversationId,
            input.userId,
            input.context.projectId,
            input.context.contextKind,
            encryptAiConversationTitle(deriveAiConversationTitle(input.userContent, input.attachments)),
          ],
        )
        conversation = inserted.rows[0]
      }
      const processing = await client.query<{ id: string }>(
        `select id from ai_turns where conversation_id = $1 and status = 'processing' limit 1`,
        [input.conversationId],
      )
      if (processing.rows[0]) {
        throw new AiConversationStoreError('AI_TURN_IN_PROGRESS', 'Conversation already has a processing turn', 409)
      }
      leaseToken = crypto.randomUUID()
      const turnNo = Number(conversation.nextTurnNo)
      await client.query(
        `
        insert into ai_turns (
          id,
          conversation_id,
          turn_no,
          intent_kind,
          intent_payload,
          status,
          user_content,
          lease_token,
          lease_until
        )
        values ($1, $2, $3, $4, $5, 'processing', $6, $7, now() + ($8 * interval '1 millisecond'))
        `,
        [
          input.turnId,
          input.conversationId,
          turnNo,
          classifiedIntent.kind,
          encryptText(JSON.stringify(classifiedIntent)),
          encryptAiTurnContent(input.userContent),
          leaseToken,
          aiTurnLeaseMs,
        ],
      )
      for (const attachment of encryptAiTurnAttachments(input.attachments)) {
        await client.query(
          `
          insert into ai_turn_attachments (
            turn_id, ordinal, name, media_type, size_bytes, content_characters, content
          )
          values ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            input.turnId,
            attachment.ordinal,
            attachment.name,
            attachment.mediaType,
            attachment.sizeBytes,
            attachment.contentCharacters,
            attachment.content,
          ],
        )
      }
      await client.query(
        `
        update ai_conversations
        set next_turn_no = next_turn_no + 1,
            updated_at = now(),
            last_turn_at = now()
        where id = $1
        `,
        [input.conversationId],
      )
    }
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }

  const conversation = await getAccessibleConversationRow(pool, input.conversationId, input.userId)
  const turn = await getAiTurnRow(pool, input.turnId, input.userId)
  if (!conversation || !turn) {
    throw new AiConversationStoreError('AI_TURN_NOT_FOUND', 'AI turn not found', 404)
  }
  const attachments = await loadAttachmentMetadataRows(pool, [turn.id])
  return {
    conversation: conversationDto(conversation),
    duplicate,
    execution: !duplicate && leaseToken
      ? await loadTurnExecution(input.userId, input.conversationId, input.turnId, leaseToken)
      : null,
    turn: turnDto(turn, attachments),
  }
}

export async function retryAiTurn(
  userId: number,
  conversationId: string,
  turnId: string,
): Promise<AiTurnExecution> {
  assertUuid(conversationId, 'conversationId')
  assertUuid(turnId, 'turnId')
  const client = await pool.connect()
  const leaseToken = crypto.randomUUID()
  try {
    await client.query('begin')
    const conversation = await getAccessibleConversationRow(client, conversationId, userId, true)
    if (!conversation) throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
    const result = await client.query<AiTurnRow>(
      `
      select id,
             conversation_id as "conversationId",
             turn_no as "turnNo",
             intent_kind as "intentKind",
             intent_payload as "intentPayload",
             status,
             user_content as "userContent",
             assistant_content as "assistantContent",
             error_code as "errorCode",
             attempt_count as "attemptCount",
             lease_token as "leaseToken",
             created_at as "createdAt",
             updated_at as "updatedAt",
             completed_at as "completedAt"
      from ai_turns
      where id = $1 and conversation_id = $2
      for update
      `,
      [turnId, conversationId],
    )
    const turn = result.rows[0]
    if (!turn) throw new AiConversationStoreError('AI_TURN_NOT_FOUND', 'AI turn not found', 404)
    if (!isAiTurnRetryable(turn.status)) {
      throw new AiConversationStoreError('AI_TURN_NOT_RETRYABLE', 'AI turn is not retryable', 409)
    }
    const latest = await client.query<{ turnNo: number }>(
      `select max(turn_no) as "turnNo" from ai_turns where conversation_id = $1`,
      [conversationId],
    )
    if (Number(latest.rows[0]?.turnNo) !== Number(turn.turnNo)) {
      throw new AiConversationStoreError('AI_TURN_NOT_LATEST', 'Only the latest turn can be retried', 409)
    }
    const processing = await client.query<{ id: string }>(
      `select id from ai_turns where conversation_id = $1 and status = 'processing' limit 1`,
      [conversationId],
    )
    if (processing.rows[0]) {
      throw new AiConversationStoreError('AI_TURN_IN_PROGRESS', 'Conversation already has a processing turn', 409)
    }
    await client.query(
      `
      update ai_turns
      set status = 'processing',
          error_code = null,
          attempt_count = attempt_count + 1,
          lease_token = $1,
          lease_until = now() + ($2 * interval '1 millisecond'),
          updated_at = now()
      where id = $3
      `,
      [leaseToken, aiTurnLeaseMs, turnId],
    )
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  return loadTurnExecution(userId, conversationId, turnId, leaseToken)
}

export async function assertAiTurnExecutionActive(
  userId: number,
  execution: AiTurnExecution,
) {
  const result = await pool.query<{ id: string }>(
    `
    select t.id
    from ai_turns t
    join ai_conversations c on c.id = t.conversation_id
    where t.id = $1
      and t.conversation_id = $2
      and t.status = 'processing'
      and t.lease_token = $3
      and t.lease_until > now()
      and c.user_id = $4
      and ${conversationAccessPredicate('c', '$4')}
    `,
    [execution.turnId, execution.conversationId, execution.leaseToken, userId],
  )
  if (!result.rows[0]) {
    throw new AiConversationStoreError('AI_TURN_CANCELLED', 'AI turn is no longer active', 409)
  }
}

export async function cancelAiTurn(userId: number, conversationId: string, turnId: string) {
  assertUuid(conversationId, 'conversationId')
  assertUuid(turnId, 'turnId')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [conversationId],
    )
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-cancel-user:${userId}`],
    )
    await client.query(
      `
      delete from ai_turn_cancellations
      where user_id = $1 and created_at < now() - interval '10 minutes'
      `,
      [userId],
    )
    const result = await client.query<{
      conversationId: string
      leaseToken: string | null
      status: AiTurnApiDto['status']
    }>(
      `
      select t.conversation_id as "conversationId", t.lease_token as "leaseToken", t.status
      from ai_turns t
      join ai_conversations c on c.id = t.conversation_id
      where t.id = $1
        and c.user_id = $2
      for update of t
      `,
      [turnId, userId],
    )
    const turn = result.rows[0]
    if (turn && turn.conversationId !== conversationId) {
      throw new AiConversationStoreError(
        'AI_TURN_ID_REUSED',
        'Turn ID was reused with a different conversation',
        409,
      )
    }
    if (!turn) {
      const existingClaim = await client.query<{ conversationId: string }>(
        `
        select conversation_id as "conversationId"
        from ai_turn_cancellations
        where user_id = $1 and turn_id = $2
        for update
        `,
        [userId, turnId],
      )
      if (
        existingClaim.rows[0] &&
        existingClaim.rows[0].conversationId !== conversationId
      ) {
        throw new AiConversationStoreError(
          'AI_TURN_ID_REUSED',
          'Turn ID was reused with a different conversation',
          409,
        )
      }
      if (existingClaim.rows[0]) {
        await client.query(
          `
          update ai_turn_cancellations
          set created_at = now()
          where user_id = $1 and turn_id = $2
          `,
          [userId, turnId],
        )
        await client.query('commit')
        return { cancelled: true, leaseToken: null, pending: true } as const
      }
      const claimCount = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from ai_turn_cancellations
        where user_id = $1
        `,
        [userId],
      )
      if (Number(claimCount.rows[0]?.count ?? 0) >= 20) {
        throw new AiConversationStoreError(
          'AI_CANCEL_RATE_LIMITED',
          'Too many pending AI cancellations',
          429,
        )
      }
      await client.query(
        `
        insert into ai_turn_cancellations (user_id, conversation_id, turn_id)
        values ($1, $2, $3)
        `,
        [userId, conversationId, turnId],
      )
      await client.query('commit')
      return { cancelled: true, leaseToken: null, pending: true } as const
    }
    if (turn.status === 'processing' && turn.leaseToken) {
      await client.query(
        `
        update ai_turns
        set status = 'cancelled',
            error_code = 'AI_REQUEST_CANCELLED',
            lease_token = null,
            lease_until = null,
            updated_at = now()
        where id = $1 and lease_token = $2
        `,
        [turnId, turn.leaseToken],
      )
    }
    await client.query('commit')
    return {
      cancelled: turn.status === 'processing',
      leaseToken: turn.status === 'processing' ? turn.leaseToken : null,
      pending: false,
    } as const
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function reconcileAiTurn(userId: number, conversationId: string, turnId: string) {
  assertUuid(conversationId, 'conversationId')
  assertUuid(turnId, 'turnId')
  const client = await pool.connect()
  try {
    await client.query('begin')
    const ownedConversation = await getOwnedConversationRow(client, conversationId, userId)
    const projectId = ownedConversation?.projectId ? Number(ownedConversation.projectId) : null
    if (projectId) {
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`ai-project:${projectId}`],
      )
    }
    const conversation = await getAccessibleConversationRow(client, conversationId, userId, true)
    if (!conversation) {
      throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
    }
    await client.query(
      `
      update ai_turns
      set status = 'failed',
          error_code = 'AI_REQUEST_STALE',
          lease_token = null,
          lease_until = null,
          updated_at = now()
      where id = $1
        and conversation_id = $2
        and status = 'processing'
        and lease_until <= now()
      `,
      [turnId, conversationId],
    )
    const turn = await getAiTurnRow(client, turnId, userId)
    if (!turn || turn.conversationId !== conversationId) {
      throw new AiConversationStoreError('AI_TURN_NOT_FOUND', 'AI turn not found', 404)
    }
    const result = {
      conversation: conversationDto(conversation),
      turn: turnDto(turn, await loadAttachmentMetadataRows(client, [turnId])),
    }
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function failAiTurn(turnId: string, leaseToken: string, errorCode: string) {
  const result = await pool.query<{ id: string }>(
    `
    update ai_turns
    set status = 'failed',
        error_code = $1,
        lease_token = null,
        lease_until = null,
        updated_at = now()
    where id = $2
      and status = 'processing'
      and lease_token = $3
    returning id
    `,
    [safeErrorCode(errorCode), turnId, leaseToken],
  )
  return Boolean(result.rows[0])
}

export async function completeAiTurn<T>(
  userId: number,
  execution: AiTurnExecution,
  assistantContent: string,
  writeArtifact?: (client: PoolClient, turnId: string) => Promise<T>,
): Promise<{
  completed: boolean
  conversation: AiConversationListItemDto | null
  outcome: T | null
  turn: AiTurnDetailDto | null
}> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (execution.projectId) {
      await client.query(
        `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`ai-project:${execution.projectId}`],
      )
    }
    const conversation = await getAccessibleConversationRow(
      client,
      execution.conversationId,
      userId,
      true,
    )
    if (!conversation) {
      await client.query(
        `
        update ai_turns
        set status = 'cancelled',
            error_code = 'AI_PROJECT_ACCESS_REVOKED',
            lease_token = null,
            lease_until = null,
            updated_at = now()
        where id = $1 and status = 'processing' and lease_token = $2
        `,
        [execution.turnId, execution.leaseToken],
      )
      await client.query('commit')
      return { completed: false, conversation: null, outcome: null, turn: null }
    }
    const turnResult = await client.query<{ id: string }>(
      `
      select id
      from ai_turns
      where id = $1
        and conversation_id = $2
        and status = 'processing'
        and lease_token = $3
        and lease_until > now()
      for update
      `,
      [execution.turnId, execution.conversationId, execution.leaseToken],
    )
    if (!turnResult.rows[0]) {
      await client.query('rollback')
      return { completed: false, conversation: null, outcome: null, turn: null }
    }
    const outcome = writeArtifact ? await writeArtifact(client, execution.turnId) : null
    await client.query(
      `
      update ai_turns
      set status = 'completed',
          assistant_content = $1,
          error_code = null,
          lease_token = null,
          lease_until = null,
          completed_at = now(),
          updated_at = now()
      where id = $2
      `,
      [encryptText(assistantContent), execution.turnId],
    )
    await client.query(
      `update ai_conversations set updated_at = now(), last_turn_at = now() where id = $1`,
      [execution.conversationId],
    )
    const updatedConversation = await getAccessibleConversationRow(
      client,
      execution.conversationId,
      userId,
    )
    if (!updatedConversation) {
      throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
    }
    const completedTurn = await getAiTurnRow(client, execution.turnId, userId)
    if (!completedTurn) {
      throw new AiConversationStoreError('AI_TURN_NOT_FOUND', 'AI turn not found', 404)
    }
    const turn = turnDto(
      completedTurn,
      await loadAttachmentMetadataRows(client, [execution.turnId]),
    )
    await client.query('commit')
    return {
      completed: true,
      conversation: conversationDto(updatedConversation),
      outcome,
      turn,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function renameAiConversation(userId: number, conversationId: string, title: string) {
  assertUuid(conversationId, 'conversationId')
  const conversation = await getAccessibleConversationRow(pool, conversationId, userId)
  if (!conversation) throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  await pool.query(
    `update ai_conversations set title = $1, updated_at = now() where id = $2 and user_id = $3`,
    [encryptAiConversationTitle(title), conversationId, userId],
  )
  const updated = await getAccessibleConversationRow(pool, conversationId, userId)
  if (!updated) throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  return conversationDto(updated)
}

export async function deleteAiConversation(userId: number, conversationId: string) {
  assertUuid(conversationId, 'conversationId')
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [conversationId],
    )
    const conversation = await getOwnedConversationRow(client, conversationId, userId, true)
    if (!conversation) {
      const deletedConversation = await client.query<{ conversationId: string }>(
        `
        select conversation_id as "conversationId"
        from ai_conversation_tombstones
        where conversation_id = $1 and user_id = $2
        `,
        [conversationId, userId],
      )
      if (deletedConversation.rows[0]) {
        await client.query('commit')
        return true
      }
      await client.query('rollback')
      return false
    }
    await client.query(
      `
      insert into ai_conversation_tombstones (conversation_id, user_id)
      values ($1, $2)
      on conflict (conversation_id) do nothing
      `,
      [conversationId, userId],
    )
    await client.query(
      `
      delete from ai_todo_proposal_batches b
      using ai_turns t
      where b.source_turn_id = t.id
        and t.conversation_id = $1
        and b.status = 'pending'
      `,
      [conversationId],
    )
    await client.query(
      `delete from ai_conversations where id = $1 and user_id = $2`,
      [conversationId, userId],
    )
    await client.query('commit')
    return true
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function getAiTurnDetail(userId: number, conversationId: string, turnId: string) {
  const conversation = await getAccessibleConversationRow(pool, conversationId, userId)
  if (!conversation) throw new AiConversationStoreError('AI_CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  const turn = await getAiTurnRow(pool, turnId, userId)
  if (!turn || turn.conversationId !== conversationId) {
    throw new AiConversationStoreError('AI_TURN_NOT_FOUND', 'AI turn not found', 404)
  }
  return turnDto(turn, await loadAttachmentMetadataRows(pool, [turnId]))
}
