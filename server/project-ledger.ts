import crypto from 'node:crypto'
import express, { Router } from 'express'
import type { PoolClient } from 'pg'
import { blindIndex, decryptText, encryptText } from './crypto.ts'
import { pool, query } from './db.ts'
import { deleteOssObject, getOssObject, putOssObject } from './package-market.ts'
import { getPlatformConfigSnapshot } from './platform-config-runtime.ts'
import { markPlatformStorageUsed } from './platform-config-store.ts'
import { lockProjectMutation } from './project-lock.ts'
import { lockOrganizationModuleCatalog } from './project-modules.ts'
import { getAuthenticatedRoleSession } from './roles.ts'
import {
  isUuid,
  normalizeLedgerDate,
  normalizeLedgerPort,
  normalizeLedgerText,
  validateLedgerWritePayload,
  type ProjectLedger,
  type ProjectLedgerCluster,
  type ProjectLedgerMaintainerConfiguration,
  type ProjectLedgerWritePayload,
} from '../shared/project-ledger.ts'

type LedgerSession = { activeRole: string; userId: number }
type LedgerError = Error & { status?: number }
type LedgerClient = { query: typeof query }
type LedgerChildRow = Record<string, unknown> & { cluster_id: string }

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}

function positiveId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

async function transaction<T>(handler: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await handler(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function requireLedgerSession(request: express.Request, response: express.Response) {
  const session = await getAuthenticatedRoleSession(request) as LedgerSession | null
  if (!session) {
    response.status(401).json({ error: 'Unauthorized' })
    return null
  }
  if (session.activeRole !== 'developer') {
    response.status(403).json({
      code: 'LEDGER_DEVELOPER_REQUIRED',
      error: '项目台账仅对开发身份开放',
    })
    return null
  }
  return session
}

async function getProjectLedgerAccess(
  projectId: number,
  userId: number,
  client: LedgerClient = { query },
) {
  const result = await client.query<{ can_edit: boolean; organization_id: string }>(
    `select project.organization_id,
       exists(select 1 from project_ledger_maintainers maintainer
         where maintainer.project_id = project.id and maintainer.user_id = $2) as can_edit
     from projects project
     join organization_memberships organization_member
       on organization_member.organization_id = project.organization_id
      and organization_member.user_id = $2
      and organization_member.status = 'active'
     where project.id = $1 and project.organization_id is not null
       and (project.user_id = $2 or exists(
         select 1 from project_memberships project_member
         where project_member.project_id = project.id
           and project_member.invited_user_id = $2
           and project_member.status = 'active'
       ))`,
    [projectId, userId],
  )
  const row = result.rows[0]
  return row ? { canEdit: row.can_edit, organizationId: Number(row.organization_id) } : null
}

async function lockLedgerProject(client: PoolClient, projectId: number) {
  const before = await client.query<{ organization_id: string | null }>(
    'select organization_id from projects where id = $1',
    [projectId],
  )
  const organizationId = before.rows[0]?.organization_id
  if (!organizationId) fail('组织项目不存在', 404)
  await lockOrganizationModuleCatalog(client, Number(organizationId))
  await lockProjectMutation(client, projectId)
  const after = await client.query<{ organization_id: string | null }>(
    'select organization_id from projects where id = $1 for update',
    [projectId],
  )
  if (!after.rows[0] || after.rows[0].organization_id !== organizationId) {
    fail('项目所属组织已变化，请刷新后重试', 409)
  }
  return Number(organizationId)
}

async function isOrganizationProjectManager(
  client: LedgerClient,
  organizationId: number,
  userId: number,
) {
  const result = await client.query(
    `select membership.user_id
     from organization_memberships membership
     join user_roles role on role.user_id = membership.user_id
       and role.role = 'organization_admin'
     where membership.organization_id = $1 and membership.user_id = $2
       and membership.status = 'active' and membership.access_role in ('owner', 'admin')
     for share of membership, role`,
    [organizationId, userId],
  )
  return Boolean(result.rows[0])
}

function grouped<T extends { cluster_id: string }>(rows: T[]) {
  const result = new Map<string, T[]>()
  for (const row of rows) result.set(row.cluster_id, [...(result.get(row.cluster_id) ?? []), row])
  return result
}

async function readLedger(
  client: LedgerClient,
  projectId: number,
  canEdit: boolean,
): Promise<ProjectLedger | null> {
  const project = await client.query<{ organization_id: string }>(
    'select organization_id from projects where id = $1 and organization_id is not null',
    [projectId],
  )
  if (!project.rows[0]) return null
  const renewalOwnersResult = await client.query<{ id: string; name: string }>(
    `select account.id, coalesce(nullif(account.display_name, ''), account.email) as name
     from organization_memberships membership
     join users account on account.id = membership.user_id and account.account_status = 'active'
     where membership.organization_id = $1 and membership.status = 'active'
     order by name, account.id`,
    [project.rows[0].organization_id],
  )
  const renewalOwners = renewalOwnersResult.rows.map((row) => ({ id: Number(row.id), name: row.name }))
  const ledger = (await client.query<{
    description_markdown_encrypted: string
    installation_version_encrypted: string
    last_updated_by_name: string | null
    updated_at: Date
    version: number
  }>(
    `select ledger.description_markdown_encrypted, ledger.installation_version_encrypted,
       ledger.updated_at, ledger.version,
       coalesce(nullif(account.display_name, ''), account.email) as last_updated_by_name
     from project_ledgers ledger
     left join users account on account.id = ledger.last_updated_by_user_id
     where ledger.project_id = $1`,
    [projectId],
  )).rows[0]
  const clusters = await client.query<{
    access_account_markdown_encrypted: string
    access_address_encrypted: string
    environment_type_encrypted: string
    id: string
    name_encrypted: string
    notes_encrypted: string
    region_encrypted: string
    status: 'active' | 'retired'
  }>(
    `select id, name_encrypted, environment_type_encrypted, region_encrypted,
       access_address_encrypted, access_account_markdown_encrypted, status, notes_encrypted
     from project_ledger_clusters where project_id = $1 order by name_lookup, id`,
    [projectId],
  )
  const clusterIds = clusters.rows.map((cluster) => cluster.id)
  if (!clusterIds.length) {
    return {
      canEdit,
      clusters: [],
      descriptionMarkdown: ledger ? decryptText(ledger.description_markdown_encrypted) : '',
      installationVersion: ledger ? decryptText(ledger.installation_version_encrypted) : '',
      lastUpdatedByName: ledger?.last_updated_by_name ?? null,
      projectId,
      renewalOwners,
      updatedAt: ledger?.updated_at.toISOString() ?? null,
      version: ledger?.version ?? 1,
    }
  }
  const [applications, licenses, vpns, machines, mappings, diagrams] = await Promise.all([
    client.query<LedgerChildRow>(`select * from project_ledger_applications where project_id = $1 and cluster_id = any($2::uuid[]) order by name_lookup, id`, [projectId, clusterIds]),
    client.query<LedgerChildRow>(`select * from project_ledger_licenses where project_id = $1 and cluster_id = any($2::uuid[]) order by expires_on nulls last, id`, [projectId, clusterIds]),
    client.query<LedgerChildRow>(`select * from project_ledger_vpn_profiles where project_id = $1 and cluster_id = any($2::uuid[])`, [projectId, clusterIds]),
    client.query<LedgerChildRow>(`select * from project_ledger_machines where project_id = $1 and cluster_id = any($2::uuid[]) order by host_name_lookup, id`, [projectId, clusterIds]),
    client.query<LedgerChildRow>(`select * from project_ledger_network_mappings where project_id = $1 and cluster_id = any($2::uuid[]) order by id`, [projectId, clusterIds]),
    client.query<LedgerChildRow>(`select diagram.*, coalesce(nullif(account.display_name, ''), account.email, '未知用户') as uploaded_by_name from project_ledger_diagrams diagram left join users account on account.id = diagram.uploaded_by_user_id where diagram.project_id = $1 and diagram.cluster_id = any($2::uuid[]) order by diagram.is_primary desc, diagram.uploaded_at desc`, [projectId, clusterIds]),
  ])
  const applicationRows = grouped(applications.rows)
  const licenseRows = grouped(licenses.rows)
  const machineRows = grouped(machines.rows)
  const mappingRows = grouped(mappings.rows)
  const diagramRows = grouped(diagrams.rows)
  const vpnRows = new Map(vpns.rows.map((row) => [row.cluster_id, row]))
  const text = (row: Record<string, unknown>, key: string) => decryptText(String(row[key] ?? ''))
  return {
    canEdit,
    clusters: clusters.rows.map((cluster) => {
      const vpn = vpnRows.get(cluster.id)
      return {
        accessAccountMarkdown: decryptText(cluster.access_account_markdown_encrypted),
        accessAddress: decryptText(cluster.access_address_encrypted),
        applications: (applicationRows.get(cluster.id) ?? []).map((row) => ({
          id: String(row.id), name: text(row, 'name_encrypted'), notes: text(row, 'notes_encrypted'),
          updatedAt: row.updated_on ? String(row.updated_on).slice(0, 10) : '',
          version: text(row, 'version_encrypted'),
        })),
        diagrams: (diagramRows.get(cluster.id) ?? []).map((row) => ({
          contentType: String(row.content_type), description: text(row, 'description_encrypted'),
          fileName: text(row, 'file_name_encrypted'), id: String(row.id),
          size: Number(row.size_bytes),
          uploadedAt: new Date(String(row.uploaded_at)).toISOString(), uploadedByName: String(row.uploaded_by_name),
        })),
        environmentType: decryptText(cluster.environment_type_encrypted),
        id: cluster.id,
        licenses: (licenseRows.get(cluster.id) ?? []).map((row) => ({
          applicationId: row.application_id ? String(row.application_id) : null, expiresOn: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
          id: String(row.id), notes: text(row, 'notes_encrypted'), product: text(row, 'product_encrypted'),
          reminderDays: Number(row.reminder_days),
          renewalOwnerUserId: row.renewal_owner_user_id ? Number(row.renewal_owner_user_id) : null,
        })),
        machines: (machineRows.get(cluster.id) ?? []).map((row) => ({
          architecture: text(row, 'architecture_encrypted'), cpu: text(row, 'cpu_encrypted'),
          disksMarkdown: text(row, 'disks_markdown_encrypted'), externalAddress: text(row, 'external_address_encrypted'),
          gpu: text(row, 'gpu_encrypted'), hostName: text(row, 'host_name_encrypted'), id: String(row.id),
          instanceId: text(row, 'instance_id_encrypted'), internalAddress: text(row, 'internal_address_encrypted'),
          kernel: text(row, 'kernel_encrypted'), machineType: text(row, 'machine_type_encrypted'),
          memory: text(row, 'memory_encrypted'), networkCards: text(row, 'network_cards_encrypted'),
          notes: text(row, 'notes_encrypted'), operatingSystem: text(row, 'operating_system_encrypted'),
          raidCard: text(row, 'raid_card_encrypted'), sshMarkdown: text(row, 'ssh_markdown_encrypted'),
          use: text(row, 'use_encrypted'),
        })),
        name: decryptText(cluster.name_encrypted),
        networkMappings: (mappingRows.get(cluster.id) ?? []).map((row) => ({
          accessAddress: text(row, 'access_address_encrypted'), accessScope: text(row, 'access_scope_encrypted'),
          id: String(row.id), ip: text(row, 'ip_encrypted'), networkName: text(row, 'network_name_encrypted'),
          port: row.port == null ? null : Number(row.port), purpose: text(row, 'purpose_encrypted'),
        })),
        notes: decryptText(cluster.notes_encrypted),
        region: decryptText(cluster.region_encrypted), status: cluster.status,
        vpn: vpn ? { content: text(vpn, 'content_encrypted'), contentKind: String(vpn.content_kind) as 'document_link' | 'markdown' } : null,
      }
    }),
    descriptionMarkdown: ledger ? decryptText(ledger.description_markdown_encrypted) : '',
    installationVersion: ledger ? decryptText(ledger.installation_version_encrypted) : '',
    lastUpdatedByName: ledger?.last_updated_by_name ?? null,
    projectId,
    renewalOwners,
    updatedAt: ledger?.updated_at.toISOString() ?? null,
    version: ledger?.version ?? 1,
  }
}

async function replaceLedger(
  client: PoolClient,
  projectId: number,
  userId: number,
  payload: ProjectLedgerWritePayload,
) {
  const organizationId = await lockLedgerProject(client, projectId)
  const access = await getProjectLedgerAccess(projectId, userId, client)
  if (!access?.canEdit || access.organizationId !== organizationId) fail('当前账号不是该项目的台账维护人', 403)
  const current = await client.query<{ version: number }>(
    'select version from project_ledgers where project_id = $1 for update',
    [projectId],
  )
  const currentVersion = Number(current.rows[0]?.version ?? 1)
  if (currentVersion !== payload.expectedVersion) fail('台账已被其他维护人修改，请重新加载后保存', 409)
  const clusters = payload.clusters as ProjectLedgerCluster[]
  const retainedClusterIds = clusters.map((cluster) => cluster.id)
  const removedDiagrams = await client.query<{ object_key_encrypted: string }>(
    'select object_key_encrypted from project_ledger_diagrams where project_id = $1 and not (cluster_id = any($2::uuid[]))',
    [projectId, retainedClusterIds],
  )
  const renewalOwners = [...new Set(clusters.flatMap((cluster) => cluster.licenses
    .map((license) => license.renewalOwnerUserId)
    .filter((id): id is number => id != null)))]
  if (renewalOwners.length) {
    const valid = await client.query(
      `select membership.user_id from organization_memberships membership
       join users account on account.id = membership.user_id and account.account_status = 'active'
       where membership.organization_id = $1 and membership.status = 'active'
         and membership.user_id = any($2::bigint[]) for share of membership, account`,
      [organizationId, renewalOwners],
    )
    if (valid.rows.length !== renewalOwners.length) fail('License 续期负责人必须是当前组织有效成员')
  }
  for (const cluster of clusters) {
    const applicationIds = new Set(cluster.applications.map((application) => application.id))
    if (cluster.vpn?.contentKind === 'document_link' && !/^https:\/\//iu.test(cluster.vpn.content.trim())) {
      fail('VPN 文档链接必须使用 HTTPS')
    }
    for (const license of cluster.licenses) {
      if (license.applicationId && !applicationIds.has(license.applicationId)) fail('License 关联应用必须属于同一集群')
      if (!Number.isInteger(license.reminderDays) || license.reminderDays < 0 || license.reminderDays > 3650) fail('License 提醒天数无效')
      if (license.expiresOn && !normalizeLedgerDate(license.expiresOn)) fail('License 到期日无效')
    }
    for (const mapping of cluster.networkMappings) {
      if (mapping.port != null && normalizeLedgerPort(mapping.port) == null) fail('网络映射端口无效')
    }
  }
  await client.query(
    `insert into project_ledgers
       (project_id, organization_id, description_markdown_encrypted, installation_version_encrypted,
        last_updated_by_user_id, version)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (project_id) do update set
       description_markdown_encrypted=excluded.description_markdown_encrypted,
       installation_version_encrypted=excluded.installation_version_encrypted,
       last_updated_by_user_id=excluded.last_updated_by_user_id,
       version=excluded.version, updated_at=now()`,
    [projectId, organizationId, encryptText(normalizeLedgerText(payload.descriptionMarkdown)),
      encryptText(normalizeLedgerText(payload.installationVersion, 200)), userId, currentVersion + 1],
  )
  await client.query('delete from project_ledger_licenses where project_id = $1', [projectId])
  await client.query('delete from project_ledger_vpn_profiles where project_id = $1', [projectId])
  await client.query('delete from project_ledger_machines where project_id = $1', [projectId])
  await client.query('delete from project_ledger_network_mappings where project_id = $1', [projectId])
  await client.query('delete from project_ledger_applications where project_id = $1', [projectId])
  await client.query(
    'delete from project_ledger_clusters where project_id = $1 and not (id = any($2::uuid[]))',
    [projectId, clusters.map((cluster) => cluster.id)],
  )
  for (const cluster of clusters) {
    const savedCluster = await client.query(
      `insert into project_ledger_clusters
       (id,project_id,organization_id,name_encrypted,name_lookup,environment_type_encrypted,
        region_encrypted,access_address_encrypted,access_account_markdown_encrypted,status,notes_encrypted)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set name_encrypted=excluded.name_encrypted,
        name_lookup=excluded.name_lookup, environment_type_encrypted=excluded.environment_type_encrypted,
        region_encrypted=excluded.region_encrypted, access_address_encrypted=excluded.access_address_encrypted,
        access_account_markdown_encrypted=excluded.access_account_markdown_encrypted,
        status=excluded.status, notes_encrypted=excluded.notes_encrypted
       where project_ledger_clusters.project_id=excluded.project_id
         and project_ledger_clusters.organization_id=excluded.organization_id
       returning id`,
      [cluster.id, projectId, organizationId, encryptText(normalizeLedgerText(cluster.name, 120)),
        blindIndex(cluster.name), encryptText(normalizeLedgerText(cluster.environmentType, 120)),
        encryptText(normalizeLedgerText(cluster.region, 120)), encryptText(normalizeLedgerText(cluster.accessAddress, 500)),
        encryptText(normalizeLedgerText(cluster.accessAccountMarkdown)), cluster.status,
        encryptText(normalizeLedgerText(cluster.notes))],
    )
    if (!savedCluster.rows[0]) fail('集群不属于当前项目', 409)
    for (const app of cluster.applications) {
      await client.query(
        `insert into project_ledger_applications
         (id,cluster_id,project_id,organization_id,name_encrypted,name_lookup,version_encrypted,updated_on,notes_encrypted)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [app.id, cluster.id, projectId, organizationId, encryptText(normalizeLedgerText(app.name, 160)),
          blindIndex(app.name), encryptText(normalizeLedgerText(app.version, 160)), normalizeLedgerDate(app.updatedAt),
          encryptText(normalizeLedgerText(app.notes))],
      )
    }
    if (cluster.vpn) {
      await client.query(
        `insert into project_ledger_vpn_profiles
         (cluster_id,project_id,organization_id,content_kind,content_encrypted) values ($1,$2,$3,$4,$5)`,
        [cluster.id, projectId, organizationId, cluster.vpn.contentKind,
          encryptText(normalizeLedgerText(cluster.vpn.content))],
      )
    }
    for (const license of cluster.licenses) {
      await client.query(
        `insert into project_ledger_licenses
         (id,cluster_id,project_id,organization_id,application_id,product_encrypted,expires_on,
          reminder_days,renewal_owner_user_id,notes_encrypted)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [license.id, cluster.id, projectId, organizationId, license.applicationId,
          encryptText(normalizeLedgerText(license.product, 200)), normalizeLedgerDate(license.expiresOn),
          license.reminderDays, license.renewalOwnerUserId, encryptText(normalizeLedgerText(license.notes))],
      )
    }
    for (const machine of cluster.machines) {
      await client.query(
        `insert into project_ledger_machines
         (id,cluster_id,project_id,organization_id,host_name_encrypted,host_name_lookup,machine_type_encrypted,
          use_encrypted,cpu_encrypted,gpu_encrypted,memory_encrypted,disks_markdown_encrypted,
          operating_system_encrypted,kernel_encrypted,architecture_encrypted,raid_card_encrypted,
          network_cards_encrypted,ssh_markdown_encrypted,internal_address_encrypted,external_address_encrypted,
          instance_id_encrypted,notes_encrypted)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [machine.id, cluster.id, projectId, organizationId, encryptText(normalizeLedgerText(machine.hostName, 160)),
          blindIndex(machine.hostName), encryptText(normalizeLedgerText(machine.machineType, 120)),
          encryptText(normalizeLedgerText(machine.use, 200)), encryptText(normalizeLedgerText(machine.cpu, 200)),
          encryptText(normalizeLedgerText(machine.gpu, 200)), encryptText(normalizeLedgerText(machine.memory, 120)),
          encryptText(normalizeLedgerText(machine.disksMarkdown)), encryptText(normalizeLedgerText(machine.operatingSystem, 160)),
          encryptText(normalizeLedgerText(machine.kernel, 160)), encryptText(normalizeLedgerText(machine.architecture, 80)),
          encryptText(normalizeLedgerText(machine.raidCard, 160)), encryptText(normalizeLedgerText(machine.networkCards)),
          encryptText(normalizeLedgerText(machine.sshMarkdown)), encryptText(normalizeLedgerText(machine.internalAddress, 500)),
          encryptText(normalizeLedgerText(machine.externalAddress, 500)), encryptText(normalizeLedgerText(machine.instanceId, 200)),
          encryptText(normalizeLedgerText(machine.notes))],
      )
    }
    for (const mapping of cluster.networkMappings) {
      await client.query(
        `insert into project_ledger_network_mappings
         (id,cluster_id,project_id,organization_id,network_name_encrypted,ip_encrypted,port,
          access_address_encrypted,access_scope_encrypted,purpose_encrypted)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [mapping.id, cluster.id, projectId, organizationId, encryptText(normalizeLedgerText(mapping.networkName, 160)),
          encryptText(normalizeLedgerText(mapping.ip, 200)), normalizeLedgerPort(mapping.port),
          encryptText(normalizeLedgerText(mapping.accessAddress, 500)), encryptText(normalizeLedgerText(mapping.accessScope, 200)),
          encryptText(normalizeLedgerText(mapping.purpose, 500))],
      )
    }
  }
  await client.query(
    `insert into organization_audit_events
       (organization_id,actor_user_id,action,subject_type,subject_id,detail)
     values ($1,$2,'project_ledger.updated','project',$3,$4)`,
    [organizationId, userId, String(projectId),
      encryptText(JSON.stringify({ clusterCount: clusters.length, version: currentVersion + 1 }))],
  )
  return removedDiagrams.rows.map((row) => decryptText(row.object_key_encrypted))
}

function parseMaintainers(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) return null
  const ids = value.map(Number)
  return ids.every((id) => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length
    ? ids.sort((left, right) => left - right)
    : null
}

async function maintainerConfiguration(organizationId: number, projectId: number): Promise<ProjectLedgerMaintainerConfiguration> {
  const [members, candidates] = await Promise.all([
    query<{ id: string; name: string }>(
      `select account.id, coalesce(nullif(account.display_name, ''), account.email) as name
       from project_ledger_maintainers maintainer join users account on account.id = maintainer.user_id
       where maintainer.project_id = $1 order by account.id`, [projectId],
    ),
    query<{ id: string; name: string; project_member: boolean; username: string }>(
      `select account.id, coalesce(nullif(account.display_name, ''), account.email) as name,
         account.email as username,
         (project.user_id = account.id or exists(select 1 from project_memberships project_member
           where project_member.project_id = project.id and project_member.invited_user_id = account.id
             and project_member.status = 'active')) as project_member
       from organization_memberships membership
       join users account on account.id = membership.user_id and account.account_status = 'active'
       join projects project on project.id = $2 and project.organization_id = membership.organization_id
       where membership.organization_id = $1 and membership.status = 'active'
         and exists(select 1 from user_roles role where role.user_id = account.id
           and role.role in ('developer', 'organization_admin')) order by account.id`,
      [organizationId, projectId],
    ),
  ])
  return {
    candidates: candidates.rows.map((row) => ({
      id: Number(row.id), name: row.name, projectMember: row.project_member, username: row.username,
    })),
    members: members.rows.map((row) => ({ name: row.name, userId: Number(row.id) })),
  }
}

function normalizeImageContentType(value: unknown) {
  const contentType = String(value ?? '').split(';')[0].trim().toLowerCase()
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType) ? contentType : ''
}

function ledgerObjectKey(projectId: number, userId: number, contentType: string) {
  const prefix = getPlatformConfigSnapshot().config.storage.objectPrefix.replace(/\/+$/u, '')
  const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.slice('image/'.length)
  return `${prefix}/project-ledgers/project-${projectId}/user-${userId}/${crypto.randomUUID()}.${extension}`
}

function isLedgerObjectKey(objectKey: string, projectId: number) {
  const prefix = getPlatformConfigSnapshot().config.storage.objectPrefix.replace(/\/+$/u, '')
  return objectKey.startsWith(`${prefix}/project-ledgers/project-${projectId}/`)
    && !objectKey.includes('..') && objectKey.length <= 512
}

function safeDiagramFileName(value: unknown) {
  let decoded = '架构图'
  try { decoded = decodeURIComponent(String(value ?? decoded)) } catch { fail('图片文件名无效') }
  const fileName = Array.from(decoded)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127 && character !== '/' && character !== '\\'
    })
    .join('')
    .trim()
    .slice(0, 200)
  return fileName || '架构图'
}

export function createProjectLedgerRouter() {
  const router = Router()
  router.get('/projects/:projectId/ledger', async (request, response, next) => {
    try {
      const session = await requireLedgerSession(request, response)
      const projectId = positiveId(request.params.projectId)
      if (!session || !projectId) return
      const access = await getProjectLedgerAccess(projectId, session.userId)
      if (!access) return response.status(404).json({ error: 'Project ledger not found' })
      response.json(await readLedger({ query }, projectId, access.canEdit))
    } catch (error) { next(error) }
  })
  router.put('/projects/:projectId/ledger', async (request, response, next) => {
    try {
      const session = await requireLedgerSession(request, response)
      const projectId = positiveId(request.params.projectId)
      if (!session || !projectId) return
      const error = validateLedgerWritePayload(request.body)
      if (error) return response.status(400).json({ error })
      const removedObjects = await transaction((client) => replaceLedger(client, projectId, session.userId, request.body as ProjectLedgerWritePayload))
      await Promise.allSettled(removedObjects.filter((objectKey) => isLedgerObjectKey(objectKey, projectId)).map((objectKey) => deleteOssObject(objectKey)))
      response.json(await readLedger({ query }, projectId, true))
    } catch (error) { next(error) }
  })
  router.get('/organizations/:organizationId/projects/:projectId/ledger-maintainers', async (request, response, next) => {
    try {
      const session = await getAuthenticatedRoleSession(request) as LedgerSession | null
      const organizationId = positiveId(request.params.organizationId)
      const projectId = positiveId(request.params.projectId)
      if (!session || !organizationId || !projectId) return response.status(session ? 400 : 401).json({ error: session ? 'Valid organization and project are required' : 'Unauthorized' })
      if (!await isOrganizationProjectManager({ query }, organizationId, session.userId)) return response.status(403).json({ error: 'Organization project manager access is required' })
      const project = await query('select id from projects where id=$1 and organization_id=$2', [projectId, organizationId])
      if (!project.rows[0]) return response.status(404).json({ error: 'Organization project not found' })
      response.json(await maintainerConfiguration(organizationId, projectId))
    } catch (error) { next(error) }
  })
  router.put('/organizations/:organizationId/projects/:projectId/ledger-maintainers', async (request, response, next) => {
    try {
      const session = await getAuthenticatedRoleSession(request) as LedgerSession | null
      const organizationId = positiveId(request.params.organizationId)
      const projectId = positiveId(request.params.projectId)
      const members = parseMaintainers(request.body?.members)
      const expected = parseMaintainers(request.body?.expectedMembers)
      if (!session || !organizationId || !projectId || !members || !expected) return response.status(session ? 400 : 401).json({ error: session ? '成员配置无效' : 'Unauthorized' })
      await transaction(async (client) => {
        if (await lockLedgerProject(client, projectId) !== organizationId) fail('项目所属组织已变化', 409)
        if (!await isOrganizationProjectManager(client, organizationId, session.userId)) fail('组织项目管理权限已变化', 403)
        const before = await client.query<{ user_id: string }>('select user_id from project_ledger_maintainers where project_id=$1 order by user_id', [projectId])
        const beforeIds = before.rows.map((row) => Number(row.user_id))
        if (JSON.stringify(beforeIds) !== JSON.stringify(expected)) fail('台账维护人已被其他管理员修改，请重新加载配置', 409)
        const selected = members.length ? await client.query(
          `select membership.user_id from organization_memberships membership
           join users account on account.id=membership.user_id and account.account_status='active'
           where membership.organization_id=$1 and membership.status='active'
             and membership.user_id=any($2::bigint[])
             and exists(select 1 from user_roles role where role.user_id=membership.user_id
               and role.role in ('developer','organization_admin'))
             and exists(select 1 from projects project where project.id=$3 and
               (project.user_id=membership.user_id or exists(select 1 from project_memberships project_member
                 where project_member.project_id=project.id and project_member.invited_user_id=membership.user_id
                   and project_member.status='active')))
           for share of membership, account`, [organizationId, members, projectId],
        ) : { rows: [] }
        if (selected.rows.length !== members.length) fail('只能配置当前组织内已加入项目的有效开发成员')
        await client.query('delete from project_ledger_maintainers where project_id=$1', [projectId])
        for (const memberId of members) await client.query(
          'insert into project_ledger_maintainers (project_id,organization_id,user_id,configured_by_user_id) values ($1,$2,$3,$4)',
          [projectId, organizationId, memberId, session.userId],
        )
        await client.query(
          `insert into organization_audit_events
           (organization_id,actor_user_id,action,subject_type,subject_id,detail)
           values ($1,$2,'project_ledger.maintainers_updated','project',$3,$4)`,
          [organizationId, session.userId, String(projectId), encryptText(JSON.stringify({ after: members, before: beforeIds }))],
        )
      })
      response.json(await maintainerConfiguration(organizationId, projectId))
    } catch (error) { next(error) }
  })
  router.post('/projects/:projectId/ledger/clusters/:clusterId/diagrams', (request, response, next) => {
    express.raw({ limit: getPlatformConfigSnapshot().config.storage.uploadMaxBytes, type: ['image/*'] })(request, response, next)
  }, async (request, response, next) => {
    try {
      const session = await requireLedgerSession(request, response)
      const projectId = positiveId(request.params.projectId)
      const clusterId = String(request.params.clusterId)
      if (!session || !projectId || !isUuid(clusterId)) return
      const access = await getProjectLedgerAccess(projectId, session.userId)
      if (!access?.canEdit) return response.status(403).json({ error: '当前账号不是该项目的台账维护人' })
      const contentType = normalizeImageContentType(request.headers['content-type'])
      if (!contentType || !Buffer.isBuffer(request.body) || !request.body.length) return response.status(415).json({ error: '仅支持非空 PNG、JPEG、WebP 或 GIF 图片' })
      const objectKey = ledgerObjectKey(projectId, session.userId, contentType)
      await markPlatformStorageUsed(getPlatformConfigSnapshot().revision)
      await putOssObject(objectKey, request.body, contentType)
      const fileName = safeDiagramFileName(request.headers['x-file-name'])
      let inserted: { id: string; uploaded_at: Date }
      try {
        inserted = await transaction(async (client) => {
          const organizationId = await lockLedgerProject(client, projectId)
          const lockedAccess = await getProjectLedgerAccess(projectId, session.userId, client)
          if (!lockedAccess?.canEdit || lockedAccess.organizationId !== organizationId) fail('当前账号不是该项目的台账维护人', 403)
          const result = await client.query<{ id: string; uploaded_at: Date }>(
            `insert into project_ledger_diagrams
             (cluster_id,project_id,organization_id,object_key_encrypted,file_name_encrypted,content_type,size_bytes,uploaded_by_user_id)
             select cluster.id,cluster.project_id,cluster.organization_id,$3,$4,$5,$6,$7
             from project_ledger_clusters cluster
             where cluster.project_id=$1 and cluster.id=$2 returning id,uploaded_at`,
            [projectId, clusterId, encryptText(objectKey), encryptText(fileName), contentType, request.body.length, session.userId],
          )
          if (!result.rows[0]) fail('集群不存在', 404)
          return result.rows[0]
        })
      } catch (error) {
        await deleteOssObject(objectKey).catch(() => undefined)
        throw error
      }
      response.status(201).json({ contentType, fileName, id: inserted.id, size: request.body.length, uploadedAt: inserted.uploaded_at.toISOString() })
    } catch (error) { next(error) }
  })
  router.get('/projects/:projectId/ledger/diagrams/:diagramId/content', async (request, response, next) => {
    try {
      const session = await requireLedgerSession(request, response)
      const projectId = positiveId(request.params.projectId)
      const diagramId = String(request.params.diagramId)
      if (!session || !projectId || !isUuid(diagramId)) return
      const diagram = await query<{ content_type: string; object_key_encrypted: string }>(
        `select diagram.content_type,diagram.object_key_encrypted
         from project_ledger_diagrams diagram
         join projects project on project.id=diagram.project_id and project.organization_id=diagram.organization_id
         join organization_memberships organization_member
           on organization_member.organization_id=project.organization_id
          and organization_member.user_id=$3 and organization_member.status='active'
         where diagram.id=$1 and diagram.project_id=$2
           and (project.user_id=$3 or exists(select 1 from project_memberships project_member
             where project_member.project_id=project.id and project_member.invited_user_id=$3
               and project_member.status='active'))`,
        [diagramId, projectId, session.userId],
      )
      const objectKey = diagram.rows[0] ? decryptText(diagram.rows[0].object_key_encrypted) : ''
      if (!diagram.rows[0] || !isLedgerObjectKey(objectKey, projectId)) return response.status(404).json({ error: 'Diagram not found' })
      const result = await getOssObject(objectKey)
      response.setHeader('Cache-Control', 'private, max-age=3600')
      response.setHeader('Content-Type', diagram.rows[0].content_type)
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.send(result.content)
    } catch (error) { next(error) }
  })
  router.delete('/projects/:projectId/ledger/diagrams/:diagramId', async (request, response, next) => {
    try {
      const session = await requireLedgerSession(request, response)
      const projectId = positiveId(request.params.projectId)
      const diagramId = String(request.params.diagramId)
      if (!session || !projectId || !isUuid(diagramId)) return
      const objectKey = await transaction(async (client) => {
        const organizationId = await lockLedgerProject(client, projectId)
        const access = await getProjectLedgerAccess(projectId, session.userId, client)
        if (!access?.canEdit || access.organizationId !== organizationId) fail('当前账号不是该项目的台账维护人', 403)
        const deleted = await client.query<{ object_key_encrypted: string }>(
          'delete from project_ledger_diagrams where id=$1 and project_id=$2 returning object_key_encrypted',
          [diagramId, projectId],
        )
        return deleted.rows[0] ? decryptText(deleted.rows[0].object_key_encrypted) : null
      })
      if (objectKey && isLedgerObjectKey(objectKey, projectId)) await deleteOssObject(objectKey).catch(() => undefined)
      response.json(await readLedger({ query }, projectId, true))
    } catch (error) { next(error) }
  })
  router.use((error: LedgerError, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) return next(error)
    response.status(error.status && error.status >= 400 ? error.status : 500).json({ error: error.message || 'Project ledger request failed' })
  })
  return router
}
