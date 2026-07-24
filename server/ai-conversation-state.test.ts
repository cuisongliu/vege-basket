import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aiConversationHistoryReducer,
  canonicalProcessingAiTurn,
  createAiConversationHistoryState,
  currentAiConversationId,
  getAiConversationDateGroup,
  groupAiConversationsByDate,
  isAiTurnCanonicalStateUnknown,
  isCurrentAiConversation,
  latestRetryableAiTurnId,
  mergeAiConversationHistory,
  mergeAiTurns,
  nextAiTurnNumber,
  selectAiConversation,
  type AiConversationListItem,
} from '../src/ai-conversation-state.ts'

const generalConversation: AiConversationListItem = {
  id: 'conversation-general',
  lastTurnAt: '2026-07-17T04:00:00.000Z',
  title: '整理本周进展',
  contextType: 'general',
  projectId: null,
  projectName: null,
  createdAt: '2026-07-17T01:00:00.000Z',
  updatedAt: '2026-07-17T04:00:00.000Z',
}

const projectConversation: AiConversationListItem = {
  id: 'conversation-project',
  lastTurnAt: '2026-07-16T04:00:00.000Z',
  title: '生成 Veges 周报',
  contextType: 'project',
  projectId: 42,
  projectName: 'Veges',
  createdAt: '2026-07-16T01:00:00.000Z',
  updatedAt: '2026-07-16T04:00:00.000Z',
}

test('blank state has no current history row', () => {
  const state = createAiConversationHistoryState()

  assert.equal(currentAiConversationId(state.selection), null)
  assert.equal(isCurrentAiConversation(state.selection, generalConversation.id), false)
})

test('selecting a conversation retains its immutable context', () => {
  const selection = selectAiConversation(projectConversation)

  assert.equal(currentAiConversationId(selection), projectConversation.id)
  assert.equal(isCurrentAiConversation(selection, projectConversation.id), true)
  assert.deepEqual(selection.context, {
    contextType: 'project',
    projectId: 42,
    projectName: 'Veges',
  })
})

test('history pagination merge replaces duplicates and keeps recency order', () => {
  const refreshedGeneral = {
    ...generalConversation,
    title: '更新后的标题',
    lastTurnAt: '2026-07-18T04:00:00.000Z',
    updatedAt: '2026-07-18T04:00:00.000Z',
  }
  const result = mergeAiConversationHistory(
    [generalConversation],
    [projectConversation, refreshedGeneral],
  )

  assert.deepEqual(result.map((conversation) => conversation.id), [
    generalConversation.id,
    projectConversation.id,
  ])
  assert.equal(result[0].title, '更新后的标题')
})

test('history merge rejects an older response after a newer rename', () => {
  const renamed = {
    ...generalConversation,
    title: '刚刚重命名的标题',
    updatedAt: '2026-07-18T05:00:00.000Z',
  }
  const result = mergeAiConversationHistory([renamed], [generalConversation])

  assert.equal(result[0].title, '刚刚重命名的标题')
  assert.equal(result[0].updatedAt, renamed.updatedAt)
})

test('optimistic turns follow the largest loaded server turn number', () => {
  assert.equal(nextAiTurnNumber([{ turnNo: 61 }, { turnNo: 100 }]), 101)
  assert.equal(nextAiTurnNumber([]), 1)
})

test('canonical processing recovery and retry stay bound to the latest turn', () => {
  const turns = [
    { id: 'old-failed', status: 'failed', turnNo: 8 },
    { id: 'active', status: 'processing', turnNo: 9 },
  ]
  assert.equal(canonicalProcessingAiTurn(turns)?.id, 'active')
  assert.equal(latestRetryableAiTurnId(turns), null)
  assert.equal(latestRetryableAiTurnId([
    turns[0],
    { id: 'latest-cancelled', status: 'cancelled', turnNo: 9 },
  ]), 'latest-cancelled')
})

test('turn merge cannot regress a terminal turn with an older processing response', () => {
  const cancelled = {
    attemptCount: 1,
    id: 'turn-1',
    status: 'cancelled',
    turnNo: 1,
    updatedAt: '2026-07-20T09:00:01.000Z',
  }
  const staleProcessing = {
    ...cancelled,
    status: 'processing',
    updatedAt: '2026-07-20T09:00:00.000Z',
  }
  const sameTimestampProcessing = {
    ...cancelled,
    status: 'processing',
  }

  assert.deepEqual(mergeAiTurns([cancelled], [staleProcessing]), [cancelled])
  assert.deepEqual(mergeAiTurns([cancelled], [sameTimestampProcessing]), [cancelled])
  assert.deepEqual(mergeAiTurns([{
    ...cancelled,
    status: 'processing',
    updatedAt: '2026-07-20T09:00:02.000Z',
  }], [{
    ...cancelled,
    updatedAt: '2026-07-20T09:00:00.000Z',
  }]), [{
    ...cancelled,
    updatedAt: '2026-07-20T09:00:00.000Z',
  }])
  assert.deepEqual(mergeAiTurns([cancelled], [{
    ...cancelled,
    status: 'processing',
    updatedAt: '2026-07-20T09:00:02.000Z',
  }]), [cancelled])
  assert.deepEqual(
    mergeAiTurns([cancelled], [{
      ...cancelled,
      attemptCount: 2,
      status: 'processing',
      updatedAt: '2026-07-20T09:00:00.000Z',
    }]),
    [{
      ...cancelled,
      attemptCount: 2,
      status: 'processing',
      updatedAt: '2026-07-20T09:00:00.000Z',
    }],
  )
})

test('treats transport failures and 5xx responses as canonical-state unknown', () => {
  assert.equal(isAiTurnCanonicalStateUnknown(null), true)
  assert.equal(isAiTurnCanonicalStateUnknown(502), true)
  assert.equal(isAiTurnCanonicalStateUnknown(409), false)
  assert.equal(isAiTurnCanonicalStateUnknown(429), false)
})

test('history reducer replaces initial page and appends later pages', () => {
  const initial = createAiConversationHistoryState()
  const loading = aiConversationHistoryReducer(initial, {
    type: 'history/load-started',
    mode: 'initial',
  })
  const firstPage = aiConversationHistoryReducer(loading, {
    type: 'history/load-succeeded',
    conversations: [generalConversation],
    nextCursor: 'next-page',
    mode: 'initial',
  })
  const secondPage = aiConversationHistoryReducer(firstPage, {
    type: 'history/load-succeeded',
    conversations: [projectConversation],
    nextCursor: null,
    mode: 'more',
  })

  assert.equal(loading.loadState, 'loading-initial')
  assert.equal(firstPage.hasLoaded, true)
  assert.equal(firstPage.nextCursor, 'next-page')
  assert.deepEqual(secondPage.conversations.map(({ id }) => id), [
    generalConversation.id,
    projectConversation.id,
  ])
  assert.equal(secondPage.nextCursor, null)
})

test('initial history refresh preserves a newer local rename and drops absent rows', () => {
  const renamed = {
    ...generalConversation,
    title: '发布前终审',
    updatedAt: '2026-07-18T05:00:00.000Z',
  }
  const state = {
    ...createAiConversationHistoryState(),
    conversations: [renamed, projectConversation],
  }
  const refreshed = aiConversationHistoryReducer(state, {
    type: 'history/load-succeeded',
    conversations: [generalConversation],
    mode: 'initial',
    nextCursor: null,
  })

  assert.deepEqual(refreshed.conversations, [renamed])
})

test('cancelling an invalidated history load returns the reducer to idle', () => {
  const loading = aiConversationHistoryReducer(createAiConversationHistoryState(), {
    type: 'history/load-started',
    mode: 'initial',
  })
  const cancelled = aiConversationHistoryReducer(loading, {
    type: 'history/load-cancelled',
  })

  assert.equal(cancelled.loadState, 'idle')
})

test('date grouping uses local calendar days and omits empty groups', () => {
  const now = new Date('2026-07-17T12:00:00+08:00')
  const conversations: AiConversationListItem[] = [
    { ...generalConversation, id: 'today', lastTurnAt: '2026-07-17T08:00:00+08:00' },
    { ...generalConversation, id: 'yesterday', lastTurnAt: '2026-07-16T23:59:00+08:00' },
    { ...generalConversation, id: 'recent', lastTurnAt: '2026-07-11T09:00:00+08:00' },
    { ...generalConversation, id: 'older', lastTurnAt: '2026-07-10T23:59:00+08:00' },
  ]

  assert.equal(getAiConversationDateGroup('2026-07-18T01:00:00+08:00', now), 'today')
  assert.deepEqual(
    groupAiConversationsByDate(conversations, now).map((group) => ({
      ids: group.conversations.map(({ id }) => id),
      key: group.key,
      label: group.label,
    })),
    [
      { ids: ['today'], key: 'today', label: '今天' },
      { ids: ['yesterday'], key: 'yesterday', label: '昨天' },
      { ids: ['recent'], key: 'past-seven-days', label: '过去 7 天' },
      { ids: ['older'], key: 'older', label: '更早' },
    ],
  )
})

test('renaming trims the title without changing last-turn activity order', () => {
  const state = {
    ...createAiConversationHistoryState(),
    conversations: [generalConversation, projectConversation],
  }
  const renamed = aiConversationHistoryReducer(state, {
    type: 'conversation/renamed',
    conversationId: projectConversation.id,
    title: '  发布前检查  ',
    updatedAt: '2026-07-18T01:00:00.000Z',
  })

  assert.equal(renamed.conversations[0].id, generalConversation.id)
  assert.equal(renamed.conversations[1].title, '发布前检查')
})

test('deleting the current row returns to a blank state with the same context', () => {
  const selectedState = {
    ...createAiConversationHistoryState(),
    conversations: [projectConversation, generalConversation],
    selection: selectAiConversation(projectConversation),
  }
  const deleted = aiConversationHistoryReducer(selectedState, {
    type: 'conversation/deleted',
    conversationId: projectConversation.id,
  })

  assert.deepEqual(deleted.conversations, [generalConversation])
  assert.deepEqual(deleted.selection, {
    kind: 'blank',
    context: {
      contextType: 'project',
      projectId: 42,
      projectName: 'Veges',
    },
  })
})

test('session reset drops personal history from client memory', () => {
  const populated = {
    ...createAiConversationHistoryState(),
    conversations: [generalConversation],
    hasLoaded: true,
    selection: selectAiConversation(generalConversation),
  }
  const reset = aiConversationHistoryReducer(populated, { type: 'session/reset' })

  assert.deepEqual(reset, createAiConversationHistoryState())
})
