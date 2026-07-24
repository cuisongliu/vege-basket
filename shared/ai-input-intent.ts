export type AiSummaryPeriodType = 'daily' | 'weekly'

export type AiIntentClassification =
  | { kind: 'chat' }
  | { kind: 'conversation-analysis' }
  | { kind: 'project-summary'; period: AiSummaryPeriodType }
  | { kind: 'todo-extraction' }
  | { kind: 'workspace-review'; period: AiSummaryPeriodType }

export type AiInputIntent =
  | Exclude<AiIntentClassification, { kind: 'todo-extraction' }>
  | { content: string; kind: 'todo-extraction' }

export type AiIntentSourceContext =
  | { contextKind: 'general' | 'conversation-analysis'; projectId: null }
  | { contextKind: 'project'; projectId: number }

export type AiIntentTargetContextResult =
  | { context: AiIntentSourceContext; ok: true }
  | { ok: false; reason: 'project-required' | 'workspace-project-mismatch' }

export function buildAiClassificationContent(
  content: string,
  attachments: readonly { content: string }[],
) {
  return [content, ...attachments.map((attachment) => attachment.content)]
    .filter(Boolean)
    .join('\n\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys)
  return Object.keys(value).every((key) => expected.has(key)) &&
    keys.every((key) => key in value)
}

export function parseAiIntentClassification(value: unknown): AiIntentClassification {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('AI intent classification is invalid')
  }
  if (
    value.kind === 'chat' ||
    value.kind === 'conversation-analysis' ||
    value.kind === 'todo-extraction'
  ) {
    if (!hasOnlyKeys(value, ['kind'])) throw new Error('AI intent classification is invalid')
    return { kind: value.kind }
  }
  if (value.kind === 'project-summary' || value.kind === 'workspace-review') {
    if (
      !hasOnlyKeys(value, ['kind', 'period']) ||
      (value.period !== 'daily' && value.period !== 'weekly')
    ) {
      throw new Error('AI intent classification is invalid')
    }
    return { kind: value.kind, period: value.period }
  }
  throw new Error('AI intent classification is invalid')
}

export function hydrateAiInputIntent(
  classification: AiIntentClassification,
  sourceContent: string,
): AiInputIntent {
  if (classification.kind !== 'todo-extraction') return classification
  const content = sourceContent.trim()
  if (!content) throw new Error('Todo extraction source content is required')
  return { content, kind: classification.kind }
}

export function deriveAiIntentTargetContext(
  intent: AiIntentClassification | AiInputIntent,
  source: AiIntentSourceContext,
): AiIntentTargetContextResult {
  if (intent.kind === 'conversation-analysis') {
    return { context: { contextKind: 'conversation-analysis', projectId: null }, ok: true }
  }
  if (intent.kind === 'project-summary') {
    return source.contextKind === 'project'
      ? { context: source, ok: true }
      : { ok: false, reason: 'project-required' }
  }
  if (intent.kind === 'workspace-review') {
    return source.contextKind === 'project'
      ? { ok: false, reason: 'workspace-project-mismatch' }
      : { context: { contextKind: 'general', projectId: null }, ok: true }
  }
  if (source.contextKind === 'project') return { context: source, ok: true }
  if (source.contextKind === 'conversation-analysis' && intent.kind === 'chat') {
    return { context: source, ok: true }
  }
  return { context: { contextKind: 'general', projectId: null }, ok: true }
}
