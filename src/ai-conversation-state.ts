export type AiConversationContextType =
  | 'general'
  | 'project'
  | 'conversation-analysis'

export type AiConversationContext = {
  contextType: AiConversationContextType
  projectId: number | null
  projectName: string | null
}

export type AiConversationListItem = AiConversationContext & {
  id: string
  title: string
  createdAt: string
  lastTurnAt: string
  updatedAt: string
}

export type AiConversationSelection =
  | {
    kind: 'blank'
    context: AiConversationContext
  }
  | {
    kind: 'conversation'
    conversationId: string
    context: AiConversationContext
  }

export type AiConversationHistoryLoadState =
  | 'idle'
  | 'loading-initial'
  | 'loading-more'

export type AiConversationHistoryState = {
  conversations: AiConversationListItem[]
  error: string
  hasLoaded: boolean
  loadState: AiConversationHistoryLoadState
  nextCursor: string | null
  selection: AiConversationSelection
}

export type AiConversationHistoryAction =
  | { type: 'history/load-started'; mode: 'initial' | 'more' }
  | { type: 'history/load-cancelled' }
  | {
    type: 'history/load-succeeded'
    conversations: AiConversationListItem[]
    nextCursor: string | null
    mode: 'initial' | 'more'
  }
  | { type: 'history/load-failed'; error: string }
  | { type: 'conversation/selected'; conversation: AiConversationListItem }
  | { type: 'conversation/blanked'; context: AiConversationContext }
  | { type: 'conversation/upserted'; conversation: AiConversationListItem }
  | {
    type: 'conversation/renamed'
    conversationId: string
    title: string
    updatedAt?: string
  }
  | { type: 'conversation/deleted'; conversationId: string }
  | { type: 'session/reset'; context?: AiConversationContext }

export type AiConversationDateGroupKey =
  | 'today'
  | 'yesterday'
  | 'past-seven-days'
  | 'older'

export type AiConversationDateGroup = {
  key: AiConversationDateGroupKey
  label: string
  conversations: AiConversationListItem[]
}

const dateGroupOrder: AiConversationDateGroupKey[] = [
  'today',
  'yesterday',
  'past-seven-days',
  'older',
]

const dateGroupLabels: Record<AiConversationDateGroupKey, string> = {
  today: '今天',
  yesterday: '昨天',
  'past-seven-days': '过去 7 天',
  older: '更早',
}

export const GENERAL_AI_CONVERSATION_CONTEXT: AiConversationContext = {
  contextType: 'general',
  projectId: null,
  projectName: null,
}

export function createBlankAiConversationSelection(
  context: AiConversationContext = GENERAL_AI_CONVERSATION_CONTEXT,
): AiConversationSelection {
  return {
    kind: 'blank',
    context: normalizeAiConversationContext(context),
  }
}

export function createAiConversationHistoryState(
  context: AiConversationContext = GENERAL_AI_CONVERSATION_CONTEXT,
): AiConversationHistoryState {
  return {
    conversations: [],
    error: '',
    hasLoaded: false,
    loadState: 'idle',
    nextCursor: null,
    selection: createBlankAiConversationSelection(context),
  }
}

export function selectAiConversation(
  conversation: AiConversationListItem,
): AiConversationSelection {
  return {
    kind: 'conversation',
    conversationId: conversation.id,
    context: contextFromAiConversation(conversation),
  }
}

export function contextFromAiConversation(
  conversation: AiConversationListItem,
): AiConversationContext {
  return normalizeAiConversationContext(conversation)
}

export function normalizeAiConversationContext(
  context: AiConversationContext,
): AiConversationContext {
  if (context.contextType !== 'project') {
    return {
      contextType: context.contextType,
      projectId: null,
      projectName: null,
    }
  }

  return {
    contextType: 'project',
    projectId: context.projectId,
    projectName: context.projectName,
  }
}

export function currentAiConversationId(
  selection: AiConversationSelection,
): string | null {
  return selection.kind === 'conversation' ? selection.conversationId : null
}

export function isCurrentAiConversation(
  selection: AiConversationSelection,
  conversationId: string,
): boolean {
  return currentAiConversationId(selection) === conversationId
}

export function nextAiTurnNumber(turns: readonly { turnNo: number }[]) {
  return turns.reduce(
    (largest, turn) => Number.isSafeInteger(turn.turnNo) && turn.turnNo > largest
      ? turn.turnNo
      : largest,
    0,
  ) + 1
}

export function isAiTurnCanonicalStateUnknown(httpStatus: number | null) {
  return httpStatus === null || httpStatus >= 500
}

export function canonicalProcessingAiTurn<T extends {
  id: string
  status: string
  turnNo: number
}>(turns: readonly T[]): T | null {
  return turns.reduce<T | null>((latest, turn) => {
    if (turn.status !== 'processing') return latest
    return !latest || turn.turnNo > latest.turnNo ? turn : latest
  }, null)
}

export function latestRetryableAiTurnId(turns: readonly {
  id: string
  status: string
  turnNo: number
}[]): string | null {
  const latest = turns.reduce<(typeof turns)[number] | null>(
    (current, turn) => !current || turn.turnNo > current.turnNo ? turn : current,
    null,
  )
  return latest && (latest.status === 'failed' || latest.status === 'cancelled')
    ? latest.id
    : null
}

export function mergeAiTurns<T extends {
  attemptCount: number
  id: string
  status: string
  turnNo: number
  updatedAt: string
}>(current: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map(current.map((turn) => [turn.id, turn]))
  for (const turn of incoming) {
    const existing = byId.get(turn.id)
    if (existing) {
      if (existing.attemptCount > turn.attemptCount) continue
      if (existing.attemptCount < turn.attemptCount) {
        byId.set(turn.id, turn)
        continue
      }
      if (existing.status !== 'processing' && turn.status === 'processing') continue
      if (existing.status === 'processing' && turn.status !== 'processing') {
        byId.set(turn.id, turn)
        continue
      }
      const existingUpdatedAt = parseDateForSort(existing.updatedAt)
      const incomingUpdatedAt = parseDateForSort(turn.updatedAt)
      if (existingUpdatedAt > incomingUpdatedAt) continue
    }
    byId.set(turn.id, turn)
  }
  return [...byId.values()].sort((left, right) => left.turnNo - right.turnNo)
}

export function mergeAiConversationHistory(
  current: readonly AiConversationListItem[],
  incoming: readonly AiConversationListItem[],
): AiConversationListItem[] {
  const byId = new Map(current.map((conversation) => [conversation.id, conversation]))
  for (const conversation of incoming) {
    const existing = byId.get(conversation.id)
    if (
      existing &&
      parseDateForSort(existing.updatedAt) > parseDateForSort(conversation.updatedAt)
    ) continue
    byId.set(conversation.id, conversation)
  }
  return [...byId.values()].sort(compareAiConversationsByRecency)
}

export function groupAiConversationsByDate(
  conversations: readonly AiConversationListItem[],
  now = new Date(),
): AiConversationDateGroup[] {
  const groups = new Map<AiConversationDateGroupKey, AiConversationListItem[]>()
  for (const conversation of [...conversations].sort(compareAiConversationsByRecency)) {
    const key = getAiConversationDateGroup(conversation.lastTurnAt, now)
    const group = groups.get(key) ?? []
    group.push(conversation)
    groups.set(key, group)
  }

  return dateGroupOrder.flatMap((key) => {
    const group = groups.get(key)
    return group?.length
      ? [{ key, label: dateGroupLabels[key], conversations: group }]
      : []
  })
}

export function getAiConversationDateGroup(
  updatedAt: string,
  now = new Date(),
): AiConversationDateGroupKey {
  const updated = new Date(updatedAt)
  if (Number.isNaN(updated.getTime()) || Number.isNaN(now.getTime())) return 'older'

  const today = localCalendarDayNumber(now)
  const updatedDay = localCalendarDayNumber(updated)
  const daysAgo = today - updatedDay

  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  if (daysAgo < 7) return 'past-seven-days'
  return 'older'
}

export function aiConversationHistoryReducer(
  state: AiConversationHistoryState,
  action: AiConversationHistoryAction,
): AiConversationHistoryState {
  switch (action.type) {
    case 'history/load-started':
      return {
        ...state,
        error: '',
        loadState: action.mode === 'initial' ? 'loading-initial' : 'loading-more',
      }
    case 'history/load-cancelled':
      return {
        ...state,
        loadState: 'idle',
      }
    case 'history/load-succeeded':
      return {
        ...state,
        conversations: action.mode === 'initial'
          ? mergeAiConversationHistory(
              state.conversations.filter((current) =>
                action.conversations.some((incoming) => incoming.id === current.id)),
              action.conversations,
            )
          : mergeAiConversationHistory(state.conversations, action.conversations),
        error: '',
        hasLoaded: true,
        loadState: 'idle',
        nextCursor: action.nextCursor,
      }
    case 'history/load-failed':
      return {
        ...state,
        error: action.error,
        hasLoaded: true,
        loadState: 'idle',
      }
    case 'conversation/selected':
      return {
        ...state,
        selection: selectAiConversation(action.conversation),
      }
    case 'conversation/blanked':
      return {
        ...state,
        loadState: 'idle',
        selection: createBlankAiConversationSelection(action.context),
      }
    case 'conversation/upserted':
      return {
        ...state,
        conversations: mergeAiConversationHistory(
          state.conversations,
          [action.conversation],
        ),
        loadState: 'idle',
        selection: selectAiConversation(action.conversation),
      }
    case 'conversation/renamed': {
      const title = action.title.trim()
      if (!title) return state
      return {
        ...state,
        conversations: state.conversations.map((conversation) =>
          conversation.id === action.conversationId
            ? {
              ...conversation,
              title,
              updatedAt: action.updatedAt ?? conversation.updatedAt,
            }
            : conversation,
        ).sort(compareAiConversationsByRecency),
      }
    }
    case 'conversation/deleted': {
      const deleted = state.conversations.find(
        (conversation) => conversation.id === action.conversationId,
      )
      const deletedCurrent = isCurrentAiConversation(
        state.selection,
        action.conversationId,
      )
      return {
        ...state,
        conversations: state.conversations.filter(
          (conversation) => conversation.id !== action.conversationId,
        ),
        loadState: 'idle',
        selection: deletedCurrent
          ? createBlankAiConversationSelection(
            deleted ? contextFromAiConversation(deleted) : state.selection.context,
          )
          : state.selection,
      }
    }
    case 'session/reset':
      return createAiConversationHistoryState(
        action.context ?? GENERAL_AI_CONVERSATION_CONTEXT,
      )
  }
}

function localCalendarDayNumber(value: Date) {
  return Math.floor(Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ) / 86_400_000)
}

function compareAiConversationsByRecency(
  left: AiConversationListItem,
  right: AiConversationListItem,
) {
  const leftTime = parseDateForSort(left.lastTurnAt)
  const rightTime = parseDateForSort(right.lastTurnAt)
  if (leftTime !== rightTime) return rightTime - leftTime
  return left.id.localeCompare(right.id)
}

function parseDateForSort(value: string) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}
