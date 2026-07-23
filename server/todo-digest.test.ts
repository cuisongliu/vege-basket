import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildFeishuDigestCardContent,
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

  assert.equal(message, [
    'Veges 待办日报 · 7月16日',
    '',
    '昨日完成 **1** 项 · 重开 **1** 项',
    '当前待处理 **2** 项 · 已逾期 **1** 项',
    '',
    '**昨日完成 · 1**',
    '',
    '- **Ship release**',
    '  Alpha · 高优先级',
    '  原截止 7月15日',
    '',
    '**昨日重开 · 1**',
    '',
    '- **Review metrics**',
    '  Beta · 中优先级',
    '  原截止 7月18日',
    '',
    '**已逾期 · 1**',
    '',
    '- **Repair alert**',
    '  Alpha · 高优先级',
    '  已逾期 2 天 · 截止 7月14日',
    '',
    '**待处理 · 1**',
    '',
    '- **Polish docs**',
    '  Beta · 低优先级',
    '  截止 7月18日',
  ].join('\n'))
})

test('compresses an empty digest to the useful status lines', () => {
  const message = formatDailyTodoDigest({
    activities: [],
    completedCount: 0,
    digestLocalDate: '2026-07-15',
    outstandingCount: 0,
    outstandingItems: [],
    overdueCount: 0,
    reopenedCount: 0,
  })

  assert.equal(message, [
    'Veges 待办日报 · 7月16日',
    '',
    '昨日无完成或重开',
    '当前没有待处理事项',
  ].join('\n'))
})

test('limits digest sections and escapes user text for Lark Markdown', () => {
  const outstandingItems = Array.from({ length: 6 }, (_, index) => ({
    dueDate: `2026-07-${String(9 + index).padStart(2, '0')}`,
    priority: index === 0 ? 'high' : 'medium',
    projectName: index === 0 ? 'Alpha_[ops]' : 'Alpha',
    title: index === 0 ? 'Fix *alert* [link](url) <at>' : `Backlog ${index + 1}`,
    todoId: index + 1,
  }))
  const message = formatDailyTodoDigest({
    activities: [],
    completedCount: 0,
    digestLocalDate: '2026-07-15',
    outstandingCount: 6,
    outstandingItems,
    overdueCount: 6,
    reopenedCount: 0,
  })

  assert.ok(message.includes('Fix \\*alert\\* \\[link\\]\\(url\\) ＜at＞'))
  assert.ok(message.includes('Alpha\\_\\[ops\\]'))
  assert.match(message, /已逾期 7 天/)
  assert.match(message, /另有 1 项未展开/)
  assert.doesNotMatch(message, /Backlog 6/)
})

test('builds a structured passive Feishu card for readable digest content', () => {
  const content = [
    'Veges 待办日报 · 7月16日',
    '',
    '昨日无完成或重开',
    '当前没有待处理事项',
  ].join('\n')
  const card = JSON.parse(buildFeishuDigestCardContent(content)) as {
    body: {
      elements: Array<{
        columns?: Array<{ elements: Array<{ content: string; tag: string }> }>
        tag: string
      }>
    }
    config?: unknown
    header: {
      subtitle: { content: string; tag: string }
      template: string
      title: { content: string; tag: string }
    }
    schema: string
  }

  assert.equal(card.schema, '2.0')
  assert.equal(card.config, undefined)
  assert.equal(card.header.template, 'turquoise')
  assert.deepEqual(card.header.title, {
    content: 'Veges 待办日报',
    tag: 'plain_text',
  })
  assert.deepEqual(card.header.subtitle, {
    content: '7月16日',
    tag: 'plain_text',
  })
  assert.equal(card.body.elements.length, 1)
  assert.equal(card.body.elements[0]?.tag, 'column_set')
  assert.equal(card.body.elements[0]?.columns?.length, 2)
  assert.equal(card.body.elements[0]?.columns?.[0]?.elements[1]?.content, '无完成或重开')
  assert.equal(card.body.elements[0]?.columns?.[1]?.elements[1]?.content, '没有待处理事项')
})

test('lays out digest items with stable metadata and status columns', () => {
  const content = [
    'Veges 待办日报 · 7月16日',
    '',
    '昨日无完成或重开',
    '当前待处理 **1** 项 · 已逾期 **1** 项',
    '',
    '**已逾期 · 1**',
    '',
    '- **Repair alert**',
    '  Alpha · 高优先级',
    '  已逾期 2 天 · 截止 7月14日',
  ].join('\n')
  const card = JSON.parse(buildFeishuDigestCardContent(content)) as {
    body: {
      elements: Array<{
        background_style?: string
        columns?: Array<{ elements: Array<{ content: string; text_align: string }> }>
        margin?: string
        tag: string
      }>
    }
  }

  assert.deepEqual(card.body.elements.map((element) => element.tag), [
    'column_set',
    'column_set',
    'column_set',
  ])
  const sectionHeader = card.body.elements[1]
  assert.equal(sectionHeader?.columns?.[0]?.elements[0]?.content, '**已逾期**')
  assert.equal(
    sectionHeader?.columns?.[1]?.elements[0]?.content,
    '<text_tag color="red">1 项</text_tag>',
  )
  assert.equal(sectionHeader?.background_style, 'grey')
  assert.equal(sectionHeader?.margin, '14px 0px 0px 0px')
  const itemRow = card.body.elements[2]
  assert.equal(itemRow?.margin, '10px 0px 0px 0px')
  assert.equal(itemRow?.columns?.[0]?.elements[0]?.content, '**Repair alert**')
  assert.equal(
    itemRow?.columns?.[0]?.elements[1]?.content,
    '<font color="grey">Alpha · 高优先级</font>',
  )
  assert.equal(
    itemRow?.columns?.[1]?.elements[0]?.content,
    '<text_tag color="red">逾期 2 天</text_tag>',
  )
  assert.equal(itemRow?.columns?.[1]?.elements[0]?.text_align, 'right')
  assert.equal(
    itemRow?.columns?.[1]?.elements[1]?.content,
    '<font color="grey">截止 7月14日</font>',
  )
})

test('upgrades previous Markdown card content without merging item labels', () => {
  const previousContent = [
    'Veges 待办日报 · 7月16日',
    '',
    '昨日无完成或重开',
    '当前待处理 **1** 项 · 已逾期 **1** 项',
    '',
    '**已逾期 · 1**',
    '',
    '- **Repair alert**',
    '  Alpha · 高优先级 · 截止 7月14日 · 已逾期 2 天',
  ].join('\n')
  const card = JSON.parse(buildFeishuDigestCardContent(previousContent)) as {
    body: {
      elements: Array<{
        columns?: Array<{ elements: Array<{ content: string }> }>
      }>
    }
  }
  const itemRow = card.body.elements[2]

  assert.equal(itemRow?.columns?.length, 1)
  assert.equal(itemRow?.columns?.[0]?.elements[0]?.content, '**Repair alert**')
  assert.equal(
    itemRow?.columns?.[0]?.elements[1]?.content,
    '<font color="grey">Alpha · 高优先级 · 截止 7月14日 · 已逾期 2 天</font>',
  )
})

test('keeps legacy plain-text digests usable for card retries', () => {
  const legacyContent = [
    'Veges 待办日报 | 2026-07-15',
    '',
    '完成 0 项 · 重开 0 项 · 当前未完成 1 项 · 逾期 1 项',
    '',
    '- [中] Alpha / Fix *alert* [click](https://attacker.example)',
  ].join('\n')
  const card = JSON.parse(buildFeishuDigestCardContent(legacyContent)) as {
    body: { elements: Array<{ content: string }> }
    header: { title: { content: string } }
  }

  assert.equal(card.header.title.content, 'Veges 待办日报 | 2026-07-15')
  assert.equal(
    card.body.elements[0]?.content,
    [
      '完成 0 项 · 重开 0 项 · 当前未完成 1 项 · 逾期 1 项',
      '',
      '\\- \\[中\\] Alpha / Fix \\*alert\\* \\[click\\]\\(https://attacker\\.example\\)',
    ].join('\n'),
  )
})

test('calculates overdue state and bounded exponential retry delays', () => {
  assert.equal(isTodoOverdue('2026-07-15', '2026-07-15'), true)
  assert.equal(isTodoOverdue('2026-07-16', '2026-07-15'), false)
  assert.equal(getDigestRetryDelayMs(1), 5 * 60 * 1_000)
  assert.equal(getDigestRetryDelayMs(2), 10 * 60 * 1_000)
  assert.equal(getDigestRetryDelayMs(10), 60 * 60 * 1_000)
})
