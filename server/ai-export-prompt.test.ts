import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildAiBugExportPrompt, buildAiExportPrompt, shouldGenerateAiBugImagePrompt } from '../src/ai-export-prompt.ts'
import {
  fetchAllTodoWorkHours,
  filterWorkHourEntries,
  formatTodoExport,
  formatWorkHourExport,
  summarizeWorkHourStatuses,
} from '../src/ai-export-data.ts'
import type { WorkHourEntry } from '../src/api.ts'
import type { Todo } from '../src/types.ts'

const todo: Todo = {
  id: 7,
  projectId: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  title: '补齐导出字段',
  detail: '读取完整详情',
  dueDate: '2026-10-08',
  priority: 'high',
  done: false,
  confirmationStatus: 'pending_review',
  estimatedWorkMinutes: 120,
  recordedWorkMinutes: 60,
  confirmedWorkMinutes: 0,
  pendingWorkMinutes: 60,
  linkedToDeliveryEvent: false,
  moduleName: '研发',
  subprojectName: '导出',
  notes: [{ id: 1, todoId: 7, authorName: '小王', content: '备注', createdAt: '2026-10-01', updatedAt: '2026-10-01' }],
}

const entries: WorkHourEntry[] = [
  { id: 1, projectId: 3, todoId: 7, userId: 11, workDate: '2026-10-01', minutes: 60, hours: 1, status: 'confirmed', description: '完成读取', createdAt: '', updatedAt: '', projectName: 'Veges', todoTitle: todo.title, userName: '小王', estimatedWorkMinutes: 120 },
  { id: 2, projectId: 3, todoId: 7, userId: 12, workDate: '2026-10-02', minutes: 30, hours: 0.5, status: 'submitted', description: '等待确认', createdAt: '', updatedAt: '', projectName: 'Veges', todoTitle: todo.title, userName: '小李', estimatedWorkMinutes: 120 },
]

test('AI export prompt has stable analysis sections and explicit exclusions', () => {
  const prompt = buildAiExportPrompt({ title: '测试', scope: ['包含数量：1'], fields: ['字段'], data: '无数据' })
  assert.match(prompt, /^# 任务：请分析以下 Veges 工作数据/m)
  assert.match(prompt, /## 导出范围/u)
  assert.match(prompt, /## 数据说明/u)
  assert.match(prompt, /## 数据内容/u)
  assert.match(prompt, /## AI 分析要求/u)
  assert.match(prompt, /项目日记、图片二进制、临时下载地址、分享链接、权限配置和通知历史/u)
})

test('manual Bug image prompts are never sent back through AI generation', () => {
  assert.equal(shouldGenerateAiBugImagePrompt('', false), true)
  assert.equal(shouldGenerateAiBugImagePrompt('   ', false), true)
  assert.equal(shouldGenerateAiBugImagePrompt('直接使用这段图片提示词', false), false)
  assert.equal(shouldGenerateAiBugImagePrompt('', true), false)
})

test('processed Bug image URLs are removed from the final prompt preview', () => {
  const processedUrl = '/api/todo-images?key=veges%2Fprocessed.png&sig=signed'
  const untouchedUrl = '/api/todo-images?key=veges%2Funtouched.png&sig=signed'
  const prompt = buildAiBugExportPrompt({
    actualResult: `页面异常。![错误截图](${processedUrl}) ![待处理截图](${untouchedUrl})`,
    comments: [{ authorName: '测试员', content: `已复现 ${processedUrl}`, createdAt: '2026-10-05' }],
    environment: '测试环境',
    expectedResult: '页面正常',
    id: 42,
    imagePrompts: [{ label: 'Bug 附件图片', prompt: `核对错误信息，不要展示 ${processedUrl}` }],
    priority: 'high',
    processedImageReferences: [processedUrl],
    reproductionSteps: '打开页面',
    severity: 'major',
    status: 'in_progress',
    title: '页面异常',
  })

  assert.equal(prompt.includes(processedUrl), false)
  assert.equal(prompt.includes(untouchedUrl), true)
  assert.match(prompt, /错误截图，图片已处理/u)
})

test('Bug repair prompt is compact and focused on downstream repair', () => {
  const prompt = buildAiBugExportPrompt({
    actualResult: '提交后页面白屏',
    comments: Array.from({ length: 12 }, (_, index) => ({ authorName: '测试员', content: `记录 ${index}`, createdAt: '2026-10-05' })),
    environment: 'staging',
    expectedResult: '提交成功',
    id: 42,
    imagePrompts: [{ label: '执行截图', prompt: '页面显示错误码 E500，提交按钮可用。'.repeat(30) }],
    priority: 'high',
    reproductionSteps: '打开表单并提交',
    severity: 'major',
    status: 'in_progress',
    title: '提交白屏',
  })
  assert.match(prompt, /^# BUG-42 修复分析/u)
  assert.match(prompt, /## 已知事实/u)
  assert.match(prompt, /## 图片证据/u)
  assert.match(prompt, /指出建议检查和修改的代码位置/u)
  assert.doesNotMatch(prompt, /图片分析提示词/u)
  assert.ok(prompt.length <= 8_000)
})

test('Bug repair prompt keeps the repair task when evidence reaches the size limit', () => {
  const prompt = buildAiBugExportPrompt({
    actualResult: '实际'.repeat(2_000),
    comments: Array.from({ length: 8 }, (_, index) => ({ authorName: `测试员${index}`, content: '协作'.repeat(500), createdAt: '2026-10-05' })),
    environment: '环境'.repeat(500),
    expectedResult: '预期'.repeat(1_000),
    id: 43,
    imagePrompts: Array.from({ length: 8 }, (_, index) => ({ label: `截图${index}`, prompt: '证据'.repeat(500) })),
    priority: 'high',
    reproductionSteps: '步骤'.repeat(2_000),
    severity: 'major',
    status: 'in_progress',
    title: '超长 Bug',
  })
  assert.ok(prompt.length <= 8_000)
  assert.match(prompt, /## 任务/u)
  assert.match(prompt, /最小可行修复方案/u)
  assert.match(prompt, /不虚构未提供的事实/u)
})

test('todo export contains every promised structured field and work record', () => {
  const output = formatTodoExport(todo, entries)
  for (const field of ['详情', '备注', '创建日期', '截止日期', '优先级', '完成状态', '确认状态', '负责人', '创建人', '模块', '子项目', '工时记录']) {
    assert.match(output, new RegExp(field, 'u'))
  }
  assert.match(output, /完成读取/u)
  assert.match(output, /等待确认/u)
})

test('work-hour export filters and groups records by task', () => {
  const filtered = filterWorkHourEntries(entries, '等待确认', 'all')
  assert.equal(filtered.length, 1)
  const output = formatWorkHourExport(entries)
  assert.match(output, /### 任务：补齐导出字段/u)
  assert.match(output, /已确认（confirmed）/u)
  assert.match(output, /待确认（submitted）/u)
  assert.deepEqual(summarizeWorkHourStatuses(entries), {
    pending: { count: 0, minutes: 0 },
    submitted: { count: 1, minutes: 30 },
    confirmed: { count: 1, minutes: 60 },
  })
})

test('complete work-hour pagination advances by returned rows', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/ai-export-data.ts', import.meta.url)), 'utf8')
  assert.match(source, /fetchTodoWorkHours\(todoId, \{ cursor, limit: 50 \}\)/u)
  assert.match(source, /const next = page\.pagination \? page\.pagination\.offset \+ page\.entries\.length/u)
  assert.doesNotMatch(source, /records\.length < 5000/u)
  assert.equal(typeof fetchAllTodoWorkHours, 'function')
})

test('export boundaries remove disallowed entry points and global batch export', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8')
  const workHours = readFileSync(fileURLToPath(new URL('../src/components/work-hours-workbench.tsx', import.meta.url)), 'utf8')
  const weekly = readFileSync(fileURLToPath(new URL('../src/components/weekly-report-workbench.tsx', import.meta.url)), 'utf8')
  assert.doesNotMatch(app, /批量导出/u)
  assert.match(workHours, /mode === 'mine' \? <div[^>]*><Button[^>]*onClick=\{\(\) => openRecorder\(\)\}/u)
  assert.doesNotMatch(workHours, /function exportEntries/u)
  assert.match(weekly, /当前周报已默认选中/u)
  assert.match(weekly, /setExportCandidates/u)
})
