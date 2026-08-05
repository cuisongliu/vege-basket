import type { ProjectPackageEventStatus } from './project-package-timeline.ts'

export function shouldRetirePackageEventNotification(
  previousStatus: ProjectPackageEventStatus,
  nextStatus: ProjectPackageEventStatus | undefined,
) {
  return nextStatus !== undefined && (
    previousStatus !== 'draft' || nextStatus !== 'draft'
  )
}

export function hasTodoWatcherChanged(
  previousWatcherUserId: number | null,
  nextWatcherUserId: number | null | undefined,
) {
  return nextWatcherUserId !== undefined && nextWatcherUserId !== previousWatcherUserId
}

export function hasTodoWatchersChanged(
  previousWatcherUserIds: number[],
  nextWatcherUserIds: number[] | null | undefined,
) {
  if (nextWatcherUserIds == null) return false
  if (previousWatcherUserIds.length !== nextWatcherUserIds.length) return true
  return previousWatcherUserIds.some((userId, index) => userId !== nextWatcherUserIds[index])
}

export function hasTodoAssigneeChanged(
  previousAssigneeUserId: number | null,
  nextAssigneeUserId: number | null | undefined,
) {
  return nextAssigneeUserId !== undefined && nextAssigneeUserId !== previousAssigneeUserId
}

export function resolveTodoReviewerUserId(
  reviewerUserId: number | null,
  creatorUserId: number | null,
  projectOwnerUserId: number,
) {
  return reviewerUserId ?? creatorUserId ?? projectOwnerUserId
}

export function canUserReviewTodo(params: {
  creatorUserId: number
  projectOwnerUserId: number
  reviewerUserId: number | null
  userId: number
}) {
  const { creatorUserId, projectOwnerUserId, reviewerUserId, userId } = params
  return userId === creatorUserId ||
    userId === resolveTodoReviewerUserId(reviewerUserId, creatorUserId, projectOwnerUserId)
}

export function resolveTodoNoteRecipientUserIds(params: {
  authorUserId: number
  creatorUserId: number
  mentionedUserIds: number[]
  watcherUserId: number | null
  watcherUserIds?: number[]
}) {
  return Array.from(new Set([
    params.creatorUserId,
    ...(params.watcherUserId == null ? [] : [params.watcherUserId]),
    ...(params.watcherUserIds ?? []),
    ...params.mentionedUserIds,
  ]))
    .filter((userId) => Number.isSafeInteger(userId) && userId > 0 && userId !== params.authorUserId)
    .sort((left, right) => left - right)
}

export function shouldDeliverNotificationToProjectChat(kind: string) {
  return kind === 'assigned_todo' ||
    kind === 'todo_completed_creator' ||
    kind === 'todo_rejected_creator' ||
    kind === 'package_event_assigned' ||
    kind === 'test_bug_assigned'
}
