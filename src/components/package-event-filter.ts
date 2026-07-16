import type { ProjectPackageEvent } from '@/types'

export type PackageEventFilterJoin = 'and' | 'or'
export type PackageEventFilterField =
  | 'title'
  | 'assignee'
  | 'deliveryDate'
  | 'status'
  | 'type'
export type PackageEventFilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'between'
export type PackageEventFilterCondition = {
  field: PackageEventFilterField
  id: string
  operator: PackageEventFilterOperator
  value: string
}

export const packageEventFilterFieldLabels: Record<PackageEventFilterField, string> = {
  title: '事件标题',
  assignee: '交付人',
  deliveryDate: '交付日期',
  status: '交付状态',
  type: '事件类型',
}

export const packageEventFilterOperatorLabels: Record<PackageEventFilterOperator, string> = {
  contains: '包含',
  not_contains: '不包含',
  equals: '等于',
  not_equals: '不等于',
  is_empty: '为空',
  is_not_empty: '不为空',
  before: '早于',
  after: '晚于',
  between: '介于',
}

export const packageEventFilterFields: PackageEventFilterField[] = [
  'title',
  'assignee',
  'deliveryDate',
  'status',
  'type',
]

export const packageEventFilterOperatorsByField: Record<
  PackageEventFilterField,
  PackageEventFilterOperator[]
> = {
  title: ['contains', 'not_contains', 'equals', 'not_equals'],
  assignee: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  deliveryDate: ['equals', 'not_equals', 'before', 'after', 'between'],
  status: ['equals', 'not_equals'],
  type: ['equals', 'not_equals'],
}

export function getPackageEventFilterTodayStamp() {
  return new Date().toISOString().slice(0, 10)
}

export function getDefaultPackageEventFilterValue(
  field: PackageEventFilterField,
  operator: PackageEventFilterOperator,
) {
  if (operator === 'is_empty' || operator === 'is_not_empty') return ''
  if (field === 'deliveryDate' && operator === 'between') {
    const today = getPackageEventFilterTodayStamp()
    return `${today}..${today}`
  }
  if (field === 'deliveryDate') return getPackageEventFilterTodayStamp()
  if (field === 'status') return 'draft'
  if (field === 'type') return 'upgrade'
  return ''
}

export function createPackageEventFilterCondition(
  field: PackageEventFilterField = 'status',
): PackageEventFilterCondition {
  const operator = packageEventFilterOperatorsByField[field][0]
  return {
    field,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operator,
    value: getDefaultPackageEventFilterValue(field, operator),
  }
}

export function parsePackageEventFilterDateRange(value: string) {
  const [rawStart, rawEnd] = value.split('..')
  const start = rawStart || getPackageEventFilterTodayStamp()
  const end = rawEnd || start
  return start <= end ? { start, end } : { start: end, end: start }
}

export function normalizePackageEventFilterCondition(
  condition: PackageEventFilterCondition,
): PackageEventFilterCondition {
  const allowedOperators = packageEventFilterOperatorsByField[condition.field]
  const operator = allowedOperators.includes(condition.operator)
    ? condition.operator
    : allowedOperators[0]
  return {
    ...condition,
    operator,
    value: condition.value || getDefaultPackageEventFilterValue(condition.field, operator),
  }
}

function getFieldValue(event: ProjectPackageEvent, field: PackageEventFilterField) {
  if (field === 'title') return event.title
  if (field === 'assignee') return event.assigneeUserId ? String(event.assigneeUserId) : ''
  if (field === 'deliveryDate') return event.deliveryDate || event.createdAt.slice(0, 10)
  if (field === 'status') return event.status
  return event.type
}

function matchesCondition(
  event: ProjectPackageEvent,
  condition: PackageEventFilterCondition,
) {
  const normalized = normalizePackageEventFilterCondition(condition)
  const fieldValue = getFieldValue(event, normalized.field)
  const targetValue = normalized.value

  if (normalized.operator === 'is_empty') return !fieldValue
  if (normalized.operator === 'is_not_empty') return Boolean(fieldValue)
  if (normalized.operator === 'contains') {
    return fieldValue.toLowerCase().includes(targetValue.trim().toLowerCase())
  }
  if (normalized.operator === 'not_contains') {
    return !fieldValue.toLowerCase().includes(targetValue.trim().toLowerCase())
  }
  if (normalized.operator === 'equals') return fieldValue === targetValue
  if (normalized.operator === 'not_equals') return fieldValue !== targetValue
  if (normalized.operator === 'before') return Boolean(fieldValue) && fieldValue < targetValue
  if (normalized.operator === 'after') return Boolean(fieldValue) && fieldValue > targetValue
  if (normalized.operator === 'between') {
    const range = parsePackageEventFilterDateRange(targetValue)
    return Boolean(fieldValue) && fieldValue >= range.start && fieldValue <= range.end
  }
  return true
}

export function matchesPackageEventFilterConditions(
  event: ProjectPackageEvent,
  conditions: PackageEventFilterCondition[],
  join: PackageEventFilterJoin,
) {
  const activeConditions = conditions.filter((condition) => {
    const normalized = normalizePackageEventFilterCondition(condition)
    return (
      normalized.operator === 'is_empty' ||
      normalized.operator === 'is_not_empty' ||
      Boolean(normalized.value.trim())
    )
  })
  if (activeConditions.length === 0) return true
  return join === 'and'
    ? activeConditions.every((condition) => matchesCondition(event, condition))
    : activeConditions.some((condition) => matchesCondition(event, condition))
}
