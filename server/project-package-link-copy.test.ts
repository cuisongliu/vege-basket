import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workbenchSource = readFileSync(
  new URL('../src/components/project-package-workbench.tsx', import.meta.url),
  'utf8',
)

test('copies a project-authorized download URL for each installed package item', () => {
  assert.match(workbenchSource, /onLoadPackageItemDownloadUrl\(item\.id\)/u)
  assert.match(workbenchSource, /copyToClipboard\(downloadUrl,/u)
  assert.match(workbenchSource, /group\.items\.map\(\(item\)/u)
  assert.match(workbenchSource, /复制安装包链接/u)
})
