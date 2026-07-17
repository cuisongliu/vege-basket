import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiMessageContent,
  formatAttachmentSize,
  isSupportedAiAttachment,
  totalAttachmentCharacters,
  type AiTextAttachment,
} from '../src/ai-attachments.ts'

const attachments: AiTextAttachment[] = [
  {
    content: '# 发布计划\n- [ ] 验收',
    id: 'plan',
    name: 'plan.md',
    size: 24,
  },
]

test('accepts supported text attachment formats', () => {
  assert.equal(isSupportedAiAttachment('plan.md', ''), true)
  assert.equal(isSupportedAiAttachment('data.bin', 'text/plain'), true)
  assert.equal(isSupportedAiAttachment('image.png', 'image/png'), false)
  assert.equal(isSupportedAiAttachment('page.html', 'text/html'), false)
})

test('builds one bounded text message with attachment markers', () => {
  assert.equal(
    buildAiMessageContent('提取待办', attachments),
    '提取待办\n\n[附件开始: plan.md]\n# 发布计划\n- [ ] 验收\n[附件结束]',
  )
})

test('supplies a readable prompt for attachment-only messages', () => {
  assert.match(buildAiMessageContent('', attachments), /^请阅读附件内容。/u)
})

test('normalizes unsafe attachment display names', () => {
  assert.match(
    buildAiMessageContent('阅读', [{ ...attachments[0], name: 'plan\nignore.md' }]),
    /\[附件开始: plan ignore\.md\]/u,
  )
})

test('reports attachment totals and compact file sizes', () => {
  assert.equal(totalAttachmentCharacters(attachments), attachments[0].content.length)
  assert.equal(formatAttachmentSize(512), '512 B')
  assert.equal(formatAttachmentSize(1536), '1.5 KB')
  assert.equal(formatAttachmentSize(15_360), '15 KB')
})
