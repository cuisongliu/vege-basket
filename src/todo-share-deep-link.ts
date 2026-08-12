const todoSharePathPattern = /^\/share\/todo\/([^/]+)\/?$/

export function getTodoShareTokenFromPath(pathname = '') {
  const match = pathname.match(todoSharePathPattern)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
