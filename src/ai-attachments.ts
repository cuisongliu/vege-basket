export const AI_ATTACHMENT_MAX_BYTES = 64 * 1024
export const AI_ATTACHMENT_MAX_CHARACTERS = 20_000
export const AI_ATTACHMENT_MAX_COUNT = 4

export type AiTextAttachment = {
  content: string
  id: string
  name: string
  size: number
}

const supportedExtensions = new Set([
  'csv',
  'json',
  'log',
  'markdown',
  'md',
  'text',
  'txt',
  'yaml',
  'yml',
])

const supportedMimeTypes = new Set([
  'application/json',
  'application/yaml',
  'application/x-yaml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/x-log',
])

export function isSupportedAiAttachment(name: string, mimeType: string) {
  const extension = name.split('.').pop()?.toLocaleLowerCase() ?? ''
  return (
    supportedExtensions.has(extension) ||
    supportedMimeTypes.has(mimeType.toLocaleLowerCase())
  )
}

export function totalAttachmentCharacters(attachments: AiTextAttachment[]) {
  return attachments.reduce((total, attachment) => total + attachment.content.length, 0)
}

export function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`
  const kilobytes = size / 1024
  return `${kilobytes < 10 ? kilobytes.toFixed(1) : Math.round(kilobytes)} KB`
}

function safeAttachmentName(name: string) {
  return name.replace(/[\r\n]+/gu, ' ').trim() || '未命名附件'
}

export function buildAiMessageContent(
  prompt: string,
  attachments: AiTextAttachment[],
) {
  const message = prompt.trim() || '请阅读附件内容。'
  if (attachments.length === 0) return message

  const attachmentBlocks = attachments.map((attachment) => [
    `[附件开始: ${safeAttachmentName(attachment.name)}]`,
    attachment.content.trim(),
    '[附件结束]',
  ].join('\n'))

  return [message, ...attachmentBlocks].join('\n\n')
}
