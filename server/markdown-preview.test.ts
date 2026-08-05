import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isMarkdownSectionLine,
  normalizeMarkdownLinkLineBreaks,
  stripMarkdownLinksToText,
} from '../src/markdown-preview-policy.ts'

const markdownPreviewSource = readFileSync(
  new URL('../src/components/markdown-preview.tsx', import.meta.url),
  'utf8',
)

test('does not treat an absolute HTTP URL as a labeled Markdown section', () => {
  const url = 'https://fael3z0zfze.feishu.cn/wiki/YWs8wtomji41pWkM2wLcZiWfn4N'
  assert.equal(
    isMarkdownSectionLine(url),
    false,
  )
  assert.equal(isMarkdownSectionLine('http://example.com/path'), false)
})

test('keeps short labeled lines as Markdown sections', () => {
  assert.equal(isMarkdownSectionLine('风险问题：暂无'), true)
  assert.equal(isMarkdownSectionLine('负责人: 邱天丰'), true)
})

test('joins protocol line breaks before parsing Markdown links', () => {
  const url = 'fael3z0zfze.feishu.cn/wiki/YWs8wtomji41pWkM2wLcZiWfn4N'
  assert.equal(
    normalizeMarkdownLinkLineBreaks(`[https\n\n//${url}]\n(https:  //${url})`),
    `[https://${url}](https://${url})`,
  )
  assert.equal(
    normalizeMarkdownLinkLineBreaks(`[https\n//${url}] (https:\n//${url})`),
    `[https://${url}](https://${url})`,
  )
  assert.equal(
    normalizeMarkdownLinkLineBreaks(`[https\u2028\u2028//${url}]\u2029(https:  //${url})`),
    `[https://${url}](https://${url})`,
  )
})

test('keeps todo Markdown links as plain visible text', () => {
  const url = 'https://fael3z0zfze.feishu.cn/wiki/YWs8wtomji41pWkM2wLcZiWfn4N'
  assert.equal(
    stripMarkdownLinksToText(`[${url}](${url})`),
    url,
  )
  assert.equal(
    stripMarkdownLinksToText(`[https\n\n//fael3z0zfze.feishu.cn/wiki/YWs8wtomji41pWkM2wLcZiWfn4N]\n(https:  //fael3z0zfze.feishu.cn/wiki/YWs8wtomji41pWkM2wLcZiWfn4N)`),
    url,
  )
})

test('renders plain HTTP URLs as clickable links in the preview', () => {
  assert.match(markdownPreviewSource, /const tokenPattern =/u)
  assert.match(markdownPreviewSource, /href=\{match\[6\]\}/u)
  assert.match(markdownPreviewSource, /target="_blank"/u)
})
