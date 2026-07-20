import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiClassificationContent,
  classifyAiInput,
} from '../src/ai-input-intent.ts'

test('routes explicit Markdown todo extraction with source content', () => {
  assert.deepEqual(
    classifyAiInput('请从下面的 Markdown 提取待办：\n\n# 发布计划\n- [ ] 完成验收'),
    {
      content: '# 发布计划\n- [ ] 完成验收',
      kind: 'todo-extraction',
    },
  )
})

test('keeps todo requests without pasted Markdown in ordinary chat', () => {
  assert.deepEqual(classifyAiInput('请帮我提取待办'), { kind: 'chat' })
})

test('routes explicit conversation analysis', () => {
  assert.deepEqual(
    classifyAiInput('请分析下面这段对话，并整理决定和待办：\nA：周五发布。\nB：我来验收。'),
    { kind: 'conversation-analysis' },
  )
})

test('classifies attachment-only intent from raw attachment content', () => {
  const content = buildAiClassificationContent('', [{
    content: '请分析下面这段对话：\nA：周五发布。\nB：我来验收。',
  }])

  assert.deepEqual(classifyAiInput(content), { kind: 'conversation-analysis' })
})

test('routes project summary requests and infers the requested period', () => {
  assert.deepEqual(
    classifyAiInput('总结一下这个项目今天的进展'),
    { kind: 'project-summary', period: 'daily' },
  )
  assert.deepEqual(
    classifyAiInput('生成这个项目的周报'),
    { kind: 'project-summary', period: 'weekly' },
  )
})

test('keeps ambiguous project questions in ordinary chat', () => {
  assert.deepEqual(classifyAiInput('这个项目现在最大的风险是什么？'), { kind: 'chat' })
})

test('does not route negated capability requests', () => {
  assert.deepEqual(classifyAiInput('不要总结这个项目，只回答我的问题'), { kind: 'chat' })
  assert.deepEqual(
    classifyAiInput('请不要分析下面这段对话，只帮我润色：\nA：周五发布。'),
    { kind: 'chat' },
  )
  assert.deepEqual(
    classifyAiInput('不要从下面的 Markdown 提取待办，只帮我润色：\n# 计划\n- [ ] 发布'),
    { kind: 'chat' },
  )
})

test('only treats the first meaningful line as a capability command', () => {
  assert.deepEqual(
    classifyAiInput('帮我润色下面这段话：\n不要总结这个项目。\n分析下面这段对话。'),
    { kind: 'chat' },
  )
})

test('keeps historical summary periods in ordinary chat', () => {
  assert.deepEqual(classifyAiInput('总结一下这个项目昨天的进展'), { kind: 'chat' })
  assert.deepEqual(classifyAiInput('生成这个项目的上周周报'), { kind: 'chat' })
})

test('keeps capability questions and design discussions in ordinary chat', () => {
  assert.deepEqual(classifyAiInput('总结一个项目需要哪些信息？'), { kind: 'chat' })
  assert.deepEqual(classifyAiInput('生成项目周报的功能应该怎么设计？'), { kind: 'chat' })
  assert.deepEqual(classifyAiInput('分析对话会清空项目上下文吗？'), { kind: 'chat' })
})

test('allows explicit commands to include output questions', () => {
  assert.deepEqual(
    classifyAiInput('请分析下面这段对话，看看有什么问题'),
    { kind: 'conversation-analysis' },
  )
  assert.deepEqual(
    classifyAiInput('请分析下面这段对话，建议应该如何推进'),
    { kind: 'conversation-analysis' },
  )
  assert.deepEqual(
    classifyAiInput('请总结这个项目今天有什么进展'),
    { kind: 'project-summary', period: 'daily' },
  )
  assert.deepEqual(
    classifyAiInput('请从下面的 Markdown 提取待办，并说明哪些需要优先处理\n# 计划\n- [ ] 发布'),
    { content: '# 计划\n- [ ] 发布', kind: 'todo-extraction' },
  )
})

test('routes the empty-chat example prompts through their intended capabilities', () => {
  assert.deepEqual(
    classifyAiInput('帮我梳理本周进展，并给出下一步行动建议。'),
    { kind: 'chat' },
  )
  assert.deepEqual(
    classifyAiInput('生成这个项目的周报'),
    { kind: 'project-summary', period: 'weekly' },
  )
  assert.deepEqual(
    classifyAiInput([
      '分析下面这段对话里的结论和分歧：',
      '',
      '小王：本周先上线搜索，导出功能下周再做。',
      '小李：我认为导出更影响交付，应该优先。',
      '小王：那先补导出，搜索顺延到下周。',
    ].join('\n')),
    { kind: 'conversation-analysis' },
  )
  assert.deepEqual(
    classifyAiInput([
      '从下面的 Markdown 示例中提取待办：',
      '',
      '## 发布准备',
      '- [ ] 完成移动端回归',
      '- [ ] 更新部署说明',
      '- [x] 确认版本号',
    ].join('\n')),
    {
      content: [
        '## 发布准备',
        '- [ ] 完成移动端回归',
        '- [ ] 更新部署说明',
        '- [x] 确认版本号',
      ].join('\n'),
      kind: 'todo-extraction',
    },
  )
})
