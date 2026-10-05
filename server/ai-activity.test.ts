import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { completeAiActivity, failAiActivityForTurn, getAiActivityDetail, listAiActivities, startAiActivity, summarizeAiRequest } from './ai-activity.ts'

process.env.APP_ENCRYPTION_ACTIVE_KEY_ID = 'ai-activity-test'
process.env.APP_ENCRYPTION_KEYS = `ai-activity-test:${Buffer.alloc(32, 23).toString('base64')}`

const activityMigration = readFileSync(
  new URL('./migrations/20261005_ai_activity_records.sql', import.meta.url),
  'utf8',
)

test('AI activity migration is transactional and keeps canonical references', () => {
  assert.match(activityMigration, /(?:^|\n)begin;/u)
  assert.match(activityMigration, /create table if not exists ai_activity_records/u)
  assert.match(activityMigration, /foreign key \(conversation_id\) references ai_conversations\(id\) on delete set null/u)
  assert.match(activityMigration, /foreign key \(turn_id\) references ai_turns\(id\) on delete set null/u)
  assert.match(activityMigration, /commit;\s*$/u)
})

test('summarizes AI requests without image binaries or URLs', () => {
  const summary = summarizeAiRequest({
    imageParts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,secret-binary' } }],
    messages: [{ role: 'user', content: '请分析' }],
    systemPrompt: '系统规则',
    untrustedContext: 'Bug 资料',
  })
  assert.match(summary, /"imageCount": 1/u)
  assert.doesNotMatch(summary, /secret-binary/u)
  assert.match(summary, /Bug 资料/u)
})

test('lists AI activities for the current user with a stable cursor query', async () => {
  let sql = ''
  const database = {
    query: async (text: string) => {
      sql = text
      return {
        rows: [{
          id: '00000000-0000-4000-8000-000000000001',
          module: 'veges-ai',
          operation: 'general',
          status: 'completed',
          model: 'model',
          related_type: null,
          related_id: null,
          image_count: 0,
          started_at: '2026-10-05T00:00:00.000Z',
          completed_at: '2026-10-05T00:00:01.000Z',
          duration_ms: 1000,
          created_at: '2026-10-05T00:00:00.000Z',
        }],
      } as never
    },
  } as never
  const result = await listAiActivities(database, 7, { cursor: '00000000-0000-4000-8000-000000000002', limit: 1 })
  assert.equal(result.items.length, 1)
  assert.match(sql, /user_id = \$1/u)
  assert.match(sql, /created_at, id/u)
})

test('canonical conversation activities reference the turn without duplicating content', async () => {
  const queries: Array<{ params: unknown[] | undefined; text: string }> = []
  const database = async (text: string, params?: unknown[]) => {
    queries.push({ params, text })
    return { rows: [] } as never
  }
  const activity = await startAiActivity(database, 7, {
    captureContent: false,
    conversationId: '00000000-0000-4000-8000-000000000001',
    module: 'veges-ai',
    operation: 'general',
    turnId: '00000000-0000-4000-8000-000000000002',
  }, '不应重复保存的请求', 'model')
  await completeAiActivity(database, activity, '不应重复保存的回复')
  assert.equal(queries[0]?.params?.[7], '00000000-0000-4000-8000-000000000001')
  assert.equal(queries[0]?.params?.[8], '00000000-0000-4000-8000-000000000002')
  assert.equal(queries[0]?.params?.[10], null)
  assert.equal(queries[1]?.params?.[0], null)
})

test('activity details hydrate canonical turn content and stay user scoped', async () => {
  let sql = ''
  const detail = await getAiActivityDetail(async (text: string) => {
    sql = text
    return { rows: [{
      id: '00000000-0000-4000-8000-000000000003',
      module: 'veges-ai',
      operation: 'general',
      status: 'completed',
      model: 'model',
      related_type: null,
      related_id: null,
      image_count: 0,
      started_at: '2026-10-05T00:00:00.000Z',
      completed_at: '2026-10-05T00:00:01.000Z',
      duration_ms: 1000,
      created_at: '2026-10-05T00:00:00.000Z',
      request_content: null,
      response_content: null,
      error_content: null,
      canonical_user_content: '用户问题',
      canonical_assistant_content: 'AI 回复',
    }] } as never
  }, 7, '00000000-0000-4000-8000-000000000003')
  assert.equal(detail?.request, '用户问题')
  assert.equal(detail?.response, 'AI 回复')
  assert.match(sql, /activity\.user_id = \$2/u)
  assert.match(sql, /turn\.conversation_id = activity\.conversation_id/u)
})

test('canonical activity failures are reconciled by user and turn identity', async () => {
  let sql = ''
  let params: unknown[] | undefined
  await failAiActivityForTurn(async (text: string, values?: unknown[]) => {
    sql = text
    params = values
    return { rows: [] } as never
  }, 7, '00000000-0000-4000-8000-000000000004', Object.assign(new Error('已取消'), { code: 'AI_REQUEST_CANCELLED' }))
  assert.match(sql, /where user_id = \$3/u)
  assert.match(sql, /turn_id = \$4/u)
  assert.match(sql, /duration_ms = coalesce\([\s\S]*greatest\([\s\S]*\)\s*where user_id/u)
  assert.equal(params?.[0], 'cancelled')
  assert.equal(params?.[2], 7)
})
