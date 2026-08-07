import test from 'node:test'
import assert from 'node:assert/strict'
import {
  changelogContentMaxLength,
  changelogTitleMaxLength,
  changelogVersionMaxLength,
  normalizeChangelogPayload,
} from './changelog.ts'

test('normalizes a valid changelog payload', () => {
  assert.deepEqual(normalizeChangelogPayload({
    content: '  ## 修复\n\n- 修复问题  ',
    title: '  Veges 1.2.0  ',
    version: '  v1.2.0  ',
  }), {
    content: '## 修复\n\n- 修复问题',
    title: 'Veges 1.2.0',
    version: 'v1.2.0',
  })
})

test('rejects empty and oversized changelog fields', () => {
  assert.equal(normalizeChangelogPayload({ title: '', version: '', content: '正文' }), null)
  assert.equal(normalizeChangelogPayload({
    title: '标题',
    version: 'v1',
    content: 'x'.repeat(changelogContentMaxLength + 1),
  }), null)
  assert.equal(normalizeChangelogPayload({
    title: 'x'.repeat(changelogTitleMaxLength + 1),
    version: 'v1',
    content: '正文',
  }), null)
  assert.equal(normalizeChangelogPayload({
    title: '标题',
    version: 'x'.repeat(changelogVersionMaxLength + 1),
    content: '正文',
  }), null)
})
