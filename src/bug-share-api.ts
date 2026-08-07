import { request } from './api'
import type { BugShareLink, BugShareView } from './bug-share-types'

export function fetchBugShare(token: string) {
  return request<BugShareView>(`/api/bug-shares/${encodeURIComponent(token)}`)
}

export function addBugShareComment(token: string, content: string) {
  return request<BugShareView>(`/api/bug-shares/${encodeURIComponent(token)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export function createBugShareLink(bugId: number) {
  return request<BugShareLink>(`/api/test-bugs/${bugId}/share-link`, { method: 'POST' })
}

export function revokeBugShareLink(bugId: number) {
  return request<{ ok: true }>(`/api/test-bugs/${bugId}/share-link`, { method: 'DELETE' })
}
