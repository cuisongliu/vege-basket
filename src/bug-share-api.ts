import { request } from './api'
import type { BugShareLink, BugShareView } from './bug-share-types'

const createShareLinkTimeoutMs = 20_000

export function fetchBugShare(token: string) {
  return request<BugShareView>(`/api/bug-shares/${encodeURIComponent(token)}`)
}

export function addBugShareComment(token: string, content: string) {
  return request<BugShareView>(`/api/bug-shares/${encodeURIComponent(token)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export async function createBugShareLink(bugId: number) {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), createShareLinkTimeoutMs)
  try {
    const result = await request<BugShareLink>(`/api/test-bugs/${bugId}/share-link`, {
      method: 'POST',
      signal: controller.signal,
    })
    return { ...result, url: new URL(result.url, globalThis.location.origin).toString() }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export function revokeBugShareLink(bugId: number) {
  return request<{ ok: true }>(`/api/test-bugs/${bugId}/share-link`, { method: 'DELETE' })
}
