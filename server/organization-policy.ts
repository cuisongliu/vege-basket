import crypto from 'node:crypto'

export const organizationAccessRoles = ['owner', 'admin', 'member'] as const
export type OrganizationAccessRole = (typeof organizationAccessRoles)[number]

export function isOrganizationAccessRole(value: unknown): value is OrganizationAccessRole {
  return organizationAccessRoles.includes(value as OrganizationAccessRole)
}

export function canManageOrganization(role: OrganizationAccessRole | null) {
  return role === 'owner' || role === 'admin'
}

export function normalizeOrganizationName(value: unknown) {
  const name = String(value ?? '').trim()
  return name && name.length <= 80 ? name : null
}

export function matchesOrganizationDeleteConfirmation(
  organizationName: string,
  confirmationName: unknown,
) {
  return typeof confirmationName === 'string' && confirmationName === organizationName
}

export function normalizeOrganizationWeekStartsOn(value: unknown) {
  const weekStartsOn = Number(value)
  return Number.isSafeInteger(weekStartsOn) && weekStartsOn >= 1 && weekStartsOn <= 7
    ? weekStartsOn
    : null
}

export function normalizeOrganizationWeekStart(value: unknown, weekStartsOn = 1) {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const normalizedWeekStartsOn = normalizeOrganizationWeekStartsOn(weekStartsOn)
  if (!normalizedWeekStartsOn) return null
  const date = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) return null
  const day = date.getUTCDay()
  const startDay = normalizedWeekStartsOn === 7 ? 0 : normalizedWeekStartsOn
  date.setUTCDate(date.getUTCDate() - ((day - startDay + 7) % 7))
  return date.toISOString().slice(0, 10)
}

export function hashOrganizationInviteToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('base64url')
}

export function verifyFeishuCardSignature(params: {
  body: string
  nonce: string
  signature: string
  timestamp: string
  verificationToken: string
}) {
  if (!params.signature || !params.timestamp || !params.nonce || !params.verificationToken) return false
  const expected = crypto
    .createHash('sha1')
    .update(`${params.timestamp}${params.nonce}${params.verificationToken}${params.body}`)
    .digest('hex')
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(params.signature)
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
}

export function isFreshFeishuTimestamp(value: string, nowMs = Date.now()) {
  const seconds = Number(value)
  return Number.isFinite(seconds) && Math.abs(nowMs - seconds * 1_000) <= 5 * 60 * 1_000
}
