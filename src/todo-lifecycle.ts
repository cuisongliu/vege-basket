import type { Todo } from './types'

export type TodoDisplayStatus = {
  label: '进行中' | '待确认' | '已完成' | '已废弃'
  marker: 'open' | 'review' | 'done' | 'discarded'
}

export function getTodoDisplayStatus(
  todo: Pick<Todo, 'confirmationStatus' | 'done' | 'todoStatus'>,
  organizationProject: boolean,
): TodoDisplayStatus {
  if (todo.todoStatus === 'discarded') return { label: '已废弃', marker: 'discarded' }
  if (todo.todoStatus === 'completed' || todo.done) return { label: '已完成', marker: 'done' }
  if (organizationProject && todo.confirmationStatus === 'pending_review') {
    return { label: '待确认', marker: 'review' }
  }
  return { label: '进行中', marker: 'open' }
}

export function canDiscardTodo(
  todo: Pick<Todo, 'recordedWorkMinutes' | 'todoStatus'>,
  organizationProject: boolean,
) {
  return todo.todoStatus === 'open' && (
    !organizationProject || (todo.recordedWorkMinutes ?? 0) === 0
  )
}

export function canReopenTodo(
  todo: Pick<Todo, 'todoStatus'>,
) {
  return todo.todoStatus === 'discarded'
}
