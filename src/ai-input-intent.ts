import type { SummaryPeriodType } from './types'

export type AiInputIntent =
  | { kind: 'chat' }
  | { kind: 'conversation-analysis' }
  | { kind: 'project-summary'; period: SummaryPeriodType }
  | { content: string; kind: 'todo-extraction' }

const negativeCommandPattern =
  /^(?:(?:请|麻烦)(?:你)?|帮我)?\s*(?:不要|不用|无需|别|不需要|请勿)/u
const todoCommandPattern =
  /^(?:(?:请|麻烦)(?:帮我|你)?|帮我|帮忙)?\s*(?:(?:从|把).{0,16})?(?:提取|抽取|识别|整理|生成|创建).{0,12}(?:待办|任务|todo)/iu
const conversationCommandPattern =
  /^(?:(?:请|麻烦)(?:帮我|你)?|帮我|帮忙)?\s*(?:(?:分析|复盘|梳理|总结).{0,10}(?:对话|聊天(?:记录)?|会议记录)|(?:把|对)?.{0,10}(?:对话|聊天(?:记录)?|会议记录).{0,10}(?:分析|复盘|梳理|总结))/u
const summaryCommandPattern =
  /^(?:(?:请|麻烦)(?:帮我|你)?|帮我|帮忙)?\s*(?:(?:总结|复盘|生成).{0,10}(?:项目(?:日报|周报|日总结|周总结)?|日报|周报|日总结|周总结)|(?:给|把)?.{0,10}(?:项目(?:日报|周报|日总结|周总结)?|日报|周报|日总结|周总结).{0,10}(?:总结|复盘|生成))/u
const historicalSummaryPattern =
  /(?:昨天|前天|上周|上星期|上个月|去年|过去|此前|历史|截至|\d{4}[年/-]\d{1,2})/u
const capabilityQuestionRemainderPattern =
  /^(?:[，,：:]?\s*)?(?:的|这个)?(?:功能|能力|入口|流程)?\s*(?:需要|会|能|可以|支持|是否|应该|如何|怎么|哪些|是什么|有什么|为什么|吗|么)/u
const markdownLinePattern = /^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+|```|\|.*\|\s*$)/u

function hasMarkdownSource(content: string) {
  const markdownLines = content
    .split(/\r?\n/u)
    .filter((line) => markdownLinePattern.test(line))

  return /(?:^|\n)\s*[-*+]\s+\[[ xX]\]\s+/u.test(content) || markdownLines.length >= 2
}

function withoutLeadingTodoInstruction(content: string) {
  const lines = content.split(/\r?\n/u)
  const commandIndex = lines.findIndex((line) => line.trim())
  if (commandIndex < 0 || !todoCommandPattern.test(lines[commandIndex].trim())) {
    return content.trim()
  }
  return lines.slice(commandIndex + 1).join('\n').trim()
}

function summaryPeriod(content: string): SummaryPeriodType {
  if (/(?:日报|日总结|今日|今天|昨天)/u.test(content)) return 'daily'
  return 'weekly'
}

function asksAboutCapability(commandLine: string, matchedCommand: string) {
  return capabilityQuestionRemainderPattern.test(commandLine.slice(matchedCommand.length))
}

export function classifyAiInput(content: string): AiInputIntent {
  const normalized = content.trim()
  if (!normalized) return { kind: 'chat' }
  const commandLine = normalized.split(/\r?\n/u).find((line) => line.trim())?.trim() ?? ''
  if (negativeCommandPattern.test(commandLine)) return { kind: 'chat' }

  const todoCommand = commandLine.match(todoCommandPattern)?.[0]
  if (
    todoCommand &&
    !asksAboutCapability(commandLine, todoCommand) &&
    hasMarkdownSource(normalized)
  ) {
    const markdownContent = withoutLeadingTodoInstruction(normalized)
    if (markdownContent) return { content: markdownContent, kind: 'todo-extraction' }
  }

  const conversationCommand = commandLine.match(conversationCommandPattern)?.[0]
  if (conversationCommand && !asksAboutCapability(commandLine, conversationCommand)) {
    return { kind: 'conversation-analysis' }
  }

  const summaryCommand = commandLine.match(summaryCommandPattern)?.[0]
  if (
    summaryCommand &&
    !asksAboutCapability(commandLine, summaryCommand) &&
    !historicalSummaryPattern.test(commandLine)
  ) {
    return { kind: 'project-summary', period: summaryPeriod(commandLine) }
  }

  return { kind: 'chat' }
}
