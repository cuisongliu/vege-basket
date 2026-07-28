import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AiTodoProposalValidationError,
  buildAiTodoProposalRequest,
  parseAiTodoProposalResponse,
} from './ai-todo-proposals.ts'
import type { AiTodoProposalCatalog } from './ai-todo-proposals.ts'

const sourceMarkdown = '# 会议纪要\n\n李四在 2026-07-20 前完成登录联调。'
const catalog: AiTodoProposalCatalog = {
  projects: [{
    assignees: [{ id: 7, name: '李四' }],
    id: 3,
    modules: [{ id: 11, name: '登录' }],
    name: '内部平台',
  }],
}

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    proposals: [{
      assigneeUserId: 7,
      confidence: 0.94,
      detail: '根据会议纪要完成接口与页面联调。',
      dueDate: '2026-07-20',
      moduleId: 11,
      priority: 'medium',
      projectId: 3,
      sourceExcerpt: '李四在 2026-07-20 前完成登录联调。',
      title: '完成登录联调',
      ...overrides,
    }],
  })
}

test('accepts a complete proposal constrained to the accessible catalog', () => {
  assert.deepEqual(
    parseAiTodoProposalResponse(response(), { catalog, sourceMarkdown }),
    [{
      assigneeUserId: 7,
      confidence: 0.94,
      detail: '根据会议纪要完成接口与页面联调。',
      dueDate: '2026-07-20',
      moduleId: 11,
      priority: 'medium',
      projectId: 3,
      sourceExcerpt: '李四在 2026-07-20 前完成登录联调。',
      title: '完成登录联调',
    }],
  )
})

test('allows unresolved optional inferences to stay null', () => {
  const parsed = parseAiTodoProposalResponse(
    response({ assigneeUserId: null, dueDate: null, moduleId: null, projectId: null }),
    { catalog, sourceMarkdown },
  )

  assert.equal(parsed[0].assigneeUserId, null)
  assert.equal(parsed[0].moduleId, null)
  assert.equal(parsed[0].dueDate, null)
  assert.equal(parsed[0].projectId, null)
})

test('drops stale assignee and module when a correction moves the todo to another project', () => {
  const retargetCatalog: AiTodoProposalCatalog = {
    projects: [
      catalog.projects[0],
      {
        assignees: [{ id: 8, name: '王五' }],
        id: 4,
        modules: [{ id: 12, name: '网络方案' }],
        name: '测试空间',
      },
    ],
  }

  const parsed = parseAiTodoProposalResponse(response({ projectId: 4 }), {
    catalog: retargetCatalog,
    normalizeInvalidRelations: true,
    sourceMarkdown,
  })

  assert.equal(parsed[0].projectId, 4)
  assert.equal(parsed[0].assigneeUserId, null)
  assert.equal(parsed[0].moduleId, null)
})

test('strict parsing rejects inaccessible projects, cross-project relations, and invented excerpts', () => {
  assert.throws(
    () => parseAiTodoProposalResponse(response({ projectId: 99 }), { catalog, sourceMarkdown }),
    /projectId is not accessible/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ moduleId: 99 }), { catalog, sourceMarkdown }),
    /moduleId is outside the project/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ assigneeUserId: 99 }), { catalog, sourceMarkdown }),
    /assigneeUserId is outside the project/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ assigneeUserId: 7, moduleId: null, projectId: null }), {
      catalog,
      sourceMarkdown,
    }),
    /cannot infer a module or assignee without a project/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ sourceExcerpt: '不存在的原文' }), {
      catalog,
      sourceMarkdown,
    }),
    /sourceExcerpt must appear/,
  )
})

test('rejects invalid dates, confidence, priorities, and unknown fields', () => {
  assert.throws(
    () => parseAiTodoProposalResponse(response({ dueDate: '2026-02-30' }), {
      catalog,
      sourceMarkdown,
    }),
    /valid calendar date/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ confidence: 1.2 }), { catalog, sourceMarkdown }),
    /between 0 and 1/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ priority: 'urgent' }), {
      catalog,
      sourceMarkdown,
    }),
    /priority is invalid/,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response({ unexpected: true }), { catalog, sourceMarkdown }),
    /missing or unknown fields/,
  )
})

test('requires strict JSON and enforces the proposal count limit', () => {
  assert.throws(
    () => parseAiTodoProposalResponse('```json\n{}\n```', { catalog, sourceMarkdown }),
    AiTodoProposalValidationError,
  )
  assert.throws(
    () => parseAiTodoProposalResponse(response(), {
      catalog,
      maxProposals: 0,
      sourceMarkdown,
    }),
    /more than 0 proposals/,
  )
})

test('builds an inference request for source text and the permission catalog as untrusted context', () => {
  const request = buildAiTodoProposalRequest(sourceMarkdown, catalog, '2026-07-16')

  assert.equal(request.responseFormat, 'json_object')
  assert.match(request.systemPrompt, /自然语言指令或 Markdown/u)
  assert.match(request.systemPrompt, /sourceExcerpt 必须原样摘自/)
  assert.match(request.untrustedContext, /内部平台/)
  assert.match(request.untrustedContext, /李四在 2026-07-20/)
})
