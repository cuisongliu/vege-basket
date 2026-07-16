export type PackageItemFailurePhase =
  | 'validate_object_keys'
  | 'persist_package_items'
  | 'read_package_timeline'

export type PackageItemFailureContext = {
  eventId: number
  itemCount: number
  phase: PackageItemFailurePhase
  projectId: number
}

type ErrorLike = {
  code?: unknown
  column?: unknown
  constraint?: unknown
  detail?: unknown
  message?: unknown
  name?: unknown
  table?: unknown
}

function stringProperty(value: ErrorLike, key: keyof ErrorLike) {
  const property = value[key]
  return typeof property === 'string' && property.trim() ? property.trim() : ''
}

function sanitizeDatabaseDetail(value: string) {
  return value
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(password|secret|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 500)
}

function errorShape(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? error as ErrorLike : {}
}

function knownDomainFailure(message: string) {
  if (message === 'Event not found') {
    return {
      code: 'PACKAGE_EVENT_NOT_FOUND',
      reason: '目标交付事件不存在，或不属于当前项目。',
      status: 404,
    }
  }
  if (message === 'At least one package item is required') {
    return {
      code: 'PACKAGE_ITEMS_EMPTY',
      reason: '请求中没有可保存的安装包条目。',
      status: 400,
    }
  }
  if (/^Package item \d+ (requires|has)/.test(message)) {
    return {
      code: 'PACKAGE_ITEM_INVALID',
      reason: message,
      status: 400,
    }
  }
  return null
}

export function createPackageItemFailureDiagnostic(
  error: unknown,
  context: PackageItemFailureContext,
) {
  const shape = errorShape(error)
  const message = error instanceof Error
    ? error.message
    : stringProperty(shape, 'message')
  const domainFailure = knownDomainFailure(message)
  const databaseCode = stringProperty(shape, 'code')
  const constraint = stringProperty(shape, 'constraint')
  const databaseDetail = sanitizeDatabaseDetail(stringProperty(shape, 'detail'))
  const table = stringProperty(shape, 'table')
  const column = stringProperty(shape, 'column')
  const errorType = error instanceof Error
    ? error.name
    : stringProperty(shape, 'name') || typeof error

  const status = domainFailure?.status
    ?? (databaseCode === '23503' || databaseCode === '23505' ? 409 : 500)
  const code = domainFailure?.code
    ?? (databaseCode ? 'PACKAGE_ITEMS_DATABASE_ERROR' : 'PACKAGE_ITEMS_UNEXPECTED_ERROR')
  const reason = domainFailure?.reason
    ?? (databaseCode
      ? '数据库拒绝了安装包批量写入。'
      : '服务端在处理安装包批量写入时发生未分类异常。')

  return {
    status,
    body: {
      error: '安装包记录保存失败',
      code,
      details: {
        projectId: context.projectId,
        eventId: context.eventId,
        itemCount: context.itemCount,
        phase: context.phase,
        reason,
        errorType,
        ...(databaseCode ? { databaseCode } : {}),
        ...(constraint ? { constraint } : {}),
        ...(table ? { table } : {}),
        ...(column ? { column } : {}),
        ...(databaseDetail ? { databaseDetail } : {}),
      },
    },
  }
}
