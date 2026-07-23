export const dailyTodoDigestKind = 'daily_todo_digest'
export const defaultDigestTimeZone = 'Asia/Shanghai'
export const defaultDigestSendTime = '10:00'
export const digestMaxAttempts = 3

const digestListLimit = 5
const digestRetryBaseDelayMs = 5 * 60 * 1_000
const digestRetryMaxDelayMs = 60 * 60 * 1_000
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/
const legacyDigestTitlePattern = /^Veges 待办日报 \| \d{4}-\d{2}-\d{2}$/
const sendTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

type LocalDateTime = {
  day: number
  hour: number
  minute: number
  month: number
  second: number
  year: number
}

export type DailyDigestSchedule = {
  digestLocalDate: string
  periodEnd: Date
  periodStart: Date
  scheduledFor: Date
  scheduledLocalDate: string
}

export type TodoDigestActivity = {
  dueDate: string
  eventType: 'completed' | 'reopened'
  occurredAt: Date
  priority: string
  projectName: string
  title: string
  todoId: number | null
}

export type TodoDigestOutstandingItem = {
  dueDate: string
  priority: string
  projectName: string
  title: string
  todoId: number
}

export type DailyTodoDigestFacts = {
  activities: TodoDigestActivity[]
  completedCount: number
  digestLocalDate: string
  outstandingCount: number
  outstandingItems: TodoDigestOutstandingItem[]
  overdueCount: number
  reopenedCount: number
}

function localDateTimeFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB-u-ca-iso8601', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  })
}

function getLocalDateTime(value: Date, timeZone: string): LocalDateTime {
  const parts = localDateTimeFormatter(timeZone).formatToParts(value)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return {
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    month: Number(values.get('month')),
    second: Number(values.get('second')),
    year: Number(values.get('year')),
  }
}

function formatIsoDate(parts: Pick<LocalDateTime, 'day' | 'month' | 'year'>) {
  return [parts.year, parts.month, parts.day]
    .map((part, index) => index === 0 ? String(part).padStart(4, '0') : String(part).padStart(2, '0'))
    .join('-')
}

function parseIsoDate(value: string) {
  if (!isoDatePattern.test(value)) throw new Error('Digest date must use YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Digest date is invalid')
  }
  return { day, month, year }
}

export function isValidDigestSendTime(value: unknown): value is string {
  return typeof value === 'string' && sendTimePattern.test(value)
}

export function isValidDigestTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) return false
  try {
    localDateTimeFormatter(value).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function shiftIsoDate(value: string, days: number) {
  const parts = parseIsoDate(value)
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return formatIsoDate({
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  })
}

function localDateTimeToUtc(params: {
  date: string
  hour: number
  minute: number
  timeZone: string
}) {
  const dateParts = parseIsoDate(params.date)
  const targetWallTime = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    params.hour,
    params.minute,
  )
  let candidate = targetWallTime

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getLocalDateTime(new Date(candidate), params.timeZone)
    const actualWallTime = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const adjustment = targetWallTime - actualWallTime
    if (adjustment === 0) return new Date(candidate)
    candidate += adjustment
  }

  throw new Error(`Local digest time does not exist in ${params.timeZone}`)
}

export function resolveDailyDigestSchedule(params: {
  localSendTime?: string
  now: Date
  timeZone?: string
}): DailyDigestSchedule {
  const localSendTime = params.localSendTime ?? defaultDigestSendTime
  const timeZone = params.timeZone ?? defaultDigestTimeZone
  if (!isValidDigestSendTime(localSendTime)) {
    throw new Error('Digest send time must use valid HH:mm format')
  }
  if (!isValidDigestTimeZone(timeZone)) {
    throw new Error('Digest timezone must be a valid IANA timezone')
  }

  const nowParts = getLocalDateTime(params.now, timeZone)
  const currentLocalDate = formatIsoDate(nowParts)
  const [sendHour, sendMinute] = localSendTime.split(':').map(Number)
  const nowMinuteOfDay = nowParts.hour * 60 + nowParts.minute
  const sendMinuteOfDay = sendHour * 60 + sendMinute
  const scheduledLocalDate = nowMinuteOfDay >= sendMinuteOfDay
    ? currentLocalDate
    : shiftIsoDate(currentLocalDate, -1)
  const digestLocalDate = shiftIsoDate(scheduledLocalDate, -1)
  const nextLocalDate = shiftIsoDate(digestLocalDate, 1)

  return {
    digestLocalDate,
    periodEnd: localDateTimeToUtc({
      date: nextLocalDate,
      hour: 0,
      minute: 0,
      timeZone,
    }),
    periodStart: localDateTimeToUtc({
      date: digestLocalDate,
      hour: 0,
      minute: 0,
      timeZone,
    }),
    scheduledFor: localDateTimeToUtc({
      date: scheduledLocalDate,
      hour: sendHour,
      minute: sendMinute,
      timeZone,
    }),
    scheduledLocalDate,
  }
}

export function shouldSeedDailyDigestRun(schedule: DailyDigestSchedule, subscriptionActiveSince: Date) {
  return schedule.scheduledFor.getTime() >= subscriptionActiveSince.getTime()
}

export function getDigestRetryDelayMs(attempt: number) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('Digest attempt must be a positive integer')
  }
  return Math.min(digestRetryBaseDelayMs * (2 ** (attempt - 1)), digestRetryMaxDelayMs)
}

export function isTodoOverdue(dueDate: string, digestLocalDate: string) {
  parseIsoDate(dueDate)
  parseIsoDate(digestLocalDate)
  return dueDate <= digestLocalDate
}

function cleanDigestText(value: string, fallback: string) {
  const cleaned = value
    .replace(/[<>]/g, (character) => character === '<' ? '＜' : '＞')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return fallback
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned
}

function escapeLarkMarkdownLiteral(value: string) {
  return value.replace(/([\\*_~`[\]()#+\-.!|{}>])/g, '\\$1')
}

function escapeLarkMarkdownText(value: string, fallback: string) {
  return escapeLarkMarkdownLiteral(cleanDigestText(value, fallback))
}

function priorityLabel(priority: string) {
  if (priority === 'high') return '高优先级'
  if (priority === 'low') return '低优先级'
  return '中优先级'
}

function formatMonthDay(value: string) {
  const parts = parseIsoDate(value)
  return `${parts.month}月${parts.day}日`
}

function daysBetweenIsoDates(start: string, end: string) {
  const startParts = parseIsoDate(start)
  const endParts = parseIsoDate(end)
  const startTime = Date.UTC(startParts.year, startParts.month - 1, startParts.day)
  const endTime = Date.UTC(endParts.year, endParts.month - 1, endParts.day)
  return Math.round((endTime - startTime) / (24 * 60 * 60 * 1_000))
}

function formatDigestItem(item: {
  dueDate: string
  priority: string
  projectName: string
  title: string
}, mode: 'activity' | 'outstanding' | 'overdue', deliveryLocalDate: string) {
  const projectName = escapeLarkMarkdownText(item.projectName, '未命名项目')
  const title = escapeLarkMarkdownText(item.title, '未命名待办')
  let dueLabel = `原截止 ${formatMonthDay(item.dueDate)}`
  if (mode === 'overdue') {
    const overdueDays = Math.max(1, daysBetweenIsoDates(item.dueDate, deliveryLocalDate))
    dueLabel = `截止 ${formatMonthDay(item.dueDate)} · 已逾期 ${overdueDays} 天`
  } else if (mode === 'outstanding') {
    dueLabel = item.dueDate === deliveryLocalDate
      ? '今日截止'
      : `截止 ${formatMonthDay(item.dueDate)}`
  }
  return [`- **${title}**`, `  ${projectName} · ${priorityLabel(item.priority)} · ${dueLabel}`]
}

function appendSection(params: {
  count: number
  deliveryLocalDate: string
  items: Array<{
    dueDate: string
    priority: string
    projectName: string
    title: string
  }>
  lines: string[]
  mode: 'activity' | 'outstanding' | 'overdue'
  title: string
}) {
  if (params.count === 0) return
  params.lines.push('', `**${params.title} · ${params.count}**`, '')
  const displayed = params.items.slice(0, digestListLimit)
  displayed.forEach((item, index) => {
    if (index > 0) params.lines.push('')
    params.lines.push(...formatDigestItem(item, params.mode, params.deliveryLocalDate))
  })
  if (params.count > displayed.length) {
    params.lines.push('', `另有 ${params.count - displayed.length} 项未展开`)
  }
}

export function formatDailyTodoDigest(facts: DailyTodoDigestFacts) {
  parseIsoDate(facts.digestLocalDate)
  const deliveryLocalDate = shiftIsoDate(facts.digestLocalDate, 1)
  const completed = facts.activities.filter((item) => item.eventType === 'completed')
  const reopened = facts.activities.filter((item) => item.eventType === 'reopened')
  const overdue = facts.outstandingItems.filter((item) =>
    isTodoOverdue(item.dueDate, facts.digestLocalDate))
  const outstanding = facts.outstandingItems.filter((item) =>
    !isTodoOverdue(item.dueDate, facts.digestLocalDate))
  const activitySummary = facts.completedCount === 0 && facts.reopenedCount === 0
    ? '昨日无完成或重开'
    : `昨日完成 **${facts.completedCount}** 项 · 重开 **${facts.reopenedCount}** 项`
  const backlogSummary = facts.outstandingCount === 0
    ? '当前没有待处理事项'
    : `当前待处理 **${facts.outstandingCount}** 项 · 已逾期 **${facts.overdueCount}** 项`
  const lines = [`Veges 待办日报 · ${formatMonthDay(deliveryLocalDate)}`, '', activitySummary, backlogSummary]

  appendSection({
    count: facts.completedCount,
    deliveryLocalDate,
    items: completed,
    lines,
    mode: 'activity',
    title: '昨日完成',
  })
  appendSection({
    count: facts.reopenedCount,
    deliveryLocalDate,
    items: reopened,
    lines,
    mode: 'activity',
    title: '昨日重开',
  })
  appendSection({
    count: facts.overdueCount,
    deliveryLocalDate,
    items: overdue,
    lines,
    mode: 'overdue',
    title: '已逾期',
  })
  appendSection({
    count: Math.max(0, facts.outstandingCount - facts.overdueCount),
    deliveryLocalDate,
    items: outstanding,
    lines,
    mode: 'outstanding',
    title: '待处理',
  })

  return lines.join('\n')
}

export function buildFeishuDigestCardContent(content: string) {
  const [rawTitle = '', ...rawBodyLines] = content.split('\n')
  const title = cleanDigestText(rawTitle, 'Veges 待办日报').slice(0, 80)
  const rawBody = rawBodyLines.join('\n').trim()
  const body = rawBody
    ? legacyDigestTitlePattern.test(rawTitle.trim())
      ? escapeLarkMarkdownLiteral(rawBody)
      : rawBody
    : '暂无日报内容。'
  return JSON.stringify({
    body: {
      direction: 'vertical',
      elements: [{
        content: body,
        margin: '0px 0px 0px 0px',
        tag: 'markdown',
        text_align: 'left',
        text_size: 'normal_v2',
      }],
      padding: '12px 12px 12px 12px',
    },
    header: {
      padding: '12px 12px 12px 12px',
      template: 'turquoise',
      title: {
        content: title,
        tag: 'plain_text',
      },
    },
    schema: '2.0',
  })
}
