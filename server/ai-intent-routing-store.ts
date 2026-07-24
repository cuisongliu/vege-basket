import crypto from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'

import type {
  AiConversationContext,
  AiTurnAttachment,
} from './ai-conversations.ts'
import {
  buildAiClassificationContent,
  deriveAiIntentTargetContext,
  hydrateAiInputIntent,
  parseAiIntentClassification,
  type AiIntentClassification,
  type AiInputIntent,
} from '../shared/ai-input-intent.ts'

export const AI_INTENT_CLASSIFICATION_LEASE_MS = 120_000
export const AI_INTENT_CLASSIFICATION_WAIT_MS = 9_000
export const AI_INTENT_CLASSIFICATION_POLL_MS = 250
export const AI_INTENT_CLASSIFICATION_COMPLETION_TTL_MS = 2 * 60_000
export const AI_INTENT_CLASSIFICATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const AI_INTENT_CLASSIFICATION_CLEANUP_BATCH_SIZE = 100

type AiIntentRoutingDatabase = Pick<Pool, 'connect'>
type Queryable = Pick<PoolClient, 'query'>

export type AiIntentRoutingDependencies = {
  database: AiIntentRoutingDatabase
  decryptText: (value: string) => string
  digestMatches: (value: string, expected: string) => boolean
  digestText: (value: string) => string
  encryptText: (value: string) => string
  monotonicNow?: () => number
  now?: () => Date
  randomUuid?: () => string
  shouldCleanup?: () => boolean
  sleep?: (milliseconds: number) => Promise<void>
}

export type AiIntentClassificationSource = {
  attachments: readonly AiTurnAttachment[]
  context: AiConversationContext
  userContent: string
}

export type AiIntentClassificationInput = {
  source: AiIntentClassificationSource
  turnId: string
  userId: number
}

export type AiInputIntentDto = AiIntentClassification

export type AiIntentClassificationReceipt =
  | {
    attemptCount: number
    leaseToken: string
    leaseUntil: Date
    status: 'claimed'
  }
  | {
    attemptCount: number
    leaseActive: boolean
    leaseUntil: Date
    status: 'processing'
  }
  | {
    context: AiConversationContext
    intent: AiIntentClassification
    status: 'completed' | 'consumed'
  }
  | {
    errorCode: string
    status: 'failed'
  }

type AiIntentClassificationRow = QueryResultRow & {
  attemptCount: number
  completionActive: boolean
  errorCode: string | null
  inputDigest: string
  intentPayload: string | null
  leaseActive: boolean
  leaseToken: string | null
  leaseUntil: Date | string | null
  sourceContextKind: AiConversationContext['contextKind']
  sourceProjectId: string | null
  status: 'completed' | 'consumed' | 'failed' | 'processing'
  turnId: string
  userId: string
}

export class AiIntentRoutingStoreError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'AiIntentRoutingStoreError'
    this.code = code
    this.status = status
  }
}

const classificationColumns = `
  user_id as "userId",
  turn_id as "turnId",
  input_digest as "inputDigest",
  source_context_kind as "sourceContextKind",
  source_project_id as "sourceProjectId",
  status,
  intent_payload as "intentPayload",
  error_code as "errorCode",
  attempt_count as "attemptCount",
  lease_token as "leaseToken",
  lease_until as "leaseUntil",
  coalesce(lease_until > clock_timestamp(), false) as "leaseActive",
  coalesce(
    completed_at > clock_timestamp() - (${AI_INTENT_CLASSIFICATION_COMPLETION_TTL_MS} * interval '1 millisecond'),
    false
  ) as "completionActive"
`

function assertUuid(value: string, field: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new AiIntentRoutingStoreError('AI_INTENT_ID_INVALID', `${field} must be a UUID`, 400)
  }
}

function assertContext(context: AiConversationContext) {
  if (context.contextKind === 'project') {
    if (!Number.isSafeInteger(context.projectId) || context.projectId <= 0) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_CONTEXT_INVALID',
        'Project context requires a positive projectId',
        400,
      )
    }
    return
  }
  if (
    (context.contextKind !== 'general' && context.contextKind !== 'conversation-analysis') ||
    context.projectId !== null
  ) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_CONTEXT_INVALID',
      'AI intent source context is invalid',
      400,
    )
  }
}

function assertInput(input: AiIntentClassificationInput) {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_ID_INVALID',
      'userId must be a positive integer',
      400,
    )
  }
  assertUuid(input.turnId, 'turnId')
  assertContext(input.source.context)
}

function sourceContext(row: AiIntentClassificationRow): AiConversationContext {
  if (row.sourceContextKind === 'project') {
    const projectId = Number(row.sourceProjectId)
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_RECEIPT_INVALID',
        'AI intent receipt has an invalid project context',
        500,
      )
    }
    return { contextKind: 'project', projectId }
  }
  if (
    (row.sourceContextKind === 'general' || row.sourceContextKind === 'conversation-analysis') &&
    row.sourceProjectId === null
  ) {
    return { contextKind: row.sourceContextKind, projectId: null }
  }
  throw new AiIntentRoutingStoreError(
    'AI_INTENT_RECEIPT_INVALID',
    'AI intent receipt has an invalid source context',
    500,
  )
}

function classificationDigestPayload(source: AiIntentClassificationSource) {
  assertContext(source.context)
  return JSON.stringify({
    attachments: source.attachments.map((attachment, ordinal) => ({
      content: attachment.content,
      mediaType: attachment.mediaType,
      name: attachment.name,
      ordinal,
      sizeBytes: attachment.sizeBytes,
    })),
    context: source.context,
    userContent: source.userContent,
    version: 1,
  })
}

export function createAiIntentClassificationDigest(
  source: AiIntentClassificationSource,
  digestText: AiIntentRoutingDependencies['digestText'],
) {
  return digestText(classificationDigestPayload(source))
}

function aiIntentClassificationDigestMatches(
  source: AiIntentClassificationSource,
  expected: string,
  digestMatches: AiIntentRoutingDependencies['digestMatches'],
) {
  return digestMatches(classificationDigestPayload(source), expected)
}

export function toAiInputIntentDto(
  intent: AiIntentClassification | AiInputIntent,
): AiInputIntentDto {
  if (intent.kind === 'todo-extraction') return { kind: intent.kind }
  return intent
}

function normalizeIntent(value: unknown): AiIntentClassification {
  try {
    return parseAiIntentClassification(value)
  } catch {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_RESULT_INVALID',
      'AI intent classifier returned an invalid result',
      502,
    )
  }
}

function readIntent(row: AiIntentClassificationRow, decryptText: (value: string) => string) {
  if (!row.intentPayload) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_RECEIPT_INVALID',
      'AI intent receipt has no completed payload',
      500,
    )
  }
  try {
    const value = JSON.parse(decryptText(row.intentPayload)) as unknown
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('invalid intent payload')
    }
    return parseAiIntentClassification(value)
  } catch {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_RECEIPT_INVALID',
      'AI intent receipt payload cannot be read',
      500,
    )
  }
}

export function deriveAiIntentConversationContext(
  intent: AiIntentClassification | AiInputIntent,
  context: AiConversationContext,
): AiConversationContext {
  assertContext(context)
  const target = deriveAiIntentTargetContext(intent, context)
  if (target.ok) return target.context
  if (target.reason === 'project-required') {
    throw new AiIntentRoutingStoreError(
      'AI_PROJECT_REQUIRED',
      'Select a project before generating a project summary',
      409,
    )
  }
  throw new AiIntentRoutingStoreError(
    'AI_CONTEXT_INTENT_MISMATCH',
    'Workspace review cannot use project context',
    409,
  )
}

function assertIntentSource(
  intent: AiIntentClassification | AiInputIntent,
  source: AiIntentClassificationSource,
) {
  if (
    (intent.kind === 'project-summary' || intent.kind === 'workspace-review') &&
    source.attachments.length > 0
  ) {
    throw new AiIntentRoutingStoreError(
      'AI_CONTEXT_INTENT_MISMATCH',
      'This AI intent does not accept attachments',
      409,
    )
  }
  deriveAiIntentConversationContext(intent, source.context)
}

function assertReceiptMatches(
  row: AiIntentClassificationRow,
  input: AiIntentClassificationInput,
  dependencies: Pick<AiIntentRoutingDependencies, 'digestMatches'>,
) {
  const storedContext = sourceContext(row)
  if (
    Number(row.userId) !== input.userId ||
    row.turnId !== input.turnId ||
    !aiIntentClassificationDigestMatches(
      input.source,
      row.inputDigest,
      dependencies.digestMatches,
    ) ||
    storedContext.contextKind !== input.source.context.contextKind ||
    storedContext.projectId !== input.source.context.projectId
  ) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_TURN_ID_REUSED',
      'Turn ID was reused with different classification input',
      409,
    )
  }
}

function leaseUntil(row: AiIntentClassificationRow) {
  const value = row.leaseUntil instanceof Date ? row.leaseUntil : new Date(row.leaseUntil ?? '')
  if (!Number.isFinite(value.getTime())) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_RECEIPT_INVALID',
      'AI intent receipt has an invalid lease',
      500,
    )
  }
  return value
}

function receiptFromRow(
  row: AiIntentClassificationRow,
  dependencies: Pick<AiIntentRoutingDependencies, 'decryptText'>,
): Exclude<AiIntentClassificationReceipt, { status: 'claimed' }> {
  if (row.status === 'processing') {
    return {
      attemptCount: Number(row.attemptCount),
      leaseActive: row.leaseActive,
      leaseUntil: leaseUntil(row),
      status: row.status,
    }
  }
  if (row.status === 'failed') {
    if (!row.errorCode) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_RECEIPT_INVALID',
        'AI intent receipt has no failure code',
        500,
      )
    }
    return { errorCode: row.errorCode, status: row.status }
  }
  const intent = readIntent(row, dependencies.decryptText)
  return {
    context: deriveAiIntentConversationContext(intent, sourceContext(row)),
    intent,
    status: row.status,
  }
}

function safeErrorCode(value: string) {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]{2,63}$/u.test(normalized)
    ? normalized
    : 'AI_INTENT_CLASSIFICATION_FAILED'
}

async function lockedReceipt(client: Queryable, turnId: string) {
  const result = await client.query<AiIntentClassificationRow>(
    `
    select ${classificationColumns}
    from ai_intent_classifications
    where turn_id = $1
    for update
    `,
    [turnId],
  )
  return result.rows[0] ?? null
}

async function cleanupExpiredAiIntentClassifications(client: Queryable) {
  await client.query(
    `
    delete from ai_intent_classifications
    where ctid in (
      select ctid
      from ai_intent_classifications
      where updated_at < clock_timestamp() - ($1 * interval '1 millisecond')
        and (
          status in ('completed', 'failed', 'consumed')
          or (status = 'processing' and lease_until <= clock_timestamp())
      )
      order by updated_at
      limit $2
      for update skip locked
    )
    `,
    [AI_INTENT_CLASSIFICATION_RETENTION_MS, AI_INTENT_CLASSIFICATION_CLEANUP_BATCH_SIZE],
  )
}

export async function claimAiIntentClassification(
  input: AiIntentClassificationInput,
  allowNewClassification: () => boolean,
  dependencies: AiIntentRoutingDependencies,
): Promise<AiIntentClassificationReceipt> {
  assertInput(input)
  const digest = createAiIntentClassificationDigest(input.source, dependencies.digestText)
  const client = await dependencies.database.connect()
  try {
    await client.query('begin')
    if (dependencies.shouldCleanup?.()) {
      await cleanupExpiredAiIntentClassifications(client)
    }
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-intent:${input.turnId}`],
    )
    const existing = await lockedReceipt(client, input.turnId)
    if (existing) {
      assertReceiptMatches(existing, input, dependencies)
      if (existing.status !== 'processing') {
        await client.query('commit')
        return receiptFromRow(existing, dependencies)
      }
      if (existing.leaseActive) {
        await client.query('commit')
        return receiptFromRow(existing, dependencies)
      }
    }

    if (!allowNewClassification()) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_RATE_LIMITED',
        'AI intent classification rate limit exceeded',
        429,
      )
    }

    const leaseToken = (dependencies.randomUuid ?? crypto.randomUUID)()
    const result = existing
      ? await client.query<AiIntentClassificationRow>(
          `
          update ai_intent_classifications
          set attempt_count = attempt_count + 1,
              lease_token = $1,
              lease_until = clock_timestamp() + ($2 * interval '1 millisecond'),
              updated_at = clock_timestamp()
          where turn_id = $3 and user_id = $4 and status = 'processing'
          returning ${classificationColumns}
          `,
          [leaseToken, AI_INTENT_CLASSIFICATION_LEASE_MS, input.turnId, input.userId],
        )
      : await client.query<AiIntentClassificationRow>(
          `
          insert into ai_intent_classifications (
            user_id,
            turn_id,
            input_digest,
            source_context_kind,
            source_project_id,
            status,
            lease_token,
            lease_until
          )
          values ($1, $2, $3, $4, $5, 'processing', $6, clock_timestamp() + ($7 * interval '1 millisecond'))
          returning ${classificationColumns}
          `,
          [
            input.userId,
            input.turnId,
            digest,
            input.source.context.contextKind,
            input.source.context.projectId,
            leaseToken,
            AI_INTENT_CLASSIFICATION_LEASE_MS,
          ],
        )
    const row = result.rows[0]
    if (!row) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_CLAIM_FAILED',
        'AI intent classification could not be claimed',
        500,
      )
    }
    await client.query('commit')
    return {
      attemptCount: Number(row.attemptCount),
      leaseToken,
      leaseUntil: leaseUntil(row),
      status: 'claimed',
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function readAiIntentClassification(
  input: AiIntentClassificationInput,
  dependencies: AiIntentRoutingDependencies,
) {
  assertInput(input)
  const client = await dependencies.database.connect()
  try {
    const result = await client.query<AiIntentClassificationRow>(
      `select ${classificationColumns} from ai_intent_classifications where turn_id = $1`,
      [input.turnId],
    )
    const row = result.rows[0]
    if (!row) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_CLASSIFICATION_NOT_FOUND',
        'AI intent classification was not found',
        404,
      )
    }
    assertReceiptMatches(row, input, dependencies)
    return receiptFromRow(row, dependencies)
  } finally {
    client.release()
  }
}

export async function waitForAiIntentClassification(
  input: AiIntentClassificationInput,
  dependencies: AiIntentRoutingDependencies,
  options: { pollMs?: number; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const pollMs = options.pollMs ?? AI_INTENT_CLASSIFICATION_POLL_MS
  const timeoutMs = options.timeoutMs ?? AI_INTENT_CLASSIFICATION_WAIT_MS
  if (!Number.isFinite(pollMs) || pollMs < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_WAIT_INVALID',
      'AI intent classification wait options are invalid',
      400,
    )
  }
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
  const sleep = dependencies.sleep ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const deadline = monotonicNow() + timeoutMs
  while (true) {
    if (options.signal?.aborted) {
      throw new AiIntentRoutingStoreError('AI_REQUEST_CANCELLED', 'AI request cancelled', 499)
    }
    const receipt = await readAiIntentClassification(input, dependencies)
    if (receipt.status !== 'processing') return receipt
    const currentTime = monotonicNow()
    if (currentTime >= deadline || !receipt.leaseActive) return receipt
    await sleep(Math.min(pollMs, Math.max(0, deadline - currentTime)))
  }
}

export type CompleteAiIntentClassificationInput = AiIntentClassificationInput & {
  intent: unknown
  leaseToken: string
  sourceContent: string
}

export async function completeAiIntentClassification(
  input: CompleteAiIntentClassificationInput,
  dependencies: AiIntentRoutingDependencies,
) {
  assertInput(input)
  assertUuid(input.leaseToken, 'leaseToken')
  const canonicalSourceContent = buildAiClassificationContent(
    input.source.userContent,
    input.source.attachments,
  )
  if (input.sourceContent !== canonicalSourceContent) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_SOURCE_INVALID',
      'AI intent source content is not canonical',
      409,
    )
  }
  const intent = normalizeIntent(input.intent)
  assertIntentSource(intent, input.source)
  const client = await dependencies.database.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-intent:${input.turnId}`],
    )
    const current = await lockedReceipt(client, input.turnId)
    if (!current) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_CLASSIFICATION_NOT_FOUND',
        'AI intent classification was not found',
        404,
      )
    }
    assertReceiptMatches(current, input, dependencies)
    if (
      current.status !== 'processing' ||
      current.leaseToken !== input.leaseToken ||
      !current.leaseActive
    ) {
      await client.query('commit')
      return { completed: false, receipt: receiptFromRow(current, dependencies) }
    }
    const result = await client.query<AiIntentClassificationRow>(
      `
      update ai_intent_classifications
      set status = 'completed',
          intent_payload = $1,
          error_code = null,
          lease_token = null,
          lease_until = null,
          completed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where turn_id = $2
        and user_id = $3
        and status = 'processing'
        and lease_token = $4
        and lease_until > clock_timestamp()
      returning ${classificationColumns}
      `,
      [dependencies.encryptText(JSON.stringify(toAiInputIntentDto(intent))), input.turnId, input.userId, input.leaseToken],
    )
    const completed = result.rows[0]
    if (!completed) {
      await client.query('commit')
      return { completed: false, receipt: receiptFromRow(current, dependencies) }
    }
    await client.query('commit')
    return { completed: true, receipt: receiptFromRow(completed, dependencies) }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export type FailAiIntentClassificationInput = AiIntentClassificationInput & {
  errorCode: string
  leaseToken: string
}

export async function failAiIntentClassification(
  input: FailAiIntentClassificationInput,
  dependencies: AiIntentRoutingDependencies,
) {
  assertInput(input)
  assertUuid(input.leaseToken, 'leaseToken')
  const errorCode = safeErrorCode(input.errorCode)
  const client = await dependencies.database.connect()
  try {
    await client.query('begin')
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-intent:${input.turnId}`],
    )
    const current = await lockedReceipt(client, input.turnId)
    if (!current) {
      throw new AiIntentRoutingStoreError(
        'AI_INTENT_CLASSIFICATION_NOT_FOUND',
        'AI intent classification was not found',
        404,
      )
    }
    assertReceiptMatches(current, input, dependencies)
    if (
      current.status !== 'processing' ||
      current.leaseToken !== input.leaseToken ||
      !current.leaseActive
    ) {
      await client.query('commit')
      return { failed: false, receipt: receiptFromRow(current, dependencies) }
    }
    const result = await client.query<AiIntentClassificationRow>(
      `
      update ai_intent_classifications
      set status = 'failed',
          error_code = $1,
          lease_token = null,
          lease_until = null,
          updated_at = clock_timestamp()
      where turn_id = $2
        and user_id = $3
        and status = 'processing'
        and lease_token = $4
        and lease_until > clock_timestamp()
      returning ${classificationColumns}
      `,
      [errorCode, input.turnId, input.userId, input.leaseToken],
    )
    const failed = result.rows[0]
    if (!failed) {
      await client.query('commit')
      return { failed: false, receipt: receiptFromRow(current, dependencies) }
    }
    await client.query('commit')
    return { failed: true, receipt: receiptFromRow(failed, dependencies) }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export type ConsumeAiIntentClassificationInput = {
  attachments: readonly AiTurnAttachment[]
  requestedContext: AiConversationContext
  turnId: string
  userContent: string
  userId: number
}

export async function consumeAiIntentClassification(
  client: Queryable,
  input: ConsumeAiIntentClassificationInput,
  dependencies: Pick<AiIntentRoutingDependencies, 'decryptText' | 'digestMatches'>,
) {
  assertInput({
    source: {
      attachments: input.attachments,
      context: input.requestedContext,
      userContent: input.userContent,
    },
    turnId: input.turnId,
    userId: input.userId,
  })
  const row = await lockedReceipt(client, input.turnId)
  if (!row) {
    throw new AiIntentRoutingStoreError(
      'AI_CLIENT_UPGRADE_REQUIRED',
      'Veges AI 已升级，请刷新页面后重试。',
      409,
    )
  }
  const storedSourceContext = sourceContext(row)
  const source = {
    attachments: input.attachments,
    context: storedSourceContext,
    userContent: input.userContent,
  }
  assertReceiptMatches(
    row,
    { source, turnId: input.turnId, userId: input.userId },
    dependencies,
  )
  if (row.status === 'processing') {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_CLASSIFICATION_PENDING',
      'AI intent classification is still processing',
      409,
    )
  }
  if (row.status === 'failed') {
    throw new AiIntentRoutingStoreError(
      row.errorCode ?? 'AI_INTENT_CLASSIFICATION_FAILED',
      'AI intent classification failed',
      502,
    )
  }
  if (row.status === 'consumed') {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_CLASSIFICATION_CONSUMED',
      'AI intent classification was already consumed',
      409,
    )
  }
  if (row.status === 'completed' && !row.completionActive) {
    throw new AiIntentRoutingStoreError(
      'AI_INTENT_CLASSIFICATION_EXPIRED',
      'AI intent classification expired; classify the request again',
      409,
    )
  }
  const classification = readIntent(row, dependencies.decryptText)
  const intent = hydrateAiInputIntent(
    classification,
    buildAiClassificationContent(input.userContent, input.attachments),
  )
  assertIntentSource(intent, source)
  const context = deriveAiIntentConversationContext(intent, storedSourceContext)
  assertContext(input.requestedContext)
  if (
    context.contextKind !== input.requestedContext.contextKind ||
    context.projectId !== input.requestedContext.projectId
  ) {
    throw new AiIntentRoutingStoreError(
      'AI_CONTEXT_INTENT_MISMATCH',
      'Requested conversation context does not match the classified intent',
      409,
    )
  }
  if (row.status === 'completed') {
    await client.query(
      `
      update ai_intent_classifications
      set status = 'consumed',
          consumed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where turn_id = $1 and user_id = $2 and status = 'completed'
      `,
      [input.turnId, input.userId],
    )
  }
  return { context, intent }
}
