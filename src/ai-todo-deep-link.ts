const aiTodoBatchParam = 'aiTodoBatch'

export function parseAiTodoBatchDeepLink(search: string) {
  const raw = new URLSearchParams(search).get(aiTodoBatchParam)
  if (raw === null) return { batchId: null, status: 'absent' as const }
  if (!/^[1-9]\d*$/u.test(raw)) return { batchId: null, status: 'invalid' as const }
  const batchId = Number(raw)
  if (!Number.isSafeInteger(batchId)) return { batchId: null, status: 'invalid' as const }
  return { batchId, status: 'valid' as const }
}

export function removeAiTodoBatchDeepLink(location: {
  hash: string
  pathname: string
  search: string
}) {
  const search = new URLSearchParams(location.search)
  search.delete(aiTodoBatchParam)
  const serialized = search.toString()
  return `${location.pathname}${serialized ? `?${serialized}` : ''}${location.hash}`
}
