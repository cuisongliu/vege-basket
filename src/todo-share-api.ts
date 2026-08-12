import { request } from './api'
import type { TodoShareLink, TodoShareView } from './todo-share-types'

const createShareLinkTimeoutMs = 20_000

export function fetchTodoShare(token: string) {
  return request<TodoShareView>(`/api/todo-shares/${encodeURIComponent(token)}`)
}

export function addTodoShareComment(token: string, content: string, requestId: string) {
  return request<{ created: boolean; noteId: number; todoId: number }>(`/api/todo-shares/${encodeURIComponent(token)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, requestId }),
  })
}

export async function createTodoShareLink(todoId: number) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), createShareLinkTimeoutMs)
  try {
    const result = await request<TodoShareLink>(`/api/todos/${todoId}/share-link`, {
      method: 'POST',
      signal: controller.signal,
    })
    return { ...result, url: new URL(result.url, globalThis.location.origin).toString() }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export function revokeTodoShareLink(todoId: number) {
  return request<{ ok: true }>(`/api/todos/${todoId}/share-link`, { method: 'DELETE' })
}
