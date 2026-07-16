type ApiErrorOptions = {
  method: string
  path: string
  responseBody: unknown
  status: number
  statusText: string
}

export class ApiError extends Error {
  readonly method: string
  readonly path: string
  readonly responseBody: unknown
  readonly status: number
  readonly statusText: string

  constructor(message: string, options: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.method = options.method
    this.path = options.path
    this.responseBody = options.responseBody
    this.status = options.status
    this.statusText = options.statusText
  }
}

function responseBodyText(body: unknown) {
  if (typeof body === 'string') return body || '(空响应)'
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

export function formatApiErrorDiagnostic(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) {
    return error instanceof Error && error.message
      ? `${fallback}\n错误：${error.message}`
      : fallback
  }
  const statusLabel = `${error.status}${error.statusText ? ` ${error.statusText}` : ''}`
  const body = responseBodyText(error.responseBody).slice(0, 3000)
  return [
    fallback,
    `HTTP 状态：${statusLabel}`,
    `请求：${error.method} ${error.path}`,
    `响应内容：${body}`,
  ].join('\n')
}
