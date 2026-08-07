const bugSharePathPattern = /^\/share\/bug\/([^/]+)\/?$/

export function getBugShareTokenFromPath(pathname = window.location.pathname) {
  const match = pathname.match(bugSharePathPattern)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}
