import type { NotificationCenterData } from './types'

export const notificationRefreshIntervalMs = 15_000
export const workspaceRefreshIntervalMs = 30_000

const refreshFailureBackoffBaseMs = 1_000
const refreshFailureBackoffMaxMs = 60_000

export function startNotificationRefreshSchedule(options: {
  clearInterval: (handle: number) => void
  isVisible: () => boolean
  onFocus: (listener: () => void) => () => void
  onVisibilityChange: (listener: () => void) => () => void
  refresh: () => void | Promise<boolean | void>
  setInterval: (listener: () => void, delay: number) => number
  intervalMs?: number
}) {
  let refreshInFlight = false
  let failureCount = 0
  let blockedUntil = 0

  const registerFailure = () => {
    failureCount += 1
    const delay = Math.min(
      refreshFailureBackoffMaxMs,
      refreshFailureBackoffBaseMs * 2 ** (failureCount - 1),
    )
    blockedUntil = Date.now() + delay
  }

  const refreshIfVisible = () => {
    if (!options.isVisible() || refreshInFlight || Date.now() < blockedUntil) return

    let result: void | Promise<boolean | void>
    try {
      result = options.refresh()
    } catch {
      registerFailure()
      return
    }

    if (!result || typeof result.then !== 'function') return

    refreshInFlight = true
    Promise.resolve(result).then(
      (successful) => {
        refreshInFlight = false
        if (successful === false) {
          registerFailure()
        } else {
          failureCount = 0
          blockedUntil = 0
        }
      },
      () => {
        refreshInFlight = false
        registerFailure()
      },
    )
  }
  const interval = options.setInterval(refreshIfVisible, options.intervalMs ?? notificationRefreshIntervalMs)
  const removeFocusListener = options.onFocus(refreshIfVisible)
  const removeVisibilityListener = options.onVisibilityChange(refreshIfVisible)

  return () => {
    options.clearInterval(interval)
    removeFocusListener()
    removeVisibilityListener()
  }
}

export function removePackageEventNotification(
  notifications: NotificationCenterData,
  eventId: number,
): NotificationCenterData {
  return {
    ...notifications,
    assignedPackageEvents: notifications.assignedPackageEvents.filter(
      (item) => item.id !== eventId,
    ),
  }
}

export function removeTodoNotifications(
  notifications: NotificationCenterData,
  todoId: number,
): NotificationCenterData {
  return {
    ...notifications,
    assignedTodos: notifications.assignedTodos.filter((item) => item.id !== todoId),
    dueTomorrowTodos: notifications.dueTomorrowTodos.filter((item) => item.id !== todoId),
    noteMentions: notifications.noteMentions.filter((item) => item.id !== todoId),
  }
}
