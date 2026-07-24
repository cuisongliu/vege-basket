import type { AiChatMessage } from './ai-provider.ts'

export type AiTodoPriority = 'high' | 'low' | 'medium'

export type AiTodoProposal = {
  assigneeUserId: number | null
  confidence: number
  detail: string
  dueDate: string | null
  moduleId: number | null
  priority: AiTodoPriority
  projectId: number | null
  sourceExcerpt: string
  title: string
}

export type AiTodoProposalCatalog = {
  projects: Array<{
    assignees: Array<{ id: number; name: string }>
    id: number
    modules: Array<{ id: number; name: string }>
    name: string
  }>
}

export type AiTodoProposalRequest = {
  messages: AiChatMessage[]
  responseFormat: 'json_object'
  systemPrompt: string
  untrustedContext: string
}

export type AiTodoProposalValidationOptions = {
  catalog: AiTodoProposalCatalog
  maxProposals?: number
  sourceMarkdown: string
}

export const AI_TODO_PROPOSAL_SYSTEM_PROMPT = `你是 Veges 的 Markdown 待办提取助手。根据文档内容识别可执行事项，并从权限目录中推断项目、模块和负责人。
只返回一个 JSON 对象，结构必须是 {"proposals":[...]}。每项必须且只能包含 projectId、moduleId、assigneeUserId、title、detail、dueDate、priority、confidence、sourceExcerpt。
projectId、moduleId 和 assigneeUserId 应优先从权限目录推断；无法判断时使用 null。非空 projectId 必须来自权限目录，非空 moduleId 和 assigneeUserId 必须属于该项目。dueDate 使用 YYYY-MM-DD，无法判断时使用 null。priority 只能是 high、medium、low。confidence 是 0 到 1 的数字。sourceExcerpt 必须原样摘自 Markdown 文档。不要创建文档中没有依据的事项。`

const proposalKeys = [
  'assigneeUserId',
  'confidence',
  'detail',
  'dueDate',
  'moduleId',
  'priority',
  'projectId',
  'sourceExcerpt',
  'title',
].sort()

export class AiTodoProposalValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiTodoProposalValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveId(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new AiTodoProposalValidationError(`${field} must be a positive integer`)
  }
  return Number(value)
}

function nullablePositiveId(value: unknown, field: string) {
  return value === null ? null : positiveId(value, field)
}

function boundedString(value: unknown, field: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string') {
    throw new AiTodoProposalValidationError(`${field} must be a string`)
  }
  const trimmed = value.trim()
  if ((!allowEmpty && !trimmed) || trimmed.length > maxLength) {
    throw new AiTodoProposalValidationError(`${field} has an invalid length`)
  }
  return trimmed
}

function nullableDate(value: unknown) {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AiTodoProposalValidationError('dueDate must use YYYY-MM-DD or be null')
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new AiTodoProposalValidationError('dueDate must be a valid calendar date')
  }
  return value
}

function parseProposal(
  value: unknown,
  index: number,
  options: AiTodoProposalValidationOptions,
): AiTodoProposal {
  if (!isRecord(value)) {
    throw new AiTodoProposalValidationError(`proposals[${index}] must be an object`)
  }
  const keys = Object.keys(value).sort()
  if (keys.length !== proposalKeys.length || keys.some((key, keyIndex) => key !== proposalKeys[keyIndex])) {
    throw new AiTodoProposalValidationError(`proposals[${index}] has missing or unknown fields`)
  }

  const projectId = nullablePositiveId(value.projectId, `proposals[${index}].projectId`)
  const moduleId = nullablePositiveId(value.moduleId, `proposals[${index}].moduleId`)
  const assigneeUserId = nullablePositiveId(
    value.assigneeUserId,
    `proposals[${index}].assigneeUserId`,
  )
  const project = projectId === null
    ? null
    : options.catalog.projects.find((candidate) => candidate.id === projectId)
  if (projectId !== null && !project) {
    throw new AiTodoProposalValidationError(`proposals[${index}].projectId is not accessible`)
  }
  if (projectId === null && (moduleId !== null || assigneeUserId !== null)) {
    throw new AiTodoProposalValidationError(
      `proposals[${index}] cannot infer a module or assignee without a project`,
    )
  }
  if (moduleId !== null && !project?.modules.some((module) => module.id === moduleId)) {
    throw new AiTodoProposalValidationError(`proposals[${index}].moduleId is outside the project`)
  }
  if (
    assigneeUserId !== null &&
    !project?.assignees.some((assignee) => assignee.id === assigneeUserId)
  ) {
    throw new AiTodoProposalValidationError(
      `proposals[${index}].assigneeUserId is outside the project`,
    )
  }

  const priority = value.priority
  if (priority !== 'high' && priority !== 'medium' && priority !== 'low') {
    throw new AiTodoProposalValidationError(`proposals[${index}].priority is invalid`)
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
    throw new AiTodoProposalValidationError(`proposals[${index}].confidence must be a number`)
  }
  if (value.confidence < 0 || value.confidence > 1) {
    throw new AiTodoProposalValidationError(`proposals[${index}].confidence must be between 0 and 1`)
  }

  const sourceExcerpt = boundedString(
    value.sourceExcerpt,
    `proposals[${index}].sourceExcerpt`,
    500,
  )
  if (!options.sourceMarkdown.includes(sourceExcerpt)) {
    throw new AiTodoProposalValidationError(
      `proposals[${index}].sourceExcerpt must appear in the source Markdown`,
    )
  }

  return {
    assigneeUserId,
    confidence: value.confidence,
    detail: boundedString(value.detail, `proposals[${index}].detail`, 4_000, true),
    dueDate: nullableDate(value.dueDate),
    moduleId,
    priority,
    projectId,
    sourceExcerpt,
    title: boundedString(value.title, `proposals[${index}].title`, 200),
  }
}

export function parseAiTodoProposalResponse(
  content: string,
  options: AiTodoProposalValidationOptions,
) {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new AiTodoProposalValidationError('AI todo proposal response must be valid JSON')
  }
  if (!isRecord(parsed) || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.proposals)) {
    throw new AiTodoProposalValidationError(
      'AI todo proposal response must contain only a proposals array',
    )
  }
  const maxProposals = options.maxProposals ?? 50
  if (parsed.proposals.length > maxProposals) {
    throw new AiTodoProposalValidationError(`AI returned more than ${maxProposals} proposals`)
  }
  return parsed.proposals.map((proposal, index) => parseProposal(proposal, index, options))
}

export function buildAiTodoProposalRequest(
  sourceMarkdown: string,
  catalog: AiTodoProposalCatalog,
  today: string,
): AiTodoProposalRequest {
  if (!sourceMarkdown.trim()) {
    throw new AiTodoProposalValidationError('Markdown source is required')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new AiTodoProposalValidationError('Today must use YYYY-MM-DD')
  }
  return {
    messages: [{
      content: '请从 Markdown 文档中提取待办候选，并严格返回约定的 JSON。',
      role: 'user',
    }],
    responseFormat: 'json_object',
    systemPrompt: AI_TODO_PROPOSAL_SYSTEM_PROMPT,
    untrustedContext: [
      `当前日期：${today}`,
      `权限目录：${JSON.stringify(catalog)}`,
      'Markdown 文档：',
      sourceMarkdown,
    ].join('\n\n'),
  }
}
