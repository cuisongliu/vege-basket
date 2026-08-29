export type OrganizationContext = number | null

export function parseOrganizationContext(value: unknown): OrganizationContext | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (normalized === 'personal') return null
  if (!/^[1-9]\d*$/u.test(normalized)) return undefined

  const organizationId = Number(normalized)
  return Number.isSafeInteger(organizationId) && organizationId > 0
    ? organizationId
    : undefined
}

export function serializeOrganizationContext(organizationId: OrganizationContext) {
  return organizationId == null ? 'personal' : String(organizationId)
}
