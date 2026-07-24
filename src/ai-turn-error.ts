export function aiTurnFailureDetail(errorCode: string | null) {
  if (errorCode === 'AI_BASE_URL_UNRESOLVED') {
    return 'AI 服务地址暂时无法解析，请检查网络或 DNS 后重试。'
  }
  if (errorCode === 'AI_REQUEST_TIMEOUT') return '模型响应超时，请重试这条消息。'
  if (errorCode === 'AI_RESPONSE_INCOMPLETE') return '模型连接提前结束，请重试这条消息。'
  if (errorCode === 'AI_RESPONSE_INVALID' || errorCode === 'AI_TODO_RESPONSE_INVALID') {
    return '模型返回的内容无法读取，请重试这条消息。'
  }
  if (errorCode === 'AI_TODO_NONE_FOUND') return '没有识别到可执行的待办，可以补充更明确的内容后重试。'
  if (errorCode === 'AI_REQUEST_STALE') return '回复等待时间过长，已停止本次生成。'
  if (errorCode === 'AI_PROJECT_ACCESS_LOST') return '项目权限在生成期间发生变化，请刷新后重试。'
  return '模型没有完成这次回复，请重试这条消息。'
}
