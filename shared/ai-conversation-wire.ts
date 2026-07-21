export type AiConversationContextKind = 'general' | 'project' | 'conversation-analysis'

export type AiConversation = {
  contextKind: AiConversationContextKind
  createdAt: string
  id: string
  lastTurnAt: string
  projectId: number | null
  projectName: string | null
  title: string
  updatedAt: string
}

export type AiTurnStatus = 'processing' | 'completed' | 'failed' | 'cancelled'

export type AiTurnIntentKind =
  | 'chat'
  | 'project-summary'
  | 'todo-extraction'
  | 'conversation-analysis'
  | 'workspace-review'

export type AiTurnAttachment = {
  id: number
  mediaType: string
  name: string
  ordinal: number
  size: number
}

export type AiTurnOutcome =
  | { summaryId: number; type: 'summary' }
  | { batchId: number; status: string; type: 'todo-proposals' }
  | null

export type AiTurn = {
  assistantContent: string | null
  attachments: AiTurnAttachment[]
  attemptCount: number
  completedAt: string | null
  createdAt: string
  errorCode: string | null
  id: string
  intentKind: AiTurnIntentKind
  outcome: AiTurnOutcome
  status: AiTurnStatus
  turnNo: number
  updatedAt: string
  userContent: string
}

export type AiTurnRunResponse = {
  conversation: AiConversation
  outcome: AiTurnOutcome
  turn: AiTurn
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isSafeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isContextKind(value: unknown): value is AiConversationContextKind {
  return value === 'general' || value === 'project' || value === 'conversation-analysis'
}

function isTurnStatus(value: unknown): value is AiTurnStatus {
  return value === 'processing' || value === 'completed' || value === 'failed' || value === 'cancelled'
}

function isIntentKind(value: unknown): value is AiTurnIntentKind {
  return value === 'chat' ||
    value === 'project-summary' ||
    value === 'todo-extraction' ||
    value === 'conversation-analysis' ||
    value === 'workspace-review'
}

function isAiTurnOutcome(value: unknown): value is AiTurnOutcome {
  if (value === null) return true
  if (!isRecord(value)) return false
  if (value.type === 'summary') return isSafeNumber(value.summaryId)
  return value.type === 'todo-proposals' &&
    isSafeNumber(value.batchId) &&
    isString(value.status)
}

export function isAiConversation(value: unknown): value is AiConversation {
  return isRecord(value) &&
    isContextKind(value.contextKind) &&
    isString(value.createdAt) &&
    isString(value.id) &&
    isString(value.lastTurnAt) &&
    (value.projectId === null || isSafeNumber(value.projectId)) &&
    isNullableString(value.projectName) &&
    isString(value.title) &&
    isString(value.updatedAt)
}

function isAiTurnAttachment(value: unknown): value is AiTurnAttachment {
  return isRecord(value) &&
    isSafeNumber(value.id) &&
    isString(value.mediaType) &&
    isString(value.name) &&
    isSafeNumber(value.ordinal) &&
    isSafeNumber(value.size)
}

export function isAiTurn(value: unknown): value is AiTurn {
  return isRecord(value) &&
    isNullableString(value.assistantContent) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isAiTurnAttachment) &&
    isSafeNumber(value.attemptCount) &&
    isNullableString(value.completedAt) &&
    isString(value.createdAt) &&
    isNullableString(value.errorCode) &&
    isString(value.id) &&
    isIntentKind(value.intentKind) &&
    isAiTurnOutcome(value.outcome) &&
    isTurnStatus(value.status) &&
    isSafeNumber(value.turnNo) &&
    isString(value.updatedAt) &&
    isString(value.userContent)
}

export function isAiTurnRunResponse(value: unknown): value is AiTurnRunResponse {
  return isRecord(value) &&
    isAiConversation(value.conversation) &&
    isAiTurnOutcome(value.outcome) &&
    isAiTurn(value.turn)
}

export function parseAiTurnRunResponse(value: unknown) {
  if (!isAiTurnRunResponse(value)) {
    throw new Error('AI response stream contained an invalid turn result')
  }
  return value
}
