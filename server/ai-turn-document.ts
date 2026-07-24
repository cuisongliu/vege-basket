import type { Pool, PoolClient, QueryResultRow } from 'pg'

export const AI_TURN_DOCUMENT_TITLE_MAX_CHARACTERS = 80

type AiTurnDocumentDatabase = Pick<Pool, 'connect'>

export type AiTurnDocumentDependencies = {
  database: AiTurnDocumentDatabase
  decryptText: (value: string) => string
  encryptText: (value: string) => string
}

export type AiTurnDocumentInput = {
  conversationId: string
  turnId: string
  userId: number
}

export type AiTurnDocumentResult = {
  created: boolean
  summaryId: number
}

type ConversationRow = QueryResultRow & {
  contextKind: string
  projectId: string | null
}

type ProjectRow = QueryResultRow & {
  ownerUserId: string
}

type TurnRow = QueryResultRow & {
  assistantContent: string | null
  intentKind: string
  status: string
  userContent: string
}

export class AiTurnDocumentError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'AiTurnDocumentError'
    this.code = code
    this.status = status
  }
}

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new AiTurnDocumentError('AI_ID_INVALID', `${field} must be a UUID`, 400)
  }
}

function normalizeVisibleText(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('').replace(/\s+/gu, ' ').trim()
}

export function deriveAiTurnDocumentTitle(question: string) {
  const normalized = normalizeVisibleText(question) || 'AI 对话回复'
  const characters = Array.from(normalized)
  if (characters.length <= AI_TURN_DOCUMENT_TITLE_MAX_CHARACTERS) return normalized
  return `${characters.slice(0, AI_TURN_DOCUMENT_TITLE_MAX_CHARACTERS - 3).join('')}...`
}

async function loadConversation(
  client: PoolClient,
  input: AiTurnDocumentInput,
  lock: boolean,
) {
  const result = await client.query<ConversationRow>(
    `
    select project_id as "projectId",
           context_kind as "contextKind"
    from ai_conversations
    where id = $1 and user_id = $2
    ${lock ? 'for share' : ''}
    `,
    [input.conversationId, input.userId],
  )
  const conversation = result.rows[0]
  if (!conversation) {
    throw new AiTurnDocumentError(
      'AI_CONVERSATION_NOT_FOUND',
      'Conversation not found',
      404,
    )
  }
  if (conversation.contextKind !== 'project' || !conversation.projectId) {
    throw new AiTurnDocumentError(
      'AI_DOCUMENT_PROJECT_CONTEXT_REQUIRED',
      'Only project conversation replies can be saved as documents',
      409,
    )
  }
  return conversation
}

async function assertProjectAccess(client: PoolClient, projectId: number, userId: number) {
  const projectResult = await client.query<ProjectRow>(
    `select user_id as "ownerUserId" from projects where id = $1 for share`,
    [projectId],
  )
  const project = projectResult.rows[0]
  if (!project) {
    throw new AiTurnDocumentError('AI_PROJECT_NOT_FOUND', 'Project not found', 404)
  }
  if (Number(project.ownerUserId) === userId) return

  const membership = await client.query<{ id: string }>(
    `
    select id
    from project_memberships
    where project_id = $1
      and invited_user_id = $2
      and status = 'active'
    for share
    `,
    [projectId, userId],
  )
  if (!membership.rows[0]) {
    throw new AiTurnDocumentError('AI_PROJECT_NOT_FOUND', 'Project not found', 404)
  }
}

async function loadCanonicalTurn(client: PoolClient, input: AiTurnDocumentInput) {
  const result = await client.query<TurnRow>(
    `
    select status,
           intent_kind as "intentKind",
           user_content as "userContent",
           assistant_content as "assistantContent"
    from ai_turns
    where id = $1 and conversation_id = $2
    for share
    `,
    [input.turnId, input.conversationId],
  )
  const turn = result.rows[0]
  if (!turn) {
    throw new AiTurnDocumentError('AI_TURN_NOT_FOUND', 'AI turn not found', 404)
  }
  if (turn.status !== 'completed') {
    throw new AiTurnDocumentError(
      'AI_DOCUMENT_TURN_NOT_COMPLETED',
      'Only a completed AI turn can be saved as a document',
      409,
    )
  }
  if (turn.intentKind !== 'chat') {
    throw new AiTurnDocumentError(
      'AI_DOCUMENT_TURN_UNSUPPORTED',
      'Only an ordinary chat reply can be saved as a document',
      409,
    )
  }
  const assistantContent = turn.assistantContent
  if (assistantContent === null) {
    throw new AiTurnDocumentError(
      'AI_DOCUMENT_ASSISTANT_EMPTY',
      'The AI turn has no completed reply to save',
      409,
    )
  }
  return { ...turn, assistantContent }
}

async function existingSummaryId(
  client: PoolClient,
  input: AiTurnDocumentInput,
  projectId: number,
) {
  const result = await client.query<{ id: string }>(
    `
    select id
    from summaries
    where source_turn_id = $1
      and user_id = $2
      and project_id = $3
    `,
    [input.turnId, input.userId, projectId],
  )
  return result.rows[0] ? Number(result.rows[0].id) : null
}

export async function createAiTurnDocument(
  input: AiTurnDocumentInput,
  dependencies: AiTurnDocumentDependencies,
): Promise<AiTurnDocumentResult> {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new AiTurnDocumentError('AI_ID_INVALID', 'userId must be a positive integer', 400)
  }
  assertUuid(input.conversationId, 'conversationId')
  assertUuid(input.turnId, 'turnId')

  const client = await dependencies.database.connect()
  try {
    await client.query('begin')
    const initialConversation = await loadConversation(client, input, false)
    const projectId = Number(initialConversation.projectId)
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new AiTurnDocumentError('AI_PROJECT_NOT_FOUND', 'Project not found', 404)
    }

    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-project:${projectId}`],
    )
    const lockedConversation = await loadConversation(client, input, true)
    if (Number(lockedConversation.projectId) !== projectId) {
      throw new AiTurnDocumentError(
        'AI_DOCUMENT_CONTEXT_CHANGED',
        'Conversation project context changed',
        409,
      )
    }
    await assertProjectAccess(client, projectId, input.userId)
    const turn = await loadCanonicalTurn(client, input)

    const priorSummaryId = await existingSummaryId(client, input, projectId)
    if (priorSummaryId !== null) {
      await client.query('commit')
      return { created: false, summaryId: priorSummaryId }
    }

    const assistantContent = dependencies.decryptText(turn.assistantContent)
    if (!assistantContent.trim()) {
      throw new AiTurnDocumentError(
        'AI_DOCUMENT_ASSISTANT_EMPTY',
        'The AI turn has no completed reply to save',
        409,
      )
    }
    const title = deriveAiTurnDocumentTitle(dependencies.decryptText(turn.userContent))
    const inserted = await client.query<{ id: string }>(
      `
      insert into summaries (
        user_id, project_id, type, title, period, content, source_turn_id
      )
      values ($1, $2, 'reply', $3, $4, $5, $6)
      on conflict (source_turn_id) where source_turn_id is not null do nothing
      returning id
      `,
      [
        input.userId,
        projectId,
        dependencies.encryptText(title),
        dependencies.encryptText('对话文档'),
        dependencies.encryptText(assistantContent),
        input.turnId,
      ],
    )
    const insertedId = inserted.rows[0] ? Number(inserted.rows[0].id) : null
    const summaryId = insertedId ?? await existingSummaryId(client, input, projectId)
    if (summaryId === null) {
      throw new AiTurnDocumentError(
        'AI_DOCUMENT_SAVE_CONFLICT',
        'AI document save conflict could not be reconciled',
        500,
      )
    }
    await client.query('commit')
    return { created: insertedId !== null, summaryId }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
