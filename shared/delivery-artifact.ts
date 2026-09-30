export const maxDeliveryArtifactEntries = 20
export const maxOfflinePackageUrlLength = 4096

export type OfflinePackageUrlResult =
  | { error: string; valid: false }
  | { valid: true; value: string }

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export function normalizeOfflinePackageUrl(value: unknown): OfflinePackageUrlResult {
  if (typeof value !== 'string') return { error: '离线包地址不能为空。', valid: false }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxOfflinePackageUrlLength || hasControlCharacter(normalized)) {
    return { error: '离线包地址格式无效。', valid: false }
  }
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return { error: '离线包地址必须是未包含账号密码的 HTTPS 地址。', valid: false }
    }
    return { valid: true, value: normalized }
  } catch {
    return { error: '离线包地址格式无效。', valid: false }
  }
}

export function offlinePackageFileName(value: string, fallbackIndex: number) {
  try {
    const pathname = new URL(value).pathname
    const rawName = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '')
    return rawName.replace(/[^A-Za-z0-9._-]/gu, '-') || `offline-package-${fallbackIndex + 1}.tar`
  } catch {
    return `offline-package-${fallbackIndex + 1}.tar`
  }
}
