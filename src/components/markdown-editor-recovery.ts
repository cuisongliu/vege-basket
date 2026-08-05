const recoveryStorageKey = 'veges.markdown-editor-recovery-at'
const recoveryCooldownMs = 60_000

export function claimMarkdownEditorRecovery() {
  if (typeof window === 'undefined') return false

  try {
    const previousAttempt = Number(window.sessionStorage.getItem(recoveryStorageKey) ?? '')
    const now = Date.now()
    if (Number.isFinite(previousAttempt) && now - previousAttempt < recoveryCooldownMs) {
      return false
    }
    window.sessionStorage.setItem(recoveryStorageKey, String(now))
    return true
  } catch {
    return false
  }
}

export function clearMarkdownEditorRecovery() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(recoveryStorageKey)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
