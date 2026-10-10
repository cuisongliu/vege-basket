import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  normalizeLedgerDate,
  normalizeLedgerPort,
  validateLedgerWritePayload,
} from '../shared/project-ledger.ts'

const routeSource = readFileSync(new URL('./project-ledger.ts', import.meta.url), 'utf8')
const schemaSource = readFileSync(new URL('./project-ledger-schema.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(new URL('./migrations/20261010_project_ledgers.sql', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const maintainerPanelSource = readFileSync(new URL('../src/components/project-ledger-maintainers-panel.tsx', import.meta.url), 'utf8')

function payload() {
  return {
    expectedVersion: 1,
    descriptionMarkdown: '# 简介',
    installationVersion: 'v1.2.3',
    clusters: [{
      id: '11111111-1111-4111-8111-111111111111',
      name: '生产集群',
      environmentType: 'production',
      region: 'cn-shanghai',
      accessAddress: 'https://console.example.com',
      accessAccountMarkdown: '账号：ops-user\n凭据库：https://vault.example.com/item/1',
      status: 'active',
      notes: '',
      diagrams: [],
      applications: [{ id: '22222222-2222-4222-8222-222222222222', name: 'API', version: '1.0.0', updatedAt: '2026-10-10', notes: '' }],
      licenses: [{ id: '33333333-3333-4333-8333-333333333333', applicationId: '22222222-2222-4222-8222-222222222222', product: 'Enterprise', expiresOn: '2027-10-10', reminderDays: 30, renewalOwnerUserId: null, notes: '' }],
      vpn: { contentKind: 'document_link', content: 'https://docs.example.com/vpn' },
      machines: [{ id: '44444444-4444-4444-8444-444444444444', hostName: 'node-1', machineType: 'physical', use: 'worker', cpu: '32C', gpu: '', memory: '128 GB', disksMarkdown: '', operatingSystem: 'Ubuntu', kernel: '6.8', architecture: 'amd64', raidCard: '', networkCards: '', sshMarkdown: '账号：ops-user', internalAddress: '10.0.0.1', externalAddress: '', instanceId: '', notes: '' }],
      networkMappings: [{ id: '55555555-5555-4555-8555-555555555555', networkName: 'API', ip: '10.0.0.1', port: 443, accessAddress: 'https://api.example.com', accessScope: 'organization', purpose: 'API access' }],
    }],
  }
}

test('ledger dates and network ports reject invalid boundary values', () => {
  assert.equal(normalizeLedgerDate('2026-02-28'), '2026-02-28')
  assert.equal(normalizeLedgerDate('2026-02-30'), null)
  assert.equal(normalizeLedgerDate('10/10/2026'), null)
  assert.equal(normalizeLedgerPort(1), 1)
  assert.equal(normalizeLedgerPort(65535), 65535)
  for (const value of [0, 65536, 1.5, 'not-a-port']) assert.equal(normalizeLedgerPort(value), null)
})

test('ledger payload validates cluster-scoped applications, VPN links and secret-like text', () => {
  assert.equal(validateLedgerWritePayload(payload()), null)
  const httpVpn = structuredClone(payload())
  httpVpn.clusters[0].vpn.content = 'http://docs.example.com/vpn'
  assert.match(validateLedgerWritePayload(httpVpn) ?? '', /HTTPS/u)
  const secret = structuredClone(payload())
  secret.clusters[0].machines[0].sshMarkdown = 'password=plain-text'
  assert.match(validateLedgerWritePayload(secret) ?? '', /敏感内容/u)
  const crossCluster = structuredClone(payload())
  crossCluster.clusters.push({ ...structuredClone(crossCluster.clusters[0]), id: '66666666-6666-4666-8666-666666666666', name: '灾备集群', applications: [] })
  crossCluster.clusters[1].licenses[0].id = '77777777-7777-4777-8777-777777777777'
  crossCluster.clusters[1].machines[0].id = '88888888-8888-4888-8888-888888888888'
  crossCluster.clusters[1].networkMappings[0].id = '99999999-9999-4999-8999-999999999999'
  assert.equal(validateLedgerWritePayload(crossCluster), null)
  assert.match(routeSource, /License 关联应用必须属于同一集群/u)
})

test('ledger HTTP authorization requires developer persona plus project and organization membership', () => {
  assert.match(routeSource, /session\.activeRole !== 'developer'/u)
  assert.match(routeSource, /LEDGER_DEVELOPER_REQUIRED/u)
  assert.match(routeSource, /join organization_memberships organization_member/u)
  assert.match(routeSource, /organization_member\.status = 'active'/u)
  assert.match(routeSource, /project\.user_id = \$2 or exists/u)
  assert.match(routeSource, /project_member\.status = 'active'/u)
  assert.match(routeSource, /access\?\.canEdit/u)
  assert.match(routeSource, /project_ledger_maintainers maintainer/u)
})

test('maintainer configuration requires organization governance and eligible project members', () => {
  assert.match(routeSource, /role\.role = 'organization_admin'/u)
  assert.match(routeSource, /membership\.access_role in \('owner', 'admin'\)/u)
  assert.match(routeSource, /role\.role in \('developer','organization_admin'\)/u)
  assert.match(routeSource, /只能配置当前组织内已加入项目的有效开发成员/u)
  assert.match(maintainerPanelSource, /ProjectLedgerMaintainersPanel/u)
  assert.match(maintainerPanelSource, /搜索项目开发成员/u)
  assert.match(maintainerPanelSource, /reconcileAction/u)
  assert.match(maintainerPanelSource, /ConfirmActionDialog/u)
  assert.match(maintainerPanelSource, /核对保存结果/u)
})

test('ledger schema encrypts sensitive text, scopes child rows and revokes stale grants', () => {
  for (const table of ['project_ledgers', 'project_ledger_maintainers', 'project_ledger_clusters', 'project_ledger_applications', 'project_ledger_licenses', 'project_ledger_vpn_profiles', 'project_ledger_machines', 'project_ledger_network_mappings', 'project_ledger_diagrams']) {
    assert.match(schemaSource, new RegExp(`create table if not exists ${table}`, 'u'))
    assert.match(migrationSource, new RegExp(`create table if not exists ${table}`, 'u'))
  }
  assert.match(schemaSource, /foreign key \(cluster_id, project_id, organization_id\)/u)
  assert.match(schemaSource, /description_markdown_encrypted/u)
  assert.match(schemaSource, /object_key_encrypted/u)
  assert.match(schemaSource, /project_ledger_project_membership_revoked/u)
  assert.match(schemaSource, /project_ledger_organization_membership_revoked/u)
  assert.match(schemaSource, /project_ledger_user_membership_revoked/u)
  assert.match(schemaSource, /project_ledger_organization_changed/u)
  assert.doesNotMatch(routeSource, /objectKey:\s*text\(/u)
  assert.match(routeSource, /const lockedAccess = await getProjectLedgerAccess\(projectId, session\.userId, client\)/u)
  assert.match(routeSource, /await deleteOssObject\(objectKey\)\.catch/u)
  assert.match(routeSource, /returning object_key_encrypted/u)
  assert.match(routeSource, /join organization_memberships organization_member/u)
})

test('project UI exposes ledger only for developer persona and organization projects', () => {
  assert.match(appSource, /authUser\?\.activeRole === 'developer' && selectedProject\?\.organizationId != null/u)
  assert.match(appSource, /canViewProjectLedger \? <button/u)
  assert.match(appSource, /projectDetailTab === 'ledger' && !canViewProjectLedger/u)
  assert.match(appSource, /<ProjectLedger projectId=\{project\.id\}/u)
})
