import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

import {
  AI_INTENT_CLASSIFICATION_COMPLETION_TTL_MS,
  AI_INTENT_CLASSIFICATION_LEASE_MS,
  AI_INTENT_CLASSIFICATION_POLL_MS,
  AI_INTENT_CLASSIFICATION_RETENTION_MS,
  AI_INTENT_CLASSIFICATION_WAIT_MS,
  AiIntentRoutingStoreError,
  claimAiIntentClassification,
  completeAiIntentClassification,
  consumeAiIntentClassification,
  createAiIntentClassificationDigest,
  deriveAiIntentConversationContext,
  failAiIntentClassification,
  readAiIntentClassification,
  toAiInputIntentDto,
  waitForAiIntentClassification,
  type AiIntentClassificationInput,
  type AiIntentRoutingDependencies,
} from './ai-intent-routing-store.ts'

const turnId = '11111111-1111-4111-8111-111111111111'
const firstLeaseToken = '22222222-2222-4222-8222-222222222222'
const secondLeaseToken = '33333333-3333-4333-8333-333333333333'

function digestText(value: string) {
  const digest = createHmac('sha256', 'test-intent-key').update(value).digest('base64url')
  return `veges:mac:test:${digest}`
}

type StoredReceipt = {
  attemptCount: number
  completedAt: Date | null
  completionActive: boolean
  errorCode: string | null
  inputDigest: string
  intentPayload: string | null
  leaseActive: boolean
  leaseToken: string | null
  leaseUntil: Date | null
  sourceContextKind: 'conversation-analysis' | 'general' | 'project'
  sourceProjectId: string | null
  status: 'completed' | 'consumed' | 'failed' | 'processing'
  turnId: string
  userId: string
}

function queryResult<Row extends QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return {
    command: '',
    fields: [],
    oid: 0,
    rowCount: rows.length,
    rows,
  }
}

function createHarness(initialNow = new Date('2026-07-22T02:00:00.000Z')) {
  let currentTime = initialNow
  let monotonicTime = 0
  let receipt: StoredReceipt | null = null
  let leaseIndex = 0
  const leaseTokens = [firstLeaseToken, secondLeaseToken]
  const queries: Array<{ params: unknown[]; text: string }> = []

  const client = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ params, text })
      if (
        text === 'begin' ||
        text === 'commit' ||
        text === 'rollback' ||
        text.includes('pg_advisory_xact_lock')
      ) return queryResult()

      if (text.includes('insert into ai_intent_classifications')) {
        receipt = {
          attemptCount: 1,
          completedAt: null,
          completionActive: false,
          errorCode: null,
          inputDigest: String(params[2]),
          intentPayload: null,
          leaseActive: true,
          leaseToken: String(params[5]),
          leaseUntil: new Date(currentTime.getTime() + Number(params[6])),
          sourceContextKind: params[3] as StoredReceipt['sourceContextKind'],
          sourceProjectId: params[4] === null ? null : String(params[4]),
          status: 'processing',
          turnId: String(params[1]),
          userId: String(params[0]),
        }
        return queryResult([receipt])
      }

      if (text.includes('set attempt_count = attempt_count + 1')) {
        if (!receipt) return queryResult()
        receipt = {
          ...receipt,
          attemptCount: receipt.attemptCount + 1,
          completedAt: null,
          completionActive: false,
          leaseActive: true,
          leaseToken: String(params[0]),
          leaseUntil: new Date(currentTime.getTime() + Number(params[1])),
        }
        return queryResult([receipt])
      }

      if (text.includes("set status = 'completed'")) {
        if (
          !receipt ||
          receipt.status !== 'processing' ||
          receipt.leaseToken !== params[3] ||
          !receipt.leaseUntil ||
          receipt.leaseUntil.getTime() <= currentTime.getTime()
        ) return queryResult()
        receipt = {
          ...receipt,
          completedAt: currentTime,
          completionActive: true,
          intentPayload: String(params[0]),
          leaseActive: false,
          leaseToken: null,
          leaseUntil: null,
          status: 'completed',
        }
        return queryResult([receipt])
      }

      if (text.includes("set status = 'failed'")) {
        if (
          !receipt ||
          receipt.status !== 'processing' ||
          receipt.leaseToken !== params[3] ||
          !receipt.leaseUntil ||
          receipt.leaseUntil.getTime() <= currentTime.getTime()
        ) return queryResult()
        receipt = {
          ...receipt,
          completedAt: null,
          completionActive: false,
          errorCode: String(params[0]),
          leaseActive: false,
          leaseToken: null,
          leaseUntil: null,
          status: 'failed',
        }
        return queryResult([receipt])
      }

      if (text.includes("set status = 'consumed'")) {
        if (receipt?.status === 'completed') receipt = { ...receipt, status: 'consumed' }
        return queryResult()
      }

      if (text.includes('from ai_intent_classifications')) {
        const requestedTurnId = String(params[0])
        if (receipt) {
          receipt.leaseActive = Boolean(
            receipt.leaseUntil && receipt.leaseUntil.getTime() > currentTime.getTime(),
          )
          receipt.completionActive = Boolean(
            receipt.completedAt &&
            receipt.completedAt.getTime() + AI_INTENT_CLASSIFICATION_COMPLETION_TTL_MS >
              currentTime.getTime(),
          )
        }
        return queryResult(receipt?.turnId === requestedTurnId ? [receipt] : [])
      }
      return queryResult()
    },
    release: () => undefined,
  } as unknown as PoolClient
  const database = { connect: async () => client } as unknown as Pick<Pool, 'connect'>
  const dependencies: AiIntentRoutingDependencies = {
    database,
    decryptText: (value) => value.startsWith('encrypted:') ? value.slice(10) : value,
    digestMatches: (value, expected) => digestText(value) === expected,
    digestText,
    encryptText: (value) => `encrypted:${value}`,
    monotonicNow: () => monotonicTime,
    now: () => currentTime,
    randomUuid: () => leaseTokens[leaseIndex++] ?? secondLeaseToken,
    sleep: async (milliseconds) => {
      monotonicTime += milliseconds
      currentTime = new Date(currentTime.getTime() + milliseconds)
    },
  }
  return {
    client,
    dependencies,
    get receipt() {
      return receipt
    },
    queries,
    setNow(value: Date) {
      currentTime = value
    },
    setMonotonicNow(value: number) {
      monotonicTime = value
    },
  }
}

function classificationInput(
  overrides: Partial<AiIntentClassificationInput['source']> = {},
): AiIntentClassificationInput {
  return {
    source: {
      attachments: [],
      context: { contextKind: 'general', projectId: null },
      userContent: '请整理下面的待办\n\n- [ ] 发布新版本',
      ...overrides,
    },
    turnId,
    userId: 7,
  }
}

test('digest binds exact content, attachments, ordering, and source context', () => {
  const base = classificationInput().source
  const attachment = {
    content: '附件正文',
    mediaType: 'text/plain',
    name: 'notes.txt',
    sizeBytes: 12,
  }
  const first = createAiIntentClassificationDigest({ ...base, attachments: [attachment] }, digestText)

  assert.match(first, /^veges:mac:test:[A-Za-z0-9_-]{43}$/u)
  assert.equal(
    first,
    createAiIntentClassificationDigest({ ...base, attachments: [attachment] }, digestText),
  )
  assert.notEqual(first, createAiIntentClassificationDigest({
    ...base,
    attachments: [{ ...attachment, content: '另一份正文' }],
  }, digestText))
  assert.notEqual(first, createAiIntentClassificationDigest({
    ...base,
    attachments: [attachment],
    context: { contextKind: 'project', projectId: 9 },
  }, digestText))
})

test('public intent DTO omits canonical todo source content', () => {
  assert.deepEqual(
    toAiInputIntentDto({ content: 'private source', kind: 'todo-extraction' }),
    { kind: 'todo-extraction' },
  )
  assert.deepEqual(
    toAiInputIntentDto({ kind: 'workspace-review', period: 'weekly' }),
    { kind: 'workspace-review', period: 'weekly' },
  )
})

test('derives immutable context from semantic intent and source context', () => {
  assert.deepEqual(
    deriveAiIntentConversationContext(
      { kind: 'conversation-analysis' },
      { contextKind: 'project', projectId: 9 },
    ),
    { contextKind: 'conversation-analysis', projectId: null },
  )
  assert.deepEqual(
    deriveAiIntentConversationContext(
      { content: 'todo', kind: 'todo-extraction' },
      { contextKind: 'conversation-analysis', projectId: null },
    ),
    { contextKind: 'general', projectId: null },
  )
  assert.throws(
    () => deriveAiIntentConversationContext(
      { kind: 'project-summary', period: 'weekly' },
      { contextKind: 'general', projectId: null },
    ),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError && error.code === 'AI_PROJECT_REQUIRED',
  )
})

test('claim is idempotent and consumes rate limit only for first or expired leases', async () => {
  const harness = createHarness()
  const input = classificationInput()
  let rateLimitCalls = 0
  const allow = () => {
    rateLimitCalls += 1
    return true
  }

  const first = await claimAiIntentClassification(input, allow, harness.dependencies)
  const replay = await claimAiIntentClassification(input, allow, harness.dependencies)

  assert.equal(first.status, 'claimed')
  assert.equal(first.status === 'claimed' ? first.leaseToken : '', firstLeaseToken)
  assert.equal(replay.status, 'processing')
  assert.equal(rateLimitCalls, 1)

  harness.setNow(new Date('2026-07-22T02:03:00.000Z'))
  const reclaimed = await claimAiIntentClassification(input, allow, harness.dependencies)
  assert.equal(reclaimed.status, 'claimed')
  assert.equal(reclaimed.status === 'claimed' ? reclaimed.leaseToken : '', secondLeaseToken)
  assert.equal(reclaimed.status === 'claimed' ? reclaimed.attemptCount : 0, 2)
  assert.equal(rateLimitCalls, 2)
})

test('claim runs bounded lock-skipping cleanup only when the caller schedules it', async () => {
  const harness = createHarness()
  harness.dependencies.shouldCleanup = () => true

  await claimAiIntentClassification(classificationInput(), () => true, harness.dependencies)

  const cleanup = harness.queries.find(({ text }) =>
    text.includes('delete from ai_intent_classifications'))
  assert.ok(cleanup)
  assert.match(cleanup.text, /for update skip locked/u)
  assert.deepEqual(cleanup.params, [AI_INTENT_CLASSIFICATION_RETENTION_MS, 100])
})

test('turn IDs cannot be rebound to another user, content, or context', async () => {
  const harness = createHarness()
  const input = classificationInput()
  await claimAiIntentClassification(input, () => true, harness.dependencies)

  const conflicts = [
    { ...input, userId: 8 },
    classificationInput({ userContent: 'different' }),
    classificationInput({ context: { contextKind: 'project', projectId: 9 } }),
  ]
  for (const conflict of conflicts) {
    await assert.rejects(
      claimAiIntentClassification(conflict, () => true, harness.dependencies),
      (error: unknown) =>
        error instanceof AiIntentRoutingStoreError &&
        error.code === 'AI_INTENT_TURN_ID_REUSED' &&
        error.status === 409,
    )
  }
})

test('todo completion stores only bounded intent and consume restores canonical source', async () => {
  const harness = createHarness()
  const input = classificationInput()
  const claimed = await claimAiIntentClassification(input, () => true, harness.dependencies)
  assert.equal(claimed.status, 'claimed')
  if (claimed.status !== 'claimed') return
  const sourceContent = [input.source.userContent].join('\n\n')

  const completed = await completeAiIntentClassification({
    ...input,
    intent: { kind: 'todo-extraction' },
    leaseToken: claimed.leaseToken,
    sourceContent,
  }, harness.dependencies)

  assert.equal(completed.completed, true)
  assert.deepEqual(completed.receipt, {
    context: { contextKind: 'general', projectId: null },
    intent: { kind: 'todo-extraction' },
    status: 'completed',
  })
  assert.equal(
    harness.receipt?.intentPayload,
    `encrypted:${JSON.stringify({ kind: 'todo-extraction' })}`,
  )
  assert.doesNotMatch(harness.receipt?.intentPayload ?? '', /发布新版本/u)

  const replay = await claimAiIntentClassification(input, () => {
    throw new Error('completed replay must not consume rate limit')
  }, harness.dependencies)
  assert.equal(replay.status, 'completed')

  assert.deepEqual(
    await consumeAiIntentClassification(harness.client, {
      attachments: input.source.attachments,
      requestedContext: { contextKind: 'general', projectId: null },
      turnId,
      userContent: input.source.userContent,
      userId: input.userId,
    }, harness.dependencies),
    {
      context: { contextKind: 'general', projectId: null },
      intent: { content: sourceContent, kind: 'todo-extraction' },
    },
  )
})

test('stale completion cannot win and the active lease can record a terminal failure', async () => {
  const harness = createHarness()
  const input = classificationInput()
  const first = await claimAiIntentClassification(input, () => true, harness.dependencies)
  assert.equal(first.status, 'claimed')
  if (first.status !== 'claimed') return

  harness.setNow(new Date(first.leaseUntil.getTime() + 1))
  const stale = await completeAiIntentClassification({
    ...input,
    intent: { kind: 'chat' },
    leaseToken: first.leaseToken,
    sourceContent: input.source.userContent,
  }, harness.dependencies)
  assert.equal(stale.completed, false)
  assert.equal(stale.receipt.status, 'processing')

  const reclaimed = await claimAiIntentClassification(input, () => true, harness.dependencies)
  assert.equal(reclaimed.status, 'claimed')
  if (reclaimed.status !== 'claimed') return
  const failed = await failAiIntentClassification({
    ...input,
    errorCode: 'provider timeout!',
    leaseToken: reclaimed.leaseToken,
  }, harness.dependencies)
  assert.deepEqual(failed, {
    failed: true,
    receipt: { errorCode: 'AI_INTENT_CLASSIFICATION_FAILED', status: 'failed' },
  })
  assert.deepEqual(await waitForAiIntentClassification(input, harness.dependencies), {
    errorCode: 'AI_INTENT_CLASSIFICATION_FAILED',
    status: 'failed',
  })
})

test('an unconsumed completed classification expires before it can be stockpiled', async () => {
  const harness = createHarness()
  const input = classificationInput({ userContent: '普通问题' })
  const claimed = await claimAiIntentClassification(input, () => true, harness.dependencies)
  assert.equal(claimed.status, 'claimed')
  if (claimed.status !== 'claimed') return
  await completeAiIntentClassification({
    ...input,
    intent: { kind: 'chat' },
    leaseToken: claimed.leaseToken,
    sourceContent: input.source.userContent,
  }, harness.dependencies)
  const completedAt = harness.receipt?.completedAt
  assert.ok(completedAt)
  harness.setNow(new Date(
    completedAt.getTime() + AI_INTENT_CLASSIFICATION_COMPLETION_TTL_MS + 1,
  ))

  await assert.rejects(
    consumeAiIntentClassification(harness.client, {
      attachments: [],
      requestedContext: input.source.context,
      turnId,
      userContent: input.source.userContent,
      userId: input.userId,
    }, harness.dependencies),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError &&
      error.code === 'AI_INTENT_CLASSIFICATION_EXPIRED' &&
      error.status === 409,
  )
})

test('consume rechecks canonical input and rejects reuse after canonical consumption', async () => {
  const harness = createHarness()
  const input = classificationInput({
    context: { contextKind: 'project', projectId: 9 },
    userContent: '分析这段沟通有哪些问题',
  })
  const claimed = await claimAiIntentClassification(input, () => true, harness.dependencies)
  assert.equal(claimed.status, 'claimed')
  if (claimed.status !== 'claimed') return
  await completeAiIntentClassification({
    ...input,
    intent: { kind: 'conversation-analysis' },
    leaseToken: claimed.leaseToken,
    sourceContent: input.source.userContent,
  }, harness.dependencies)

  const consumeInput = {
    attachments: input.source.attachments,
    requestedContext: { contextKind: 'conversation-analysis', projectId: null } as const,
    turnId,
    userContent: input.source.userContent,
    userId: input.userId,
  }
  await assert.rejects(
    consumeAiIntentClassification(harness.client, {
      ...consumeInput,
      userContent: 'different request',
    }, harness.dependencies),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError && error.code === 'AI_INTENT_TURN_ID_REUSED',
  )
  await assert.rejects(
    consumeAiIntentClassification(harness.client, {
      ...consumeInput,
      requestedContext: { contextKind: 'general', projectId: null },
    }, harness.dependencies),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError && error.code === 'AI_CONTEXT_INTENT_MISMATCH',
  )
  assert.deepEqual(
    await consumeAiIntentClassification(harness.client, consumeInput, harness.dependencies),
    {
      context: { contextKind: 'conversation-analysis', projectId: null },
      intent: { kind: 'conversation-analysis' },
    },
  )
  assert.equal(harness.receipt?.status, 'consumed')
  await assert.rejects(
    consumeAiIntentClassification(harness.client, consumeInput, harness.dependencies),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError &&
      error.code === 'AI_INTENT_CLASSIFICATION_CONSUMED' &&
      error.status === 409,
  )
})

test('schema enforces globally bound turn IDs and receipt state invariants', () => {
  const source = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
  const table = source.match(
    /create table if not exists ai_intent_classifications \([\s\S]*?\n\);/u,
  )?.[0] ?? ''

  assert.match(table, /primary key \(user_id, turn_id\)/u)
  assert.match(table, /unique \(turn_id\)/u)
  assert.match(table, /status in \('processing', 'completed', 'failed', 'consumed'\)/u)
  assert.match(table, /source_context_kind = 'project'[\s\S]*?source_project_id is not null/u)
  assert.match(table, /status = 'processing'[\s\S]*?lease_token is not null/u)
  assert.match(table, /status = 'consumed'[\s\S]*?consumed_at is not null/u)
  assert.equal(AI_INTENT_CLASSIFICATION_LEASE_MS, 120_000)
  assert.equal(AI_INTENT_CLASSIFICATION_COMPLETION_TTL_MS, 120_000)
  assert.equal(AI_INTENT_CLASSIFICATION_POLL_MS, 250)
  assert.equal(AI_INTENT_CLASSIFICATION_WAIT_MS, 9_000)
  assert.equal(AI_INTENT_CLASSIFICATION_RETENTION_MS, 7 * 24 * 60 * 60 * 1_000)
  assert.match(source, /ai_intent_classifications_cleanup_idx/u)
})

test('lease and completion expiry SQL uses the live PostgreSQL clock across lock waits', () => {
  const source = readFileSync(new URL('./ai-intent-routing-store.ts', import.meta.url), 'utf8')

  assert.match(source, /lease_until > clock_timestamp\(\)/u)
  assert.match(source, /completed_at > clock_timestamp\(\) -/u)
  assert.match(source, /lease_until = clock_timestamp\(\) \+/u)
  assert.match(source, /completed_at = clock_timestamp\(\)/u)
  assert.match(source, /consumed_at = clock_timestamp\(\)/u)
  assert.doesNotMatch(source, /lease_until > now\(\)/u)
  assert.doesNotMatch(source, /completed_at > now\(\) -/u)
})

test('wait trusts the database lease state instead of the application wall clock', async () => {
  const harness = createHarness()
  const input = classificationInput()
  await claimAiIntentClassification(input, () => true, harness.dependencies)
  harness.dependencies.now = () => new Date('2036-07-22T02:00:00.000Z')
  harness.setMonotonicNow(0)

  const receipt = await waitForAiIntentClassification(input, harness.dependencies, {
    pollMs: 1,
    timeoutMs: 1,
  })

  assert.equal(receipt.status, 'processing')
  assert.equal(receipt.status === 'processing' && receipt.leaseActive, true)
})

test('wait observes caller cancellation between bounded polls', async () => {
  const harness = createHarness()
  const input = classificationInput()
  await claimAiIntentClassification(input, () => true, harness.dependencies)
  const controller = new AbortController()
  harness.dependencies.sleep = async () => {
    controller.abort()
  }

  await assert.rejects(
    waitForAiIntentClassification(input, harness.dependencies, { signal: controller.signal }),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError && error.code === 'AI_REQUEST_CANCELLED',
  )
})

test('missing receipt at canonical turn creation requires a client refresh', async () => {
  const harness = createHarness()
  const input = classificationInput()

  await assert.rejects(
    consumeAiIntentClassification(harness.client, {
      attachments: input.source.attachments,
      requestedContext: input.source.context,
      turnId: input.turnId,
      userContent: input.source.userContent,
      userId: input.userId,
    }, harness.dependencies),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError &&
      error.code === 'AI_CLIENT_UPGRADE_REQUIRED' &&
      error.status === 409,
  )
})

test('read rejects malformed IDs before acquiring a database client', async () => {
  let connected = false
  const dependencies: AiIntentRoutingDependencies = {
    database: {
      connect: async () => {
        connected = true
        throw new Error('must not connect')
      },
    } as unknown as Pick<Pool, 'connect'>,
    decryptText: String,
    digestMatches: (value, expected) => digestText(value) === expected,
    digestText,
    encryptText: String,
  }
  await assert.rejects(
    readAiIntentClassification({ ...classificationInput(), turnId: 'invalid' }, dependencies),
    (error: unknown) =>
      error instanceof AiIntentRoutingStoreError && error.code === 'AI_INTENT_ID_INVALID',
  )
  assert.equal(connected, false)
})
