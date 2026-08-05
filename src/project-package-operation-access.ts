export function resolveExistingOperationInteraction(canManageTimeline: boolean) {
  return {
    disabled: false as const,
    readOnly: !canManageTimeline,
  }
}
