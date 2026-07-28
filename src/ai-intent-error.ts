import { ApiError } from './api-error'

function apiErrorCode(error: ApiError) {
  const body = error.responseBody
  if (!body || typeof body !== 'object' || !('code' in body)) return ''
  return String(body.code ?? '')
}

export function aiIntentRequestErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return ''

  if (error instanceof ApiError) {
    const code = apiErrorCode(error)
    if (code === 'AI_PROJECT_REQUIRED') return '请先用 @ 选择一个项目，再生成项目总结。'
    if (error.status === 429) return 'AI 请求过于频繁，请稍后再试。'
    if (code === 'AI_NOT_CONFIGURED') return 'AI 服务尚未配置，请联系管理员。'
    if (code === 'AI_BASE_URL_UNRESOLVED') {
      return 'AI 服务地址暂时无法解析，请检查网络或 DNS 后重试。'
    }
    if (code === 'AI_REQUEST_TIMEOUT') return '模型响应超时，请重试。'
    if (code === 'AI_INTENT_CLASSIFICATION_INVALID') {
      return '模型返回的意图格式无法读取，请重试。'
    }
    if (code === 'AI_RESPONSE_INVALID' || code === 'AI_RESPONSE_INCOMPLETE') {
      return '模型返回的内容不完整或格式异常，请重试。'
    }
    if (code === 'AI_MESSAGE_TOO_LARGE' || error.status === 413) {
      return '消息内容过长，请减少输入或附件后重试。'
    }
    if (code === 'AI_REQUEST_FAILED' || error.status >= 500) {
      return 'AI 服务暂时不可用，请稍后重试。'
    }
    if (error.status === 401) return '登录状态已失效，请重新登录。'
    return 'AI 请求未能提交，请刷新页面后重试。'
  }

  if (error instanceof Error && error.message === 'AI intent classification response is invalid') {
    return 'AI 服务返回了无法识别的意图格式，请刷新页面后重试。'
  }
  return '网络连接异常，请检查网络后重试。'
}
