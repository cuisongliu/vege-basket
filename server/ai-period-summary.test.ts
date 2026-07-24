import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAiPeriodSummaryRequest,
  countAiPeriodFacts,
  formatAiPeriodFacts,
  getAiSummaryPeriod,
} from './ai-period-summary.ts'
import type { AiTodoActivityFact } from './ai-period-summary.ts'

const facts: AiTodoActivityFact[] = [
  {
    actorName: '李四',
    kind: 'completed',
    occurredAt: '2026-07-16T02:30:00.000Z',
    priority: 'high',
    projectName: '内部平台',
    title: '完成登录联调',
    todoId: 12,
  },
  {
    actorName: '张三',
    assigneeName: '李四',
    kind: 'assigned',
    occurredAt: '2026-07-16T01:00:00.000Z',
    title: '完成登录联调',
    todoId: 12,
  },
]

test('calculates a Shanghai calendar-day boundary independent of host timezone', () => {
  const period = getAiSummaryPeriod('daily', new Date('2026-07-15T16:30:00.000Z'))

  assert.equal(period.label, '2026-07-16')
  assert.equal(period.start.toISOString(), '2026-07-15T16:00:00.000Z')
  assert.equal(period.endExclusive.toISOString(), '2026-07-16T16:00:00.000Z')
})

test('calculates a Monday-through-Sunday Shanghai week across a month boundary', () => {
  const period = getAiSummaryPeriod('weekly', new Date('2026-08-02T10:00:00.000Z'))

  assert.equal(period.label, '2026-07-27 至 2026-08-02')
  assert.equal(period.start.toISOString(), '2026-07-26T16:00:00.000Z')
  assert.equal(period.endExclusive.toISOString(), '2026-08-02T16:00:00.000Z')
})

test('formats ordered facts and keeps the actor distinct from the assignee', () => {
  const content = formatAiPeriodFacts(facts)

  assert.ok(content.indexOf('已指派') < content.indexOf('已完成'))
  assert.match(content, /操作人：张三/)
  assert.match(content, /负责人：李四/)
  assert.match(content, /操作人：李四/)
  assert.deepEqual(countAiPeriodFacts(facts), {
    assigned: 1,
    completed: 1,
    confirmed: 0,
    created: 0,
    rejected: 0,
    reopened: 0,
  })
})

test('builds a fact-only daily summary request', () => {
  const request = buildAiPeriodSummaryRequest(
    getAiSummaryPeriod('daily', new Date('2026-07-16T03:00:00.000Z')),
    facts,
  )

  assert.match(request.systemPrompt, /不得补写/)
  assert.match(request.untrustedContext, /统计时区：Asia\/Shanghai/)
  assert.match(request.untrustedContext, /已完成 1/)
  assert.equal(request.messages[0].content, '请生成日总结。')
})
