import type { AiChatMessage } from './ai-provider.ts'

export type AiSummaryPeriodType = 'daily' | 'weekly'
export type AiTodoActivityKind =
  | 'assigned'
  | 'completed'
  | 'confirmed'
  | 'created'
  | 'rejected'
  | 'reopened'

export type AiSummaryPeriod = {
  endDate: string
  endExclusive: Date
  label: string
  start: Date
  startDate: string
  timeZone: 'Asia/Shanghai'
  type: AiSummaryPeriodType
}

export type AiTodoActivityFact = {
  actorName?: string | null
  assigneeName?: string | null
  detail?: string | null
  dueDate?: string | null
  kind: AiTodoActivityKind
  occurredAt: Date | string
  priority?: 'high' | 'low' | 'medium' | null
  projectName?: string | null
  title: string
  todoId: number
}

export type AiPeriodSummaryRequest = {
  messages: AiChatMessage[]
  systemPrompt: string
  untrustedContext: string
}

export const AI_PERIOD_SUMMARY_SYSTEM_PROMPT =
  '你是 Veges 的项目总结助手。仅根据给出的周期、统计和待办活动事实生成简洁中文总结。先写结论，再写已完成事项、变化与风险、下一步建议。不得补写资料中没有的完成情况、人员、日期或因果关系。'

const shanghaiTimeZone = 'Asia/Shanghai' as const
const shanghaiOffsetMs = 8 * 60 * 60 * 1_000
const dayMs = 24 * 60 * 60 * 1_000
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: shanghaiTimeZone,
  year: 'numeric',
})
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: '2-digit',
  timeZone: shanghaiTimeZone,
  year: 'numeric',
})

function dateParts(value: Date) {
  const parts = dateFormatter.formatToParts(value)
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { day: pick('day'), month: pick('month'), year: pick('year') }
}

function shanghaiMidnight(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day) - shanghaiOffsetMs)
}

function formatDate(value: Date) {
  const { day, month, year } = dateParts(value)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function getAiSummaryPeriod(
  type: AiSummaryPeriodType,
  now: Date = new Date(),
): AiSummaryPeriod {
  if (!Number.isFinite(now.getTime())) throw new Error('Summary reference time is invalid')
  const { day, month, year } = dateParts(now)
  const localCalendarDate = new Date(Date.UTC(year, month - 1, day))
  const mondayOffset = (localCalendarDate.getUTCDay() + 6) % 7
  const firstCalendarDate = type === 'weekly'
    ? new Date(localCalendarDate.getTime() - mondayOffset * dayMs)
    : localCalendarDate
  const start = shanghaiMidnight(
    firstCalendarDate.getUTCFullYear(),
    firstCalendarDate.getUTCMonth() + 1,
    firstCalendarDate.getUTCDate(),
  )
  const endExclusive = new Date(start.getTime() + (type === 'weekly' ? 7 : 1) * dayMs)
  const startDate = formatDate(start)
  const endDate = formatDate(new Date(endExclusive.getTime() - 1))
  return {
    endDate,
    endExclusive,
    label: startDate === endDate ? startDate : `${startDate} 至 ${endDate}`,
    start,
    startDate,
    timeZone: shanghaiTimeZone,
    type,
  }
}

const activityLabels: Record<AiTodoActivityKind, string> = {
  assigned: '已指派',
  completed: '已完成',
  confirmed: '已确认',
  created: '已创建',
  rejected: '已驳回',
  reopened: '已重开',
}

function cleanText(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

export function formatAiPeriodFacts(facts: readonly AiTodoActivityFact[], maxChars = 12_000) {
  const ordered = [...facts].sort((left, right) =>
    new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime())
  const lines: string[] = []
  for (const fact of ordered) {
    const occurredAt = new Date(fact.occurredAt)
    if (!Number.isFinite(occurredAt.getTime())) continue
    const metadata = [
      fact.projectName ? `项目：${cleanText(fact.projectName, 80)}` : '',
      fact.actorName ? `操作人：${cleanText(fact.actorName, 80)}` : '',
      fact.assigneeName ? `负责人：${cleanText(fact.assigneeName, 80)}` : '',
      fact.dueDate ? `截止：${fact.dueDate}` : '',
      fact.priority ? `优先级：${fact.priority}` : '',
    ].filter(Boolean)
    const line = [
      `- ${dateTimeFormatter.format(occurredAt)}`,
      activityLabels[fact.kind],
      `待办 #${fact.todoId}：${cleanText(fact.title, 180)}`,
      ...metadata,
      fact.detail ? `详情：${cleanText(fact.detail, 280)}` : '',
    ].filter(Boolean).join(' | ')
    if ([...lines, line].join('\n').length > maxChars) break
    lines.push(line)
  }
  return lines.length > 0 ? lines.join('\n') : '本周期没有待办活动事实。'
}

export function countAiPeriodFacts(facts: readonly AiTodoActivityFact[]) {
  const counts: Record<AiTodoActivityKind, number> = {
    assigned: 0,
    completed: 0,
    confirmed: 0,
    created: 0,
    rejected: 0,
    reopened: 0,
  }
  for (const fact of facts) counts[fact.kind] += 1
  return counts
}

export function buildAiPeriodSummaryRequest(
  period: AiSummaryPeriod,
  facts: readonly AiTodoActivityFact[],
): AiPeriodSummaryRequest {
  const counts = countAiPeriodFacts(facts)
  const statistics = Object.entries(counts)
    .map(([kind, count]) => `${activityLabels[kind as AiTodoActivityKind]} ${count}`)
    .join('，')
  return {
    messages: [{
      content: `请生成${period.type === 'daily' ? '日总结' : '周总结'}。`,
      role: 'user',
    }],
    systemPrompt: AI_PERIOD_SUMMARY_SYSTEM_PROMPT,
    untrustedContext: [
      `总结类型：${period.type}`,
      `统计时区：${period.timeZone}`,
      `统计周期：${period.label}`,
      `活动统计：${statistics}`,
      '待办活动事实：',
      formatAiPeriodFacts(facts),
    ].join('\n'),
  }
}
