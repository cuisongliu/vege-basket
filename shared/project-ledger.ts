export type ProjectLedgerVpn = {
  content: string
  contentKind: 'document_link' | 'markdown'
}

export type ProjectLedgerApplication = {
  id: string
  name: string
  notes: string
  updatedAt: string
  version: string
}

export type ProjectLedgerLicense = {
  applicationId: string | null
  expiresOn: string | null
  id: string
  notes: string
  product: string
  renewalOwnerUserId: number | null
  reminderDays: number
}

export type ProjectLedgerMachine = {
  architecture: string
  cpu: string
  disksMarkdown: string
  externalAddress: string
  gpu: string
  hostName: string
  id: string
  instanceId: string
  internalAddress: string
  machineType: string
  networkCards: string
  notes: string
  operatingSystem: string
  raidCard: string
  sshMarkdown: string
  use: string
  kernel: string
  memory: string
}

export type ProjectLedgerNetworkMapping = {
  accessAddress: string
  accessScope: string
  id: string
  ip: string
  networkName: string
  port: number | null
  purpose: string
}

export type ProjectLedgerDiagram = {
  contentType: string
  description: string
  fileName: string
  id: string
  size: number
  uploadedAt: string
  uploadedByName: string
}

export type ProjectLedgerCluster = {
  accessAccountMarkdown: string
  accessAddress: string
  applications: ProjectLedgerApplication[]
  diagrams: ProjectLedgerDiagram[]
  environmentType: string
  id: string
  licenses: ProjectLedgerLicense[]
  machines: ProjectLedgerMachine[]
  name: string
  networkMappings: ProjectLedgerNetworkMapping[]
  notes: string
  region: string
  status: 'active' | 'retired'
  vpn: ProjectLedgerVpn | null
}

export type ProjectLedger = {
  canEdit: boolean
  descriptionMarkdown: string
  installationVersion: string
  lastUpdatedByName: string | null
  projectId: number
  updatedAt: string | null
  version: number
  clusters: ProjectLedgerCluster[]
  renewalOwners: Array<{ id: number; name: string }>
}

export type ProjectLedgerWritePayload = Pick<ProjectLedger, 'descriptionMarkdown' | 'installationVersion' | 'clusters'> & {
  expectedVersion: number
}

export type ProjectLedgerMaintainer = {
  userId: number
  name: string
}

export type ProjectLedgerMaintainerConfiguration = {
  candidates: Array<{ id: number; name: string; username: string; projectMember: boolean }>
  members: ProjectLedgerMaintainer[]
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

export function normalizeLedgerText(value: unknown, maxLength = 20_000) {
  return String(value ?? '').trim().slice(0, maxLength)
}

export function normalizeLedgerDate(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null
  const date = new Date(`${text}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null
}

export function normalizeLedgerPort(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

export function validateLedgerWritePayload(value: unknown) {
  if (!value || typeof value !== 'object') return '台账数据格式无效。'
  const payload = value as Record<string, unknown>
  if (!Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1) return '台账版本无效。'
  const secretPattern = /-----BEGIN[^\n]*PRIVATE KEY-----|(?:password|passwd|token|secret|client[_ -]?secret)\s*[:=]\s*\S/iu
  if (typeof payload.descriptionMarkdown !== 'string' || payload.descriptionMarkdown.length > 50_000 || secretPattern.test(payload.descriptionMarkdown)) return '项目简介格式、长度或敏感内容无效。'
  if (typeof payload.installationVersion !== 'string' || payload.installationVersion.length > 200) return '安装版本号格式或长度无效。'
  if (!Array.isArray(payload.clusters) || payload.clusters.length > 100) return '集群数量无效。'
  const clusterIds = new Set<string>()
  const childIds = new Set<string>()
  const textField = (item: Record<string, unknown>, key: string, max: number, required = false) => {
    if (typeof item[key] !== 'string' || item[key].length > max || (required && !normalizeLedgerText(item[key], max))) return false
    return !secretPattern.test(item[key] as string)
  }
  for (const cluster of payload.clusters) {
    if (!cluster || typeof cluster !== 'object') return '集群数据格式无效。'
    const item = cluster as Record<string, unknown>
    if (!isUuid(item.id) || clusterIds.has(item.id as string)) return '集群 ID 无效或重复。'
    clusterIds.add(item.id as string)
    if (!textField(item, 'name', 120, true) || !textField(item, 'environmentType', 120) || !textField(item, 'region', 120) || !textField(item, 'accessAddress', 500) || !textField(item, 'accessAccountMarkdown', 20_000) || !textField(item, 'notes', 20_000)) return '集群字段格式、长度或敏感内容无效。'
    if (item.status !== 'active' && item.status !== 'retired') return '集群状态无效。'
    if (!Array.isArray(item.applications) || !Array.isArray(item.licenses) || !Array.isArray(item.machines) || !Array.isArray(item.networkMappings)) return '集群子项格式无效。'
    if (item.applications.length > 500 || item.licenses.length > 500 || item.machines.length > 500 || item.networkMappings.length > 1000) return '集群子项数量无效。'
    const ids = ['applications', 'licenses', 'machines', 'networkMappings'] as const
    for (const key of ids) {
      const seen = new Set<string>()
      for (const child of item[key] as unknown[]) {
        if (!child || typeof child !== 'object' || !isUuid((child as Record<string, unknown>).id) || seen.has((child as Record<string, unknown>).id as string) || childIds.has((child as Record<string, unknown>).id as string)) return `${key} ID 无效或重复。`
        const row = child as Record<string, unknown>
        seen.add(row.id as string); childIds.add(row.id as string)
        if (key === 'applications' && (
          !textField(row, 'name', 160, true) || !textField(row, 'version', 160)
          || typeof row.updatedAt !== 'string' || (row.updatedAt !== '' && !normalizeLedgerDate(row.updatedAt))
          || !textField(row, 'notes', 20_000)
        )) return '应用字段格式、长度或敏感内容无效。'
        if (key === 'licenses' && (
          !textField(row, 'product', 200, true) || !textField(row, 'notes', 20_000)
          || (row.applicationId !== null && !isUuid(row.applicationId))
          || (row.expiresOn !== null && !normalizeLedgerDate(row.expiresOn))
          || !Number.isInteger(row.reminderDays) || Number(row.reminderDays) < 0 || Number(row.reminderDays) > 3650
          || (row.renewalOwnerUserId !== null && (!Number.isSafeInteger(row.renewalOwnerUserId) || Number(row.renewalOwnerUserId) <= 0))
        )) return 'License 字段格式无效。'
        if (key === 'machines' && (!textField(row, 'hostName', 160, true) || !textField(row, 'machineType', 120) || !textField(row, 'use', 200) || !textField(row, 'cpu', 200) || !textField(row, 'gpu', 200) || !textField(row, 'memory', 120) || !textField(row, 'disksMarkdown', 20_000) || !textField(row, 'operatingSystem', 160) || !textField(row, 'kernel', 160) || !textField(row, 'architecture', 80) || !textField(row, 'raidCard', 160) || !textField(row, 'networkCards', 20_000) || !textField(row, 'sshMarkdown', 20_000) || !textField(row, 'internalAddress', 500) || !textField(row, 'externalAddress', 500) || !textField(row, 'instanceId', 200) || !textField(row, 'notes', 20_000))) return '机器字段格式、长度或敏感内容无效。'
        if (key === 'networkMappings' && (!textField(row, 'networkName', 160) || !textField(row, 'ip', 200) || !textField(row, 'accessAddress', 500) || !textField(row, 'accessScope', 200) || !textField(row, 'purpose', 500) || (row.port !== null && (!Number.isInteger(row.port) || normalizeLedgerPort(row.port) === null)))) return '网络映射字段格式无效。'
      }
    }
    if (item.vpn !== null && (typeof item.vpn !== 'object' || !['markdown', 'document_link'].includes((item.vpn as Record<string, unknown>).contentKind as string) || typeof (item.vpn as Record<string, unknown>).content !== 'string' || ((item.vpn as Record<string, unknown>).content as string).length > 50_000 || secretPattern.test((item.vpn as Record<string, unknown>).content as string))) return 'VPN 文档格式、长度或敏感内容无效。'
    const vpn = item.vpn as Record<string, unknown> | null
    if (vpn?.contentKind === 'document_link' && !/^https:\/\/[^\s]+$/iu.test(String(vpn.content).trim())) return 'VPN 文档链接必须使用 HTTPS。'
  }
  return null
}
