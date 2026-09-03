import type { PoolClient, QueryResultRow } from 'pg'
import { query } from './db.ts'
import {
  canonicalPackageMarketRuleId,
  defaultOrganizationPackageMarketPolicy,
  filterPackageMarketRules,
  isPackageMarketRuleAllowed,
  isPackageMarketRuleVisible,
  mergeOrganizationPackageMarketPolicy,
  normalizeOrganizationPackageMarketChannel,
  normalizeOrganizationPackageMarketRuleIds,
  normalizeOrganizationPackageMarketRuleOverrides,
  normalizeOrganizationPackageMarketSelectionMode,
  packageMarketDependencyChannel,
  packageMarketRuleSupportsChannel,
  visiblePackageMarketRuleIds,
  type OrganizationPackageMarketChannel,
  type OrganizationPackageMarketChannelPolicy,
  type OrganizationPackageMarketPolicy,
  type OrganizationPackageMarketSelectionPolicy,
} from '../shared/organization-package-market.ts'
import {
  listPackageMarketRules,
  type PackageMarketRule,
} from './package-market.ts'

type QueryExecutor = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>
}

type PolicyRow = {
  enabled: boolean
  revision: number
  channel: string
  channel_enabled: boolean
  legacy_channel_mode: string
  legacy_rule_ids: string[]
  selection_configured: boolean
  selection_mode: string
  selection_rule_ids: string[]
  rule_overrides: unknown
  show_dependencies: boolean
}

export type PackageMarketRulesResponse = {
  expireMinutes: number
  organizationId: number | null
  policy: OrganizationPackageMarketPolicy
  rules: PackageMarketRule[]
  visibleRuleIds: Record<OrganizationPackageMarketChannel, string[]>
}

export class OrganizationPackageMarketPolicyError extends Error {
  readonly code: 'ORGANIZATION_CONTEXT_REQUIRED' | 'ORGANIZATION_FEATURE_DISABLED' | 'PACKAGE_MARKET_CHANNEL_DISABLED' | 'PACKAGE_MARKET_RULE_NOT_ALLOWED' | 'PACKAGE_MARKET_POLICY_CONFLICT' | 'PACKAGE_MARKET_POLICY_INVALID'
  readonly status: 400 | 403 | 404 | 409

  constructor(
    code: OrganizationPackageMarketPolicyError['code'],
    message: string,
    status: OrganizationPackageMarketPolicyError['status'],
  ) {
    super(message)
    this.name = 'OrganizationPackageMarketPolicyError'
    this.code = code
    this.status = status
  }
}

function executor(client?: PoolClient): QueryExecutor {
  return client ?? { query }
}

function channelPolicy(
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  return policy.channels[channel]
}

export function organizationPackageMarketPolicyForPersonalWorkspace() {
  return mergeOrganizationPackageMarketPolicy(defaultOrganizationPackageMarketPolicy)
}

export async function getOrganizationPackageMarketPolicy(
  organizationId: number,
  client?: PoolClient,
): Promise<OrganizationPackageMarketPolicy> {
  const db = executor(client)
  // Keep the feature flag, channel switches, and shared selection on one
  // snapshot so a concurrent policy save cannot produce a mixed response.
  const result = await db.query<PolicyRow>(
    `with channels(channel) as (
       values ('release'::text), ('ci'::text)
     )
     select coalesce(feature.enabled, true) as enabled,
            coalesce(feature.revision, 0) as revision,
            case when feature.config ->> 'showDependencies' = 'false' then false else true end as show_dependencies,
            coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'channel', rule_override.channel,
                  'enabled', rule_override.enabled,
                  'ruleId', rule_override.rule_id
                ) order by rule_override.rule_id, rule_override.channel
              )
                from organization_package_market_rule_overrides rule_override
               where rule_override.organization_id = $1::bigint
            ), '[]'::jsonb) as rule_overrides,
            channels.channel,
            coalesce(channel_policy.enabled, true) as channel_enabled,
            coalesce(channel_policy.mode, 'all') as legacy_channel_mode,
            selection_policy.organization_id is not null as selection_configured,
            coalesce(selection_policy.mode, 'all') as selection_mode,
            coalesce(
              array_agg(distinct selection_rule.rule_id order by selection_rule.rule_id)
                filter (where selection_rule.rule_id is not null),
              '{}'::text[]
            ) as selection_rule_ids,
            coalesce(
              array_agg(distinct legacy_selection.rule_id order by legacy_selection.rule_id)
                filter (where legacy_selection.rule_id is not null),
              '{}'::text[]
            ) as legacy_rule_ids
     from channels
     left join organization_feature_settings feature
       on feature.organization_id = $1::bigint
      and feature.feature_key = 'package_market'
     left join organization_package_market_channel_policies channel_policy
       on channel_policy.organization_id = $1::bigint
      and channel_policy.channel = channels.channel
     left join organization_package_market_selection_policies selection_policy
       on selection_policy.organization_id = $1::bigint
     left join organization_package_market_selection_rules selection_rule
       on selection_rule.organization_id = $1::bigint
     left join organization_package_market_selections legacy_selection
       on legacy_selection.organization_id = $1::bigint
      and legacy_selection.channel = channels.channel
     group by feature.enabled,
              feature.revision,
              feature.config,
              channels.channel,
              channel_policy.enabled,
              channel_policy.mode,
              selection_policy.organization_id,
              selection_policy.mode
     order by channels.channel`,
    [organizationId],
  )

  const channels: Partial<Record<OrganizationPackageMarketChannel, Partial<OrganizationPackageMarketChannelPolicy>>> = {}
  const legacySelections: Partial<Record<
    OrganizationPackageMarketChannel,
    OrganizationPackageMarketSelectionPolicy
  >> = {}
  let selection: OrganizationPackageMarketSelectionPolicy | undefined
  for (const row of result.rows) {
    const channel = normalizeOrganizationPackageMarketChannel(row.channel)
    if (!channel) continue
    channels[channel] = {
      enabled: row.channel_enabled === true,
    }
    legacySelections[channel] = {
      mode: normalizeOrganizationPackageMarketSelectionMode(row.legacy_channel_mode) ?? 'all',
      ruleIds: (Array.isArray(row.legacy_rule_ids) ? row.legacy_rule_ids : [])
        .map((ruleId) => canonicalPackageMarketRuleId(ruleId)),
    }
    if (row.selection_configured) {
      selection = {
        mode: normalizeOrganizationPackageMarketSelectionMode(row.selection_mode) ?? 'all',
        ruleIds: (Array.isArray(row.selection_rule_ids) ? row.selection_rule_ids : [])
          .map((ruleId) => canonicalPackageMarketRuleId(ruleId)),
      }
    }
  }
  const ruleOverrides = normalizeOrganizationPackageMarketRuleOverrides(result.rows[0]?.rule_overrides) ?? []

  return mergeOrganizationPackageMarketPolicy({
    enabled: result.rows[0]?.enabled !== false,
    revision: result.rows[0]?.revision ?? 0,
    channels,
    // A server bootstrapped against a pre-migration database can create the
    // new tables before the operator applies the migration. Derive a safe
    // intersection from legacy rows until the canonical policy row exists.
    ruleOverrides,
    selection: selection ?? mergeLegacyChannelSelections(legacySelections),
    showDependencies: result.rows[0]?.show_dependencies !== false,
  })
}

function mergeLegacyChannelSelections(
  legacySelections: Partial<Record<
    OrganizationPackageMarketChannel,
    OrganizationPackageMarketSelectionPolicy
  >>,
): OrganizationPackageMarketSelectionPolicy {
  const release = legacySelections.release ?? { mode: 'all' as const, ruleIds: [] }
  const ci = legacySelections.ci ?? { mode: 'all' as const, ruleIds: [] }
  const policies = [release, ci]
  const selectedPolicies = policies.filter((policy) => policy.mode === 'selected')

  if (selectedPolicies.length > 0) {
    let ruleIds = [...selectedPolicies[0].ruleIds]
    for (const selected of selectedPolicies.slice(1)) {
      const selectedIds = new Set(selected.ruleIds)
      ruleIds = ruleIds.filter((ruleId) => selectedIds.has(ruleId))
    }
    const excludedIds = new Set(
      policies
        .filter((policy) => policy.mode === 'excluded')
        .flatMap((policy) => policy.ruleIds),
    )
    return { mode: 'selected', ruleIds: ruleIds.filter((ruleId) => !excludedIds.has(ruleId)) }
  }

  const excludedRuleIds = policies
    .filter((policy) => policy.mode === 'excluded')
    .flatMap((policy) => policy.ruleIds)
  return excludedRuleIds.length > 0
    ? { mode: 'excluded', ruleIds: [...new Set(excludedRuleIds)] }
    : { mode: 'all', ruleIds: [] }
}

export function normalizePackageMarketPolicyInput(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (typeof body.featureEnabled !== 'boolean') return null
  const channelsValue = body.channels
  if (!channelsValue || typeof channelsValue !== 'object') return null
  const channels = channelsValue as Record<string, unknown>
  const normalizedChannels: Record<OrganizationPackageMarketChannel, OrganizationPackageMarketChannelPolicy> = {
    release: { enabled: false },
    ci: { enabled: false },
  }
  for (const channel of ['release', 'ci'] as const) {
    const raw = channels[channel]
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    if (typeof record.enabled !== 'boolean') return null
    normalizedChannels[channel] = {
      enabled: record.enabled,
    }
  }
  const selectionValue = body.selection
  if (!selectionValue || typeof selectionValue !== 'object') return null
  const selectionRecord = selectionValue as Record<string, unknown>
  const mode = normalizeOrganizationPackageMarketSelectionMode(selectionRecord.mode)
  const ruleIds = normalizeOrganizationPackageMarketRuleIds(selectionRecord.ruleIds)
  if (!mode || !ruleIds) return null
  const ruleOverrides = normalizeOrganizationPackageMarketRuleOverrides(body.ruleOverrides ?? [])
  if (!ruleOverrides) return null
  if (body.showDependencies != null && typeof body.showDependencies !== 'boolean') return null
  const revision = Number(body.revision)
  if (!Number.isSafeInteger(revision) || revision < 0) return null
  return {
    featureEnabled: body.featureEnabled,
    revision,
    channels: normalizedChannels,
    ruleOverrides,
    selection: {
      mode,
      ruleIds: mode === 'all' ? [] : ruleIds,
    },
    showDependencies: body.showDependencies !== false,
  }
}

export function validatePackageMarketPolicyInput(
  input: ReturnType<typeof normalizePackageMarketPolicyInput>,
  rules: readonly PackageMarketRule[],
) {
  if (!input) {
    throw new OrganizationPackageMarketPolicyError(
      'PACKAGE_MARKET_POLICY_INVALID',
      '安装包市场设置格式无效',
      400,
    )
  }
  const selectableRules = new Map<string, PackageMarketRule>()
  const rulesById = new Map<string, PackageMarketRule>()
  for (const rule of rules) {
    rulesById.set(canonicalPackageMarketRuleId(rule.id), rule)
    if (!rule.category || rule.category === 'dependency') continue
    selectableRules.set(canonicalPackageMarketRuleId(rule.id), rule)
  }
  for (const ruleId of input.selection.ruleIds) {
    const canonicalId = canonicalPackageMarketRuleId(ruleId)
    if (!selectableRules.has(canonicalId)) {
      throw new OrganizationPackageMarketPolicyError(
        'PACKAGE_MARKET_POLICY_INVALID',
        `安装包 ${canonicalId} 不存在或不能单独配置`,
        400,
      )
    }
  }
  for (const override of input.ruleOverrides) {
    const canonicalId = canonicalPackageMarketRuleId(override.ruleId)
    const rule = rulesById.get(canonicalId)
    const dependencyChannel = rule ? packageMarketDependencyChannel(rule) : null
    const supportsOverride = rule && (
      rule.category === 'dependency'
        ? dependencyChannel === override.channel
        : packageMarketRuleSupportsChannel(canonicalId, override.channel)
    )
    if (!supportsOverride) {
      throw new OrganizationPackageMarketPolicyError(
        'PACKAGE_MARKET_POLICY_INVALID',
        `安装包 ${canonicalId} 不支持该渠道配置`,
        400,
      )
    }
  }
  const enabledChannels = (['release', 'ci'] as const).filter((channel) => input.channels[channel].enabled)
  if (input.featureEnabled && enabledChannels.length > 0) {
    const effectivePolicy = mergeOrganizationPackageMarketPolicy({
      enabled: input.featureEnabled,
      channels: input.channels,
      ruleOverrides: input.ruleOverrides,
      selection: input.selection,
      showDependencies: input.showDependencies,
    })
    const hasVisibleRule = [...selectableRules.values()].some((rule) => (
      enabledChannels.some((channel) => isPackageMarketRuleVisible(rule, effectivePolicy, channel))
    ))
    if (!hasVisibleRule) {
      throw new OrganizationPackageMarketPolicyError(
        'PACKAGE_MARKET_POLICY_INVALID',
        '当前已开启的渠道没有可用安装包，请调整可见范围或关闭对应渠道',
        400,
      )
    }
  }
  return input
}

export async function saveOrganizationPackageMarketPolicy(params: {
  client: PoolClient
  organizationId: number
  updatedByUserId: number
  input: NonNullable<ReturnType<typeof normalizePackageMarketPolicyInput>>
}) {
  const current = await getOrganizationPackageMarketPolicy(params.organizationId, params.client)
  ensurePackageMarketRevision(params.input.revision, current)
  const revision = current.revision + 1
  await params.client.query(
    `insert into organization_feature_settings
      (organization_id, feature_key, enabled, config, revision, updated_by_user_id, updated_at)
     values ($1, 'package_market', $2, jsonb_build_object('showDependencies', $3::boolean), $4, $5, now())
     on conflict (organization_id, feature_key) do update
       set enabled = excluded.enabled,
           config = organization_feature_settings.config || excluded.config,
           revision = excluded.revision,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()`,
    [
      params.organizationId,
      params.input.featureEnabled,
      params.input.showDependencies,
      revision,
      params.updatedByUserId,
    ],
  )
  await params.client.query(
    `insert into organization_package_market_selection_policies
      (organization_id, mode, updated_by_user_id, updated_at)
     values ($1, $2, $3, now())
     on conflict (organization_id) do update
       set mode = excluded.mode,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()`,
    [
      params.organizationId,
      params.input.selection.mode,
      params.updatedByUserId,
    ],
  )
  await params.client.query(
    `delete from organization_package_market_selection_rules
     where organization_id = $1`,
    [params.organizationId],
  )
  for (const ruleId of params.input.selection.ruleIds) {
    await params.client.query(
      `insert into organization_package_market_selection_rules
        (organization_id, rule_id)
       values ($1, $2)
       on conflict (organization_id, rule_id) do nothing`,
      [params.organizationId, canonicalPackageMarketRuleId(ruleId)],
    )
  }
  for (const channel of ['release', 'ci'] as const) {
    const channelPolicy = params.input.channels[channel]
    await params.client.query(
      `insert into organization_package_market_channel_policies
        (organization_id, channel, enabled, mode, updated_by_user_id, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (organization_id, channel) do update
         set enabled = excluded.enabled,
             mode = excluded.mode,
             updated_by_user_id = excluded.updated_by_user_id,
             updated_at = now()`,
      [
        params.organizationId,
        channel,
        channelPolicy.enabled,
        params.input.selection.mode,
        params.updatedByUserId,
      ],
    )
    await params.client.query(
      `delete from organization_package_market_selections
       where organization_id = $1 and channel = $2`,
      [params.organizationId, channel],
    )
    for (const ruleId of params.input.selection.ruleIds) {
      const canonicalId = canonicalPackageMarketRuleId(ruleId)
      if (!packageMarketRuleSupportsChannel(canonicalId, channel)) continue
      await params.client.query(
        `insert into organization_package_market_selections
          (organization_id, channel, rule_id)
         values ($1, $2, $3)
         on conflict (organization_id, channel, rule_id) do nothing`,
        [params.organizationId, channel, canonicalId],
      )
    }
  }
  await params.client.query(
    `delete from organization_package_market_rule_overrides
     where organization_id = $1`,
    [params.organizationId],
  )
  for (const override of params.input.ruleOverrides) {
    await params.client.query(
      `insert into organization_package_market_rule_overrides
        (organization_id, rule_id, channel, enabled, created_at)
       values ($1, $2, $3, $4, now())
       on conflict (organization_id, rule_id, channel) do update
         set enabled = excluded.enabled,
             updated_at = now()`,
      [
        params.organizationId,
        canonicalPackageMarketRuleId(override.ruleId),
        override.channel,
        override.enabled,
      ],
    )
  }
  return getOrganizationPackageMarketPolicy(params.organizationId, params.client)
}

export async function getPackageMarketRulesResponse(params: {
  expireMinutes: number
  organizationId: number | null
  policy?: OrganizationPackageMarketPolicy
}) {
  const policy = params.policy ?? (
    params.organizationId == null
      ? organizationPackageMarketPolicyForPersonalWorkspace()
      : await getOrganizationPackageMarketPolicy(params.organizationId)
  )
  const allRules = await listPackageMarketRules()
  const visibleByChannel = {
    release: visiblePackageMarketRuleIds(allRules, policy, 'release'),
    ci: visiblePackageMarketRuleIds(allRules, policy, 'ci'),
  }
  const visibleIds = new Set([...visibleByChannel.release, ...visibleByChannel.ci])
  const rules = allRules.filter((rule) => {
    const canonicalId = canonicalPackageMarketRuleId(rule.id)
    if (rule.category === 'dependency') {
      const parent = canonicalPackageMarketRuleId(rule.parent)
      const dependencyChannel = packageMarketDependencyChannel(rule)
      return Boolean(
        parent &&
        dependencyChannel &&
        visibleIds.has(parent) &&
        isPackageMarketRuleVisible(rule, policy, dependencyChannel),
      )
    }
    return visibleIds.has(canonicalId)
  })
  return {
    expireMinutes: params.expireMinutes,
    organizationId: params.organizationId,
    policy,
    rules,
    visibleRuleIds: visibleByChannel,
  } satisfies PackageMarketRulesResponse
}

export function filterPackageMarketRulesForChannel(
  rules: readonly PackageMarketRule[],
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  return filterPackageMarketRules(rules, policy, channel)
}

export function ensurePackageMarketFeatureEnabled(policy: OrganizationPackageMarketPolicy) {
  if (!policy.enabled) {
    throw new OrganizationPackageMarketPolicyError(
      'ORGANIZATION_FEATURE_DISABLED',
      '当前组织已关闭安装包市场',
      403,
    )
  }
}

export function ensurePackageMarketChannelEnabled(
  policy: OrganizationPackageMarketPolicy,
  channel: OrganizationPackageMarketChannel,
) {
  ensurePackageMarketFeatureEnabled(policy)
  if (!channelPolicy(policy, channel).enabled) {
    throw new OrganizationPackageMarketPolicyError(
      'PACKAGE_MARKET_CHANNEL_DISABLED',
      channel === 'ci' ? '当前组织已关闭测试包渠道' : '当前组织已关闭正式包渠道',
      403,
    )
  }
}

export function ensurePackageMarketRuleAllowed(
  rules: readonly PackageMarketRule[],
  policy: OrganizationPackageMarketPolicy,
  packageId: unknown,
  channel: OrganizationPackageMarketChannel,
) {
  ensurePackageMarketFeatureEnabled(policy)
  const canonicalId = canonicalPackageMarketRuleId(packageId)
  const rule = rules.find((candidate) => (
    canonicalPackageMarketRuleId(candidate.id) === canonicalId
  ))
  if (!rule) {
    throw new OrganizationPackageMarketPolicyError(
      'PACKAGE_MARKET_RULE_NOT_ALLOWED',
      '当前组织未开放该安装包',
      403,
    )
  }

  if (rule.category === 'dependency') {
    const dependencyChannel = packageMarketDependencyChannel(rule)
    const parent = rules.find((candidate) => (
      canonicalPackageMarketRuleId(candidate.id) === canonicalPackageMarketRuleId(rule.parent)
    ))
    if (dependencyChannel !== channel) {
      throw new OrganizationPackageMarketPolicyError(
        'PACKAGE_MARKET_RULE_NOT_ALLOWED',
        '当前组织未开放该安装包',
        403,
      )
    }
    const parentAllowed = parent && isPackageMarketRuleAllowed(
      parent.id,
      rules,
      policy,
      dependencyChannel,
    )
    if (parentAllowed) return
  } else {
    ensurePackageMarketChannelEnabled(policy, channel)
    if (packageMarketRuleSupportsChannel(canonicalId, channel) && isPackageMarketRuleAllowed(packageId, rules, policy, channel)) {
      return
    }
  }
  throw new OrganizationPackageMarketPolicyError(
    'PACKAGE_MARKET_RULE_NOT_ALLOWED',
    '当前组织未开放该安装包',
    403,
  )
}

export function ensurePackageMarketRevision(
  expectedRevision: number,
  currentPolicy: OrganizationPackageMarketPolicy,
) {
  if (expectedRevision !== currentPolicy.revision) {
    throw new OrganizationPackageMarketPolicyError(
      'PACKAGE_MARKET_POLICY_CONFLICT',
      '组织安装包设置已被其他管理员更新，请刷新后重试',
      409,
    )
  }
}
