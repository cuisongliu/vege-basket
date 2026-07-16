import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultDigestSendTime,
  defaultDigestTimeZone,
  formatDailyTodoDigest,
  getDigestRetryDelayMs,
  isTodoOverdue,
  isValidDigestSendTime,
  isValidDigestTimeZone,
  resolveDailyDigestSchedule,
  shouldSeedDailyDigestRun,
} from './todo-digest.ts'

test('uses the approved default digest schedule and validates user times', () => {
  assert.equal(defaultDigestSendTime, '10:00')
  assert.equal(defaultDigestTimeZone, 'Asia/Shanghai')
  assert.equal(isValidDigestSendTime('00:00'), true)
  assert.equal(isValidDigestSendTime('23:59'), true)
  assert.equal(isValidDigestSendTime('9:30'), false)
  assert.equal(isValidDigestSendTime('24:00'), false)
  assert.equal(isValidDigestTimeZone('Asia/Shanghai'), true)
  assert.equal(isValidDigestTimeZone(' Asia/Shanghai '), false)
  assert.equal(isValidDigestTimeZone('not/a-timezone'), false)
})

test('schedules the previous complete Shanghai natural day at 10:00', () => {
  const schedule = resolveDailyDigestSchedule({
    localSendTime: '10:00',
    now: new Date('2026-07-16T02:00:00.000Z'),
    timeZone: 'Asia/Shanghai',
  })

  assert.equal(schedule.scheduledLocalDate, '2026-07-16')
  assert.equal(schedule.digestLocalDate, '2026-07-15')
  assert.equal(schedule.scheduledFor.toISOString(), '2026-07-16T02:00:00.000Z')
  assert.equal(schedule.periodStart.toISOString(), '2026-07-14T16:00:00.000Z')
  assert.equal(schedule.periodEnd.toISOString(), '2026-07-15T16:00:00.000Z')
})

test('catches up the latest missed schedule but not a run from before subscription', () => {
  const schedule = resolveDailyDigestSchedule({
    localSendTime: '10:00',
    now: new Date('2026-07-16T01:59:00.000Z'),
    timeZone: 'Asia/Shanghai',
  })

  assert.equal(schedule.scheduledLocalDate, '2026-07-15')
  assert.equal(schedule.digestLocalDate, '2026-07-14')
  assert.equal(
    shouldSeedDailyDigestRun(schedule, new Date('2026-07-15T01:50:00.000Z')),
    true,
  )
  assert.equal(
    shouldSeedDailyDigestRun(schedule, new Date('2026-07-15T02:01:00.000Z')),
    false,
  )
})

test('preserves natural-day bounds across a daylight-saving transition', () => {
  const schedule = resolveDailyDigestSchedule({
    localSendTime: '10:00',
    now: new Date('2026-03-09T14:00:00.000Z'),
    timeZone: 'America/New_York',
  })

  assert.equal(schedule.digestLocalDate, '2026-03-08')
  assert.equal(schedule.periodStart.toISOString(), '2026-03-08T05:00:00.000Z')
  assert.equal(schedule.periodEnd.toISOString(), '2026-03-09T04:00:00.000Z')
})

test('formats a deterministic digest without AI', () => {
  const message = formatDailyTodoDigest({
    activities: [
      {
        dueDate: '2026-07-15',
        eventType: 'completed',
        occurredAt: new Date('2026-07-15T03:00:00.000Z'),
        priority: 'high',
        projectName: 'Alpha',
        title: 'Ship release',
        todoId: 1,
      },
      {
        dueDate: '2026-07-18',
        eventType: 'reopened',
        occurredAt: new Date('2026-07-15T04:00:00.000Z'),
        priority: 'medium',
        projectName: 'Beta',
        title: 'Review metrics',
        todoId: 2,
      },
    ],
    completedCount: 1,
    digestLocalDate: '2026-07-15',
    outstandingCount: 2,
    outstandingItems: [
      {
        dueDate: '2026-07-14',
        priority: 'high',
        projectName: 'Alpha',
        title: 'Repair alert',
        todoId: 3,
      },
      {
        dueDate: '2026-07-18',
        priority: 'low',
        projectName: 'Beta',
        title: 'Polish docs',
        todoId: 4,
      },
    ],
    overdueCount: 1,
    reopenedCount: 1,
  })

  assert.match(message, /Veges 待办日报 \| 2026-07-15/)
  assert.match(message, /完成 1 项 · 重开 1 项 · 当前未完成 2 项 · 逾期 1 项/)
  assert.match(message, /\[高\] Alpha \/ Ship release（截止 2026-07-15）/)
  assert.match(message, /当前逾期（1）/)
  assert.match(message, /其他未完成（1）/)
})

test('calculates overdue state and bounded exponential retry delays', () => {
  assert.equal(isTodoOverdue('2026-07-15', '2026-07-15'), true)
  assert.equal(isTodoOverdue('2026-07-16', '2026-07-15'), false)
  assert.equal(getDigestRetryDelayMs(1), 5 * 60 * 1_000)
  assert.equal(getDigestRetryDelayMs(2), 10 * 60 * 1_000)
  assert.equal(getDigestRetryDelayMs(10), 60 * 60 * 1_000)
})
