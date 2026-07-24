import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiClassificationContent,
  deriveAiIntentTargetContext,
  hydrateAiInputIntent,
  parseAiIntentClassification,
} from '../shared/ai-input-intent.ts'

test('builds semantic-classification content from the message and text attachments', () => {
  assert.equal(
    buildAiClassificationContent('请整理这些内容', [
      { content: '# 发布计划\n- [ ] 完成验收' },
      { content: '补充说明' },
    ]),
    '请整理这些内容\n\n# 发布计划\n- [ ] 完成验收\n\n补充说明',
  )
})

test('parses the public semantic-intent response with exact fields', () => {
  assert.deepEqual(parseAiIntentClassification({ kind: 'chat' }), { kind: 'chat' })
  assert.deepEqual(
    parseAiIntentClassification({ kind: 'workspace-review', period: 'weekly' }),
    { kind: 'workspace-review', period: 'weekly' },
  )
  assert.throws(
    () => parseAiIntentClassification({ kind: 'chat', reason: 'ambiguous' }),
    /classification is invalid/u,
  )
  assert.throws(
    () => parseAiIntentClassification({ kind: 'project-summary', period: 'monthly' }),
    /classification is invalid/u,
  )
})

test('hydrates todo extraction only from canonical source content', () => {
  assert.deepEqual(
    hydrateAiInputIntent(
      { kind: 'todo-extraction' },
      '  # 发布计划\n- [ ] 完成验收  ',
    ),
    { content: '# 发布计划\n- [ ] 完成验收', kind: 'todo-extraction' },
  )
  assert.throws(
    () => hydrateAiInputIntent({ kind: 'todo-extraction' }, '  '),
    /source content is required/u,
  )
})

test('derives target conversation context without capability regex routing', () => {
  assert.deepEqual(
    deriveAiIntentTargetContext(
      { kind: 'conversation-analysis' },
      { contextKind: 'project', projectId: 9 },
    ),
    { context: { contextKind: 'conversation-analysis', projectId: null }, ok: true },
  )
  assert.deepEqual(
    deriveAiIntentTargetContext(
      { kind: 'todo-extraction' },
      { contextKind: 'conversation-analysis', projectId: null },
    ),
    { context: { contextKind: 'general', projectId: null }, ok: true },
  )
  assert.deepEqual(
    deriveAiIntentTargetContext(
      { kind: 'project-summary', period: 'weekly' },
      { contextKind: 'general', projectId: null },
    ),
    { ok: false, reason: 'project-required' },
  )
  assert.deepEqual(
    deriveAiIntentTargetContext(
      { kind: 'workspace-review', period: 'weekly' },
      { contextKind: 'project', projectId: 9 },
    ),
    { ok: false, reason: 'workspace-project-mismatch' },
  )
})
