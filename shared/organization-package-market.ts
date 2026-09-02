export const organizationPackageMarketChannels = ['release', 'ci'] as const
export type OrganizationPackageMarketChannel = (typeof organizationPackageMarketChannels)[number]

export const organizationPackageMarketSelectionModes = ['all', 'selected', 'excluded'] as const
export type OrganizationPackageMarketSelectionMode =
  (typeof organizationPackageMarketSelectionModes)[number]

export type OrganizationPackageMarketChannelPolicy = {
  enabled: boolean
}

export type OrganizationPackageMarketSelectionPolicy = {
  mode: OrganizationPackageMarketSelectionMode
  ruleIds: string[]
}

export type OrganizationPackageMarketRuleOverride = {
  channel: OrganizationPackageMarketChannel
  enabled: boolean
  ruleId: string
}

export type OrganizationPackageMarketPolicy = {
  enabled: boolean
  revision: number
  channels: Record<OrganizationPackageMarketChannel, OrganizationPackageMarketChannelPolicy>
  ruleOverrides: OrganizationPackageMarketRuleOverride[]
  selection: OrganizationPackageMarketSelectionPolicy
  showDependencies: boolean
}

export type OrganizationPackageMarketPolicyPatch = {
  enabled?: boolean
  revision?: number
  ruleOverrides?: unknown
  selection?: Partial<OrganizationPackageMarketSelectionPolicy>
  showDependencies?: boolean
  channels?: Partial<Record<
    OrganizationPackageMarketChannel,
    // mode and ruleIds are retained here only so older serialized policies can
    // be normalized safely while the canonical response uses `selection`.
    Partial<OrganizationPackageMarketChannelPolicy & OrganizationPackageMarketSelectionPolicy>
  >>
}

export type PackageMarketRuleIdentity = {
  category: string
  dependencyRoots?: readonly string[]
  id: string
  parent?: string
}

export const defaultOrganizationPackageMarketPolicy: OrganizationPackageMarketPolicy = {
  enabled: true,
  revision: 0,
  channels: {
    release: {
      enabled: true,
    },
    ci: {
      enabled: true,
    },
  },
  selection: {
    mode: 'all',
    ruleIds: [],
  },
  ruleOverrides: [],
  showDependencies: true,
}

export function organizationPackageMarketPolicyHasVisibleChannel(
  policy: OrganizationPackageMarketPolicy,
  visibleRuleIds?: Partial<Record<OrganizationPackageMarketChannel, readonly string[]>>,
) {
  if (!policy.enabled) return false
  if (
    policy.selection.mode === 'selected' &&
    policy.selection.ruleIds.length === 0 &&
    !policy.ruleOverrides.some((override) => override.enabled)
  ) {
    return false
  }
  return organizationPackageMarketChannels.some((channel) => {
    const channelPolicy = policy.channels[channel]
    if (!channelPolicy.enabled) return false
    const resolvedRuleIds = visibleRuleIds?.[channel]
    if (resolvedRuleIds) return resolvedRuleIds.length > 0
    return true
  })
}

export function canonicalPackageMarketRuleId(value: unknown) {
  const id = String(value ?? '').trim()
  if (id === 'sealos-pro') return 'base-pro'
  if (id === 'sealos-oss') return 'base-oss'
  return id
}

export function normalizeOrganizationPackageMarketChannel(
  value: unknown,
): OrganizationPackageMarketChannel | null {
  return organizationPackageMarketChannels.includes(value as OrganizationPackageMarketChannel)
    ? value as OrganizationPackageMarketChannel
    : null
}

export function normalizeOrganizationPackageMarketSelectionMode(
  value: unknown,
): OrganizationPackageMarketSelectionMode | null {
  return organizationPackageMarketSelectionModes.includes(value as OrganizationPackageMarketSelectionMode)
    ? value as OrganizationPackageMarketSelectionMode
    : null
}

export function normalizeOrganizationPackageMarketRuleIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 500) return null
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    const id = canonicalPackageMarketRuleId(item)
    if (!/^[a-zA-Z0-9:_-]{1,160}$/u.test(id)) return null
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

export function normalizeOrganizationPackageMarketRuleOverrides(value: unknown) {
  if (!Array.isArray(value) || value.length > 1000) return null
  const seen = new Set<string>()
  const overrides: OrganizationPackageMarketRuleOverride[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const record = item as Record<string, unknown>
    const ruleId = canonicalPackageMarketRuleId(record.ruleId)
    const channel = normalizeOrganizationPackageMarketChannel(record.channel)
    if (!/^[a-zA-Z0-9:_-]{1,160}$/u.test(ruleId) || !channel || typeof record.enabled !== 'boolean') {
      return null
    }
    const key = `${ruleId}\u0000${channel}`
    if (seen.has(key)) return null
    seen.add(key)
    overrides.push({ channel, enabled: record.enabled, ruleId })
  }
  return overrides
}

export function isSelectablePackageMarketRule(rule: PackageMarketRuleIdentity) {
  return rule.category !== 'dependency'
}

export function packageMarketDependencyChannel(
  rule: Pick<PackageMarketRuleIdentity, 'category' | 'dependencyRoots'>,
): OrganizationPackageMarketChannel | null {
  if (rule.category !== 'dependency') return null
  return (rule.dependencyRoots?.length ?? 0) > 0 ? 'ci' : 'release'
}

export function packageMarketRuleSupportsChannel(
  ruleId: string,
  channel: OrganizationPackageMarketChannel,
) {
  // The OSS base package has no CI surface in the existing market contract.
  return !(channel === 'ci' && canonicalPackageMarketRuleId(ruleId) === 'base-oss')
}

function ruleOverride(
  policy: OrganizationPackageMarketPolicy,
  ruleId: string,
  channel: OrganizationPackageMarketChannel,
) {
  const canonicalId = canonicalPackageMarketRuleId(ruleId)
  return policy.ruleOverrides.find((override) => (
    override.channel === channel && canonicalPackageMarketRuleId(override.ruleId) === canonicalId
  ))
}

function topLevelRuleAllowed(
  ruleId: string,
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  const canonicalId = canonicalPackageMarketRuleId(ruleId)
  if (!policy.channels[channel].enabled || !packageMarketRuleSupportsChannel(canonicalId, channel)) return false
  const override = ruleOverride(policy, canonicalId, channel)
  if (override) return override.enabled
  if (policy.selection.mode === 'all') return true
  const listed = policy.selection.ruleIds.some((ruleId) => (
    canonicalPackageMarketRuleId(ruleId) === canonicalId
  ))
  return policy.selection.mode === 'selected' ? listed : !listed
}

export function isPackageMarketRuleVisible(
  rule: PackageMarketRuleIdentity,
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  if (!policy.enabled) return false
  if (rule.category === 'dependency') {
    if (!policy.showDependencies || packageMarketDependencyChannel(rule) !== channel) return false
    const parent = canonicalPackageMarketRuleId(rule.parent)
    if (!parent || !topLevelRuleAllowed(parent, policy, channel)) return false
    return ruleOverride(policy, rule.id, channel)?.enabled ?? true
  }
  return topLevelRuleAllowed(rule.id, policy, channel)
}

export function filterPackageMarketRules<T extends PackageMarketRuleIdentity>(
  rules: readonly T[],
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  return rules.filter((rule) => isPackageMarketRuleVisible(rule, policy, channel))
}

export function visiblePackageMarketRuleIds(
  rules: readonly PackageMarketRuleIdentity[],
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  return rules
    .filter((rule) => rule.category !== 'dependency')
    .filter((rule) => isPackageMarketRuleVisible(rule, policy, channel))
    .map((rule) => canonicalPackageMarketRuleId(rule.id))
    .filter((id, index, list) => list.indexOf(id) === index)
}

export function isPackageMarketRuleAllowed(
  packageId: unknown,
  rules: readonly PackageMarketRuleIdentity[],
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  const canonicalId = canonicalPackageMarketRuleId(packageId)
  const rule = rules.find((candidate) => (
    canonicalPackageMarketRuleId(candidate.id) === canonicalId
  ))
  return Boolean(rule && isPackageMarketRuleVisible(rule, policy, channel))
}

export function mergeOrganizationPackageMarketPolicy(
  value: OrganizationPackageMarketPolicyPatch | null | undefined,
): OrganizationPackageMarketPolicy {
  const source = value ?? {}
  const channels: Partial<Record<
    OrganizationPackageMarketChannel,
    Partial<OrganizationPackageMarketChannelPolicy & OrganizationPackageMarketSelectionPolicy>
  >> = source.channels ?? {}
  const legacySelection = channels.release ?? channels.ci
  return {
    enabled: source.enabled !== false,
    revision: Number.isSafeInteger(source.revision) && Number(source.revision) >= 0
      ? Number(source.revision)
      : 0,
    channels: {
      release: normalizeChannelPolicy(channels.release),
      ci: normalizeChannelPolicy(channels.ci),
    },
    ruleOverrides: normalizeOrganizationPackageMarketRuleOverrides(source.ruleOverrides) ?? [],
    selection: normalizeSelectionPolicy(source.selection ?? legacySelection),
    showDependencies: source.showDependencies !== false,
  }
}

function normalizeChannelPolicy(
  value: Partial<OrganizationPackageMarketChannelPolicy & OrganizationPackageMarketSelectionPolicy> | null | undefined,
): OrganizationPackageMarketChannelPolicy {
  return {
    enabled: value?.enabled !== false,
  }
}

function normalizeSelectionPolicy(
  value: Partial<OrganizationPackageMarketSelectionPolicy> | null | undefined,
): OrganizationPackageMarketSelectionPolicy {
  const mode = normalizeOrganizationPackageMarketSelectionMode(value?.mode) ?? 'all'
  const ruleIds = normalizeOrganizationPackageMarketRuleIds(value?.ruleIds) ?? []
  return {
    mode,
    ruleIds: mode === 'all' ? [] : ruleIds,
  }
}
