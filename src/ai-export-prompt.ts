export type AiPromptExportInput = {
  title: string
  scope: string[]
  fields: string[]
  data: string
  instructions?: string[]
}

export function buildAiExportPrompt({ title, scope, fields, data, instructions = [] }: AiPromptExportInput) {
  const scopeText = scope.length ? scope.map((item) => `- ${item}`).join('\n') : '- 无数据'
  const fieldText = fields.length ? fields.map((item) => `- ${item}`).join('\n') : '- 无字段说明'
  const instructionText = instructions.length
    ? instructions.map((item) => `- ${item}`).join('\n')
    : '- 请先概括事实，再给出可执行的分析结论。'
  return [
    '# 任务：请分析以下 Veges 工作数据',
    '',
    `## 导出标题\n${title}`,
    '',
    '## 导出范围',
    scopeText,
    '',
    '## 数据说明',
    '字段含义：',
    fieldText,
    '- 统计口径：以本次导出时重新读取的授权数据快照为准。',
    '- 不包含内容：项目日记、图片二进制、临时下载地址、分享链接、权限配置和通知历史。',
    '',
    '## 数据内容',
    '```text',
    data.trim() || '无数据',
    '```',
    '',
    '## AI 分析要求',
    instructionText,
    '',
    '## 约束',
    '- 仅基于以上数据回答，不要补充未提供的事实。',
    '- 区分已确认、待确认、进行中和缺失数据。',
    '- 输出结论时保留日期、人员、项目和任务的原始上下文。',
    '- 请总结当前进展、风险与阻塞、工时异常和下一步建议。',
  ].join('\n')
}

export function downloadMarkdownFile(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const browserDocument = (globalThis as unknown as {
    document: { createElement: (tagName: 'a') => { click: () => void; download: string; href: string } }
  }).document
  const link = browserDocument.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.md') ? fileName : `${fileName}.md`
  link.click()
  URL.revokeObjectURL(url)
}
