import { useEffect, useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { JournalDatePicker } from '@/components/journal-date-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Todo } from '@/types'

export type TodoFilterJoin = 'and' | 'or'
export type TodoFilterField =
  | 'title'
  | 'module'
  | 'assignee'
  | 'watcher'
  | 'creator'
  | 'priority'
  | 'done'
  | 'confirmationStatus'
  | 'dueDate'
  | 'createdAt'
export type TodoFilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'between'
export type TodoFilterCondition = {
  field: TodoFilterField
  id: string
  operator: TodoFilterOperator
  value: string
}

const todoFilterFieldLabels: Record<TodoFilterField, string> = {
  title: '待办内容',
  module: '所属模块',
  assignee: '负责人',
  watcher: '关注人',
  creator: '创建人',
  priority: '优先级',
  done: '完成状态',
  confirmationStatus: '确认状态',
  dueDate: '截止日期',
  createdAt: '创建日期',
}

const todoFilterOperatorLabels: Record<TodoFilterOperator, string> = {
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

const todoFilterFields: TodoFilterField[] = [
  'title',
  'module',
  'assignee',
  'watcher',
  'creator',
  'priority',
  'done',
  'confirmationStatus',
  'dueDate',
  'createdAt',
]

const todoFilterOperatorsByField: Record<TodoFilterField, TodoFilterOperator[]> = {
  title: ['contains', 'not_contains', 'equals', 'not_equals'],
  module: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  assignee: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  watcher: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  creator: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  priority: ['equals', 'not_equals'],
  done: ['equals', 'not_equals'],
  confirmationStatus: ['equals', 'not_equals'],
  dueDate: ['equals', 'not_equals', 'before', 'after', 'between'],
  createdAt: ['equals', 'not_equals', 'before', 'after', 'between'],
}

function getTodayStamp() {
  return new Date().toISOString().slice(0, 10)
}

export function createTodoFilterCondition(field: TodoFilterField = 'done'): TodoFilterCondition {
  const operator = todoFilterOperatorsByField[field][0]
  return {
    field,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    operator,
    value: getDefaultTodoFilterValue(field, operator),
  }
}

function getDefaultTodoFilterValue(field: TodoFilterField, operator: TodoFilterOperator) {
  if (operator === 'is_empty' || operator === 'is_not_empty') return ''
  if ((field === 'dueDate' || field === 'createdAt') && operator === 'between') {
    const today = getTodayStamp()
    return `${today}..${today}`
  }
  if (field === 'priority') return 'medium'
  if (field === 'done') return 'open'
  if (field === 'confirmationStatus') return 'confirmed'
  if (field === 'dueDate' || field === 'createdAt') return getTodayStamp()
  return ''
}

function parseTodoFilterDateRange(value: string) {
  const [rawStart, rawEnd] = value.split('..')
  const start = rawStart || getTodayStamp()
  const end = rawEnd || start
  return start <= end ? { start, end } : { start: end, end: start }
}

function isTodoFilterDateRangeCondition(condition: TodoFilterCondition) {
  return (condition.field === 'dueDate' || condition.field === 'createdAt') && condition.operator === 'between'
}

function normalizeTodoFilterCondition(condition: TodoFilterCondition): TodoFilterCondition {
  const allowedOperators = todoFilterOperatorsByField[condition.field]
  const operator = allowedOperators.includes(condition.operator)
    ? condition.operator
    : allowedOperators[0]
  const value = condition.value || getDefaultTodoFilterValue(condition.field, operator)
  return { ...condition, operator, value }
}

function getTodoFilterFieldValue(todo: Todo, field: TodoFilterField) {
  if (field === 'title') return todo.title
  if (field === 'module') return todo.moduleId ? String(todo.moduleId) : ''
  if (field === 'assignee') return todo.assigneeUserId ? String(todo.assigneeUserId) : ''
  if (field === 'watcher') return todo.watcherUserId ? String(todo.watcherUserId) : ''
  if (field === 'creator') return todo.createdByUserId ? String(todo.createdByUserId) : ''
  if (field === 'priority') return todo.priority
  if (field === 'done') return todo.done ? 'done' : 'open'
  if (field === 'confirmationStatus') return todo.confirmationStatus
  if (field === 'dueDate') return todo.dueDate
  return todo.createdAt.slice(0, 10)
}

function matchesTodoFilterCondition(todo: Todo, condition: TodoFilterCondition) {
  const normalized = normalizeTodoFilterCondition(condition)
  const fieldValue = getTodoFilterFieldValue(todo, normalized.field)
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
    const range = parseTodoFilterDateRange(targetValue)
    return Boolean(fieldValue) && fieldValue >= range.start && fieldValue <= range.end
  }
  return true
}

export function matchesTodoFilterConditions(
  todo: Todo,
  conditions: TodoFilterCondition[],
  join: TodoFilterJoin,
) {
  const activeConditions = conditions.filter((condition) => {
    const normalized = normalizeTodoFilterCondition(condition)
    return (
      normalized.operator === 'is_empty' ||
      normalized.operator === 'is_not_empty' ||
      Boolean(normalized.value.trim())
    )
  })
  if (activeConditions.length === 0) return true
  return join === 'and'
    ? activeConditions.every((condition) => matchesTodoFilterCondition(todo, condition))
    : activeConditions.some((condition) => matchesTodoFilterCondition(todo, condition))
}

export function TodoFilterBuilderDialog({
  assigneeOptions,
  conditions,
  creatorOptions,
  join,
  moduleOptions,
  watcherOptions,
  onApply,
  open,
  onOpenChange,
}: {
  assigneeOptions: Array<{ id: number; name: string }>
  conditions: TodoFilterCondition[]
  creatorOptions: Array<{ id: number; name: string }>
  join: TodoFilterJoin
  moduleOptions: Array<{ id: number; name: string }>
  watcherOptions: Array<{ id: number; name: string }>
  onApply: (next: { conditions: TodoFilterCondition[]; join: TodoFilterJoin }) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [draftJoin, setDraftJoin] = useState<TodoFilterJoin>(join)
  const [draftConditions, setDraftConditions] = useState<TodoFilterCondition[]>(conditions)

  useEffect(() => {
    if (!open) return
    setDraftJoin(join)
    setDraftConditions(conditions)
  }, [conditions, join, open])

  function updateCondition(id: string, patch: Partial<TodoFilterCondition>) {
    setDraftConditions((current) =>
      current.map((condition) => {
        if (condition.id !== id) return condition
        const next = { ...condition, ...patch }
        if (patch.field) {
          next.operator = todoFilterOperatorsByField[patch.field][0]
          next.value = getDefaultTodoFilterValue(next.field, next.operator)
        } else if (patch.operator) {
          next.value = getDefaultTodoFilterValue(next.field, patch.operator)
        }
        return normalizeTodoFilterCondition(next)
      }),
    )
  }

  function addCondition(condition = createTodoFilterCondition()) {
    setDraftConditions((current) => [...current, condition])
  }

  function applyFilters() {
    onApply({
      conditions: draftConditions.map(normalizeTodoFilterCondition).filter((condition) => {
        return (
          condition.operator === 'is_empty' ||
          condition.operator === 'is_not_empty' ||
          Boolean(condition.value.trim())
        )
      }),
      join: draftJoin,
    })
    onOpenChange(false)
  }

  function renderConditionValue(condition: TodoFilterCondition) {
    if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
      return <span className="todo-filter-value-hint">无需填写</span>
    }

    if (condition.field === 'title') {
      return (
        <Input
          aria-label="筛选值"
          className="todo-filter-value-input"
          placeholder="输入关键词"
          value={condition.value}
          onChange={(event) => updateCondition(condition.id, { value: event.target.value })}
        />
      )
    }

    if (condition.field === 'module') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选模块" className="todo-filter-condition-select">
            <SelectValue placeholder="选择模块" />
          </SelectTrigger>
          <SelectContent>
            {moduleOptions.map((module) => (
              <SelectItem key={module.id} value={String(module.id)}>
                {module.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (condition.field === 'assignee' || condition.field === 'watcher' || condition.field === 'creator') {
      const options = condition.field === 'assignee'
        ? assigneeOptions
        : condition.field === 'watcher'
          ? watcherOptions
          : creatorOptions
      const label = condition.field === 'assignee'
        ? '负责人'
        : condition.field === 'watcher'
          ? '关注人'
          : '创建人'
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label={`筛选${label}`} className="todo-filter-condition-select">
            <SelectValue placeholder={`选择${label}`} />
          </SelectTrigger>
          <SelectContent>
            {options.map((user) => (
              <SelectItem key={user.id} value={String(user.id)}>
                @{user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (condition.field === 'priority') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选优先级" className="todo-filter-condition-select">
            <SelectValue placeholder="选择优先级" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">高优先级</SelectItem>
            <SelectItem value="medium">中优先级</SelectItem>
            <SelectItem value="low">低优先级</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if (condition.field === 'done') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选完成状态" className="todo-filter-condition-select">
            <SelectValue placeholder="选择状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">未完成</SelectItem>
            <SelectItem value="done">已完成</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if (condition.field === 'confirmationStatus') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选确认状态" className="todo-filter-condition-select">
            <SelectValue placeholder="选择状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="confirmed">已确认</SelectItem>
            <SelectItem value="pending_review">待验收</SelectItem>
            <SelectItem value="rejected">已驳回</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if ((condition.field === 'dueDate' || condition.field === 'createdAt') && condition.operator === 'between') {
      const range = parseTodoFilterDateRange(condition.value)
      return (
        <div className="todo-filter-date-range">
          <JournalDatePicker
            ariaLabel="选择开始日期"
            className="todo-filter-date-trigger"
            datesWithEntries={[]}
            displayValue={range.start || '开始日期'}
            value={range.start}
            onChange={(value) =>
              updateCondition(condition.id, { value: `${value}..${range.end}` })
            }
          />
          <span className="todo-filter-date-range-separator">至</span>
          <JournalDatePicker
            ariaLabel="选择结束日期"
            className="todo-filter-date-trigger"
            datesWithEntries={[]}
            displayValue={range.end || '结束日期'}
            value={range.end}
            onChange={(value) =>
              updateCondition(condition.id, { value: `${range.start}..${value}` })
            }
          />
        </div>
      )
    }

    return (
      <JournalDatePicker
        ariaLabel="选择筛选日期"
        className="todo-filter-date-trigger"
        datesWithEntries={[]}
        displayValue={condition.value || '选择日期'}
        value={condition.value || getTodayStamp()}
        onChange={(value) => updateCondition(condition.id, { value })}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="todo-filter-dialog">
        <DialogHeader>
          <DialogTitle>筛选待办</DialogTitle>
          <DialogDescription>
            用条件组合筛选待办。搜索框仍保留在外层，适合快速查标题或关键词。
          </DialogDescription>
        </DialogHeader>
        <div className="todo-filter-join-row">
          <span>匹配方式</span>
          <Select value={draftJoin} onValueChange={(value) => setDraftJoin(value as TodoFilterJoin)}>
            <SelectTrigger aria-label="筛选匹配方式" className="todo-filter-join-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">全部满足（且）</SelectItem>
              <SelectItem value="or">任一满足（或）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="todo-filter-condition-list">
          {draftConditions.length === 0 ? (
            <div className="todo-filter-empty">还没有筛选条件。</div>
          ) : (
            draftConditions.map((condition, index) => (
              <div
                className={
                  isTodoFilterDateRangeCondition(condition)
                    ? 'todo-filter-condition-row date-range'
                    : 'todo-filter-condition-row'
                }
                key={condition.id}
              >
                <span className="todo-filter-condition-index">条件 {index + 1}</span>
                <Select
                  value={condition.field}
                  onValueChange={(value) =>
                    updateCondition(condition.id, { field: value as TodoFilterField })
                  }
                >
                  <SelectTrigger aria-label="筛选字段" className="todo-filter-condition-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {todoFilterFields.map((field) => (
                      <SelectItem key={field} value={field}>
                        {todoFilterFieldLabels[field]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={condition.operator}
                  onValueChange={(value) =>
                    updateCondition(condition.id, { operator: value as TodoFilterOperator })
                  }
                >
                  <SelectTrigger aria-label="筛选操作符" className="todo-filter-condition-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {todoFilterOperatorsByField[condition.field].map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {todoFilterOperatorLabels[operator]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="todo-filter-value-control">{renderConditionValue(condition)}</div>
                <Button
                  className="todo-filter-remove-button"
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="删除筛选条件"
                  onClick={() =>
                    setDraftConditions((current) =>
                      current.filter((item) => item.id !== condition.id),
                    )
                  }
                >
                  <Trash size={14} />
                </Button>
              </div>
            ))
          )}
        </div>
        <Button
          className="todo-filter-add-condition ghost-button"
          type="button"
          variant="outline"
          onClick={() => addCondition()}
        >
          <Plus size={14} /> 添加条件
        </Button>
        <DialogFooter>
          <Button
            className="ghost-button"
            type="button"
            variant="outline"
            onClick={() => {
              setDraftConditions([])
              setDraftJoin('and')
            }}
          >
            清空
          </Button>
          <Button className="ghost-button" type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="solid-button" type="button" onClick={applyFilters}>
            应用筛选
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
