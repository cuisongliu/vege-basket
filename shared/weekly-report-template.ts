export const WEEKLY_REPORT_ITEM_FIELD_TITLES = [
  '本周进展',
  '风险问题',
  '下周计划',
] as const

const WEEKLY_REPORT_GOAL_HEADING = '## 本周重点工作目标：'

const buildWeeklyReportItemTemplate = (itemNumber: string) => [
  `## 事项${itemNumber}：`,
  '',
  ...WEEKLY_REPORT_ITEM_FIELD_TITLES.map((title) => `- ${title}：`),
].join('\n')

export const WEEKLY_REPORT_TEMPLATE = [
  `${WEEKLY_REPORT_GOAL_HEADING}\n\n---`,
  buildWeeklyReportItemTemplate('一'),
  '---',
  buildWeeklyReportItemTemplate('二'),
].join('\n\n')

const LEGACY_WEEKLY_REPORT_TEMPLATE = [
  buildWeeklyReportItemTemplate('一'),
  '---',
  buildWeeklyReportItemTemplate('二'),
].join('\n\n')

export const WEEKLY_REPORT_AI_STRUCTURE_INSTRUCTION = [
  '输出必须按事项分组，每个事项严格使用以下结构：',
  '## 事项一：<事项名称>',
  '- 本周进展：<已经发生的进展和结果>',
  '- 风险问题：<有事实依据的风险、阻塞或问题>',
  '- 下周计划：<输入中明确出现的后续行动>',
  '存在多个事项时，依次使用“事项二”“事项三”等连续编号，并在事项之间插入一行“---”。',
  '每个事项的三个字段都必须保留；没有事实支撑的字段写“暂无记录”。不要按维度拆成全局章节，也不要输出额外的一级或二级标题、周期行或总结标题。',
].join('\n')

export function isDefaultWeeklyReportTemplate(value: string) {
  const normalized = value.trim()
  return normalized === WEEKLY_REPORT_TEMPLATE || normalized === LEGACY_WEEKLY_REPORT_TEMPLATE
}

export function hasWeeklyReportBodyContent(value: string) {
  return value
    .split('\n')
    .some((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed === '---') return false
      if (/^(?:## 本周重点工作目标：|## 事项(?:[一二三四五六七八九十]+|\d+)：)\s*$/u.test(trimmed)) return false
      return !/^-\s*(?:本周进展|风险问题|下周计划)：\s*$/u.test(trimmed)
    })
}

export function hasCanonicalWeeklyReportStructure(value: string) {
  const lines = value.trim().split('\n')
  const allHeadingIndexes = lines.flatMap((line, index) => (
    /^#{1,2}[ \t]+/u.test(line) ? [index] : []
  ))
  const firstHeadingIndex = allHeadingIndexes[0]
  const headingIndexes = allHeadingIndexes.filter((index) => (
    index !== firstHeadingIndex || lines[index].trim() !== WEEKLY_REPORT_GOAL_HEADING
  ))
  if (headingIndexes.length === 0) return false

  for (const [position, headingIndex] of headingIndexes.entries()) {
    if (!/^## 事项(?:[一二三四五六七八九十]+|\d+)：(?:\S.*)?$/u.test(lines[headingIndex].trim())) {
      return false
    }
    const nextHeadingIndex = headingIndexes[position + 1] ?? lines.length
    const fields = lines
      .slice(headingIndex + 1, nextHeadingIndex)
      .flatMap((line) => {
        const match = line.trim().match(/^-\s*(本周进展|风险问题|下周计划)：/u)
        return match ? [match[1]] : []
      })
    if (fields.length !== WEEKLY_REPORT_ITEM_FIELD_TITLES.length
      || fields.some((field, index) => field !== WEEKLY_REPORT_ITEM_FIELD_TITLES[index])) {
      return false
    }
  }

  return true
}
