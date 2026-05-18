import type {
  InboxItem,
  Priority,
  Project,
  ProjectStatus,
  Summary,
  Todo,
} from './types'

export type WorkspaceData = {
  inbox: InboxItem[]
  projects: Project[]
  summaries: Summary[]
  todos: Todo[]
}

export type AuthUser = {
  displayName: string
  id: number
  email: string
}

export type AuthResponse = {
  token: string
  user: AuthUser
  workspace: WorkspaceData
}

export type AiChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

const tokenStorageKey = 'veges.authToken'
let authToken =
  typeof window === 'undefined' ? '' : localStorage.getItem(tokenStorageKey) ?? ''

export function getAuthToken() {
  return authToken
}

export function setAuthToken(token: string) {
  authToken = token
  localStorage.setItem(tokenStorageKey, token)
}

export function clearAuthToken() {
  authToken = ''
  localStorage.removeItem(tokenStorageKey)
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
    ...options,
  })

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export function fetchWorkspace() {
  return request<WorkspaceData>('/api/workspace')
}

export function fetchCurrentUser() {
  return request<{ user: AuthUser; workspace: WorkspaceData }>('/api/auth/me')
}

export function registerAccount(payload: { email: string; password: string }) {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loginAccount(payload: { email: string; password: string }) {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateCurrentUser(payload: { displayName: string }) {
  return request<{ user: AuthUser }>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function createProject(payload: { name: string; tags: string[] }) {
  return request<WorkspaceData>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateProject(
  projectId: number,
  payload: Partial<{ name: string; status: ProjectStatus; tags: string[] }>,
) {
  return request<WorkspaceData>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function removeProject(projectId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export function createJournalEntry(projectId: number, content: string) {
  return request<WorkspaceData>(`/api/projects/${projectId}/journals`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export function updateJournalEntry(
  projectId: number,
  entryId: number,
  content: string,
) {
  return request<WorkspaceData>(`/api/projects/${projectId}/journals/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  })
}

export function removeJournalEntry(projectId: number, entryId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}/journals/${entryId}`, {
    method: 'DELETE',
  })
}

export function createRiskFromJournal(projectId: number, journalEntryId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}/risks`, {
    method: 'POST',
    body: JSON.stringify({ journalEntryId }),
  })
}

export function createDraft(payload: {
  content: string
  suggestedProjectId?: number
}) {
  return request<WorkspaceData>('/api/drafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function archiveDraft(draftId: number, projectId: number) {
  return request<WorkspaceData>(`/api/drafts/${draftId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  })
}

export function removeDraft(draftId: number) {
  return request<WorkspaceData>(`/api/drafts/${draftId}`, {
    method: 'DELETE',
  })
}

export function createTodo(payload: {
  dueDate: string
  priority: Priority
  projectId: number
  title: string
}) {
  return request<WorkspaceData>('/api/todos', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTodo(todoId: number, payload: Partial<Todo>) {
  return request<WorkspaceData>(`/api/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function removeTodo(todoId: number) {
  return request<WorkspaceData>(`/api/todos/${todoId}`, {
    method: 'DELETE',
  })
}

export function createSummary(projectId: number, type: Summary['type']) {
  return request<WorkspaceData>('/api/summaries', {
    method: 'POST',
    body: JSON.stringify({ projectId, type }),
  })
}

export function createSummaryFromContent(payload: {
  content: string
  projectId: number
  title?: string
  type?: Summary['type']
}) {
  return request<WorkspaceData>('/api/summaries', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function sendAiChat(messages: AiChatMessage[]) {
  return request<{ message: string }>('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  })
}
