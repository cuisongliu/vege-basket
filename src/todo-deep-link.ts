export type TodoDeepLink =
  | { status: 'absent'; todoId: null }
  | { status: 'invalid'; todoId: null }
  | { status: 'valid'; todoId: number }

export function parseTodoDeepLink(search: string): TodoDeepLink {
  const value = new URLSearchParams(search).get('todo')
  if (value == null) return { status: 'absent', todoId: null }
  if (!/^[1-9]\d*$/.test(value)) return { status: 'invalid', todoId: null }
  const todoId = Number(value)
  return Number.isSafeInteger(todoId)
    ? { status: 'valid', todoId }
    : { status: 'invalid', todoId: null }
}

export function removeTodoDeepLink(params: {
  hash: string
  pathname: string
  search: string
}) {
  const searchParams = new URLSearchParams(params.search)
  searchParams.delete('todo')
  const search = searchParams.toString()
  return `${params.pathname}${search ? `?${search}` : ''}${params.hash}`
}

export function resolveTodoDeepLinkTarget<T extends { id: number; projectId: number }>(params: {
  projectIds: Iterable<number>
  todoId: number
  todos: T[]
}) {
  const todo = params.todos.find((item) => item.id === params.todoId) ?? null
  if (!todo) return null
  return new Set(params.projectIds).has(todo.projectId) ? todo : null
}

export function shouldDeferTodoDeepLinkForInvite(
  inviteToken: string,
  settledInviteToken: string,
) {
  return Boolean(inviteToken && inviteToken !== settledInviteToken)
}
