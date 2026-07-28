import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildFeishuAiReviewUrl,
  buildFeishuAiTodoProposalCard,
  isFeishuAiChatEnabled,
  shouldRetainFeishuAiSource,
} from './feishu-ai.ts'
import { schemaSql } from './schema.ts'

const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('Feishu AI chat is enabled only by an explicit true value', () => {
  assert.equal(isFeishuAiChatEnabled('true'), true)
  assert.equal(isFeishuAiChatEnabled('TRUE'), true)
  assert.equal(isFeishuAiChatEnabled('false'), false)
  assert.equal(isFeishuAiChatEnabled(undefined), false)
})

test('Feishu AI callback schema is declared after its proposal batch dependency', () => {
  assert.ok(schemaSql.indexOf('create table if not exists ai_todo_proposal_batches') >= 0)
  assert.ok(
    schemaSql.indexOf('create table if not exists feishu_ai_callback_events') >
      schemaSql.indexOf('create table if not exists ai_todo_proposal_batches'),
  )
})

test('Feishu AI card actions require signatures', () => {
  assert.match(
    serverSource,
    /if \(!signature \|\| !isFreshFeishuTimestamp\(timestamp\) \|\| !verifyFeishuCardSignature\(/u,
  )
})

test('Feishu AI queue binds retries to the original sender and stable AI identifiers', () => {
  const queueSchema = schemaSql.slice(
    schemaSql.indexOf('create table if not exists feishu_ai_messages'),
    schemaSql.indexOf('create table if not exists ai_todo_proposal_batches'),
  )
  assert.match(queueSchema, /sender_open_id text not null/u)
  assert.match(queueSchema, /request_turn_id uuid not null/u)
  assert.match(queueSchema, /request_conversation_id uuid not null/u)
})

test('Feishu AI retains forwarded source while todo candidates are still actionable', () => {
  assert.equal(shouldRetainFeishuAiSource({
    contextKind: 'general',
    hasPendingTodoProposals: true,
    outcomeType: null,
  }), true)
  assert.equal(shouldRetainFeishuAiSource({
    contextKind: 'general',
    hasPendingTodoProposals: false,
    outcomeType: 'todo-proposals',
  }), true)
  assert.equal(shouldRetainFeishuAiSource({
    contextKind: 'general',
    hasPendingTodoProposals: false,
    outcomeType: null,
  }), false)
})

test('Feishu AI review URL keeps the batch identifier on the trusted app origin', () => {
  assert.equal(
    buildFeishuAiReviewUrl(42, 'https://veges.example', 'production'),
    'https://veges.example/?aiTodoBatch=42',
  )
  assert.equal(buildFeishuAiReviewUrl(0, 'https://veges.example', 'production'), null)
  assert.equal(buildFeishuAiReviewUrl(42, 'http://veges.example', 'production'), null)
})

test('todo drafts preserve structured fields in the shared inbox schema', () => {
  const draftSchema = schemaSql.slice(
    schemaSql.indexOf('create table if not exists draft_items'),
    schemaSql.indexOf('create table if not exists ai_conversations'),
  )
  assert.match(draftSchema, /item_type text not null default 'journal'/u)
  assert.match(draftSchema, /todo_title text/u)
  assert.match(draftSchema, /todo_due_date date/u)
  assert.match(draftSchema, /todo_priority text/u)
  assert.match(draftSchema, /item_type in \('journal', 'todo'\)/u)
})

test('Feishu AI todo card exposes confirm and review actions without leaking markdown', () => {
  const card = buildFeishuAiTodoProposalCard({
    batchId: 7,
    proposals: [{
      assigneeName: 'Felix',
      dueDate: '2026-07-25',
      moduleName: null,
      priority: 'high',
      projectName: 'Project [A]',
      title: 'Ship *release*',
    }],
    reviewUrl: 'https://veges.example/?aiTodoBatch=7',
  })
  const serialized = JSON.stringify(card)
  const content = (card.elements[0] as { text: { content: string } }).text.content
  assert.match(serialized, /feishu_ai_todo_confirm_all/)
  assert.match(serialized, /进入 Veges 编辑/)
  assert.match(serialized, /待确认项目的待办会先暂存至草稿箱/u)
  assert.equal(content.includes('Project \\[A\\]'), true)
  assert.equal(content.includes('Ship \\*release\\*'), true)
})
