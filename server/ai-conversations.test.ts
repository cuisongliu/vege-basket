import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AI_CONVERSATION_TITLE_MAX_CHARACTERS,
  AI_TURN_ATTACHMENT_MAX_BYTES,
  AiConversationValidationError,
  assertAiConversationContextMatches,
  assertAiTurnStatusTransition,
  buildAiTurnModelContent,
  canTransitionAiTurnStatus,
  createAiConversationContext,
  deriveAiConversationTitle,
  encryptAiConversationTitle,
  encryptAiTurnAttachments,
  encryptAiTurnContent,
  isAiTurnRetryable,
  normalizeAiConversationTitle,
  parseAiTurnIntentKind,
  serializeAiConversation,
  serializeAiTurn,
  validateAiTurnAttachments,
} from './ai-conversations.ts'
import { isEncryptedText } from './crypto.ts'
import { schemaSql } from './schema.ts'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'test'
process.env.APP_ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 7).toString('base64')}`

test('models immutable general, project, and conversation-analysis contexts', () => {
  const general = createAiConversationContext('general', null)
  const project = createAiConversationContext('project', 17)
  const analysis = createAiConversationContext('conversation-analysis', undefined)

  assert.deepEqual(general, { contextKind: 'general', projectId: null })
  assert.deepEqual(project, { contextKind: 'project', projectId: 17 })
  assert.deepEqual(analysis, { contextKind: 'conversation-analysis', projectId: null })
  assert.doesNotThrow(() => assertAiConversationContextMatches(project, project))
  assert.throws(
    () => assertAiConversationContextMatches(project, general),
    /Conversation context is immutable/,
  )
  assert.throws(
    () => createAiConversationContext('project', null),
    /projectId must be a positive integer/,
  )
  assert.throws(
    () => createAiConversationContext('general', 17),
    /general context cannot have a projectId/,
  )
})

test('schema records cancel-before-create claims without conversation foreign keys', () => {
  assert.match(schemaSql, /create table if not exists ai_turn_cancellations/u)
  assert.match(schemaSql, /primary key \(user_id, turn_id\)/u)
  assert.doesNotMatch(
    schemaSql.match(/create table if not exists ai_turn_cancellations[\s\S]*?\n\);/u)?.[0] ?? '',
    /references ai_conversations/u,
  )
})

test('schema permanently records deleted conversation UUIDs outside the conversation cascade', () => {
  const tombstoneTable = schemaSql.match(
    /create table if not exists ai_conversation_tombstones[\s\S]*?\n\);/u,
  )?.[0] ?? ''

  assert.match(tombstoneTable, /conversation_id uuid primary key/u)
  assert.match(tombstoneTable, /user_id bigint not null references users\(id\) on delete cascade/u)
  assert.doesNotMatch(tombstoneTable, /references ai_conversations/u)
})

test('accepts workspace review as a durable AI turn intent', () => {
  assert.equal(parseAiTurnIntentKind('workspace-review'), 'workspace-review')
  assert.match(
    schemaSql,
    /ai_turns_intent_kind_check[\s\S]*?'workspace-review'/u,
  )
  const sourceTable = schemaSql.match(
    /create table if not exists ai_turn_project_sources[\s\S]*?\n\);/u,
  )?.[0] ?? ''
  assert.match(sourceTable, /turn_id uuid not null references ai_turns\(id\) on delete cascade/u)
  assert.match(sourceTable, /project_id bigint not null/u)
  assert.doesNotMatch(sourceTable, /project_id bigint[^\n]*references projects/u)
  assert.match(schemaSql, /position\('workspace-review' in intent_constraint_definition\) = 0/u)
})

test('normalizes manual titles and derives a bounded first-turn title', () => {
  assert.equal(normalizeAiConversationTitle('  发布\n计划  '), '发布 计划')
  assert.equal(deriveAiConversationTitle('', [{ name: 'plan.md' }]), '阅读 plan.md')
  assert.equal(deriveAiConversationTitle('', []), '新对话')

  const longTitle = deriveAiConversationTitle('项'.repeat(100))
  assert.equal(Array.from(longTitle).length, AI_CONVERSATION_TITLE_MAX_CHARACTERS)
  assert.match(longTitle, /\.\.\.$/u)
  assert.throws(() => normalizeAiConversationTitle('  '), /title must contain/)
})

test('validates, normalizes, and bounds text attachments using trusted content bytes', () => {
  const attachments = validateAiTurnAttachments([
    {
      content: '# 发布计划\n- [ ] 验收',
      name: '../plan\nfinal.md',
      size: 24,
      type: 'text/markdown; charset=utf-8',
    },
  ])

  assert.deepEqual(attachments, [{
    content: '# 发布计划\n- [ ] 验收',
    mediaType: 'text/markdown',
    name: 'plan final.md',
    sizeBytes: 24,
  }])
  assert.equal(validateAiTurnAttachments(undefined).length, 0)
  assert.throws(
    () => validateAiTurnAttachments(new Array(5).fill({
      content: 'x',
      name: 'x.txt',
      size: 1,
      type: 'text/plain',
    })),
    (error: unknown) =>
      error instanceof AiConversationValidationError && error.status === 413,
  )
  assert.throws(
    () => validateAiTurnAttachments([{
      content: 'x',
      name: 'image.png',
      size: 1,
      type: 'image/png',
    }]),
    (error: unknown) =>
      error instanceof AiConversationValidationError && error.status === 415,
  )
  assert.throws(
    () => validateAiTurnAttachments([{
      content: 'x'.repeat(AI_TURN_ATTACHMENT_MAX_BYTES + 1),
      name: 'large.txt',
      size: 1,
      type: 'text/plain',
    }]),
    (error: unknown) =>
      error instanceof AiConversationValidationError && error.status === 413,
  )
})

test('builds the exact model input including attachment boundaries', () => {
  assert.equal(
    buildAiTurnModelContent('', [{ content: '对话内容', name: 'chat\nlog.txt' }]),
    '请阅读附件内容。\n\n[附件开始: chat log.txt]\n对话内容\n[附件结束]',
  )
})

test('encrypts every sensitive persistence field and counts Unicode characters', () => {
  const title = encryptAiConversationTitle('发布计划')
  const userContent = encryptAiTurnContent('请检查附件')
  const [attachment] = encryptAiTurnAttachments([{
    content: '发布🚀',
    mediaType: 'text/plain',
    name: 'plan.txt',
    sizeBytes: 10,
  }])

  assert.equal(isEncryptedText(title), true)
  assert.equal(isEncryptedText(userContent), true)
  assert.equal(isEncryptedText(attachment.name), true)
  assert.equal(isEncryptedText(attachment.content), true)
  assert.equal(attachment.contentCharacters, 3)
  assert.equal(attachment.ordinal, 0)
})

test('allows only terminal completion or cancellation and explicit retries', () => {
  assert.equal(canTransitionAiTurnStatus('processing', 'completed'), true)
  assert.equal(canTransitionAiTurnStatus('processing', 'failed'), true)
  assert.equal(canTransitionAiTurnStatus('processing', 'cancelled'), true)
  assert.equal(canTransitionAiTurnStatus('failed', 'processing'), true)
  assert.equal(canTransitionAiTurnStatus('cancelled', 'processing'), true)
  assert.equal(canTransitionAiTurnStatus('completed', 'processing'), false)
  assert.equal(canTransitionAiTurnStatus('processing', 'processing'), false)
  assert.equal(isAiTurnRetryable('failed'), true)
  assert.equal(isAiTurnRetryable('completed'), false)
  assert.throws(
    () => assertAiTurnStatusTransition('completed', 'processing'),
    /Cannot transition an AI turn/,
  )
})

test('serializes decrypted history without attachment content or internal lease fields', () => {
  const conversation = serializeAiConversation({
    contextKind: 'project',
    createdAt: '2026-07-17T01:00:00.000Z',
    id: 'conversation-1',
    lastTurnAt: new Date('2026-07-17T01:02:00.000Z'),
    projectId: 17,
    title: encryptAiConversationTitle('发布计划'),
    updatedAt: '2026-07-17T01:02:00.000Z',
  })
  const turn = serializeAiTurn({
    assistantContent: encryptAiTurnContent('已经整理完成。'),
    attemptCount: 1,
    completedAt: '2026-07-17T01:02:00.000Z',
    createdAt: '2026-07-17T01:01:00.000Z',
    id: 'turn-1',
    intentKind: 'chat',
    status: 'completed',
    turnNo: 1,
    updatedAt: '2026-07-17T01:02:00.000Z',
    userContent: encryptAiTurnContent('请整理附件'),
  }, [{
    id: 9,
    mediaType: 'text/markdown',
    name: encryptAiConversationTitle('plan.md'),
    ordinal: 0,
    sizeBytes: 24,
  }])

  assert.equal(conversation.title, '发布计划')
  assert.equal(conversation.projectId, 17)
  assert.equal(turn.userContent, '请整理附件')
  assert.equal(turn.assistantContent, '已经整理完成。')
  assert.deepEqual(turn.attachments, [{
    id: 9,
    mediaType: 'text/markdown',
    name: 'plan.md',
    ordinal: 0,
    size: 24,
  }])
  assert.equal('content' in turn.attachments[0], false)
  assert.equal('leaseToken' in turn, false)
})
