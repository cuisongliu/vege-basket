import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canUserReviewTodo,
  hasTodoWatcherChanged,
  resolveTodoReviewerUserId,
  resolveTodoNoteRecipientUserIds,
  shouldDeliverNotificationToProjectChat,
  shouldRetirePackageEventNotification,
} from './notification-policy.ts'
import {
  notificationRefreshIntervalMs,
  removePackageEventNotification,
  removeTodoNotifications,
  startNotificationRefreshSchedule,
} from '../src/notifications.ts'
import type { NotificationCenterData, TodoNotification } from '../src/types.ts'

const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const testWorkbenchSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')

function todoNotification(id: number): TodoNotification {
  return {
    dueDate: '2026-07-16',
    id,
    priority: 'medium',
    projectId: 1,
    projectName: 'Project',
    title: `Todo ${id}`,
  }
}

test('removes a completed todo from actionable todo notification categories', () => {
  const notifications: NotificationCenterData = {
    assignedPackageEvents: [{
      eventStatus: 'draft',
      eventType: 'upgrade',
      id: 30,
      projectId: 1,
      projectName: 'Project',
      title: 'Event',
    }],
    assignedTodos: [todoNotification(10), todoNotification(20)],
    watchedTodos: [todoNotification(10), todoNotification(30)],
    dueTomorrowTodos: [todoNotification(10)],
    noteMentions: [todoNotification(10), todoNotification(20)],
    invites: [{
      createdAt: '2026-07-15 12:00',
      id: 40,
      invitedByName: 'Owner',
      projectId: 1,
      projectName: 'Project',
    }],
  }

  const result = removeTodoNotifications(notifications, 10)

  assert.deepEqual(result.assignedTodos.map((item) => item.id), [20])
  assert.equal(result.watchedTodos, notifications.watchedTodos)
  assert.deepEqual(result.dueTomorrowTodos, [])
  assert.deepEqual(result.noteMentions.map((item) => item.id), [20])
  assert.equal(result.assignedPackageEvents, notifications.assignedPackageEvents)
  assert.equal(result.invites, notifications.invites)
})

test('removes only the delivery event whose status advanced', () => {
  const notifications: NotificationCenterData = {
    assignedPackageEvents: [
      {
        eventStatus: 'draft',
        eventType: 'upgrade',
        id: 30,
        projectId: 1,
        projectName: 'Project',
        title: 'Event 30',
      },
      {
        eventStatus: 'draft',
        eventType: 'init',
        id: 31,
        projectId: 1,
        projectName: 'Project',
        title: 'Event 31',
      },
    ],
    assignedTodos: [todoNotification(10)],
    watchedTodos: [],
    dueTomorrowTodos: [],
    noteMentions: [],
    invites: [],
  }

  const result = removePackageEventNotification(notifications, 30)

  assert.deepEqual(result.assignedPackageEvents.map((item) => item.id), [31])
  assert.equal(result.assignedTodos, notifications.assignedTodos)
})

test('retires a delivery event notification after it leaves draft for the first time', () => {
  assert.equal(shouldRetirePackageEventNotification('draft', 'delivering'), true)
  assert.equal(shouldRetirePackageEventNotification('draft', 'delivered'), true)
  assert.equal(shouldRetirePackageEventNotification('delivering', 'draft'), true)
  assert.equal(shouldRetirePackageEventNotification('delivered', 'draft'), true)
  assert.equal(shouldRetirePackageEventNotification('draft', 'draft'), false)
  assert.equal(shouldRetirePackageEventNotification('draft', undefined), false)
})

test('detects only explicit todo watcher changes', () => {
  assert.equal(hasTodoWatcherChanged(10, undefined), false)
  assert.equal(hasTodoWatcherChanged(10, 10), false)
  assert.equal(hasTodoWatcherChanged(10, 20), true)
  assert.equal(hasTodoWatcherChanged(10, null), true)
  assert.equal(hasTodoWatcherChanged(null, 20), true)
})

test('uses the designated todo reviewer and otherwise falls back to the creator', () => {
  assert.equal(resolveTodoReviewerUserId(30, 20, 10), 30)
  assert.equal(resolveTodoReviewerUserId(null, 20, 10), 20)
  assert.equal(resolveTodoReviewerUserId(null, null, 10), 10)
  assert.equal(canUserReviewTodo({
    creatorUserId: 20,
    projectOwnerUserId: 10,
    reviewerUserId: 30,
    userId: 30,
  }), true)
  assert.equal(canUserReviewTodo({
    creatorUserId: 20,
    projectOwnerUserId: 10,
    reviewerUserId: 30,
    userId: 20,
  }), false)
  assert.equal(canUserReviewTodo({
    creatorUserId: 20,
    projectOwnerUserId: 10,
    reviewerUserId: 30,
    userId: 10,
  }), false)
})

test('routes pending-review Feishu delivery and group mentions to the effective reviewer', () => {
  assert.match(
    serverSource,
    /coalesce\(t\.reviewer_user_id, t\.created_by_user_id, p\.user_id\) as reviewer_user_id/,
  )
  assert.match(serverSource, /`验收人：\$\{reviewerText\}`/)
})

test('deduplicates todo note recipients and excludes the note author', () => {
  assert.deepEqual(resolveTodoNoteRecipientUserIds({
    authorUserId: 10,
    creatorUserId: 20,
    mentionedUserIds: [10, 20, 30, 40, 40],
    watcherUserId: 30,
  }), [20, 30, 40])
  assert.deepEqual(resolveTodoNoteRecipientUserIds({
    authorUserId: 20,
    creatorUserId: 20,
    mentionedUserIds: [20],
    watcherUserId: 20,
  }), [])
})

test('enqueues personal Feishu delivery after todo note creation and editing', () => {
  assert.equal((serverSource.match(/enqueueTodoNoteDeliveries\(noteId\)/g) ?? []).length, 2)
  assert.match(serverSource, /kind: 'todo_note_added'/)
  assert.match(serverSource, /noteRecipientReason/)
})

test('delivers watched todo notifications only to the individual Feishu target', () => {
  assert.equal(shouldDeliverNotificationToProjectChat('watched_todo'), false)
  assert.equal(shouldDeliverNotificationToProjectChat('todo_note_added'), false)
  assert.equal(shouldDeliverNotificationToProjectChat('assigned_todo'), true)
  assert.equal(shouldDeliverNotificationToProjectChat('package_event_assigned'), true)
})

test('routes Bug assignments to the developer and only project-linked Bugs to project chat', () => {
  assert.equal(shouldDeliverNotificationToProjectChat('test_bug_assigned'), true)
  assert.equal((testWorkbenchSource.match(/onTestBugAssigned\(\{/g) ?? []).length, 2)
  assert.match(serverSource, /left join projects project on project\.id = plan\.project_id/)
  assert.match(serverSource, /candidate\.projectId <= 0/)
  assert.match(serverSource, /kind: 'test_bug_assigned'/)
})

test('refreshes notifications while visible and cleans up the live schedule', () => {
  let visible = true
  let refreshCount = 0
  let intervalDelay = 0
  let intervalListener = () => {}
  let focusListener = () => {}
  let visibilityListener = () => {}
  let clearedInterval = 0
  let removedFocus = false
  let removedVisibility = false

  const stop = startNotificationRefreshSchedule({
    clearInterval: (handle) => {
      clearedInterval = handle
    },
    isVisible: () => visible,
    onFocus: (listener) => {
      focusListener = listener
      return () => {
        removedFocus = true
      }
    },
    onVisibilityChange: (listener) => {
      visibilityListener = listener
      return () => {
        removedVisibility = true
      }
    },
    refresh: () => {
      refreshCount += 1
    },
    setInterval: (listener, delay) => {
      intervalListener = listener
      intervalDelay = delay
      return 17
    },
  })

  assert.equal(intervalDelay, notificationRefreshIntervalMs)
  intervalListener()
  focusListener()
  assert.equal(refreshCount, 2)

  visible = false
  intervalListener()
  visibilityListener()
  assert.equal(refreshCount, 2)

  visible = true
  visibilityListener()
  assert.equal(refreshCount, 3)

  stop()
  assert.equal(clearedInterval, 17)
  assert.equal(removedFocus, true)
  assert.equal(removedVisibility, true)
})
