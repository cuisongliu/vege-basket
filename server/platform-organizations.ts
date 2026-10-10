import type { PoolClient } from 'pg'
import { blindIndex, decryptText, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import { normalizeOrganizationName } from './organization-policy.ts'
import {
  hasVerifiedFeishuIdentity,
  lockPlatformAdministration,
  requirePlatformAdminWithClient,
} from './platform-admins.ts'
import { platformMutationDigest } from './platform-config-store.ts'
import {
  lockOrganizationModuleCatalog,
  lockOrganizationModuleProjects,
} from './project-modules.ts'

export type OrganizationDeletionBlockerGroup = 'configuration' | 'history' | 'membership' | 'resources' | 'workflow'

export type OrganizationDeletionBlockerSample = {
  detail: string
  id: string
  label: string
}

export type OrganizationDeletionBlocker = {
  count: number
  databaseTable: string
  group: OrganizationDeletionBlockerGroup
  groupLabel: string
  instruction: string
  label: string
  remainingCount: number
  samples: OrganizationDeletionBlockerSample[]
  type: string
}

type OrganizationDeletionBlockerDefinition = Omit<OrganizationDeletionBlocker, 'count' | 'remainingCount' | 'samples'>

const organizationDeletionBlockerDefinitions = [
  { type: 'projects', label: '项目', group: 'resources', groupLabel: '业务资源', databaseTable: 'projects', instruction: '前往组织管理 → 项目管理，迁移或逐个删除项目。' },
  { type: 'testSpaces', label: '测试空间', group: 'resources', groupLabel: '业务资源', databaseTable: 'test_spaces', instruction: '前往组织管理 → 测试空间，迁移或逐个删除测试空间。' },
  { type: 'members', label: '额外成员关系', group: 'membership', groupLabel: '成员关系', databaseTable: 'organization_memberships', instruction: '前往组织管理 → 成员，移除除唯一所有者外的成员；已移除关系当前不支持通过界面清理。' },
  { type: 'invitations', label: '组织邀请记录', group: 'membership', groupLabel: '成员关系', databaseTable: 'organization_invitations', instruction: '当前版本不支持通过界面清理历史组织邀请记录。' },
  { type: 'inviteLinks', label: '组织邀请链接', group: 'membership', groupLabel: '成员关系', databaseTable: 'organization_invite_links', instruction: '当前版本不支持通过界面清理历史邀请链接。' },
  { type: 'projectModules', label: '项目模块', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_project_modules', instruction: '前往组织管理 → 组织设置 → 项目模块，删除未被待办引用的模块。' },
  { type: 'testEnvironments', label: '测试环境', group: 'configuration', groupLabel: '组织配置', databaseTable: 'test_environments', instruction: '前往组织管理 → 测试空间 → 测试环境，逐个删除环境。' },
  { type: 'featureSettings', label: '功能设置', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_feature_settings', instruction: '当前版本不支持单独清理组织功能设置。' },
  { type: 'packageChannelPolicies', label: '安装包渠道策略', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_package_market_channel_policies', instruction: '当前版本不支持单独清理安装包渠道策略。' },
  { type: 'packageSelections', label: '安装包渠道选择', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_package_market_selections', instruction: '在组织安装包市场设置中取消选择；兼容记录无法通过界面单独清理。' },
  { type: 'packageSelectionPolicies', label: '安装包选择策略', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_package_market_selection_policies', instruction: '当前版本不支持单独清理安装包选择策略。' },
  { type: 'packageSelectionRules', label: '安装包选择规则', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_package_market_selection_rules', instruction: '在组织安装包市场设置中取消选择；兼容记录无法通过界面单独清理。' },
  { type: 'packageRuleOverrides', label: '安装包规则覆盖', group: 'configuration', groupLabel: '组织配置', databaseTable: 'organization_package_market_rule_overrides', instruction: '在组织安装包市场设置中恢复继承；兼容记录无法通过界面单独清理。' },
  { type: 'projectTransfers', label: '项目所有权转移记录', group: 'workflow', groupLabel: '流程记录', databaseTable: 'project_transfer_requests', instruction: '先处理或删除对应项目；转移历史会随项目删除。' },
  { type: 'testSpaceTransfers', label: '测试空间所有权转移记录', group: 'workflow', groupLabel: '流程记录', databaseTable: 'test_space_transfer_requests', instruction: '先处理或删除对应测试空间；转移历史会随测试空间删除。' },
  { type: 'weeklyReports', label: '周报', group: 'history', groupLabel: '历史数据', databaseTable: 'organization_weekly_reports', instruction: '周报作者可在周报工作台删除自己的周报；其他历史周报当前不支持由平台管理员清理。' },
  { type: 'weeklySummaries', label: '周报汇总', group: 'history', groupLabel: '历史数据', databaseTable: 'organization_weekly_summaries', instruction: '当前版本不支持通过界面清理周报汇总。' },
  { type: 'weeklyReminders', label: '周报提醒记录', group: 'history', groupLabel: '历史数据', databaseTable: 'organization_weekly_report_reminders', instruction: '当前版本不支持通过界面清理周报提醒记录。' },
  { type: 'offboardingTransfers', label: '离职交接记录', group: 'history', groupLabel: '历史数据', databaseTable: 'account_offboarding_asset_transfers', instruction: '当前版本不支持通过界面清理离职交接历史。' },
] as const satisfies readonly OrganizationDeletionBlockerDefinition[]

const organizationDeletionBlockerDefinitionByType = new Map<string, OrganizationDeletionBlockerDefinition>(
  organizationDeletionBlockerDefinitions.map((definition) => [definition.type, definition]),
)

function blockerDefinition(type: string): OrganizationDeletionBlockerDefinition {
  return organizationDeletionBlockerDefinitionByType.get(type) ?? {
    type,
    label: '未分类关联数据',
    group: 'history',
    groupLabel: '其他数据',
    databaseTable: 'unknown',
    instruction: '当前版本尚未分类这项数据，请联系维护人员确认后再删除组织。',
  }
}

export class PlatformOrganizationError extends Error {
  readonly blockers?: OrganizationDeletionBlocker[]
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 409, blockers?: OrganizationDeletionBlocker[]) {
    super(message)
    this.name = 'PlatformOrganizationError'
    this.blockers = blockers
    this.code = code
    this.status = status
  }
}

type OrganizationDeletionBlockerCount = { blocker_type: string; count: string }

async function organizationBlockerCounts(client: PoolClient, organizationId: number, ownerUserId: number) {
  const result = await client.query<OrganizationDeletionBlockerCount>(
    `select blocker_type, count(*)::text as count
       from (
         select 'members' as blocker_type from organization_memberships
          where organization_id = $1
            and not (user_id = $2 and access_role = 'owner' and status = 'active')
         union all select 'projects' from projects where organization_id = $1
         union all select 'testSpaces' from test_spaces where organization_id = $1
         union all select 'invitations' from organization_invitations where organization_id = $1
         union all select 'inviteLinks' from organization_invite_links where organization_id = $1
         union all select 'weeklyReports' from organization_weekly_reports where organization_id = $1
         union all select 'weeklySummaries' from organization_weekly_summaries where organization_id = $1
         union all select 'weeklyReminders' from organization_weekly_report_reminders where organization_id = $1
         union all select 'projectModules' from organization_project_modules where organization_id = $1
         union all select 'testEnvironments' from test_environments where organization_id = $1
         union all select 'featureSettings' from organization_feature_settings where organization_id = $1
         union all select 'packageChannelPolicies' from organization_package_market_channel_policies where organization_id = $1
         union all select 'packageSelections' from organization_package_market_selections where organization_id = $1
         union all select 'packageSelectionPolicies' from organization_package_market_selection_policies where organization_id = $1
         union all select 'packageSelectionRules' from organization_package_market_selection_rules where organization_id = $1
         union all select 'packageRuleOverrides' from organization_package_market_rule_overrides where organization_id = $1
         union all select 'projectTransfers' from project_transfer_requests where organization_id = $1
         union all select 'testSpaceTransfers' from test_space_transfer_requests where organization_id = $1
         union all select 'offboardingTransfers' from account_offboarding_asset_transfers where organization_id = $1
       ) blockers
      group by blocker_type
      order by blocker_type`,
    [organizationId, ownerUserId],
  )
  return result.rows.map((row) => ({ count: Number(row.count), type: row.blocker_type }))
}

function displayDeletionSampleName(displayName: string | null, email: string | null) {
  return String(displayName || email || '未知用户')
}

function deletionSampleDate(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : ''
}

async function organizationBlockerSamples(
  client: PoolClient,
  organizationId: number,
  type: string,
) {
  switch (type) {
    case 'members': {
      const result = await client.query<{ access_role: string; display_name: string | null; email: string; status: string; user_id: string }>(
        `select membership.user_id, membership.access_role, membership.status, user.display_name, user.email
           from organization_memberships membership
           join users user on user.id = membership.user_id
          where membership.organization_id = $1
            and not (membership.user_id = (select owner_user_id from organizations where id = $1)
                     and membership.access_role = 'owner' and membership.status = 'active')
          order by membership.status, membership.access_role, membership.user_id
          limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({
        detail: `${row.access_role === 'owner' ? '所有者' : row.access_role === 'admin' ? '管理员' : '成员'} · ${row.status === 'active' ? '有效' : '已移除'}`,
        id: row.user_id,
        label: displayDeletionSampleName(row.display_name, row.email),
      }))
    }
    case 'projects': {
      const result = await client.query<{ id: string; name: string; status: string }>(
        `select id, name, status from projects where organization_id = $1 order by updated_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `状态：${row.status}`, id: row.id, label: decryptText(row.name) }))
    }
    case 'testSpaces': {
      const result = await client.query<{ id: string; name: string; version_label: string | null }>(
        `select id, name, version_label from test_spaces where organization_id = $1 order by updated_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: row.version_label ? `版本：${decryptText(row.version_label)}` : '未设置版本', id: row.id, label: decryptText(row.name) }))
    }
    case 'invitations': {
      const result = await client.query<{ created_at: Date; id: string; status: string; target_email: string }>(
        `select id, target_email, status, created_at from organization_invitations where organization_id = $1 order by created_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.status} · ${deletionSampleDate(row.created_at)}`, id: row.id, label: decryptText(row.target_email) }))
    }
    case 'inviteLinks': {
      const result = await client.query<{ created_at: Date; expires_at: Date; id: string; revoked_at: Date | null }>(
        `select id, created_at, expires_at, revoked_at from organization_invite_links where organization_id = $1 order by created_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.revoked_at ? '已撤销' : '有效或已过期'} · ${deletionSampleDate(row.created_at)}`, id: row.id, label: `邀请链接 #${row.id}` }))
    }
    case 'projectModules': {
      const result = await client.query<{ enabled: boolean; id: string; name: string }>(
        `select id, name, enabled from organization_project_modules where organization_id = $1 order by updated_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: row.enabled ? '启用' : '已停用', id: row.id, label: decryptText(row.name) }))
    }
    case 'testEnvironments': {
      const result = await client.query<{ id: string; name: string }>(
        `select id, name from test_environments where organization_id = $1 order by updated_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: '组织共享环境', id: row.id, label: decryptText(row.name) }))
    }
    case 'featureSettings': {
      const result = await client.query<{ feature_key: string; revision: number }>(
        `select feature_key, revision from organization_feature_settings where organization_id = $1 order by feature_key limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `配置版本：${row.revision}`, id: row.feature_key, label: row.feature_key }))
    }
    case 'packageChannelPolicies': {
      const result = await client.query<{ channel: string; enabled: boolean; mode: string }>(
        `select channel, enabled, mode from organization_package_market_channel_policies where organization_id = $1 order by channel limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.enabled ? '启用' : '停用'} · ${row.mode}`, id: row.channel, label: `安装包渠道：${row.channel}` }))
    }
    case 'packageSelections': {
      const result = await client.query<{ channel: string; rule_id: string }>(
        `select channel, rule_id from organization_package_market_selections where organization_id = $1 order by channel, rule_id limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `渠道：${row.channel}`, id: `${row.channel}:${row.rule_id}`, label: row.rule_id }))
    }
    case 'packageSelectionPolicies': {
      const result = await client.query<{ mode: string }>(
        `select mode from organization_package_market_selection_policies where organization_id = $1 limit 1`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `模式：${row.mode}`, id: organizationId.toString(), label: '组织安装包选择范围' }))
    }
    case 'packageSelectionRules': {
      const result = await client.query<{ rule_id: string }>(
        `select rule_id from organization_package_market_selection_rules where organization_id = $1 order by rule_id limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: '组织选择规则', id: row.rule_id, label: row.rule_id }))
    }
    case 'packageRuleOverrides': {
      const result = await client.query<{ channel: string; enabled: boolean; rule_id: string }>(
        `select rule_id, channel, enabled from organization_package_market_rule_overrides where organization_id = $1 order by rule_id, channel limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.channel} · ${row.enabled ? '启用' : '停用'}`, id: `${row.rule_id}:${row.channel}`, label: row.rule_id }))
    }
    case 'projectTransfers': {
      const result = await client.query<{ id: string; project_name: string; status: string }>(
        `select transfer.id, transfer.status, project.name as project_name
           from project_transfer_requests transfer join projects project on project.id = transfer.project_id
          where transfer.organization_id = $1 order by transfer.created_at desc, transfer.id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `转移状态：${row.status}`, id: row.id, label: decryptText(row.project_name) }))
    }
    case 'testSpaceTransfers': {
      const result = await client.query<{ id: string; space_name: string; status: string }>(
        `select transfer.id, transfer.status, space.name as space_name
           from test_space_transfer_requests transfer join test_spaces space on space.id = transfer.test_space_id
          where transfer.organization_id = $1 order by transfer.created_at desc, transfer.id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `转移状态：${row.status}`, id: row.id, label: decryptText(row.space_name) }))
    }
    case 'weeklyReports': {
      const result = await client.query<{ id: string; report_profile: string | null; status: string; user_display_name: string | null; user_email: string; week_start: Date | string }>(
        `select report.id, report.week_start, report.status, report.report_profile, user.display_name as user_display_name, user.email as user_email
           from organization_weekly_reports report join users user on user.id = report.user_id
          where report.organization_id = $1 order by report.week_start desc, report.id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.status}${row.report_profile ? ` · ${row.report_profile}` : ''} · ${String(row.week_start)}`, id: row.id, label: displayDeletionSampleName(row.user_display_name, row.user_email) }))
    }
    case 'weeklySummaries': {
      const result = await client.query<{ id: string; stale: boolean; week_start: Date | string }>(
        `select id, week_start, stale from organization_weekly_summaries where organization_id = $1 order by week_start desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.stale ? '已过期' : '当前'} · ${String(row.week_start)}`, id: row.id, label: `周报汇总 ${String(row.week_start)}` }))
    }
    case 'weeklyReminders': {
      const result = await client.query<{ id: string; reminder_day: Date | string; status: string; target_display_name: string | null; target_email: string }>(
        `select reminder.id, reminder.reminder_day, reminder.status, target.display_name as target_display_name, target.email as target_email
           from organization_weekly_report_reminders reminder join users target on target.id = reminder.target_user_id
          where reminder.organization_id = $1 order by reminder.created_at desc, reminder.id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.status} · ${String(row.reminder_day)}`, id: row.id, label: displayDeletionSampleName(row.target_display_name, row.target_email) }))
    }
    case 'offboardingTransfers': {
      const result = await client.query<{ asset_id: string; asset_type: string; id: string; action: string; created_at: Date }>(
        `select id, asset_type, asset_id, action, created_at from account_offboarding_asset_transfers where organization_id = $1 order by created_at desc, id desc limit 10`,
        [organizationId],
      )
      return result.rows.map((row) => ({ detail: `${row.asset_type} · ${row.action} · ${deletionSampleDate(row.created_at)}`, id: row.id, label: `资产 #${row.asset_id}` }))
    }
    default:
      return []
  }
}

async function organizationBlockers(
  client: PoolClient,
  organizationId: number,
  ownerUserId: number,
  includeSamples = false,
) {
  const counts = await organizationBlockerCounts(client, organizationId, ownerUserId)
  return Promise.all(counts.map(async ({ count, type }) => {
    const definition = blockerDefinition(type)
    const samples = includeSamples ? await organizationBlockerSamples(client, organizationId, type) : []
    return {
      ...definition,
      count,
      remainingCount: Math.max(0, count - samples.length),
      samples,
    }
  }))
}

async function organizationCounts(organizationId: number) {
  const result = await query<{
    member_count: string
    project_count: string
    test_space_count: string
  }>(
    `select
       (select count(*) from organization_memberships where organization_id = $1)::text as member_count,
       (select count(*) from projects where organization_id = $1)::text as project_count,
       (select count(*) from test_spaces where organization_id = $1)::text as test_space_count`,
    [organizationId],
  )
  return {
    memberCount: Number(result.rows[0]?.member_count ?? 0),
    projectCount: Number(result.rows[0]?.project_count ?? 0),
    testSpaceCount: Number(result.rows[0]?.test_space_count ?? 0),
  }
}

export async function checkPlatformOrganizationDeletion(organizationId: number, includeSamples = true) {
  const client = await pool.connect()
  try {
    await client.query('begin read only')
    const organization = await client.query<{
      id: string
      name: string
      owner_user_id: string
    }>(
      `select id, name, owner_user_id from organizations where id = $1`,
      [organizationId],
    )
    const row = organization.rows[0]
    if (!row) throw new PlatformOrganizationError('ORGANIZATION_NOT_FOUND', '组织不存在。', 404)
    const blockers = await organizationBlockers(client, organizationId, Number(row.owner_user_id), includeSamples)
    await client.query('commit')
    return {
      blockers,
      canDelete: blockers.length === 0,
      checkedAt: new Date().toISOString(),
      id: organizationId,
      name: decryptText(row.name),
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function listPlatformOrganizations(input: {
  page: number
  pageSize: number
  search: string
}) {
  const result = await query<{
    id: string
    name: string
    owner_display_name: string
    owner_email: string
    owner_user_id: string
  }>(
    `select organization.id, organization.name, organization.owner_user_id,
            owner.email as owner_email, owner.display_name as owner_display_name
       from organizations organization
       join users owner on owner.id = organization.owner_user_id
      order by organization.id desc`,
  )
  const search = input.search.trim().toLocaleLowerCase('zh-CN')
  const matching = result.rows.filter((row) => {
    if (!search) return true
    return decryptText(row.name).toLocaleLowerCase('zh-CN').includes(search) ||
      (row.owner_display_name || row.owner_email).toLocaleLowerCase('zh-CN').includes(search)
  })
  const start = (input.page - 1) * input.pageSize
  const selected = matching.slice(start, start + input.pageSize)
  const organizations = await Promise.all(selected.map(async (row) => {
    const id = Number(row.id)
    const [deletion, counts] = await Promise.all([
      checkPlatformOrganizationDeletion(id, false),
      organizationCounts(id),
    ])
    return {
      ...counts,
      blockers: deletion.blockers,
      canDelete: deletion.canDelete,
      checkedAt: deletion.checkedAt,
      id,
      name: decryptText(row.name),
      owner: {
        displayName: row.owner_display_name || row.owner_email,
        id: Number(row.owner_user_id),
        username: row.owner_email,
      },
    }
  }))
  return { organizations, page: input.page, pageSize: input.pageSize, total: matching.length }
}

export async function createPlatformOrganization(input: {
  actorUserId: number
  name: unknown
  ownerUserId: number
  requestId: string
}) {
  const name = normalizeOrganizationName(input.name)
  if (!name) throw new PlatformOrganizationError('ORGANIZATION_NAME_INVALID', '请输入有效的组织名称。', 400)
  const digest = platformMutationDigest({ name, ownerUserId: input.ownerUserId })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    const organizationAdmin = await client.query<{ allowed: boolean }>(
      `select exists(
         select 1 from user_roles
          where user_id = $1 and role = 'organization_admin'
       ) as allowed`,
      [input.actorUserId],
    )
    if (!organizationAdmin.rows[0]?.allowed) {
      throw new PlatformOrganizationError('ORGANIZATION_ADMIN_REQUIRED', '只有组织管理员可以创建组织。', 403)
    }
    const receipt = await client.query<{ request_digest: string; result_encrypted: string }>(
      `select request_digest, result_encrypted
         from platform_organization_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_digest !== digest) {
        throw new PlatformOrganizationError('REQUEST_ID_CONFLICT', '该请求编号已用于其他组织操作。')
      }
      await client.query('commit')
      return JSON.parse(decryptText(receipt.rows[0].result_encrypted)) as { id: number; name: string }
    }
    const owner = await client.query<{
      account_status: string
      feishu_identity_verified_at: Date | null
      feishu_user_id: string
      is_builtin_admin: boolean
      registration_source: 'builtin' | 'feishu' | 'legacy_unknown'
    }>(
      `select account_status, feishu_user_id, feishu_identity_verified_at, is_builtin_admin, registration_source
         from users where id = $1 for update`,
      [input.ownerUserId],
    )
    const ownerRow = owner.rows[0]
    if (!ownerRow || ownerRow.account_status !== 'active' || (!ownerRow.is_builtin_admin &&
      !hasVerifiedFeishuIdentity({
        feishuUserId: ownerRow.feishu_user_id,
        registrationSource: ownerRow.registration_source,
        verifiedAt: ownerRow.feishu_identity_verified_at,
      }))) throw new PlatformOrganizationError('ORGANIZATION_OWNER_INELIGIBLE', '所有者必须是有效的飞书用户或内置 admin。')
    const created = await client.query<{ id: string }>(
      `insert into organizations (owner_user_id, name, name_lookup, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [input.ownerUserId, encryptText(name), blindIndex(name), input.actorUserId],
    )
    const organizationId = Number(created.rows[0].id)
    await client.query(
      `insert into user_roles (user_id, role) values ($1, 'organization_admin')
       on conflict (user_id, role) do nothing`,
      [input.ownerUserId],
    )
    await client.query(
      `insert into platform_user_permission_versions (user_id, revision, updated_at)
       values ($1, 1, now())
       on conflict (user_id) do update
         set revision = platform_user_permission_versions.revision + 1, updated_at = now()`,
      [input.ownerUserId],
    )
    await client.query(
      `insert into organization_memberships
        (organization_id, user_id, access_role, status, weekly_report_required, invited_by_user_id)
       values ($1, $2, 'owner', 'active', false, $3)`,
      [organizationId, input.ownerUserId, input.actorUserId],
    )
    await client.query(
      `insert into organization_audit_events
        (organization_id, original_organization_id, organization_name_snapshot,
         actor_user_id, action, subject_type, subject_id, detail)
       values ($1, $1, $2, $3, 'organization.created', 'organization', $1::text, $2)`,
      [organizationId, encryptText(name), input.actorUserId],
    )
    const result = { id: organizationId, name }
    await client.query(
      `insert into platform_organization_mutation_receipts
        (actor_user_id, request_id, action, organization_id, request_digest, result_encrypted)
       values ($1, $2::uuid, 'create', $3, $4, $5)`,
      [input.actorUserId, input.requestId, organizationId, digest, encryptText(JSON.stringify(result))],
    )
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    if (!(error instanceof PlatformOrganizationError) &&
      error && typeof error === 'object' && 'code' in error && String(error.code) === '23505') {
      throw new PlatformOrganizationError('ORGANIZATION_NAME_CONFLICT', '组织名称已存在。', 409)
    }
    throw error
  } finally {
    client.release()
  }
}

export async function deletePlatformOrganization(input: {
  actorUserId: number
  confirmationName: unknown
  organizationId: number
  requestId: string
}) {
  const confirmationName = normalizeOrganizationName(input.confirmationName)
  const digest = platformMutationDigest({ confirmationName, organizationId: input.organizationId })
  const client = await pool.connect()
  try {
    await client.query('begin')
    await lockPlatformAdministration(client)
    await requirePlatformAdminWithClient(client, input.actorUserId)
    const receipt = await client.query<{ request_digest: string; result_encrypted: string }>(
      `select request_digest, result_encrypted
         from platform_organization_mutation_receipts
        where actor_user_id = $1 and request_id = $2::uuid for update`,
      [input.actorUserId, input.requestId],
    )
    if (receipt.rows[0]) {
      if (receipt.rows[0].request_digest !== digest) {
        throw new PlatformOrganizationError('REQUEST_ID_CONFLICT', '该请求编号已用于其他组织操作。')
      }
      await client.query('commit')
      return JSON.parse(decryptText(receipt.rows[0].result_encrypted)) as { deleted: true; id: number }
    }
    await lockOrganizationModuleCatalog(client, input.organizationId)
    await lockOrganizationModuleProjects(client, input.organizationId)
    const organization = await client.query<{ name: string; owner_user_id: string }>(
      `select name, owner_user_id from organizations where id = $1 for update`,
      [input.organizationId],
    )
    const row = organization.rows[0]
    if (!row) throw new PlatformOrganizationError('ORGANIZATION_NOT_FOUND', '组织不存在。', 404)
    const name = decryptText(row.name)
    if (confirmationName !== name) {
      throw new PlatformOrganizationError('ORGANIZATION_CONFIRMATION_MISMATCH', '请输入完整组织名称确认删除。', 400)
    }
    const blockers = await organizationBlockers(client, input.organizationId, Number(row.owner_user_id))
    if (blockers.length > 0) {
      throw new PlatformOrganizationError('ORGANIZATION_NOT_EMPTY', '组织仍有数据，不能删除。', 409, blockers)
    }
    const result = { deleted: true as const, id: input.organizationId }
    await client.query(
      `insert into platform_organization_mutation_receipts
        (actor_user_id, request_id, action, organization_id, request_digest, result_encrypted)
       values ($1, $2::uuid, 'delete', $3, $4, $5)`,
      [input.actorUserId, input.requestId, input.organizationId, digest, encryptText(JSON.stringify(result))],
    )
    await client.query(
      `insert into organization_audit_events
        (organization_id, original_organization_id, organization_name_snapshot,
         actor_user_id, action, subject_type, subject_id, detail)
       values ($1, $1, $2, $3, 'organization.deleted', 'organization', $1::text, '')`,
      [input.organizationId, row.name, input.actorUserId],
    )
    await client.query(
      `delete from organization_memberships
        where organization_id = $1 and user_id = $2
          and access_role = 'owner' and status = 'active'`,
      [input.organizationId, Number(row.owner_user_id)],
    )
    await client.query('delete from organizations where id = $1', [input.organizationId])
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
