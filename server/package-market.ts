import OSS from 'ali-oss'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

export type PackageMarketRule = {
  category: 'apps' | 'middleware'
  ciFileNameFormats: string[]
  fileNameFormats: string[]
  flatFileRoots: string[]
  id: string
  mode: 'release' | 'flat' | 'mixed' | 'pro-middleware'
  name: string
  releaseRoots: string[]
}

export type PackageMarketLink = {
  downloadUrl: string
  lastModified?: string
  name: string
  objectKey: string
  size?: number
  version: string
}

export type PackageMarketVersion = {
  hash?: string
  label: string
  lastModified?: string
  version?: string
}

export type PackageMarketDetail = {
  ciVersions?: PackageMarketVersion[]
  links: PackageMarketLink[]
  meta: Array<{ label: string; value: string }>
  releaseVersions?: PackageMarketVersion[]
  title: string
  type: string
}

type OssObject = {
  lastModified?: string
  lastModifiedTime?: string
  name: string
  size?: number
  LastModified?: string
}

const downloadExpireSeconds = Number(
  process.env.PACKAGE_MARKET_DOWNLOAD_EXPIRE_SECONDS ??
    process.env.OSS_UI_DOWNLOAD_EXPIRE_SECONDS ??
    30 * 60,
)
const middlewareRoot = normalizePrefix(
  process.env.PACKAGE_MARKET_MIDDLEWARE_ROOT ?? process.env.OSS_UI_MIDDLEWARE_ROOT,
)
const baseObjectTemplate = normalizeString(
  process.env.PACKAGE_MARKET_BASE_OBJECT_TEMPLATE ?? process.env.OSS_UI_BASE_OBJECT_TEMPLATE,
)
const baseListPrefixTemplate = normalizeString(
  process.env.PACKAGE_MARKET_BASE_LIST_PREFIX_TEMPLATE ??
    process.env.OSS_UI_BASE_LIST_PREFIX_TEMPLATE,
)
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const bundledRulesFile = path.join(serverDir, 'trial-combo-package-rules.yaml')
const rulesFile = normalizeString(
  process.env.PACKAGE_MARKET_RULES_FILE ??
    process.env.TRIAL_COMBO_PACKAGE_RULES_FILE ??
    bundledRulesFile,
)

let cachedRules: PackageMarketRule[] | null = null
let cachedRulesMtimeMs = -1
let lastClientConfig: { bucket: string; endpoint: string } | null = null

function normalizeString(value: unknown) {
  return String(value ?? '').trim()
}

function normalizePrefix(value: unknown) {
  const normalized = normalizeString(value)
  return normalized && !normalized.endsWith('/') ? `${normalized}/` : normalized
}

function normalizeVersion(value: unknown) {
  const version = normalizeString(value).toLowerCase()
  if (!version || version === '无') return version
  return version.startsWith('v') ? version : `v${version}`
}

function normalizeList(values: unknown[]) {
  const seen = new Set<string>()
  const list: string[] = []
  for (const value of values) {
    const normalized = normalizeString(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    list.push(normalized)
  }
  return list
}

function renderTemplate(template: string, values: Record<string, string>) {
  return normalizeString(template).replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

function splitVersionPart(part: string) {
  const match = String(part).match(/^([a-zA-Z]+)(\d+)$/)
  if (!match) return null
  return { prefix: match[1], number: Number(match[2]) }
}

function compareVersionParts(left: string, right: string) {
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  if (Number.isInteger(leftNumber) && Number.isInteger(rightNumber)) {
    return Math.sign(leftNumber - rightNumber)
  }

  const leftSplit = splitVersionPart(left)
  const rightSplit = splitVersionPart(right)
  if (leftSplit && rightSplit && leftSplit.prefix === rightSplit.prefix) {
    return Math.sign(leftSplit.number - rightSplit.number)
  }

  return left.localeCompare(right)
}

function compareVersions(left: string, right: string) {
  const leftTokens = normalizeVersion(left).replace(/^v/, '').split(/[._-]/)
  const rightTokens = normalizeVersion(right).replace(/^v/, '').split(/[._-]/)
  const max = Math.max(leftTokens.length, rightTokens.length)

  for (let index = 0; index < max; index += 1) {
    let leftToken = leftTokens[index] || ''
    let rightToken = rightTokens[index] || ''
    if (!leftToken && rightToken) {
      if (splitVersionPart(rightToken)) return 1
      leftToken = '0'
    }
    if (leftToken && !rightToken) {
      if (splitVersionPart(leftToken)) return -1
      rightToken = '0'
    }
    const compared = compareVersionParts(leftToken, rightToken)
    if (compared !== 0) return compared
  }

  return 0
}

function objectTime(object: OssObject) {
  const value = object.lastModified || object.lastModifiedTime || object.LastModified
  const time = value ? new Date(value).getTime() : 0
  return Number.isNaN(time) ? 0 : time
}

function formatTime(value?: string) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return 'unknown time'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function versionLabel(item: { lastModified?: string; version: string }) {
  return item.lastModified
    ? `${normalizeVersion(item.version)} · ${formatTime(item.lastModified)}`
    : normalizeVersion(item.version)
}

function formatCiLabel(item: { hash: string; lastModified?: string }) {
  return `${formatTime(item.lastModified)} ${item.hash}`
}

function formatFileName(format: string, version: string, arch: string) {
  return normalizeString(format).replace('%s', version).replace('%s', arch)
}

function candidateFileNames(formats: string[], version: string, arch: string) {
  const names = new Set<string>()
  for (const format of formats) {
    const name = formatFileName(format, version, arch)
    if (!name) continue
    names.add(name)
    if (name.endsWith('.tar')) {
      names.add(`${name}.gz`)
    }
  }
  return [...names]
}

function isArchiveObjectKey(key: string) {
  return /\.tar(\.gz)?$/.test(key) && !key.endsWith('.md5')
}

function ossClient() {
  const endpoint = normalizeString(process.env.OSS_ENDPOINT)
  const accessKeyId = normalizeString(process.env.OSS_ACCESS_KEY_ID)
  const accessKeySecret = normalizeString(process.env.OSS_ACCESS_KEY_SECRET)
  const bucket = normalizeString(process.env.OSS_BUCKET)
  if (!endpoint || !accessKeyId || !accessKeySecret || !bucket) {
    throw new Error('OSS_ENDPOINT, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET must be set')
  }
  lastClientConfig = { endpoint, bucket }
  return new OSS({
    endpoint,
    accessKeyId,
    accessKeySecret,
    bucket,
    secure: endpoint.startsWith('https://'),
  })
}

async function listAllObjects(client: OSS, prefix: string) {
  const objects: OssObject[] = []
  let marker: string | undefined
  do {
    const result = await client.list({ prefix, marker, 'max-keys': 1000 }, {})
    for (const object of result.objects || []) {
      if (object.name && !object.name.endsWith('/')) {
        objects.push(object)
      }
    }
    marker = result.nextMarker
  } while (marker)
  return objects
}

async function listCommonPrefixes(client: OSS, prefix: string) {
  const prefixes: string[] = []
  let marker: string | undefined
  do {
    const result = await client.list({ prefix, delimiter: '/', marker, 'max-keys': 1000 }, {})
    for (const item of result.prefixes || []) {
      prefixes.push(item)
    }
    marker = result.nextMarker
  } while (marker)
  return prefixes
}

function signedDownloadUrl(client: OSS, objectKey: string) {
  try {
    return client.signatureUrl(objectKey, { expires: downloadExpireSeconds, method: 'GET' })
  } catch (error) {
    if (!String((error as Error).message ?? error).includes('endpoint is IP')) {
      throw error
    }
    if (!lastClientConfig) {
      throw error
    }
    const expires = Math.floor(Date.now() / 1000) + downloadExpireSeconds
    const endpoint = String(lastClientConfig.endpoint).replace(/\/+$/, '')
    const bucket = String(lastClientConfig.bucket)
    return `${endpoint}/${bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}?Expires=${expires}`
  }
}

function objectToLink(client: OSS, name: string, version: string, object: OssObject): PackageMarketLink {
  return {
    name,
    version,
    objectKey: object.name,
    size: object.size,
    lastModified: object.lastModified,
    downloadUrl: signedDownloadUrl(client, object.name),
  }
}

function ruleCategory(rule: { flatFileRoots: string[]; releaseRoots: string[] }) {
  const roots = [...rule.releaseRoots, ...rule.flatFileRoots]
  if (middlewareRoot && roots.some((root) => root.startsWith(middlewareRoot))) {
    return 'middleware' as const
  }
  return 'apps' as const
}

function parseRulesFile() {
  if (!rulesFile) {
    throw new Error('PACKAGE_MARKET_RULES_FILE must be set')
  }
  const stat = fs.statSync(rulesFile)
  if (cachedRules && cachedRulesMtimeMs === stat.mtimeMs) return cachedRules

  const file = fs.readFileSync(rulesFile, 'utf8')
  const parsed = yaml.load(file) as { rules?: Record<string, Record<string, unknown>> } | undefined
  const rawRules = parsed?.rules ?? {}
  const rules: PackageMarketRule[] = []

  for (const [rawKey, rawRule] of Object.entries(rawRules)) {
    const id = normalizeString(rawKey).toLowerCase()
    if (!id) continue
    const rule = rawRule ?? {}
    const fileNameFormats = normalizeList([
      rule.file_name_format,
      ...(((rule.file_name_formats as unknown[]) ?? [])),
    ])
    const ciFileNameFormats = normalizeList((rule.ci_file_name_formats as unknown[]) ?? [])
    const releaseRoots = normalizeList((rule.release_roots as unknown[]) ?? [])
    const flatFileRoots = normalizeList((rule.flat_file_roots as unknown[]) ?? [])
    rules.push({
      id,
      name: normalizeString(rule.name) || id,
      releaseRoots,
      flatFileRoots,
      fileNameFormats,
      ciFileNameFormats,
      category: ruleCategory({ releaseRoots, flatFileRoots }),
      mode: flatFileRoots.length > 0 && releaseRoots.length > 0
        ? 'mixed'
        : flatFileRoots.length > 0
          ? 'flat'
          : 'release',
    })
  }

  cachedRules = rules.sort((a, b) => a.id.localeCompare(b.id))
  cachedRulesMtimeMs = stat.mtimeMs
  return cachedRules
}

function publicRule(rule: PackageMarketRule): PackageMarketRule {
  return {
    ...rule,
    releaseRoots: [...rule.releaseRoots],
    flatFileRoots: [...rule.flatFileRoots],
    fileNameFormats: [...rule.fileNameFormats],
    ciFileNameFormats: [...rule.ciFileNameFormats],
  }
}

function proMiddlewareNameFromId(packageId: string) {
  if (!packageId.startsWith('pro:')) return ''
  return normalizeString(packageId.slice('pro:'.length))
}

async function publicProMiddlewareRules(client: OSS, excludedNames = new Set<string>()) {
  if (!middlewareRoot) return []
  const prefixes = await listCommonPrefixes(client, middlewareRoot)
  return prefixes
    .map((prefix) => {
      const name = prefix.slice(middlewareRoot.length).replace(/\/$/, '')
      return {
        id: `pro:${name}`,
        name,
        category: 'middleware' as const,
        mode: 'pro-middleware' as const,
        releaseRoots: [prefix],
        flatFileRoots: [],
        fileNameFormats: [],
        ciFileNameFormats: [],
      }
    })
    .filter((item) => item.name && !excludedNames.has(item.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function extractProMiddlewareVersion(name: string, fileName: string) {
  const suffixMatch = fileName.match(/-(amd64|arm64)\.tar(?:\.gz)?$/)
  if (!suffixMatch) return ''
  let version = fileName.slice(0, suffixMatch.index)
  const prefixes = [`${name}-`, `${name}`]
  for (const prefix of prefixes) {
    if (version.startsWith(prefix)) {
      version = version.slice(prefix.length)
      break
    }
  }
  version = version.replace(/^-+/, '')
  return version || 'latest'
}

function proMiddlewareHashFromObject(root: string, objectKey: string) {
  const rest = objectKey.slice(root.length)
  const parts = rest.split('/')
  return parts.length > 1 ? normalizeString(parts[0]) : ''
}

function releaseVersionFromObject(root: string, objectKey: string) {
  const rest = objectKey.slice(root.length)
  const parts = rest.split('/')
  return parts.length > 1 ? normalizeVersion(parts[0]) : ''
}

function ciRootsForRule(rule: PackageMarketRule) {
  const roots = new Set<string>()
  for (const root of rule.releaseRoots) {
    const normalized = root.replace(/\/+$/, '/')
    const match = normalized.match(/^(.*)\/releases?\/$/)
    if (match) {
      roots.add(`${match[1]}/ci/main/`)
    }
  }
  return [...roots]
}

function ciHashFromObject(root: string, objectKey: string) {
  const rest = objectKey.slice(root.length)
  const parts = rest.split('/')
  return parts.length > 1 ? normalizeString(parts[0]) : ''
}

function ciCandidateFileNames(rule: PackageMarketRule, hash: string, arch: string) {
  const formats =
    rule.ciFileNameFormats.length > 0 ? rule.ciFileNameFormats : rule.fileNameFormats
  return candidateFileNames(formats, hash, arch)
}

function flatSuffixes(
  rule: PackageMarketRule & { flatFileNameSuffix?: string; flatFileNameSuffixes?: string[] },
  arch: string,
) {
  return normalizeList([
    rule.flatFileNameSuffix,
    ...((rule.flatFileNameSuffixes as unknown[]) ?? []),
  ]).map((suffix) => formatFileName(suffix, arch, arch))
}

function extractFlatVersion(
  rule: PackageMarketRule & {
    flatFileNamePrefix?: string
    flatFileNameSuffix?: string
    flatFileNameSuffixes?: string[]
  },
  fileName: string,
  arch: string,
) {
  const prefix = normalizeString(rule.flatFileNamePrefix)
  if (!prefix || !fileName.startsWith(prefix)) return ''
  const suffixes = flatSuffixes(rule, arch).sort((a, b) => b.length - a.length)
  for (const suffix of suffixes) {
    if (!suffix || !fileName.endsWith(suffix)) continue
    return normalizeVersion(fileName.slice(prefix.length, fileName.length - suffix.length))
  }
  return ''
}

function newestVersion(objects: Array<{ version: string }>) {
  const versions = [...new Set(objects.map((item) => item.version).filter(Boolean))]
  versions.sort((a, b) => compareVersions(b, a))
  return versions[0] || ''
}

async function listProMiddlewareReleaseVersions(client: OSS, name: string, arch: string) {
  if (!middlewareRoot) return []
  const root = `${middlewareRoot}${name}/`
  const objects = await listAllObjects(client, root)
  const versions = new Map<string, { object: OssObject; version: string }>()

  for (const object of objects) {
    const fileName = object.name.slice(root.length)
    if (!fileName || fileName.includes('/') || !isArchiveObjectKey(fileName) || !fileName.includes(`-${arch}.tar`)) {
      continue
    }
    const version = extractProMiddlewareVersion(name, fileName)
    const current = versions.get(version)
    if (!current || objectTime(object) > objectTime(current.object)) {
      versions.set(version, { version, object })
    }
  }

  return [...versions.values()]
    .sort((a, b) => objectTime(b.object) - objectTime(a.object))
    .map((item) => ({
      version: item.version,
      label: versionLabel({ version: item.version, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }))
}

async function buildProMiddlewarePackage(
  client: OSS,
  name: string,
  arch: string,
  requestedVersion: string,
): Promise<PackageMarketDetail> {
  if (!middlewareRoot) throw new Error('PACKAGE_MARKET_MIDDLEWARE_ROOT must be set')
  const versions = await listProMiddlewareReleaseVersions(client, name, arch)
  const version = normalizeString(requestedVersion) || versions[0]?.version || ''
  const root = `${middlewareRoot}${name}/`
  const objects = await listAllObjects(client, root)
  const matched = objects.filter((object) => {
    const fileName = object.name.slice(root.length)
    return (
      fileName &&
      !fileName.includes('/') &&
      isArchiveObjectKey(fileName) &&
      fileName.includes(`-${arch}.tar`) &&
      extractProMiddlewareVersion(name, fileName) === version
    )
  })

  return {
    title: name,
    type: 'pro middleware',
    meta: [
      { label: '目录', value: root },
      { label: '正式版本', value: version || '未找到' },
      { label: '下载有效期', value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    releaseVersions: versions,
    links: matched.map((object) => objectToLink(client, name, version, object)),
  }
}

async function listProMiddlewareCiVersions(client: OSS, name: string, arch: string) {
  if (!middlewareRoot) return []
  const root = `${middlewareRoot}${name}/`
  const objects = await listAllObjects(client, root)
  const versions = new Map<string, { hash: string; object: OssObject }>()

  for (const object of objects) {
    const hash = proMiddlewareHashFromObject(root, object.name)
    if (!hash) continue
    const fileName = object.name.slice(`${root}${hash}/`.length)
    if (!fileName || fileName.includes('/') || !isArchiveObjectKey(fileName) || !fileName.includes(`-${arch}.tar`)) {
      continue
    }
    const current = versions.get(hash)
    if (!current || objectTime(object) > objectTime(current.object)) {
      versions.set(hash, { hash, object })
    }
  }

  return [...versions.values()]
    .sort((a, b) => objectTime(b.object) - objectTime(a.object))
    .map((item) => ({
      hash: item.hash,
      label: formatCiLabel({ hash: item.hash, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }))
}

async function buildProMiddlewareCiPackage(
  client: OSS,
  name: string,
  arch: string,
  requestedHash: string,
): Promise<PackageMarketDetail> {
  if (!middlewareRoot) throw new Error('PACKAGE_MARKET_MIDDLEWARE_ROOT must be set')
  const versions = await listProMiddlewareCiVersions(client, name, arch)
  const hash = normalizeString(requestedHash) || versions[0]?.hash || ''
  const root = `${middlewareRoot}${name}/`
  const objects = hash ? await listAllObjects(client, `${root}${hash}/`) : []
  const matched = objects.filter((object) => {
    const fileName = object.name.slice(`${root}${hash}/`.length)
    return fileName && !fileName.includes('/') && isArchiveObjectKey(fileName) && fileName.includes(`-${arch}.tar`)
  })
  const selected = versions.find((item) => item.hash === hash)

  return {
    title: name,
    type: 'pro middleware ci',
    meta: [
      { label: '目录', value: root },
      { label: '测试版本', value: selected?.label || '未找到' },
      { label: '下载有效期', value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    ciVersions: versions,
    links: matched.map((object) => objectToLink(client, name, selected?.label || hash, object)),
  }
}

async function listBaseVersions(client: OSS, deployType: string, arch: string) {
  const normalizedDeployType = normalizeString(deployType || 'pro').toLowerCase()
  if (!baseListPrefixTemplate) return []
  const packageNames =
    normalizedDeployType === 'pro' ? ['sealos-pro', 'sealos-commercial'] : [`sealos-${normalizedDeployType}`]
  const listPrefix = normalizePrefix(renderTemplate(baseListPrefixTemplate, { deployType: normalizedDeployType, arch }))
  const objects = await listAllObjects(client, listPrefix)
  const versions = new Map<string, { object: OssObject; version: string }>()

  for (const object of objects) {
    const rest = object.name.slice(listPrefix.length)
    const parts = rest.split('/')
    if (parts.length < 2) continue
    const version = normalizeVersion(parts[0])
    const fileName = parts[1]
    const expectedNames = packageNames.flatMap((packageName) =>
      candidateFileNames([`${packageName}-%s-%s.tar`], version, arch),
    )
    if (!expectedNames.includes(fileName)) continue
    const current = versions.get(version)
    if (!current || objectTime(object) > objectTime(current.object)) {
      versions.set(version, { version, object })
    }
  }

  return [...versions.values()]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((item) => ({
      version: item.version,
      label: versionLabel({ version: item.version, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }))
}

async function buildBasePackage(
  client: OSS,
  deployType: string,
  releaseVersion: string,
  arch: string,
): Promise<PackageMarketDetail> {
  if (!baseObjectTemplate) throw new Error('PACKAGE_MARKET_BASE_OBJECT_TEMPLATE must be set')
  const versions = await listBaseVersions(client, deployType, arch)
  const version = normalizeVersion(releaseVersion) || versions[0]?.version || ''
  const normalizedDeployType = normalizeString(deployType || 'pro').toLowerCase()
  if (!version || !arch || !normalizedDeployType) {
    throw new Error('deployType, releaseVersion and arch are required')
  }

  const packageNames =
    normalizedDeployType === 'pro' ? ['sealos-pro', 'sealos-commercial'] : [`sealos-${normalizedDeployType}`]
  const links: PackageMarketLink[] = []

  for (const packageName of packageNames) {
    for (const fileName of candidateFileNames([`${packageName}-%s-%s.tar`], version, arch)) {
      const key = renderTemplate(baseObjectTemplate, {
        deployType: normalizedDeployType,
        version,
        fileName,
        arch,
        packageName,
      })
      try {
        const head = await client.head(key)
        const headers = head.res.headers as Record<string, string | number | undefined>
        links.push(
          objectToLink(client, packageName, version, {
            name: key,
            size: Number(headers['content-length']),
            lastModified: String(headers['last-modified'] ?? ''),
          }),
        )
        break
      } catch (error) {
        const ossError = error as { code?: string; status?: number }
        if (ossError.code !== 'NoSuchKey' && ossError.status !== 404) throw error
      }
    }
  }

  return {
    title: '基础包',
    type: 'main package',
    meta: [
      { label: '部署类型', value: normalizedDeployType.toUpperCase() },
      { label: '基础包版本', value: version },
      { label: '下载有效期', value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    releaseVersions: versions,
    links,
  }
}

async function listReleaseVersions(
  client: OSS,
  rule: PackageMarketRule & {
    flatFileNamePrefix?: string
    flatFileNameSuffix?: string
    flatFileNameSuffixes?: string[]
  },
  arch: string,
) {
  const versions = new Map<string, { object: OssObject; version: string }>()

  for (const root of rule.releaseRoots) {
    const objects = await listAllObjects(client, root)
    for (const object of objects) {
      const version = releaseVersionFromObject(root, object.name)
      if (!version) continue
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch)
      if (!expectedNames.some((name) => object.name === `${root}${version}/${name}`)) continue
      const current = versions.get(version)
      if (!current || objectTime(object) > objectTime(current.object)) {
        versions.set(version, { version, object })
      }
    }
  }

  for (const root of rule.flatFileRoots) {
    const objects = await listAllObjects(client, root)
    for (const object of objects) {
      const fileName = object.name.slice(root.length)
      if (!fileName || fileName.includes('/')) continue
      const version = extractFlatVersion(rule, fileName, arch)
      if (!version) continue
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch)
      if (!expectedNames.includes(fileName)) continue
      const current = versions.get(version)
      if (!current || objectTime(object) > objectTime(current.object)) {
        versions.set(version, { version, object })
      }
    }
  }

  return [...versions.values()]
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((item) => ({
      version: item.version,
      label: versionLabel({ version: item.version, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }))
}

async function listCiVersions(client: OSS, rule: PackageMarketRule, arch: string) {
  const versions = new Map<string, { hash: string; object: OssObject }>()

  for (const root of ciRootsForRule(rule)) {
    const objects = await listAllObjects(client, root)
    for (const object of objects) {
      const hash = ciHashFromObject(root, object.name)
      if (!hash) continue
      const expectedNames = ciCandidateFileNames(rule, hash, arch)
      const fileName = object.name.slice(`${root}${hash}/`.length)
      if (!expectedNames.includes(fileName)) continue
      const current = versions.get(hash)
      if (!current || objectTime(object) > objectTime(current.object)) {
        versions.set(hash, { hash, object })
      }
    }
  }

  return [...versions.values()]
    .sort((a, b) => objectTime(b.object) - objectTime(a.object))
    .map((item) => ({
      hash: item.hash,
      label: formatCiLabel({ hash: item.hash, lastModified: item.object.lastModified }),
      lastModified: item.object.lastModified,
    }))
}

async function buildCiPackage(
  client: OSS,
  rule: PackageMarketRule,
  arch: string,
  requestedHash: string,
): Promise<PackageMarketDetail> {
  const versions = await listCiVersions(client, rule, arch)
  const hash = normalizeString(requestedHash) || versions[0]?.hash || ''
  const matched: OssObject[] = []

  if (hash) {
    for (const root of ciRootsForRule(rule)) {
      const objects = await listAllObjects(client, `${root}${hash}/`)
      const expectedNames = ciCandidateFileNames(rule, hash, arch)
      for (const object of objects) {
        const fileName = object.name.slice(`${root}${hash}/`.length)
        if (expectedNames.includes(fileName)) {
          matched.push(object)
        }
      }
    }
  }

  const selected = versions.find((item) => item.hash === hash)
  return {
    title: rule.name,
    type: 'ci package',
    meta: [
      { label: '规则 key', value: rule.id },
      { label: '测试版本', value: selected?.label || '未找到' },
      { label: '下载有效期', value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    ciVersions: versions,
    links: matched.map((object) => objectToLink(client, rule.name, selected?.label || hash, object)),
  }
}

async function buildComboPackage(
  client: OSS,
  rule: PackageMarketRule & {
    flatFileNamePrefix?: string
    flatFileNameSuffix?: string
    flatFileNameSuffixes?: string[]
  },
  arch: string,
  releaseVersion: string,
  channel: 'release' | 'ci',
  ciVersion: string,
): Promise<PackageMarketDetail> {
  if (channel === 'ci') {
    return buildCiPackage(client, rule, arch, ciVersion)
  }

  const matched: Array<{ object: OssObject; version: string }> = []
  for (const root of rule.releaseRoots) {
    const objects = await listAllObjects(client, root)
    for (const object of objects) {
      const version = releaseVersionFromObject(root, object.name)
      if (!version) continue
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch)
      if (expectedNames.some((name) => object.name === `${root}${version}/${name}`)) {
        matched.push({ version, object })
      }
    }
  }

  for (const root of rule.flatFileRoots) {
    const objects = await listAllObjects(client, root)
    for (const object of objects) {
      const fileName = object.name.slice(root.length)
      if (!fileName || fileName.includes('/')) continue
      const version = extractFlatVersion(rule, fileName, arch)
      if (!version) continue
      const expectedNames = candidateFileNames(rule.fileNameFormats, version, arch)
      if (expectedNames.includes(fileName)) {
        matched.push({ version, object })
      }
    }
  }

  const releaseVersions = await listReleaseVersions(client, rule, arch)
  const latest =
    normalizeVersion(releaseVersion) || releaseVersions[0]?.version || newestVersion(matched)
  const latestObjects = matched.filter((item) => item.version === latest)

  return {
    title: rule.name,
    type: 'combo package',
    meta: [
      { label: '规则 key', value: rule.id },
      { label: '最新版本', value: latest || '未找到' },
      { label: '下载有效期', value: `${Math.round(downloadExpireSeconds / 60)} 分钟` },
    ],
    releaseVersions,
    links: latestObjects.map((item) => objectToLink(client, rule.name, item.version, item.object)),
  }
}

export function getPackageMarketExpireMinutes() {
  return Math.round(downloadExpireSeconds / 60)
}

export async function listPackageMarketRules() {
  const client = ossClient()
  const yamlRules = parseRulesFile().map(publicRule)
  const yamlMiddlewareNames = new Set(
    yamlRules.filter((rule) => rule.category === 'middleware').map((rule) => rule.name),
  )
  const middlewareRules = await publicProMiddlewareRules(client, yamlMiddlewareNames)
  return [...yamlRules, ...middlewareRules]
}

export async function getPackageMarketDetail(params: {
  arch: string
  channel: 'release' | 'ci'
  ciVersion?: string
  deployType?: string
  packageId: string
  releaseVersion?: string
}) {
  const client = ossClient()
  const arch = normalizeString(params.arch || 'amd64').toLowerCase()
  if (params.packageId === 'base-pro' || params.packageId === 'base-oss') {
    return buildBasePackage(
      client,
      params.deployType || (params.packageId === 'base-oss' ? 'oss' : 'pro'),
      params.releaseVersion || '',
      arch,
    )
  }

  const middlewareName = proMiddlewareNameFromId(params.packageId)
  if (middlewareName) {
    return params.channel === 'ci'
      ? buildProMiddlewareCiPackage(client, middlewareName, arch, params.ciVersion || '')
      : buildProMiddlewarePackage(client, middlewareName, arch, params.releaseVersion || '')
  }

  const rule = parseRulesFile().find((item) => item.id === params.packageId)
  if (!rule) {
    throw new Error(`unknown package: ${params.packageId}`)
  }

  return buildComboPackage(
    client,
    rule,
    arch,
    params.releaseVersion || '',
    params.channel,
    params.ciVersion || '',
  )
}

export async function listPackageMarketReleaseVersions(params: {
  arch: string
  deployType?: string
  packageId: string
}) {
  const client = ossClient()
  const arch = normalizeString(params.arch || 'amd64').toLowerCase()
  if (params.packageId === 'base-pro' || params.packageId === 'base-oss') {
    return listBaseVersions(
      client,
      params.deployType || (params.packageId === 'base-oss' ? 'oss' : 'pro'),
      arch,
    )
  }

  const middlewareName = proMiddlewareNameFromId(params.packageId)
  if (middlewareName) {
    return listProMiddlewareReleaseVersions(client, middlewareName, arch)
  }

  const rule = parseRulesFile().find((item) => item.id === params.packageId)
  if (!rule) {
    throw new Error(`unknown package: ${params.packageId}`)
  }
  return listReleaseVersions(client, rule, arch)
}

export async function listPackageMarketCiVersions(params: {
  arch: string
  packageId: string
}) {
  const client = ossClient()
  const arch = normalizeString(params.arch || 'amd64').toLowerCase()
  const middlewareName = proMiddlewareNameFromId(params.packageId)
  if (middlewareName) {
    return listProMiddlewareCiVersions(client, middlewareName, arch)
  }

  const rule = parseRulesFile().find((item) => item.id === params.packageId)
  if (!rule) {
    throw new Error(`unknown package: ${params.packageId}`)
  }
  return listCiVersions(client, rule, arch)
}

export function createPackageItemDownloadUrl(objectKey: string) {
  return signedDownloadUrl(ossClient(), objectKey)
}
