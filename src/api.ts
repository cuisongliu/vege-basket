import type {
  InboxItem,
  AiConversationContextKind,
  AiConversationPage,
  AiTurnPage,
  AiTurnRunResponse,
  JournalVisibility,
  PackageMarketChannel,
  PackageMarketDetail,
  PackageMarketRule,
  PackageMarketVersion,
  NotificationCenterData,
  Priority,
  Project,
  ProjectPackageEventStatus,
  ProjectPackageOperationKind,
  ProjectPackageOperationStatus,
  ProjectPackageTimeline,
  ProjectPackageEventType,
  ProjectMembership,
  ProjectStatus,
  Summary,
  SummaryPeriodType,
  Todo,
  TodoActivityEvent,
  TodoNote,
  TodoProposal,
  NotificationSubscription,
} from './types'
import { ApiError } from './api-error'
import {
  decodeAiTurnStreamEvent,
  ServerSentEventDecoder,
  type AiTurnStreamPhase,
} from '../shared/server-sent-events'
import {
  parseAiIntentClassification,
  type AiIntentClassification,
} from '../shared/ai-input-intent'
import { parseAiTurnRunResponse } from '../shared/ai-conversation-wire'
export { ApiError, formatApiErrorDiagnostic } from './api-error'
export type { AiTurnStreamPhase } from '../shared/server-sent-events'

export type WorkspaceData = {
  inbox: InboxItem[]
  memberships: ProjectMembership[]
  projects: Project[]
  summaries: Summary[]
  todos: Todo[]
}

export type AiTurnDocumentResponse = {
  created: boolean
  summaryId: number
  workspace: WorkspaceData
}

export type NotificationResponse = {
  notifications: NotificationCenterData
}

export type PackageMarketRulesResponse = {
  expireMinutes: number
  rules: PackageMarketRule[]
}

export type AuthUser = {
  displayName: string
  feishuEmail: string
  feishuLinked: boolean
  id: number
  username: string
}

export type AuthResponse = {
  token: string
  user: AuthUser
  workspace: WorkspaceData
}

export type ProjectInviteLinkResponse = {
  token: string
}

export type AiStatus = {
  configured: boolean
  maxMessageLength: number
  model: string
}

export type AiTurnStreamHandlers = {
  onDelta?: (append: string) => void
  onHeartbeat?: () => void
  onProgress?: (phase: AiTurnStreamPhase) => void
  onStarted?: (event: {
    conversation?: AiTurnRunResponse['conversation']
    mode: 'progress' | 'text'
    turn?: AiTurnRunResponse['turn']
  }) => void
}

export type AiIntentClassificationResponse = {
  intent: AiIntentClassification
  turnId: string
}

export class AiTurnStreamTerminalError extends Error {
  readonly code: string
  readonly event: 'cancelled' | 'failed'

  constructor(event: 'cancelled' | 'failed', code: string, message: string) {
    super(message)
    this.name = 'AiTurnStreamTerminalError'
    this.code = code
    this.event = event
  }
}

export type TodoImageUploadResponse = {
  imageUrl: string
  objectKey: string
}

function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object' || !('error' in body)) return fallback
  const error = (body as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error.trim() : fallback
}

const tokenStorageKey = 'veges.authToken'
const browserStorage = (globalThis as {
  localStorage?: {
    getItem: (key: string) => string | null
    removeItem: (key: string) => void
    setItem: (key: string, value: string) => void
  }
}).localStorage
let authToken = browserStorage?.getItem(tokenStorageKey) ?? ''

export function getAuthToken() {
  return authToken
}

export function setAuthToken(token: string) {
  authToken = token
  browserStorage?.setItem(tokenStorageKey, token)
}

export function clearAuthToken() {
  authToken = ''
  browserStorage?.removeItem(tokenStorageKey)
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
    const fallbackMessage = `Request failed: ${response.status}`
    const responseText = await response.text()
    let responseBody: unknown = responseText
    try {
      responseBody = responseText ? JSON.parse(responseText) : ''
    } catch {
      // Keep non-JSON response text for diagnostics.
    }
    throw new ApiError(apiErrorMessage(responseBody, fallbackMessage), {
      method: String(options.method ?? 'GET').toUpperCase(),
      path,
      responseBody,
      status: response.status,
      statusText: response.statusText,
    })
  }

  return response.json() as Promise<T>
}

async function throwApiResponseError(response: Response, path: string, method: string): Promise<never> {
  const fallbackMessage = `Request failed: ${response.status}`
  const responseText = await response.text()
  let responseBody: unknown = responseText
  try {
    responseBody = responseText ? JSON.parse(responseText) : ''
  } catch {
    // Keep non-JSON response text for diagnostics.
  }
  throw new ApiError(apiErrorMessage(responseBody, fallbackMessage), {
    method,
    path,
    responseBody,
    status: response.status,
    statusText: response.statusText,
  })
}

async function requestAiTurnStream(
  path: string,
  options: RequestInit,
  handlers: AiTurnStreamHandlers,
) {
  const method = String(options.method ?? 'POST').toUpperCase()
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  })
  if (!response.ok) await throwApiResponseError(response, path, method)
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    return parseAiTurnRunResponse(await response.json())
  }
  if (!response.body) throw new Error('AI response stream is unavailable')

  const decoder = new ServerSentEventDecoder()
  const reader = response.body.getReader()
  let lastSequence = 0
  let result: AiTurnRunResponse | null = null
  let terminalError: AiTurnStreamTerminalError | null = null

  const consume = (events: ReturnType<ServerSentEventDecoder['push']>) => {
    for (const frame of events) {
      const event = decodeAiTurnStreamEvent(frame)
      if (event.sequence <= lastSequence) {
        throw new Error('AI response stream events arrived out of order')
      }
      lastSequence = event.sequence

      if (event.type === 'started') {
        handlers.onStarted?.({
          conversation: event.conversation,
          mode: event.mode,
          turn: event.turn,
        })
      } else if (event.type === 'delta') {
        handlers.onDelta?.(event.append)
      } else if (event.type === 'progress') {
        handlers.onProgress?.(event.phase)
      } else if (event.type === 'heartbeat') {
        handlers.onHeartbeat?.()
      } else if (event.type === 'completed') {
        result = event.result
      } else if (event.type === 'failed' || event.type === 'cancelled') {
        if (event.result) {
          result = event.result
        } else {
          terminalError = new AiTurnStreamTerminalError(
            event.type,
            event.error.code,
            event.error.message,
          )
        }
      }
    }
  }

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    consume(decoder.push(chunk.value))
  }
  consume(decoder.finish())
  if (result) return result
  if (terminalError) throw terminalError
  throw new Error('AI response stream ended before the turn was confirmed')
}

export function fetchWorkspace() {
  return request<WorkspaceData>('/api/workspace')
}

export function fetchNotifications() {
  return request<NotificationResponse>('/api/notifications')
}

export function fetchCurrentUser() {
  return request<{ user: AuthUser; workspace: WorkspaceData }>('/api/auth/me')
}

export function registerAccount(payload: { inviteToken?: string; password: string; username: string }) {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loginAccount(payload: { inviteToken?: string; password: string; username: string }) {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateCurrentUser(payload: {
  displayName: string
}) {
  return request<{ user: AuthUser }>('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function createFeishuOAuthUrl(payload: { inviteToken?: string; returnTo: string }) {
  return request<{ url: string }>('/api/auth/feishu/oauth/url', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function disconnectFeishuAccount() {
  return request<{ user: AuthUser }>('/api/auth/feishu/oauth', {
    method: 'DELETE',
  })
}

export function updateCurrentPassword(payload: {
  currentPassword: string
  nextPassword: string
}) {
  return request<{ ok: true }>('/api/auth/password', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function fetchAiStatus() {
  return request<AiStatus>('/api/ai/status')
}

export function createProject(payload: { name: string; tags: string[] }) {
  return request<WorkspaceData>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function createProjectModule(projectId: number, payload: { name: string }) {
  return request<WorkspaceData>(`/api/projects/${projectId}/modules`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function removeProjectModule(projectId: number, moduleId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}/modules/${moduleId}`, {
    method: 'DELETE',
  })
}

export function updateProject(
  projectId: number,
  payload: Partial<{ name: string; description: string; status: ProjectStatus; tags: string[] }>,
) {
  return request<WorkspaceData>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function updateProjectFeishuSettings(
  projectId: number,
  payload: { feishuChatEnabled: boolean; feishuChatId: string },
) {
  return request<WorkspaceData>(`/api/projects/${projectId}/feishu`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function removeProject(projectId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}`, {
    method: 'DELETE',
  })
}

export function createJournalEntry(projectId: number, content: string, createdAt?: string) {
  return request<WorkspaceData>(`/api/projects/${projectId}/journals`, {
    method: 'POST',
    body: JSON.stringify({ content, createdAt }),
  })
}

export function updateJournalEntry(
  projectId: number,
  entryId: number,
  payload: { content?: string; visibility?: JournalVisibility },
) {
  return request<WorkspaceData>(`/api/projects/${projectId}/journals/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
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

export function resolveRisk(projectId: number, content: string) {
  return request<WorkspaceData>(`/api/projects/${projectId}/risks`, {
    method: 'DELETE',
    body: JSON.stringify({ content }),
  })
}

export function resolveRiskFromJournal(projectId: number, journalEntryId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}/risks`, {
    method: 'DELETE',
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

export async function uploadTodoImage(file: File) {
  const response = await fetch('/api/todo-images', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: file,
  })

  if (!response.ok) {
    const fallbackMessage = `Request failed: ${response.status}`
    let data: { error?: string }
    try {
      data = await response.json() as { error?: string }
    } catch (error) {
      throw new Error(fallbackMessage, { cause: error })
    }
    throw new Error(data.error || fallbackMessage)
  }

  return response.json() as Promise<TodoImageUploadResponse>
}

export function createTodo(payload: {
  assigneeUserId?: number
  createdAt?: string
  detail?: string
  dueDate: string
  moduleId?: number | null
  priority: Priority
  projectId: number
  title: string
}) {
  return request<WorkspaceData>('/api/todos', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function inviteProjectMember(projectId: number, payload: { username: string }) {
  return request<WorkspaceData>(`/api/projects/${projectId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getProjectInviteLink(projectId: number) {
  return request<ProjectInviteLinkResponse>(`/api/projects/${projectId}/invite-link`, {
    method: 'POST',
  })
}

export function acceptProjectInviteLink(token: string) {
  return request<{ workspace: WorkspaceData }>(
    `/api/project-invite-links/${encodeURIComponent(token)}/accept`,
    {
      method: 'POST',
    },
  )
}

export function removeProjectMember(projectId: number, membershipId: number) {
  return request<WorkspaceData>(`/api/projects/${projectId}/invitations/${membershipId}`, {
    method: 'DELETE',
  })
}

export function acceptProjectInvitation(membershipId: number) {
  return request<NotificationResponse & { workspace: WorkspaceData }>(
    `/api/invitations/${membershipId}/accept`,
    {
      method: 'POST',
    },
  )
}

export function declineProjectInvitation(membershipId: number) {
  return request<NotificationResponse & { workspace: WorkspaceData }>(
    `/api/invitations/${membershipId}/decline`,
    {
      method: 'POST',
    },
  )
}

export function markNotificationRead(
  kind: 'project_invite' | 'assigned_todo' | 'package_event_assigned' | 'todo_due_tomorrow' | 'todo_note_mention',
  sourceId: number,
  dismiss = false,
) {
  return request<NotificationResponse>(`/api/notifications/${kind}/${sourceId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({ dismiss }),
  })
}

export function updateTodo(
  todoId: number,
  payload: Omit<Partial<Todo>, 'assigneeUserId' | 'moduleId'> & {
    assigneeUserId?: number | null
    createdAt?: string
    moduleId?: number | null
    rejectionReason?: string
  },
) {
  return request<WorkspaceData>(`/api/todos/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function createTodoNote(todoId: number, payload: { content: string }) {
  return request<WorkspaceData>(`/api/todos/${todoId}/notes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTodoNote(todoId: number, noteId: number, payload: Pick<TodoNote, 'content'>) {
  return request<WorkspaceData>(`/api/todos/${todoId}/notes/${noteId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function removeTodo(todoId: number) {
  return request<WorkspaceData>(`/api/todos/${todoId}`, {
    method: 'DELETE',
  })
}

export function createSummary(projectId: number, type: SummaryPeriodType) {
  return request<WorkspaceData>(`/api/projects/${projectId}/summaries`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  })
}

export function createAiTurnDocument(conversationId: string, turnId: string) {
  return request<AiTurnDocumentResponse>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/document`,
    {
      method: 'POST',
    },
  )
}

export function fetchTodoActivity(projectId: number) {
  return request<{ events: TodoActivityEvent[] }>(`/api/projects/${projectId}/todo-activity`)
}

export function fetchNotificationSubscription() {
  return request<{ subscription: NotificationSubscription }>('/api/notification-subscription')
}

export function updateNotificationSubscription(payload: {
  enabled: boolean
  localSendTime: string
}) {
  return request<{ subscription: NotificationSubscription }>('/api/notification-subscription', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function fetchTodoProposalBatch(batchId: number) {
  return request<{ batchId: number; proposals: TodoProposal[]; status: string }>(
    `/api/ai/todo-proposals/${encodeURIComponent(batchId)}`,
  )
}

export function confirmTodoProposals(batchId: number, proposals: TodoProposal[]) {
  return request<WorkspaceData>(`/api/ai/todo-proposals/${encodeURIComponent(batchId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ proposals }),
  })
}

export function fetchAiConversations(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return request<AiConversationPage>(`/api/ai/conversations${query}`)
}

export function fetchAiConversationTurns(
  conversationId: string,
  beforeTurn?: number,
  limit?: number,
) {
  const search = new URLSearchParams()
  if (beforeTurn) search.set('beforeTurn', String(beforeTurn))
  if (limit) search.set('limit', String(limit))
  const query = search.size > 0 ? `?${search.toString()}` : ''
  return request<AiTurnPage>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/turns${query}`,
  )
}

export async function classifyAiConversationTurnIntent(payload: {
  attachments: Array<{
    content: string
    mediaType?: string
    name: string
    size: number
  }>
  content: string
  contextKind: AiConversationContextKind
  projectId: number | null
  turnId: string
}, signal?: AbortSignal) {
  const response = await request<unknown>('/api/ai/intent-classifications', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
  if (
    !response ||
    typeof response !== 'object' ||
    Array.isArray(response) ||
    !('turnId' in response) ||
    typeof response.turnId !== 'string' ||
    response.turnId !== payload.turnId ||
    !('intent' in response)
  ) {
    throw new Error('AI intent classification response is invalid')
  }
  return {
    intent: parseAiIntentClassification(response.intent),
    turnId: response.turnId,
  } satisfies AiIntentClassificationResponse
}

export function sendAiConversationTurn(payload: {
  attachments: Array<{
    content: string
    mediaType?: string
    name: string
    size: number
  }>
  content: string
  contextKind: AiConversationContextKind
  conversationId: string
  projectId: number | null
  turnId: string
}, handlers: AiTurnStreamHandlers = {}) {
  return requestAiTurnStream(
    `/api/ai/conversations/${encodeURIComponent(payload.conversationId)}/turns`,
    {
      method: 'POST',
      body: JSON.stringify({
        attachments: payload.attachments,
        content: payload.content,
        contextKind: payload.contextKind,
        projectId: payload.projectId,
        turnId: payload.turnId,
      }),
    },
    handlers,
  )
}

export function retryAiConversationTurn(
  conversationId: string,
  turnId: string,
  handlers: AiTurnStreamHandlers = {},
) {
  return requestAiTurnStream(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/retry`,
    { method: 'POST' },
    handlers,
  )
}

export function cancelAiConversationTurn(conversationId: string, turnId: string) {
  return request<
    | { cancelled: true; pending: true }
    | {
      cancelled: boolean
      conversation: AiConversationPage['conversations'][number]
      pending: false
      turn: AiTurnRunResponse['turn']
    }
  >(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/cancel`,
    { method: 'POST' },
  )
}

export function reconcileAiConversationTurn(conversationId: string, turnId: string) {
  return request<{
    conversation: AiConversationPage['conversations'][number]
    turn: AiTurnRunResponse['turn']
  }>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/reconcile`,
    { method: 'POST' },
  )
}

export function renameAiConversation(conversationId: string, title: string) {
  return request<{ conversation: AiConversationPage['conversations'][number] }>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'PATCH', body: JSON.stringify({ title }) },
  )
}

export function deleteAiConversation(conversationId: string) {
  return request<{ ok: true }>(
    `/api/ai/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'DELETE' },
  )
}

export function fetchProjectPackageTimeline(projectId: number) {
  return request<ProjectPackageTimeline>(`/api/projects/${projectId}/package-timeline`)
}

export function createProjectPackageEvent(
  projectId: number,
  payload: { assigneeUserId: number; deliveryDate: string; title: string; type: ProjectPackageEventType },
) {
  return request<ProjectPackageTimeline>(`/api/projects/${projectId}/package-timeline/events`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateProjectPackageEvent(
  projectId: number,
  eventId: number,
  payload: Partial<{
    assigneeUserId: number
    deliveryDate: string
    status: ProjectPackageEventStatus
    title: string
    type: ProjectPackageEventType
  }>,
) {
  return request<ProjectPackageTimeline>(
    `/api/projects/${projectId}/package-timeline/events/${eventId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  )
}

export function removeProjectPackageEvent(projectId: number, eventId: number) {
  return request<ProjectPackageTimeline>(
    `/api/projects/${projectId}/package-timeline/events/${eventId}`,
    {
      method: 'DELETE',
    },
  )
}

export function addProjectPackageItems(
  projectId: number,
  eventId: number,
  payload: {
    items: Array<{
      sourcePackageId: string
      sourcePackageName: string
      packageName: string
      channel: string
      channelLabel: string
      arch: string
      version: string
      objectKey: string
      objectLastModified?: string
      sizeBytes?: number
    }>
  },
) {
  return request<ProjectPackageTimeline>(
    `/api/projects/${projectId}/package-timeline/events/${eventId}/packages`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
}

export function removeProjectPackageGroup(projectId: number, groupId: number) {
  return request<ProjectPackageTimeline>(
    `/api/projects/${projectId}/package-timeline/package-groups/${groupId}`,
    {
      method: 'DELETE',
    },
  )
}

export function createProjectPackageOperation(
  projectId: number,
  payload: {
    eventId: number
    groupId?: number | null
    kind: ProjectPackageOperationKind
    status?: ProjectPackageOperationStatus
    title?: string
    label?: string
    content?: string
    completed?: boolean
    relatedTodoIds?: number[]
    relatedTodoNotes?: Record<number, string>
  },
) {
  return request<ProjectPackageTimeline>(`/api/projects/${projectId}/package-timeline/operations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateProjectPackageOperation(
  projectId: number,
  operationId: number,
  payload: Partial<{
    title: string
    label: string
    content: string
    completed: boolean
    status: ProjectPackageOperationStatus
    relatedTodoIds: number[]
    relatedTodoNotes: Record<number, string>
  }>,
) {
  return request<ProjectPackageTimeline>(
    `/api/projects/${projectId}/package-timeline/operations/${operationId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  )
}

export function removeProjectPackageOperation(projectId: number, operationId: number) {
  return request<ProjectPackageTimeline>(
    `/api/projects/${projectId}/package-timeline/operations/${operationId}`,
    {
      method: 'DELETE',
    },
  )
}

export function exportProjectPackageTimeline(projectId: number) {
  return request<{ fileName: string; markdown: string }>(
    `/api/projects/${projectId}/package-timeline/export`,
  )
}

export function fetchProjectPackageItemDownloadUrl(
  projectId: number,
  itemId: number,
  expireMinutes?: number,
) {
  const params = new URLSearchParams()
  if (expireMinutes) params.set('expireMinutes', String(expireMinutes))
  const suffix = params.toString() ? `?${params.toString()}` : ''
  return request<{ downloadUrl: string; expiresAt: string; expiresInSeconds: number }>(
    `/api/projects/${projectId}/package-items/${itemId}/download-url${suffix}`,
  )
}

export function fetchPackageMarketRules() {
  return request<PackageMarketRulesResponse>('/api/package-market/rules')
}

export function fetchPackageMarketBaseDetail(payload: {
  arch: string
  channel: PackageMarketChannel
  deployType: 'pro' | 'oss'
  expireMinutes?: number
  releaseVersion?: string
}) {
  const params = new URLSearchParams({
    arch: payload.arch,
    channel: payload.channel,
    deployType: payload.deployType,
  })
  if (payload.expireMinutes) params.set('expireMinutes', String(payload.expireMinutes))
  if (payload.releaseVersion) params.set('releaseVersion', payload.releaseVersion)
  return request<PackageMarketDetail>(`/api/package-market/packages/base?${params.toString()}`)
}

export function fetchPackageMarketBaseReleaseVersions(payload: {
  arch: string
  deployType: 'pro' | 'oss'
}) {
  const params = new URLSearchParams({
    arch: payload.arch,
    deployType: payload.deployType,
  })
  return request<{ versions: PackageMarketVersion[] }>(
    `/api/package-market/packages/base/release-versions?${params.toString()}`,
  )
}

export function fetchPackageMarketDetail(payload: {
  arch: string
  channel: PackageMarketChannel
  ciVersion?: string
  deployType?: string
  expireMinutes?: number
  packageId: string
  releaseVersion?: string
}) {
  const params = new URLSearchParams({
    arch: payload.arch,
    channel: payload.channel,
  })
  if (payload.ciVersion) params.set('ciVersion', payload.ciVersion)
  if (payload.deployType) params.set('deployType', payload.deployType)
  if (payload.expireMinutes) params.set('expireMinutes', String(payload.expireMinutes))
  if (payload.releaseVersion) params.set('releaseVersion', payload.releaseVersion)
  return request<PackageMarketDetail>(
    `/api/package-market/packages/${encodeURIComponent(payload.packageId)}?${params.toString()}`,
  )
}

export function fetchPackageMarketReleaseVersions(payload: {
  arch: string
  deployType?: string
  packageId: string
}) {
  const params = new URLSearchParams({ arch: payload.arch })
  if (payload.deployType) params.set('deployType', payload.deployType)
  return request<{ versions: PackageMarketVersion[] }>(
    `/api/package-market/packages/${encodeURIComponent(payload.packageId)}/release-versions?${params.toString()}`,
  )
}

export function fetchPackageMarketCiVersions(payload: { arch: string; packageId: string }) {
  const params = new URLSearchParams({ arch: payload.arch })
  return request<{ versions: PackageMarketVersion[] }>(
    `/api/package-market/packages/${encodeURIComponent(payload.packageId)}/ci-versions?${params.toString()}`,
  )
}
