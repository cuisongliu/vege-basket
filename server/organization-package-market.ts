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
  normalizeOrganizationPackageMarketSelectionMode,
  packageMarketDependencyChannel,
  packageMarketRuleSupportsChannel,
  visiblePackageMarketRuleIds,
  type OrganizationPackageMarketChannel,
  type OrganizationPackageMarketChannelPolicy,
  type OrganizationPackageMarketPolicy,
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
  channel_mode: string
  rule_ids: string[]
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
  // Keep the feature flag, channel switches, and selections on one database
  // snapshot so a concurrent policy save cannot produce a mixed response.
  const result = await db.query<PolicyRow>(
    `with channels(channel) as (
       values ('release'::text), ('ci'::text)
     )
     select coalesce(feature.enabled, true) as enabled,
            coalesce(feature.revision, 0) as revision,
            channels.channel,
            coalesce(channel_policy.enabled, true) as channel_enabled,
            coalesce(channel_policy.mode, 'all') as channel_mode,
            coalesce(
              array_agg(selection.rule_id order by selection.rule_id)
                filter (where selection.rule_id is not null),
              '{}'::text[]
            ) as rule_ids
     from channels
     left join organization_feature_settings feature
       on feature.organization_id = $1::bigint
      and feature.feature_key = 'package_market'
     left join organization_package_market_channel_policies channel_policy
       on channel_policy.organization_id = $1::bigint
      and channel_policy.channel = channels.channel
     left join organization_package_market_selections selection
       on selection.organization_id = $1::bigint
      and selection.channel = channels.channel
     group by feature.enabled,
              feature.revision,
              channels.channel,
              channel_policy.enabled,
              channel_policy.mode
     order by channels.channel`,
    [organizationId],
  )

  const channels: Partial<Record<OrganizationPackageMarketChannel, Partial<OrganizationPackageMarketChannelPolicy>>> = {}
  for (const row of result.rows) {
    const channel = normalizeOrganizationPackageMarketChannel(row.channel)
    if (!channel) continue
    channels[channel] = {
      enabled: row.channel_enabled === true,
      mode: normalizeOrganizationPackageMarketSelectionMode(row.channel_mode) ?? 'all',
      ruleIds: (Array.isArray(row.rule_ids) ? row.rule_ids : [])
        .map((ruleId) => canonicalPackageMarketRuleId(ruleId)),
    }
  }

  return mergeOrganizationPackageMarketPolicy({
    enabled: result.rows[0]?.enabled !== false,
    revision: result.rows[0]?.revision ?? 0,
    channels,
  })
}

export function normalizePackageMarketPolicyInput(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (typeof body.featureEnabled !== 'boolean') return null
  const channelsValue = body.channels
  if (!channelsValue || typeof channelsValue !== 'object') return null
  const channels = channelsValue as Record<string, unknown>
  const normalizedChannels: Record<OrganizationPackageMarketChannel, OrganizationPackageMarketChannelPolicy> = {
    release: { enabled: false, mode: 'all', ruleIds: [] },
    ci: { enabled: false, mode: 'all', ruleIds: [] },
  }
  for (const channel of ['release', 'ci'] as const) {
    const raw = channels[channel]
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    if (typeof record.enabled !== 'boolean') return null
    const mode = normalizeOrganizationPackageMarketSelectionMode(record.mode)
    const ruleIds = normalizeOrganizationPackageMarketRuleIds(record.ruleIds)
    if (!mode || !ruleIds) return null
    normalizedChannels[channel] = {
      enabled: record.enabled,
      mode,
      ruleIds,
    }
  }
  const revision = Number(body.revision)
  if (!Number.isSafeInteger(revision) || revision < 0) return null
  return {
    featureEnabled: body.featureEnabled,
    revision,
    channels: normalizedChannels,
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
  for (const rule of rules) {
    if (!rule.category || rule.category === 'dependency') continue
    selectableRules.set(canonicalPackageMarketRuleId(rule.id), rule)
  }
  for (const channel of ['release', 'ci'] as const) {
    const channelPolicy = input.channels[channel]
    for (const ruleId of channelPolicy.ruleIds) {
      const canonicalId = canonicalPackageMarketRuleId(ruleId)
      const rule = selectableRules.get(canonicalId)
      if (!rule || !packageMarketRuleSupportsChannel(canonicalId, channel)) {
        throw new OrganizationPackageMarketPolicyError(
          'PACKAGE_MARKET_POLICY_INVALID',
          `安装包 ${canonicalId} 不存在或不支持${channel === 'ci' ? '测试包' : '正式包'}渠道`,
          400,
        )
      }
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
     values ($1, 'package_market', $2, '{}'::jsonb, $3, $4, now())
     on conflict (organization_id, feature_key) do update
       set enabled = excluded.enabled,
           revision = excluded.revision,
           updated_by_user_id = excluded.updated_by_user_id,
           updated_at = now()`,
    [params.organizationId, params.input.featureEnabled, revision, params.updatedByUserId],
  )
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
      [params.organizationId, channel, channelPolicy.enabled, channelPolicy.mode, params.updatedByUserId],
    )
    await params.client.query(
      `delete from organization_package_market_selections
       where organization_id = $1 and channel = $2`,
      [params.organizationId, channel],
    )
    for (const ruleId of channelPolicy.ruleIds) {
      await params.client.query(
        `insert into organization_package_market_selections
          (organization_id, channel, rule_id)
         values ($1, $2, $3)
         on conflict (organization_id, channel, rule_id) do nothing`,
        [params.organizationId, channel, canonicalPackageMarketRuleId(ruleId)],
      )
    }
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
