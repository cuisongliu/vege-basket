export function clampListPage(page: number, total: number, pageSize: number) {
  return Math.max(0, Math.min(page, Math.max(0, Math.ceil(total / pageSize) - 1)))
}

export function selectedListPage(ids: readonly number[], selectedId: number | undefined, pageSize: number) {
  const index = selectedId == null ? -1 : ids.indexOf(selectedId)
  return index < 0 ? 0 : Math.floor(index / pageSize)
}

export function calculateAdaptiveListPageSize({
  containerTop,
  itemHeight,
  maxPageSize,
  minPageSize,
  pagerHeight = 0,
  reservedHeight = 0,
  viewportHeight,
}: {
  containerTop: number
  itemHeight: number
  maxPageSize: number
  minPageSize: number
  pagerHeight?: number
  reservedHeight?: number
  viewportHeight: number
}) {
  const availableHeight = Math.max(
    itemHeight * minPageSize,
    viewportHeight - containerTop - reservedHeight - pagerHeight,
  )
  return Math.max(
    minPageSize,
    Math.min(maxPageSize, Math.floor(availableHeight / itemHeight)),
  )
}
