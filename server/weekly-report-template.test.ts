import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hasCanonicalWeeklyReportStructure,
  hasWeeklyReportBodyContent,
  isDefaultWeeklyReportTemplate,
  WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION,
  WEEKLY_REPORT_ITEM_FIELD_TITLES,
  WEEKLY_REPORT_TEMPLATE,
} from '../shared/weekly-report-template.ts'

test('weekly report template uses two placeholder items with canonical fields', () => {
  assert.deepEqual(WEEKLY_REPORT_ITEM_FIELD_TITLES, ['本周进展', '风险问题', '下周计划'])
  assert.equal(
    WEEKLY_REPORT_TEMPLATE,
    [
      '## 本周重点工作目标：',
      '',
      '---',
      '',
      '## 事项一：',
      '',
      '- 本周进展：',
      '- 风险问题：',
      '- 下周计划：',
      '',
      '---',
      '',
      '## 事项二：',
      '',
      '- 本周进展：',
      '- 风险问题：',
      '- 下周计划：',
    ].join('\n'),
  )
  assert.equal(isDefaultWeeklyReportTemplate(`\n${WEEKLY_REPORT_TEMPLATE}\n`), true)
  assert.equal(isDefaultWeeklyReportTemplate(`## 事项一：

- 本周进展：
- 风险问题：
- 下周计划：

---

## 事项二：

- 本周进展：
- 风险问题：
- 下周计划：`), true)
  assert.equal(isDefaultWeeklyReportTemplate(`${WEEKLY_REPORT_TEMPLATE}\n\n- 已填写`), false)
  assert.equal(hasWeeklyReportBodyContent(WEEKLY_REPORT_TEMPLATE), false)
  assert.equal(hasWeeklyReportBodyContent(`${WEEKLY_REPORT_TEMPLATE}\n\n- 已填写`), true)
})

test('AI weekly report instruction and validation share the item structure', () => {
  assert.match(WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION, /## 事项一：<事项名称>/u)
  assert.match(WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION, /- 本周进展：/u)
  assert.match(WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION, /- 风险问题：/u)
  assert.match(WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION, /- 下周计划：/u)
  assert.match(WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION, /不要按维度拆成全局章节/u)
  assert.equal(hasCanonicalWeeklyReportStructure(WEEKLY_REPORT_TEMPLATE), true)
  assert.equal(hasCanonicalWeeklyReportStructure(`# 周报\n\n${WEEKLY_REPORT_TEMPLATE}`), false)
  assert.equal(hasCanonicalWeeklyReportStructure('## 事项一：项目 A\n\n- 本周进展：已完成\n- 风险问题：暂无记录'), false)
  assert.equal(hasCanonicalWeeklyReportStructure('## 本周进展\n\n- 本周进展：已完成\n- 风险问题：暂无记录\n- 下周计划：继续推进'), false)
})
