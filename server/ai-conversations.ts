import { decryptText, encryptText } from './crypto.ts'
import type {
  AiConversation as AiConversationWireDto,
  AiConversationContextKind as AiConversationContextKindWire,
  AiTurn as AiTurnWireDto,
  AiTurnAttachment as AiTurnAttachmentWireDto,
  AiTurnIntentKind as AiTurnIntentKindWire,
  AiTurnStatus as AiTurnStatusWire,
} from '../shared/ai-conversation-wire.ts'

export const AI_CONVERSATION_TITLE_MAX_CHARACTERS = 80
export const AI_TURN_ATTACHMENT_MAX_BYTES = 64 * 1024
export const AI_TURN_ATTACHMENT_MAX_CHARACTERS = 20_000
export const AI_TURN_ATTACHMENT_MAX_COUNT = 4

export type AiConversationContextKind = AiConversationContextKindWire
export type AiConversationContext =
  | { contextKind: 'general'; projectId: null }
  | { contextKind: 'project'; projectId: number }
  | { contextKind: 'conversation-analysis'; projectId: null }

export type AiTurnIntentKind = AiTurnIntentKindWire
export type AiTurnStatus = AiTurnStatusWire

export type AiTurnAttachment = {
  content: string
  mediaType: string
  name: string
  sizeBytes: number
}

export function buildAiTurnModelContent(
  userContent: string,
  attachments: readonly Pick<AiTurnAttachment, 'content' | 'name'>[],
) {
  const message = userContent.trim() || '请阅读附件内容。'
  if (attachments.length === 0) return message
  const blocks = attachments.map((attachment) => [
    `[附件开始: ${attachment.name.replace(/[\r\n]+/gu, ' ').trim()}]`,
    attachment.content.trim(),
    '[附件结束]',
  ].join('\n'))
  return [message, ...blocks].join('\n\n')
}

export type EncryptedAiTurnAttachmentDto = {
  content: string
  contentCharacters: number
  mediaType: string
  name: string
  ordinal: number
  sizeBytes: number
}

export type AiConversationSerializationRecord = {
  contextKind: AiConversationContextKind
  createdAt: Date | string
  id: string
  lastTurnAt: Date | string
  projectId: number | null
  title: string
  updatedAt: Date | string
}

export type AiConversationApiDto = Omit<AiConversationWireDto, 'projectName'>

export type AiTurnAttachmentSerializationRecord = {
  id: number
  mediaType: string
  name: string
  ordinal: number
  sizeBytes: number
}

export type AiTurnAttachmentApiDto = AiTurnAttachmentWireDto

export type AiTurnSerializationRecord = {
  assistantContent: string | null
  attemptCount: number
  completedAt: Date | string | null
  createdAt: Date | string
  id: string
  intentKind: AiTurnIntentKind
  status: AiTurnStatus
  turnNo: number
  updatedAt: Date | string
  userContent: string
}

export type AiTurnApiDto = Omit<AiTurnWireDto, 'errorCode' | 'outcome'>

export function buildAiSummaryOutcome(
  intentKind: AiTurnIntentKind,
  summaryId: number | null,
) {
  if (
    intentKind !== 'project-summary' ||
    summaryId === null ||
    !Number.isSafeInteger(summaryId) ||
    summaryId <= 0
  ) return null
  return { summaryId, type: 'summary' as const }
}

export class AiConversationValidationError extends Error {
  readonly status: 400 | 413 | 415

  constructor(message: string, status: 400 | 413 | 415 = 400) {
    super(message)
    this.name = 'AiConversationValidationError'
    this.status = status
  }
}

const supportedAttachmentExtensions = new Set([
  'csv',
  'json',
  'log',
  'markdown',
  'md',
  'text',
  'txt',
  'yaml',
  'yml',
])

const supportedAttachmentMediaTypes = new Set([
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/x-log',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function codePointLength(value: string) {
  return Array.from(value).length
}

function truncateCodePoints(value: string, maxCharacters: number) {
  const characters = Array.from(value)
  if (characters.length <= maxCharacters) return value
  return `${characters.slice(0, maxCharacters - 3).join('')}...`
}

function normalizeVisibleText(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('').replace(/\s+/gu, ' ').trim()
}

function positiveSafeInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AiConversationValidationError(`${field} must be a positive integer`)
  }
  return Number(value)
}

function isoTimestamp(value: Date | string, field: string) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new AiConversationValidationError(`${field} must be a valid timestamp`)
  }
  return date.toISOString()
}

export function createAiConversationContext(
  contextKind: unknown,
  projectId: unknown,
): AiConversationContext {
  if (contextKind === 'project') {
    return { contextKind, projectId: positiveSafeInteger(projectId, 'projectId') }
  }
  if (contextKind === 'general' || contextKind === 'conversation-analysis') {
    if (projectId !== null && projectId !== undefined) {
      throw new AiConversationValidationError(`${contextKind} context cannot have a projectId`)
    }
    return { contextKind, projectId: null }
  }
  throw new AiConversationValidationError('contextKind is invalid')
}

export function assertAiConversationContextMatches(
  stored: AiConversationContext,
  requested: AiConversationContext,
) {
  if (
    stored.contextKind !== requested.contextKind ||
    stored.projectId !== requested.projectId
  ) {
    throw new AiConversationValidationError('Conversation context is immutable')
  }
}

export function parseAiTurnIntentKind(value: unknown): AiTurnIntentKind {
  if (
    value === 'chat' ||
    value === 'project-summary' ||
    value === 'todo-extraction' ||
    value === 'conversation-analysis' ||
    value === 'workspace-review'
  ) {
    return value
  }
  throw new AiConversationValidationError('intentKind is invalid')
}

export function parseAiTurnStatus(value: unknown): AiTurnStatus {
  if (
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value
  }
  throw new AiConversationValidationError('turn status is invalid')
}

export function normalizeAiConversationTitle(value: unknown) {
  if (typeof value !== 'string') {
    throw new AiConversationValidationError('title must be a string')
  }
  const title = normalizeVisibleText(value)
  if (!title || codePointLength(title) > AI_CONVERSATION_TITLE_MAX_CHARACTERS) {
    throw new AiConversationValidationError(
      `title must contain between 1 and ${AI_CONVERSATION_TITLE_MAX_CHARACTERS} characters`,
    )
  }
  return title
}

export function deriveAiConversationTitle(
  userContent: string,
  attachments: readonly Pick<AiTurnAttachment, 'name'>[] = [],
) {
  const normalizedContent = normalizeVisibleText(userContent)
  if (normalizedContent) {
    return truncateCodePoints(normalizedContent, AI_CONVERSATION_TITLE_MAX_CHARACTERS)
  }
  const attachmentName = attachments[0]?.name
  if (attachmentName) {
    return truncateCodePoints(
      normalizeVisibleText(`阅读 ${attachmentName}`),
      AI_CONVERSATION_TITLE_MAX_CHARACTERS,
    )
  }
  return '新对话'
}

export function isSupportedAiTurnAttachment(name: string, mediaType: string) {
  const extension = name.split('.').pop()?.toLocaleLowerCase() ?? ''
  const normalizedMediaType = mediaType.split(';', 1)[0].trim().toLocaleLowerCase()
  return (
    supportedAttachmentExtensions.has(extension) ||
    supportedAttachmentMediaTypes.has(normalizedMediaType)
  )
}

function readAttachmentString(
  record: Record<string, unknown>,
  field: 'content' | 'name',
) {
  const value = record[field]
  if (typeof value !== 'string') {
    throw new AiConversationValidationError(`attachments[].${field} must be a string`)
  }
  return value
}

function readAttachmentMediaType(record: Record<string, unknown>) {
  const value = record.mediaType ?? record.type ?? ''
  if (typeof value !== 'string') {
    throw new AiConversationValidationError('attachments[].mediaType must be a string')
  }
  return value.split(';', 1)[0].trim().toLocaleLowerCase()
}

function readAttachmentSize(record: Record<string, unknown>) {
  if (
    record.size !== undefined &&
    record.sizeBytes !== undefined &&
    record.size !== record.sizeBytes
  ) {
    throw new AiConversationValidationError('attachments[].size is inconsistent')
  }
  const value = record.sizeBytes ?? record.size
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AiConversationValidationError('attachments[].size must be a positive integer')
  }
  return Number(value)
}

export function validateAiTurnAttachments(value: unknown): AiTurnAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new AiConversationValidationError('attachments must be an array')
  }
  if (value.length > AI_TURN_ATTACHMENT_MAX_COUNT) {
    throw new AiConversationValidationError(
      `At most ${AI_TURN_ATTACHMENT_MAX_COUNT} attachments are allowed`,
      413,
    )
  }

  let totalCharacters = 0
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new AiConversationValidationError('attachments[] must be an object')
    }
    const rawName = readAttachmentString(candidate, 'name')
    const basename = rawName.split(/[\\/]/u).pop() ?? ''
    const name = normalizeVisibleText(basename)
    if (!name || codePointLength(name) > 255) {
      throw new AiConversationValidationError('attachments[].name has an invalid length')
    }
    const content = readAttachmentString(candidate, 'content')
    const mediaType = readAttachmentMediaType(candidate)
    if (!isSupportedAiTurnAttachment(name, mediaType)) {
      throw new AiConversationValidationError(`Attachment ${name} is not a supported text file`, 415)
    }
    const sizeBytes = readAttachmentSize(candidate)
    const contentBytes = Buffer.byteLength(content, 'utf8')
    if (
      sizeBytes > AI_TURN_ATTACHMENT_MAX_BYTES ||
      contentBytes > AI_TURN_ATTACHMENT_MAX_BYTES
    ) {
      throw new AiConversationValidationError(
        `Attachment ${name} must not exceed ${AI_TURN_ATTACHMENT_MAX_BYTES} bytes`,
        413,
      )
    }
    const contentCharacters = codePointLength(content)
    if (contentCharacters === 0) {
      throw new AiConversationValidationError(`Attachment ${name} is empty`)
    }
    totalCharacters += contentCharacters
    if (totalCharacters > AI_TURN_ATTACHMENT_MAX_CHARACTERS) {
      throw new AiConversationValidationError(
        `Attachment content must not exceed ${AI_TURN_ATTACHMENT_MAX_CHARACTERS} characters`,
        413,
      )
    }
    return { content, mediaType, name, sizeBytes }
  })
}

export function encryptAiConversationTitle(value: unknown) {
  return encryptText(normalizeAiConversationTitle(value))
}

export function encryptAiTurnContent(value: string) {
  return encryptText(value)
}

export function encryptAiTurnAttachments(
  attachments: readonly AiTurnAttachment[],
): EncryptedAiTurnAttachmentDto[] {
  return attachments.map((attachment, ordinal) => ({
    content: encryptText(attachment.content),
    contentCharacters: codePointLength(attachment.content),
    mediaType: attachment.mediaType,
    name: encryptText(attachment.name),
    ordinal,
    sizeBytes: attachment.sizeBytes,
  }))
}

export function canTransitionAiTurnStatus(from: AiTurnStatus, to: AiTurnStatus) {
  if (from === 'processing') {
    return to === 'completed' || to === 'failed' || to === 'cancelled'
  }
  return (from === 'failed' || from === 'cancelled') && to === 'processing'
}

export function assertAiTurnStatusTransition(from: AiTurnStatus, to: AiTurnStatus) {
  if (!canTransitionAiTurnStatus(from, to)) {
    throw new AiConversationValidationError(`Cannot transition an AI turn from ${from} to ${to}`)
  }
}

export function isAiTurnRetryable(status: AiTurnStatus) {
  return status === 'failed' || status === 'cancelled'
}

export function serializeAiConversation(
  record: AiConversationSerializationRecord,
): AiConversationApiDto {
  const context = createAiConversationContext(record.contextKind, record.projectId)
  return {
    ...context,
    createdAt: isoTimestamp(record.createdAt, 'createdAt'),
    id: record.id,
    lastTurnAt: isoTimestamp(record.lastTurnAt, 'lastTurnAt'),
    title: decryptText(record.title),
    updatedAt: isoTimestamp(record.updatedAt, 'updatedAt'),
  }
}

export function serializeAiTurnAttachment(
  record: AiTurnAttachmentSerializationRecord,
): AiTurnAttachmentApiDto {
  return {
    id: record.id,
    mediaType: record.mediaType,
    name: decryptText(record.name),
    ordinal: record.ordinal,
    size: record.sizeBytes,
  }
}

export function serializeAiTurn(
  record: AiTurnSerializationRecord,
  attachmentRecords: readonly AiTurnAttachmentSerializationRecord[] = [],
): AiTurnApiDto {
  return {
    assistantContent: record.assistantContent === null
      ? null
      : decryptText(record.assistantContent),
    attachments: [...attachmentRecords]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(serializeAiTurnAttachment),
    attemptCount: record.attemptCount,
    completedAt: record.completedAt === null
      ? null
      : isoTimestamp(record.completedAt, 'completedAt'),
    createdAt: isoTimestamp(record.createdAt, 'createdAt'),
    id: record.id,
    intentKind: parseAiTurnIntentKind(record.intentKind),
    status: parseAiTurnStatus(record.status),
    turnNo: positiveSafeInteger(record.turnNo, 'turnNo'),
    updatedAt: isoTimestamp(record.updatedAt, 'updatedAt'),
    userContent: decryptText(record.userContent),
  }
}
