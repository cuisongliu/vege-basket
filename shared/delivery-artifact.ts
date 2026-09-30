import { load as parseYaml } from 'js-yaml'

export const maxDeliveryArtifactEntries = 20
export const maxOfflinePackageUrlLength = 4096
export const maxDeliveryEnvironmentVariables = 20
export const maxDeliveryEnvironmentValueLength = 4096
export const maxDeliveryValuesPatchLength = 64 * 1024
export const deliveryValuesRoot = '/root/.sealos/cloud/values'

export type DeliveryEnvironmentVariable = {
  name: string
  value: string
}

export type DeliveryRuntimeConfig = {
  environmentVariables: DeliveryEnvironmentVariable[]
  valuesPath: string
  valuesPatch: string
}

export const emptyDeliveryRuntimeConfig = (): DeliveryRuntimeConfig => ({
  environmentVariables: [],
  valuesPath: '',
  valuesPatch: '',
})

export type DeliveryRuntimeConfigResult =
  | { error: string; valid: false }
  | { valid: true; value: DeliveryRuntimeConfig }

export type OfflinePackageUrlResult =
  | { error: string; valid: false }
  | { valid: true; value: string }

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

function normalizeValuesPath(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return { valid: true as const, value: '' }
  if (
    normalized.length > 4096 ||
    hasControlCharacter(normalized) ||
    !normalized.startsWith('/') ||
    !normalized.startsWith(`${deliveryValuesRoot}/`) ||
    normalized.endsWith('/') ||
    normalized.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    return {
      error: `Values 文件必须是 ${deliveryValuesRoot}/ 下的绝对路径。`,
      valid: false as const,
    }
  }
  return { valid: true as const, value: normalized }
}

export function normalizeDeliveryRuntimeConfig(value: unknown): DeliveryRuntimeConfigResult {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rawVariables = Array.isArray(input.environmentVariables) ? input.environmentVariables : []
  if (rawVariables.length > maxDeliveryEnvironmentVariables) {
    return { error: `环境变量最多填写 ${maxDeliveryEnvironmentVariables} 项。`, valid: false }
  }
  const seenNames = new Set<string>()
  const environmentVariables: DeliveryEnvironmentVariable[] = []
  for (const [index, rawVariable] of rawVariables.entries()) {
    const variable = rawVariable && typeof rawVariable === 'object'
      ? rawVariable as Record<string, unknown>
      : {}
    const name = typeof variable.name === 'string' ? variable.name.trim() : ''
    const environmentValue = typeof variable.value === 'string' ? variable.value : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      return { error: `环境变量 ${index + 1} 的名称格式无效。`, valid: false }
    }
    if (seenNames.has(name)) return { error: `环境变量 ${name} 不能重复。`, valid: false }
    if (environmentValue.length > maxDeliveryEnvironmentValueLength || hasControlCharacter(environmentValue)) {
      return { error: `环境变量 ${name} 的值格式无效。`, valid: false }
    }
    seenNames.add(name)
    environmentVariables.push({ name, value: environmentValue })
  }

  const valuesPath = normalizeValuesPath(input.valuesPath)
  if (!valuesPath.valid) return valuesPath
  const valuesPatch = typeof input.valuesPatch === 'string' ? input.valuesPatch.trim() : ''
  if (valuesPatch.length > maxDeliveryValuesPatchLength || hasControlCharacter(valuesPatch.replaceAll('\n', ''))) {
    return { error: 'Values 修改内容格式无效或超过 64 KiB。', valid: false }
  }
  if (valuesPatch && !valuesPath.value) {
    return { error: '填写 Values 修改内容前必须填写 Values 文件地址。', valid: false }
  }
  if (valuesPath.value && !valuesPatch) {
    return { error: '填写 Values 文件地址后必须填写 YAML 修改内容。', valid: false }
  }
  if (valuesPatch) {
    try {
      const parsed = parseYaml(valuesPatch)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'Values 修改内容必须是 YAML 映射。', valid: false }
      }
    } catch {
      return { error: 'Values 修改内容不是有效的 YAML。', valid: false }
    }
  }
  return {
    valid: true,
    value: {
      environmentVariables,
      valuesPath: valuesPath.value,
      valuesPatch,
    },
  }
}

export function normalizeOfflinePackageUrl(value: unknown): OfflinePackageUrlResult {
  if (typeof value !== 'string') return { error: '离线包地址不能为空。', valid: false }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxOfflinePackageUrlLength || hasControlCharacter(normalized)) {
    return { error: '离线包地址格式无效。', valid: false }
  }
  try {
    const url = new URL(normalized)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      return { error: '离线包地址必须是未包含账号密码的 HTTPS 地址。', valid: false }
    }
    return { valid: true, value: normalized }
  } catch {
    return { error: '离线包地址格式无效。', valid: false }
  }
}

export function offlinePackageFileName(value: string, fallbackIndex: number) {
  try {
    const pathname = new URL(value).pathname
    const rawName = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '')
    return rawName.replace(/[^A-Za-z0-9._-]/gu, '-') || `offline-package-${fallbackIndex + 1}.tar`
  } catch {
    return `offline-package-${fallbackIndex + 1}.tar`
  }
}
