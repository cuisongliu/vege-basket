import assert from 'node:assert/strict'
import test from 'node:test'

import { getAiSummaryPeriod } from './ai-period-summary.ts'
import {
  AI_WORKSPACE_ACCESS_RECHECK_QUERY,
  AI_WORKSPACE_ACTIVITY_QUERY,
  AI_WORKSPACE_JOURNALS_QUERY,
  AI_WORKSPACE_OPEN_TODOS_QUERY,
  AI_WORKSPACE_PROJECTS_QUERY,
  buildAiWorkspaceReviewContext,
  buildAiWorkspaceTurnSourceAccessPredicate,
} from './ai-workspace-review.ts'

test('builds a bounded backend-authorized workspace review context', () => {
  const request = buildAiWorkspaceReviewContext(
    getAiSummaryPeriod('weekly', new Date('2026-07-21T06:00:00.000Z')),
    {
      activity: [{
        actorName: '张三',
        kind: 'completed',
        occurredAt: '2026-07-21T03:00:00.000Z',
        projectName: 'Veges',
        title: '修复流式输出',
        todoId: 7,
      }],
      journals: [{
        authorName: '张三',
        content: '完成 AI 对话历史和流式输出回归。',
        createdAt: '2026-07-21T02:00:00.000Z',
        projectName: 'Veges',
      }],
      openTodos: [{
        dueDate: '2026-07-22',
        priority: 'high',
        projectName: 'Veges',
        title: '完成发布验证',
        todoId: 8,
      }],
      projects: [{ accessRole: 'owner', name: 'Veges', status: 'active' }],
      risks: [{ content: '真实 PostgreSQL 集成尚未验证', projectName: 'Veges' }],
    },
    2_000,
  )

  assert.match(request.systemPrompt, /不要要求用户重新选择项目或粘贴/)
  assert.match(request.untrustedContext, /后端按当前登录用户权限读取/)
  assert.match(request.untrustedContext, /明细采用有上限的样本/)
  assert.match(request.untrustedContext, /修复流式输出/)
  assert.match(request.untrustedContext, /完成发布验证/)
  assert.match(request.untrustedContext, /真实 PostgreSQL 集成尚未验证/)
  assert.ok(request.untrustedContext.length <= 2_000)
})

test('workspace review SQL keeps owner and active-member boundaries explicit', () => {
  assert.match(AI_WORKSPACE_PROJECTS_QUERY, /membership\.status = 'active'/u)
  assert.match(AI_WORKSPACE_JOURNALS_QUERY, /journal\.author_user_id = \$1::bigint/u)
  assert.doesNotMatch(AI_WORKSPACE_JOURNALS_QUERY, /journal\.visibility = 'public'/u)
  assert.match(AI_WORKSPACE_ACTIVITY_QUERY, /event\.actor_user_id = \$1::bigint/u)
  assert.match(AI_WORKSPACE_ACTIVITY_QUERY, /event\.assignee_user_id = \$1::bigint/u)
  assert.match(AI_WORKSPACE_OPEN_TODOS_QUERY, /todo\.assignee_user_id = \$1::bigint/u)
  assert.match(AI_WORKSPACE_ACCESS_RECHECK_QUERY, /membership\.status = 'active'/u)
  const turnAccess = buildAiWorkspaceTurnSourceAccessPredicate('turn_row', '$7')
  assert.match(turnAccess, /turn_source\.turn_id = turn_row\.id/u)
  assert.match(turnAccess, /source_project\.user_id = \$7/u)
  assert.match(turnAccess, /source_membership\.status = 'active'/u)
})
