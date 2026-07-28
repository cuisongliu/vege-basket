import assert from 'node:assert/strict'
import test from 'node:test'

import { getProjectPackageOperationTitle } from '../src/lib/project-package-operation.ts'

test('uses the visible event label when opening an operation event editor', () => {
  assert.equal(
    getProjectPackageOperationTitle(
      {
        kind: 'event',
        label: '升级01',
        title: '',
      },
      '操作事件',
    ),
    '升级01',
  )
})

test('keeps document titles and supports legacy cross-field data', () => {
  assert.equal(
    getProjectPackageOperationTitle(
      {
        kind: 'document',
        label: '',
        title: '初始化安装',
      },
      '操作文档',
    ),
    '初始化安装',
  )
  assert.equal(
    getProjectPackageOperationTitle(
      {
        kind: 'event',
        label: '',
        title: '旧版事件标题',
      },
      '操作事件',
    ),
    '旧版事件标题',
  )
})
