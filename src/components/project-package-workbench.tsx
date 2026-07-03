import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  CaretDown,
  CaretRight,
  Code,
  CodeBlock,
  Copy,
  DotsThree,
  Highlighter,
  Package,
  Plus,
  ShoppingCartSimple,
  Trash,
} from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  PackageMarketChannel,
  PackageMarketDetail,
  PackageMarketRule,
  PackageMarketVersion,
  Project,
  ProjectMembership,
  ProjectPackageEvent,
  ProjectPackageEventStatus,
  ProjectPackageGroup,
  ProjectPackageItem,
  ProjectPackageEventType,
  ProjectPackageOperation,
  ProjectPackageOperationKind,
  ProjectPackageTimeline,
  Todo,
} from '@/types'

type PackageWorkbenchProps = {
  onAddItems: (
    eventId: number,
    items: Array<{
      sourcePackageId: string
      sourcePackageName: string
      packageName: string
      channel: string
      channelLabel: string
      arch: string
      version: string
      objectKey: string
      objectLastModified?: string
      sizeBytes?: number
    }>,
  ) => Promise<void>
  onCreateEvent: (payload: {
    assigneeUserId: number
    title: string
    type: ProjectPackageEventType
  }) => Promise<void>
  onCreateOperation: (payload: {
    eventId: number
    groupId?: number | null
    kind: ProjectPackageOperationKind
    title?: string
    label?: string
    content?: string
    completed?: boolean
    status?: ProjectPackageEventStatus
    relatedTodoIds?: number[]
    relatedTodoNotes?: Record<number, string>
  }) => Promise<void>
  onDeleteEvent: (eventId: number) => Promise<void>
  onDeleteGroup: (groupId: number) => Promise<void>
  onDeleteOperation: (operationId: number) => Promise<void>
  onExportTimeline: () => Promise<{ fileName: string; markdown: string }>
  onLoadPackageMarketDetail: (payload: {
    arch: string
    channel: PackageMarketChannel
    ciVersion?: string
    deployType?: 'pro' | 'oss'
    expireMinutes?: number
    packageId: string
    releaseVersion?: string
  }) => Promise<PackageMarketDetail>
  onLoadPackageMarketRules: () => Promise<{
    expireMinutes: number
    rules: PackageMarketRule[]
  }>
  onLoadPackageMarketVersions: (payload: {
    arch: string
    kind: 'ci' | 'release'
    deployType?: 'pro' | 'oss'
    packageId: string
  }) => Promise<PackageMarketVersion[]>
  onUpdateEvent: (
    eventId: number,
    payload: Partial<{
      assigneeUserId: number
      status: ProjectPackageEventStatus
      title: string
      type: ProjectPackageEventType
    }>,
  ) => Promise<void>
  onUpdateOperation: (
    operationId: number,
    payload: Partial<{
      title: string
      label: string
      content: string
      completed: boolean
      status: ProjectPackageEventStatus
      relatedTodoIds: number[]
      relatedTodoNotes: Record<number, string>
    }>,
  ) => Promise<void>
  onUpdateTodo: (
    todoId: number,
    payload: Partial<Pick<Todo, 'done'>>,
  ) => void | Promise<void>
  currentUserId?: number
  memberships: ProjectMembership[]
  project: Project
  todos: Todo[]
  timeline: ProjectPackageTimeline | null
}

export type ProjectPackageWorkbenchHandle = {
  exportTimeline: () => void
  openPackageMarket: () => void
}

type PendingOperationTarget =
  | {
      defaultTitle?: string
      eventId: number
      groupId?: number | null
      operation?: ProjectPackageOperation | null
    }
  | null

function eventTypeLabel(type: ProjectPackageEventType) {
  return type === 'init' ? '初始化安装' : '升级'
}

function eventStatusLabel(status: ProjectPackageEventStatus) {
  if (status === 'success') return '已成功完成'
  if (status === 'failed') return '失败'
  return '未完成'
}

function channelLabel(channel: PackageMarketChannel) {
  return channel === 'ci' ? '测试包' : '正式包'
}

const packageMarketExpireOptions = [
  { label: '30 分钟', value: 30 },
  { label: '60 分钟（1 小时）', value: 60 },
  { label: '90 分钟', value: 90 },
  { label: '2 小时', value: 120 },
  { label: '5 小时', value: 300 },
  { label: '10 小时', value: 600 },
]

function getEventCompletionProgress(event: ProjectPackageEvent) {
  const childOperations = [
    ...event.operations,
    ...event.groups.flatMap((group) => group.operations),
  ]
  const total = childOperations.length
  const completed = childOperations.filter((operation) => operation.status === 'success').length
  return {
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    total,
  }
}

function formatBytes(bytes?: number) {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function itemChannelLabel(item: Pick<ProjectPackageItem, 'channel' | 'channelLabel'>) {
  if (item.channelLabel) return item.channelLabel
  return item.channel === 'ci' ? '测试包' : '正式包'
}

function summarizeGroup(group: ProjectPackageGroup) {
  return group.items
    .map((item) =>
      [itemChannelLabel(item), item.arch, item.version || '未知版本'].filter(Boolean).join(' · '),
    )
    .join('；')
}

function operationHeading(operation: ProjectPackageOperation) {
  return operation.kind === 'document' ? operation.title || '未命名文档' : operation.label || '操作事件'
}

function summarizeTodoNote(note?: string, limit = 42) {
  const normalized = String(note ?? '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function todoSearchMeta(todo: Todo) {
  return [
    todo.title,
    todo.assigneeName ?? '',
    todo.creatorName ?? '',
    todo.priority,
    todo.dueDate,
    todo.createdAt,
    todo.done ? '已完成 完成 done' : '未完成 未做 open pending',
  ]
    .join(' ')
    .toLowerCase()
}

function renderOperationTodoChips(
  operation: ProjectPackageOperation,
  todosById: Map<number, Todo>,
) {
  if (operation.relatedTodoIds.length === 0) return null
  return (
    <div className="operation-entry-todos">
      {operation.relatedTodoIds
        .map((todoId) => todosById.get(todoId))
        .filter((todo): todo is Todo => Boolean(todo))
        .map((todo) => (
          <span className="operation-entry-todo-chip" key={todo.id}>
            {todo.done ? '已完成' : '待办'} · {todo.title}
            {summarizeTodoNote(operation.relatedTodoNotes[todo.id])
              ? ` · ${summarizeTodoNote(operation.relatedTodoNotes[todo.id])}`
              : ''}
          </span>
        ))}
    </div>
  )
}

function getOperationCardClassName(
  operation: ProjectPackageOperation,
  todosById: Map<number, Todo>,
) {
  const relatedTodos = operation.relatedTodoIds
    .map((todoId) => todosById.get(todoId))
    .filter((todo): todo is Todo => Boolean(todo))
  const isCompleted = relatedTodos.length > 0 && relatedTodos.every((todo) => todo.done)
  return isCompleted
    ? 'operation-entry completed'
    : 'operation-entry'
}

function priorityLabel(priority: Todo['priority']) {
  if (priority === 'high') return '高优先级'
  if (priority === 'low') return '低优先级'
  return '中优先级'
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[], direction: 'asc' | 'desc' = 'asc') {
  return [...items].sort((left, right) => {
    const delta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    return direction === 'asc' ? delta : -delta
  })
}

function downloadMarkdownFile(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function DeleteConfirmDialog({
  confirmLabel,
  description,
  onConfirm,
  title,
  trigger,
}: {
  confirmLabel: string
  description: string
  onConfirm: () => void | Promise<void>
  title: string
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            className="destructive-button"
            type="button"
            onClick={() => {
              void Promise.resolve(onConfirm()).finally(() => setOpen(false))
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function escapeHtml(value: string) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    }
    return entities[char] ?? char
  })
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, '&#096;')
}

function escapeMarkdownInline(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

function renderInlineLines(lines: string[]) {
  return lines.map((line) => escapeMarkdownInline(line)).join('<br />')
}

function splitMarkdownTableRow(row: string) {
  const trimmed = row.trim()
  const normalized = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaping = false

  for (const char of normalized) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  cells.push(current.trim())
  return cells
}

function isMarkdownTableRow(row: string) {
  const trimmed = row.trim()
  return trimmed.includes('|') && splitMarkdownTableRow(trimmed).length >= 2
}

function isMarkdownTableDivider(row: string) {
  if (!isMarkdownTableRow(row)) return false
  const cells = splitMarkdownTableRow(row)
  return cells.length >= 2 && cells.every((cell) => /^:?[=-]{3,}:?$/.test(cell.replace(/\s+/g, '')))
}

function getMarkdownTableAlignments(dividerRow: string) {
  return splitMarkdownTableRow(dividerRow).map((cell) => {
    const normalized = cell.replace(/\s+/g, '')
    const left = normalized.startsWith(':')
    const right = normalized.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

function renderMarkdownTable(headerRow: string, dividerRow: string, bodyRows: string[]) {
  const headers = splitMarkdownTableRow(headerRow)
  const alignments = getMarkdownTableAlignments(dividerRow)
  const columnCount = Math.max(
    headers.length,
    alignments.length,
    ...bodyRows.map((row) => splitMarkdownTableRow(row).length),
  )
  const normalizeCells = (cells: string[]) =>
    Array.from({ length: columnCount }, (_, index) => cells[index] ?? '')
  const renderCell = (tag: 'td' | 'th', cell: string, index: number) => {
    const align = alignments[index] ?? 'left'
    return `<${tag} style="text-align:${align}">${escapeMarkdownInline(cell)}</${tag}>`
  }
  const thead = `<thead><tr>${normalizeCells(headers)
    .map((cell, cellIndex) => renderCell('th', cell, cellIndex))
    .join('')}</tr></thead>`
  const tbodyRows = bodyRows
    .map((row) => normalizeCells(splitMarkdownTableRow(row)))
    .filter((cells) => cells.some(Boolean))
    .map((cells) => `<tr>${cells.map((cell, cellIndex) => renderCell('td', cell, cellIndex)).join('')}</tr>`)
    .join('')
  const tbody = tbodyRows ? `<tbody>${tbodyRows}</tbody>` : ''
  return `<div class="markdown-table-wrap"><table>${thead}${tbody}</table></div>`
}

function classifyCodeToken(token: string) {
  if (/^https?:\/\//.test(token)) return 'token-url'
  if (/^(\/\/|#)/.test(token)) return 'token-comment'
  if (/^['"]/.test(token)) return 'token-string'
  if (/^\d/.test(token)) return 'token-number'
  if (/^(kubectl|helm|docker|npm|pnpm|yarn|bash|sh|curl|wget|git)$/.test(token)) return 'token-command'
  if (
    /^(const|let|var|function|return|if|else|for|while|class|new|import|from|export|async|await|try|catch|throw|switch|case|break|continue|true|false|null|undefined)$/.test(
      token,
    )
  ) {
    return 'token-keyword'
  }
  return 'token-operator'
}

function highlightCode(code: string, language = '') {
  const tokenPattern =
    /(https?:\/\/[^\s]+|\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:kubectl|helm|docker|npm|pnpm|yarn|bash|sh|curl|wget|git)\b|\b(?:const|let|var|function|return|if|else|for|while|class|new|import|from|export|async|await|try|catch|throw|switch|case|break|continue|true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|=>|===|!==|==|!=|&&|\|\||[=+-])/gm
  let html = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(code))) {
    const token = match[0]
    const offset = match.index
    html += escapeHtml(code.slice(lastIndex, offset))
    html += `<span class="${classifyCodeToken(token)}">${escapeHtml(token)}</span>`
    lastIndex = offset + token.length
  }

  html += escapeHtml(code.slice(lastIndex))
  return `<pre><code data-language="${escapeAttribute(language)}">${html}</code></pre>`
}

function renderMarkdownPreview(markdown: string) {
  const source = String(markdown || '').replace(/\r\n/g, '\n')
  if (!source.trim()) {
    return '<p class="operation-empty">预览会显示在这里，支持标题、列表、引用、代码块。</p>'
  }

  const lines = source.split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    if (/^```/.test(line)) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(highlightCode(codeLines.join('\n'), language))
      continue
    }

    if (!line.trim()) {
      index += 1
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      const headingText = heading[2].trim()
      let headingClass = ''
      if (level === 2) headingClass = 'markdown-section-break'
      if (level === 4 && !/^\d+\./.test(headingText) && headingText !== '事件文档') {
        headingClass = 'markdown-package-break'
      }
      blocks.push(`<h${level}${headingClass ? ` class="${headingClass}"` : ''}>${escapeMarkdownInline(headingText)}</h${level}>`)
      index += 1
      continue
    }

    if (
      isMarkdownTableRow(line) &&
      index + 1 < lines.length &&
      isMarkdownTableDivider(lines[index + 1])
    ) {
      const headerRow = line
      const dividerRow = lines[index + 1]
      const bodyRows: string[] = []
      index += 2
      while (
        index < lines.length &&
        lines[index].trim() &&
        isMarkdownTableRow(lines[index]) &&
        !isMarkdownTableDivider(lines[index])
      ) {
        bodyRows.push(lines[index])
        index += 1
      }
      blocks.push(renderMarkdownTable(headerRow, dividerRow, bodyRows))
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${renderInlineLines(quoteLines)}</blockquote>`)
      continue
    }

    if (/^(-|\*)\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^(-|\*)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^(-|\*)\s+/, ''))
        index += 1
      }
      blocks.push(`<ul>${items.map((item) => `<li>${escapeMarkdownInline(item)}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(`<ol>${items.map((item) => `<li>${escapeMarkdownInline(item)}</li>`).join('')}</ol>`)
      continue
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push('<hr />')
      index += 1
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index]) &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !(
        isMarkdownTableRow(lines[index]) &&
        index + 1 < lines.length &&
        isMarkdownTableDivider(lines[index + 1])
      ) &&
      !/^>\s?/.test(lines[index]) &&
      !/^(-|\*)\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !/^---+$/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }
    blocks.push(`<p>${renderInlineLines(paragraphLines)}</p>`)
  }

  return blocks.join('')
}

function findInlineWrapperAtCursor(
  value: string,
  position: number,
  prefix: string,
  suffix: string,
) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const lineEndIndex = value.indexOf('\n', position)
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex
  const line = value.slice(lineStart, lineEnd)
  const cursorOffset = position - lineStart
  let searchFrom = 0

  while (searchFrom < line.length) {
    const openIndex = line.indexOf(prefix, searchFrom)
    if (openIndex === -1) break
    const contentStart = openIndex + prefix.length
    const closeIndex = line.indexOf(suffix, contentStart)
    if (closeIndex === -1) break
    if (cursorOffset >= contentStart && cursorOffset <= closeIndex) {
      return {
        wrapperStart: lineStart + openIndex,
        contentStart: lineStart + contentStart,
        contentEnd: lineStart + closeIndex,
        wrapperEnd: lineStart + closeIndex + suffix.length,
      }
    }
    searchFrom = closeIndex + suffix.length
  }

  return null
}

function findEnclosingCodeBlock(value: string, start: number, end: number) {
  const fencePattern = /(^|\n)```([^\n]*)\n([\s\S]*?)\n```(?=\n|$)/g
  let match: RegExpExecArray | null

  while ((match = fencePattern.exec(value))) {
    const leadingBreak = match[1].length
    const blockStart = match.index + leadingBreak
    const openingFence = `\`\`\`${match[2]}`
    const contentStart = blockStart + openingFence.length + 1
    const content = match[3]
    const contentEnd = contentStart + content.length
    const blockEnd = blockStart + match[0].length - leadingBreak

    if (start >= blockStart && end <= blockEnd) {
      return {
        blockStart,
        blockEnd,
        contentStart,
        contentEnd,
        content,
      }
    }
  }

  return null
}

const operationEventOptions: Array<{
  label: string
  type: ProjectPackageEventType
}> = [
  { label: '初始化安装', type: 'init' },
  { label: '升级', type: 'upgrade' },
]

export const ProjectPackageWorkbench = forwardRef<ProjectPackageWorkbenchHandle, PackageWorkbenchProps>(function ProjectPackageWorkbench({
  currentUserId,
  memberships,
  onAddItems,
  onCreateEvent,
  onCreateOperation,
  onDeleteEvent,
  onDeleteGroup,
  onDeleteOperation,
  onExportTimeline,
  onLoadPackageMarketDetail,
  onLoadPackageMarketRules,
  onLoadPackageMarketVersions,
  onUpdateEvent,
  onUpdateOperation,
  onUpdateTodo,
  project,
  todos,
  timeline,
}, ref) {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [eventDialogOpen, setEventDialogOpen] = useState(false)
  const [eventDialogMode, setEventDialogMode] = useState<'create' | 'edit'>('create')
  const [eventAssigneeUserId, setEventAssigneeUserId] = useState('')
  const [eventTitle, setEventTitle] = useState('')
  const [eventType, setEventType] = useState<ProjectPackageEventType>('upgrade')
  const [operationDialogOpen, setOperationDialogOpen] = useState(false)
  const [operationTitle, setOperationTitle] = useState('')
  const [operationContent, setOperationContent] = useState('')
  const [operationKind, setOperationKind] = useState<ProjectPackageOperationKind>('document')
  const [pendingOperationTarget, setPendingOperationTarget] = useState<PendingOperationTarget>(null)
  const [operationTodoDialogOpen, setOperationTodoDialogOpen] = useState(false)
  const [todoDialogOperationId, setTodoDialogOperationId] = useState<number | null>(null)
  const [todoDialogRelatedTodoIds, setTodoDialogRelatedTodoIds] = useState<number[]>([])
  const [todoDialogRelatedTodoNotes, setTodoDialogRelatedTodoNotes] = useState<Record<number, string>>({})
  const [todoDialogTodoDoneMap, setTodoDialogTodoDoneMap] = useState<Record<number, boolean>>({})
  const [todoDialogSearch, setTodoDialogSearch] = useState('')
  const [todoPickerOpen, setTodoPickerOpen] = useState(false)
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false)
  const [exportFileName, setExportFileName] = useState('')
  const [exportContent, setExportContent] = useState('')
  const [marketOpen, setMarketOpen] = useState(false)
  const [marketRules, setMarketRules] = useState<PackageMarketRule[]>([])
  const [marketExpireMinutes, setMarketExpireMinutes] = useState(packageMarketExpireOptions[0].value)
  const [marketSelectedPackage, setMarketSelectedPackage] = useState('base-pro')
  const [marketChannel, setMarketChannel] = useState<PackageMarketChannel>('release')
  const [marketArch, setMarketArch] = useState<'amd64' | 'arm64'>('amd64')
  const [marketSearch, setMarketSearch] = useState('')
  const [marketReleaseVersion, setMarketReleaseVersion] = useState('')
  const [marketCiVersion, setMarketCiVersion] = useState('')
  const [marketReleaseVersions, setMarketReleaseVersions] = useState<PackageMarketVersion[]>([])
  const [marketCiVersions, setMarketCiVersions] = useState<PackageMarketVersion[]>([])
  const [marketDetail, setMarketDetail] = useState<PackageMarketDetail | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState('')
  const [marketExpandedGroups, setMarketExpandedGroups] = useState<Record<'base' | 'apps' | 'middleware', boolean>>({
    base: true,
    apps: true,
    middleware: true,
  })
  const [cartItems, setCartItems] = useState<
    Array<{
      sourcePackageId: string
      sourcePackageName: string
      packageName: string
      channel: string
      channelLabel: string
      arch: string
      version: string
      objectKey: string
      objectLastModified?: string
      sizeBytes?: number
    }>
  >([])
  const [busyAction, setBusyAction] = useState('')
  const [copiedValue, setCopiedValue] = useState('')
  const operationTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const exportTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const todoPickerSearchRef = useRef<HTMLInputElement | null>(null)

  const events = useMemo(() => timeline?.events ?? [], [timeline])
  const memberOptions = useMemo(() => {
    const options = new Map<number, string>()
    options.set(project.ownerUserId, project.ownerName || '项目 Owner')
    memberships
      .filter((membership) => membership.projectId === project.id && membership.status === 'active' && membership.invitedUserId)
      .forEach((membership) => {
        options.set(
          Number(membership.invitedUserId),
          membership.memberName || membership.invitedUsername || `成员 ${membership.invitedUserId}`,
        )
      })
    return [...options.entries()].map(([id, name]) => ({ id, name }))
  }, [memberships, project.id, project.ownerName, project.ownerUserId])
  const [assignedOnly, setAssignedOnly] = useState(false)
  const visibleEvents = useMemo(
    () =>
      assignedOnly && currentUserId
        ? events.filter((event) => event.assigneeUserId === currentUserId)
        : events,
    [assignedOnly, currentUserId, events],
  )
  const todosById = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo])),
    [todos],
  )
  const selectableTodos = useMemo(
    () =>
      [...todos]
        .filter((todo) => todo.confirmed)
        .sort((left, right) => {
        if (left.done !== right.done) return Number(left.done) - Number(right.done)
        if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate)
        return left.id - right.id
      }),
    [todos],
  )
  const selectableTodosById = useMemo(
    () => new Map(selectableTodos.map((todo) => [todo.id, todo])),
    [selectableTodos],
  )
  const canManageTimeline = project.accessRole === 'owner' || project.accessRole === 'member'
  const todoDialogOperation = useMemo(
    () =>
      todoDialogOperationId == null
        ? null
        : events
          .flatMap((event) => [
            ...event.operations,
            ...event.groups.flatMap((group) => group.operations),
          ])
          .find((operation) => operation.id === todoDialogOperationId) ?? null,
    [events, todoDialogOperationId],
  )
  const todoDialogSelectedIds = useMemo(
    () => new Set(todoDialogRelatedTodoIds),
    [todoDialogRelatedTodoIds],
  )
  const filteredTodoDialogTodos = useMemo(() => {
    const query = todoDialogSearch.trim().toLowerCase()
    if (!query) return selectableTodos
    return selectableTodos.filter((todo) => todoSearchMeta(todo).includes(query))
  }, [selectableTodos, todoDialogSearch])
  const todoDialogSelectedTodos = useMemo(
    () =>
      todoDialogRelatedTodoIds
        .map((todoId) => selectableTodosById.get(todoId) ?? todosById.get(todoId))
        .filter((todo): todo is Todo => Boolean(todo)),
    [selectableTodosById, todoDialogRelatedTodoIds, todosById],
  )

  const selectedEvent =
    visibleEvents.find((event) => event.id === selectedEventId) ?? visibleEvents[0] ?? null

  const selectedGroup =
    selectedEvent?.groups.find((group) => group.id === selectedGroupId) ??
    selectedEvent?.groups[0] ??
    null
  const selectedEventProgress = selectedEvent
    ? getEventCompletionProgress(selectedEvent)
    : { completed: 0, percent: 0, total: 0 }

  const filteredRules = useMemo(() => {
    const query = marketSearch.trim().toLowerCase()
    const baseRules: PackageMarketRule[] = [
      {
        id: 'base-pro',
        name: 'sealos-pro',
        category: 'apps',
        mode: 'release',
        releaseRoots: [],
        flatFileRoots: [],
        fileNameFormats: [],
        ciFileNameFormats: [],
      },
      {
        id: 'base-oss',
        name: 'sealos-oss',
        category: 'apps',
        mode: 'release',
        releaseRoots: [],
        flatFileRoots: [],
        fileNameFormats: [],
        ciFileNameFormats: [],
      },
      ...marketRules,
    ]
    return baseRules.filter((rule) => {
      if (!query) return true
      return `${rule.id} ${rule.name}`.toLowerCase().includes(query)
    })
  }, [marketRules, marketSearch])

  const groupedMarketRules = useMemo(() => {
    const base = filteredRules.filter((rule) => rule.id === 'base-pro' || rule.id === 'base-oss')
    const apps = filteredRules.filter(
      (rule) => rule.category === 'apps' && rule.id !== 'base-pro' && rule.id !== 'base-oss',
    )
    const middleware = filteredRules.filter((rule) => rule.category === 'middleware')
    return { apps, base, middleware }
  }, [filteredRules])

  async function copyToClipboard(value: string, feedbackKey: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopiedValue(feedbackKey)
    window.setTimeout(() => {
      setCopiedValue((current) => (current === feedbackKey ? '' : current))
    }, 1200)
  }

  function copiedLabel(feedbackKey: string, fallback: string) {
    return copiedValue === feedbackKey ? '已复制' : fallback
  }

  useEffect(() => {
    if (!todoPickerOpen) return
    const frameId = window.requestAnimationFrame(() => {
      todoPickerSearchRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [todoPickerOpen])

  async function loadMarketContext() {
    setMarketLoading(true)
    setMarketError('')
    try {
      const rulesPayload = await onLoadPackageMarketRules()
      setMarketRules(rulesPayload.rules)
      setMarketExpireMinutes(
        packageMarketExpireOptions.some((option) => option.value === rulesPayload.expireMinutes)
          ? rulesPayload.expireMinutes
          : packageMarketExpireOptions[0].value,
      )
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : '包市场读取失败')
    } finally {
      setMarketLoading(false)
    }
  }

  async function refreshMarketDetail(nextOverrides?: Partial<{
    arch: 'amd64' | 'arm64'
    channel: PackageMarketChannel
    ciVersion: string
    expireMinutes: number
    packageId: string
    releaseVersion: string
  }>) {
    const packageId = nextOverrides?.packageId ?? marketSelectedPackage
    const channel = nextOverrides?.channel ?? marketChannel
    const arch = nextOverrides?.arch ?? marketArch
    const releaseVersion = nextOverrides?.releaseVersion ?? marketReleaseVersion
    const ciVersion = nextOverrides?.ciVersion ?? marketCiVersion
    const expireMinutes = nextOverrides?.expireMinutes ?? marketExpireMinutes
    setMarketLoading(true)
    setMarketError('')
    try {
      const [versions, detail] = await Promise.all([
        channel === 'ci'
          ? onLoadPackageMarketVersions({
              arch,
              kind: 'ci',
              packageId,
            })
          : onLoadPackageMarketVersions({
              arch,
              kind: 'release',
              packageId,
              deployType: packageId === 'base-oss' ? 'oss' : packageId === 'base-pro' ? 'pro' : undefined,
            }),
        onLoadPackageMarketDetail({
          packageId,
          channel,
          arch,
          deployType:
            packageId === 'base-oss' ? 'oss' : packageId === 'base-pro' ? 'pro' : undefined,
          expireMinutes,
          releaseVersion,
          ciVersion,
        }),
      ])
      if (channel === 'ci') {
        setMarketCiVersions(versions)
      } else {
        setMarketReleaseVersions(versions)
      }
      setMarketDetail(detail)
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : '包详情加载失败')
    } finally {
      setMarketLoading(false)
    }
  }

  function openCreateEventDialog() {
    setEventDialogMode('create')
    setEventTitle('')
    setEventType(events.length === 0 ? 'init' : 'upgrade')
    setEventAssigneeUserId(
      String(
        memberOptions.find((member) => member.id === currentUserId)?.id ??
          memberOptions[0]?.id ??
          '',
      ),
    )
    setEventDialogOpen(true)
  }

  function openPackageMarket() {
    void loadMarketContext()
    void refreshMarketDetail()
    setMarketOpen(true)
  }

  function openEditEventDialog(event: ProjectPackageEvent) {
    setEventDialogMode('edit')
    setSelectedEventId(event.id)
    setEventTitle(event.title)
    setEventType(event.type)
    setEventAssigneeUserId(String(event.assigneeUserId ?? memberOptions[0]?.id ?? ''))
    setEventDialogOpen(true)
  }

  function openOperationDialog(target: PendingOperationTarget, kind: ProjectPackageOperationKind) {
    setPendingOperationTarget(target)
    setOperationKind(target?.operation?.kind ?? kind)
    setOperationTitle(
      target?.operation?.title ??
        target?.operation?.label ??
        target?.defaultTitle ??
        (kind === 'document' ? '事件文档' : '操作事件'),
    )
    setOperationContent(target?.operation?.content ?? '')
    setOperationDialogOpen(true)
  }

  function openOperationTodoDialog(operation: ProjectPackageOperation) {
    setTodoDialogOperationId(operation.id)
    setTodoDialogRelatedTodoIds([...operation.relatedTodoIds])
    setTodoDialogRelatedTodoNotes({ ...(operation.relatedTodoNotes ?? {}) })
    setTodoDialogTodoDoneMap(
      Object.fromEntries(todos.map((todo) => [todo.id, todo.done] as const)),
    )
    setTodoDialogSearch('')
    setTodoPickerOpen(false)
    setOperationTodoDialogOpen(true)
  }

  function clearOperationTodoDialogState() {
    setTodoDialogOperationId(null)
    setTodoDialogRelatedTodoIds([])
    setTodoDialogRelatedTodoNotes({})
    setTodoDialogTodoDoneMap({})
    setTodoDialogSearch('')
    setTodoPickerOpen(false)
  }

  function toggleTodoDialogTodo(todoId: number) {
    setTodoDialogRelatedTodoIds((current) =>
      current.includes(todoId)
        ? current.filter((item) => item !== todoId)
        : [...current, todoId],
    )
    setTodoDialogRelatedTodoNotes((current) => {
      if (!(todoId in current)) return current
      return current
    })
  }

  function updateTodoDialogNote(todoId: number, note: string) {
    const normalized = note.trim()
    setTodoDialogRelatedTodoNotes((current) => ({
      ...current,
      [todoId]: note,
    }))
    if (normalized) {
      setTodoDialogRelatedTodoIds((current) =>
        current.includes(todoId) ? current : [...current, todoId],
      )
    }
  }

  async function saveOperationTodoDialog() {
    if (!todoDialogOperation) return
    setBusyAction(`operation-todo-link-${todoDialogOperation.id}`)
    try {
      const relatedTodoNotes = Object.fromEntries(
        todoDialogRelatedTodoIds.flatMap((todoId) => {
          const note = todoDialogRelatedTodoNotes[todoId]
          return note && note.trim() ? [[todoId, note] as const] : []
        }),
      )
      await onUpdateOperation(todoDialogOperation.id, {
        relatedTodoIds: todoDialogRelatedTodoIds,
        relatedTodoNotes,
      })
      const changedTodos = todos.filter(
        (todo) => todo.done !== Boolean(todoDialogTodoDoneMap[todo.id]),
      )
      for (const todo of changedTodos) {
        await Promise.resolve(onUpdateTodo(todo.id, { done: Boolean(todoDialogTodoDoneMap[todo.id]) }))
      }
      setOperationTodoDialogOpen(false)
      clearOperationTodoDialogState()
    } finally {
      setBusyAction('')
    }
  }

  function toggleTodoDialogDone(todoId: number) {
    setTodoDialogTodoDoneMap((current) => ({
      ...current,
      [todoId]: !Boolean(current[todoId]),
    }))
  }

  function applyTextareaChange(nextValue: string, selectionStart: number, selectionEnd: number) {
    setOperationContent(nextValue)
    window.requestAnimationFrame(() => {
      const textarea = operationTextareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  function toggleWrappedSelection(prefix: string, suffix: string, placeholder: string) {
    const textarea = operationTextareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = operationContent
    const selectedText = value.slice(start, end)

    if (
      selectedText.length >= prefix.length + suffix.length &&
      selectedText.startsWith(prefix) &&
      selectedText.endsWith(suffix)
    ) {
      const content = selectedText.slice(prefix.length, selectedText.length - suffix.length)
      const nextValue = `${value.slice(0, start)}${content}${value.slice(end)}`
      applyTextareaChange(nextValue, start, start + content.length)
      return
    }

    if (
      start >= prefix.length &&
      value.slice(start - prefix.length, start) === prefix &&
      value.slice(end, end + suffix.length) === suffix
    ) {
      const nextValue = `${value.slice(0, start - prefix.length)}${selectedText}${value.slice(end + suffix.length)}`
      const nextStart = start - prefix.length
      applyTextareaChange(nextValue, nextStart, nextStart + selectedText.length)
      return
    }

    if (!selectedText) {
      const wrapper = findInlineWrapperAtCursor(value, start, prefix, suffix)
      if (wrapper) {
        const content = value.slice(wrapper.contentStart, wrapper.contentEnd)
        const cursorOffset = start - wrapper.contentStart
        const nextValue = `${value.slice(0, wrapper.wrapperStart)}${content}${value.slice(wrapper.wrapperEnd)}`
        const nextCursor = wrapper.wrapperStart + Math.max(0, Math.min(cursorOffset, content.length))
        applyTextareaChange(nextValue, nextCursor, nextCursor)
        return
      }
    }

    const content = selectedText || placeholder
    const nextValue = `${value.slice(0, start)}${prefix}${content}${suffix}${value.slice(end)}`
    const contentStart = start + prefix.length
    applyTextareaChange(nextValue, contentStart, contentStart + content.length)
  }

  function toggleCodeBlockSelection() {
    const textarea = operationTextareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = operationContent
    const enclosingBlock = findEnclosingCodeBlock(value, start, end)

    if (enclosingBlock && start >= enclosingBlock.contentStart && end <= enclosingBlock.contentEnd) {
      const nextValue = `${value.slice(0, enclosingBlock.blockStart)}${enclosingBlock.content}${value.slice(enclosingBlock.blockEnd)}`
      const nextStart = enclosingBlock.blockStart + (start - enclosingBlock.contentStart)
      const nextEnd = enclosingBlock.blockStart + (end - enclosingBlock.contentStart)
      applyTextareaChange(nextValue, nextStart, nextEnd)
      return
    }

    const selectedText = value.slice(start, end)
    const leadingBreak = start > 0 && value[start - 1] !== '\n' ? '\n' : ''
    const trailingBreak = end < value.length && value[end] !== '\n' ? '\n' : ''
    const content = selectedText || '在这里输入代码'
    const block = `${leadingBreak}\`\`\`\n${content}\n\`\`\`${trailingBreak}`
    const nextValue = `${value.slice(0, start)}${block}${value.slice(end)}`
    const contentStart = start + leadingBreak.length + '```\n'.length
    applyTextareaChange(nextValue, contentStart, contentStart + content.length)
  }

  function formatOperationDocSelection(format: 'highlight' | 'inline-code' | 'code-block') {
    if (format === 'highlight') {
      toggleWrappedSelection('==', '==', '高亮内容')
      return
    }
    if (format === 'inline-code') {
      toggleWrappedSelection('`', '`', '命令')
      return
    }
    toggleCodeBlockSelection()
  }

  function applyExportTextareaChange(nextValue: string, selectionStart: number, selectionEnd: number) {
    setExportContent(nextValue)
    window.requestAnimationFrame(() => {
      const textarea = exportTextareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  function toggleExportWrappedSelection(prefix: string, suffix: string, placeholder: string) {
    const textarea = exportTextareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = exportContent
    const selectedText = value.slice(start, end)

    if (
      selectedText.length >= prefix.length + suffix.length &&
      selectedText.startsWith(prefix) &&
      selectedText.endsWith(suffix)
    ) {
      const content = selectedText.slice(prefix.length, selectedText.length - suffix.length)
      const nextValue = `${value.slice(0, start)}${content}${value.slice(end)}`
      applyExportTextareaChange(nextValue, start, start + content.length)
      return
    }

    if (
      start >= prefix.length &&
      value.slice(start - prefix.length, start) === prefix &&
      value.slice(end, end + suffix.length) === suffix
    ) {
      const nextValue = `${value.slice(0, start - prefix.length)}${selectedText}${value.slice(end + suffix.length)}`
      const nextStart = start - prefix.length
      applyExportTextareaChange(nextValue, nextStart, nextStart + selectedText.length)
      return
    }

    if (!selectedText) {
      const wrapper = findInlineWrapperAtCursor(value, start, prefix, suffix)
      if (wrapper) {
        const content = value.slice(wrapper.contentStart, wrapper.contentEnd)
        const cursorOffset = start - wrapper.contentStart
        const nextValue = `${value.slice(0, wrapper.wrapperStart)}${content}${value.slice(wrapper.wrapperEnd)}`
        const nextCursor = wrapper.wrapperStart + Math.max(0, Math.min(cursorOffset, content.length))
        applyExportTextareaChange(nextValue, nextCursor, nextCursor)
        return
      }
    }

    const content = selectedText || placeholder
    const nextValue = `${value.slice(0, start)}${prefix}${content}${suffix}${value.slice(end)}`
    const contentStart = start + prefix.length
    applyExportTextareaChange(nextValue, contentStart, contentStart + content.length)
  }

  function toggleExportCodeBlockSelection() {
    const textarea = exportTextareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = exportContent
    const enclosingBlock = findEnclosingCodeBlock(value, start, end)

    if (enclosingBlock && start >= enclosingBlock.contentStart && end <= enclosingBlock.contentEnd) {
      const nextValue = `${value.slice(0, enclosingBlock.blockStart)}${enclosingBlock.content}${value.slice(enclosingBlock.blockEnd)}`
      const nextStart = enclosingBlock.blockStart + (start - enclosingBlock.contentStart)
      const nextEnd = enclosingBlock.blockStart + (end - enclosingBlock.contentStart)
      applyExportTextareaChange(nextValue, nextStart, nextEnd)
      return
    }

    const selectedText = value.slice(start, end)
    const leadingBreak = start > 0 && value[start - 1] !== '\n' ? '\n' : ''
    const trailingBreak = end < value.length && value[end] !== '\n' ? '\n' : ''
    const content = selectedText || '在这里输入代码'
    const block = `${leadingBreak}\`\`\`\n${content}\n\`\`\`${trailingBreak}`
    const nextValue = `${value.slice(0, start)}${block}${value.slice(end)}`
    const contentStart = start + leadingBreak.length + '```\n'.length
    applyExportTextareaChange(nextValue, contentStart, contentStart + content.length)
  }

  function formatExportPreviewSelection(format: 'highlight' | 'inline-code' | 'code-block') {
    if (format === 'highlight') {
      toggleExportWrappedSelection('==', '==', '高亮内容')
      return
    }
    if (format === 'inline-code') {
      toggleExportWrappedSelection('`', '`', '命令')
      return
    }
    toggleExportCodeBlockSelection()
  }

  async function submitEvent() {
    const assigneeUserId = Number(eventAssigneeUserId)
    if (!eventTitle.trim() || !Number.isInteger(assigneeUserId) || assigneeUserId <= 0) return
    setBusyAction('event')
    try {
      if (eventDialogMode === 'create') {
        await onCreateEvent({ assigneeUserId, title: eventTitle.trim(), type: eventType })
      } else if (selectedEvent) {
        await onUpdateEvent(selectedEvent.id, { assigneeUserId, title: eventTitle.trim(), type: eventType })
      }
      setEventDialogOpen(false)
    } finally {
      setBusyAction('')
    }
  }

  async function submitOperation() {
    if (!pendingOperationTarget) return
    setBusyAction('operation')
    try {
      const trimmedTitle = operationTitle.trim()
      const trimmedContent = operationContent.trim()
      if (pendingOperationTarget.operation) {
        await onUpdateOperation(
          pendingOperationTarget.operation.id,
          operationKind === 'document'
            ? {
                title: trimmedTitle,
                content: trimmedContent,
              }
            : {
                label: trimmedTitle,
                ...(trimmedContent ? { content: trimmedContent } : {}),
              },
        )
      } else {
        await onCreateOperation({
          eventId: pendingOperationTarget.eventId,
          groupId: pendingOperationTarget.groupId ?? null,
          kind: operationKind,
          ...(operationKind === 'document'
            ? {
                title: trimmedTitle,
                content: trimmedContent,
              }
            : {
                label: trimmedTitle,
                ...(trimmedContent ? { content: trimmedContent } : {}),
              }),
        })
      }
      setOperationDialogOpen(false)
      setPendingOperationTarget(null)
    } finally {
      setBusyAction('')
    }
  }

  async function createPackageEventOperation(label: string) {
    if (!selectedEvent || !selectedGroup) return
    setBusyAction('operation')
    try {
      await onCreateOperation({
        eventId: selectedEvent.id,
        groupId: selectedGroup.id,
        kind: 'event',
        label,
        completed: false,
      })
    } finally {
      setBusyAction('')
    }
  }

  async function submitCart() {
    if (!selectedEvent || cartItems.length === 0) return
    setBusyAction('cart')
    try {
      await onAddItems(selectedEvent.id, cartItems)
      setCartItems([])
      setMarketOpen(false)
    } finally {
      setBusyAction('')
    }
  }

  async function handleExport() {
    setBusyAction('export')
    try {
      const result = await onExportTimeline()
      setExportFileName(result.fileName)
      setExportContent(result.markdown)
      setExportPreviewOpen(true)
    } finally {
      setBusyAction('')
    }
  }

  useImperativeHandle(ref, () => ({
    exportTimeline: () => {
      void handleExport()
    },
    openPackageMarket,
  }))

  function confirmExport() {
    downloadMarkdownFile(exportFileName, exportContent)
    setExportPreviewOpen(false)
  }

  const packageTimelineNodes = useMemo(
    () => (selectedGroup ? sortByCreatedAt(selectedGroup.operations, 'asc') : []),
    [selectedGroup],
  )

  return (
    <div className="package-workbench">
      {events.length === 0 ? (
        <section className="package-empty-state">
          <div className="package-empty-panel">
            <h3>先创建一个项目事件</h3>
            <p>正确路径是「项目 - 事件 - 选购安装包 - 编辑对应文档」，请先创建一个事件再开始维护交付记录。</p>
              <div className="package-empty-actions">
              {canManageTimeline ? (
                <Button className="solid-button" type="button" onClick={openCreateEventDialog}>
                  <Plus size={16} /> 新增事件
                </Button>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <div className="project-event-layout">
          <aside className="project-events-panel">
            <div className="project-events-head">
              <div>
                <h3>交付事件</h3>
              </div>
              {canManageTimeline ? (
                <Button className="solid-button" type="button" onClick={openCreateEventDialog}>
                  <Plus size={17} /> 新增事件
                </Button>
              ) : null}
            </div>
            <label className="project-events-assigned-toggle">
              <input
                type="checkbox"
                checked={assignedOnly}
                onChange={(event) => setAssignedOnly(event.target.checked)}
              />
              <span>只看我被指派的事件</span>
            </label>
            <div className="project-event-items">
              {visibleEvents.length === 0 ? (
                <p className="project-events-empty">
                  {assignedOnly ? '暂无指派给你的交付事件。' : '暂无交付事件。'}
                </p>
              ) : visibleEvents.map((event) => (
                <div
                  className={event.id === selectedEvent?.id ? 'project-event-item active' : 'project-event-item'}
                  key={event.id}
                >
                  <button
                    className="project-event-tab-button"
                    type="button"
                    onClick={() => {
                      setSelectedEventId(event.id)
                      setSelectedGroupId(event.groups[0]?.id ?? null)
                    }}
                  >
                    <strong>{event.title}</strong>
                    <span>{eventTypeLabel(event.type)} · {event.createdAt}</span>
                    <span className="project-event-assignee">
                      交付人：{event.assigneeName || '未指派'}
                    </span>
                  </button>
                  {canManageTimeline ? (
                    <div className="project-event-item-actions">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="icon-button project-event-menu-button"
                            type="button"
                            aria-label={`更多事件操作 ${event.title}`}
                          >
                            <DotsThree size={18} weight="bold" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={8}>
                          <DropdownMenuItem onSelect={() => openEditEventDialog(event)}>
                            编辑事件
                          </DropdownMenuItem>
                          <DeleteConfirmDialog
                            confirmLabel="删除事件"
                            description={`删除「${event.title}」后，这个交付事件下的安装包、记录和文档都会一起移除。`}
                            onConfirm={() => onDeleteEvent(event.id)}
                            title="确认删除这个交付事件？"
                            trigger={(
                              <DropdownMenuItem
                                className="project-event-danger-menu-item"
                                onSelect={(selectEvent) => selectEvent.preventDefault()}
                              >
                                删除事件
                              </DropdownMenuItem>
                            )}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </aside>

          {selectedEvent ? (
          <section className="event-workspace">
            <div className="event-workspace-body">
              <section className="project-operations-panel">
                <section className="operation-area">
                  <div className="operation-area-head">
                    <div>
                      <h4>事件文档</h4>
                      <p className="operation-area-meta">
                        {selectedEvent.title} · {eventTypeLabel(selectedEvent.type)} · {selectedEvent.createdAt}
                        <span className="event-progress-pill">
                          已完成 {selectedEventProgress.completed}/{selectedEventProgress.total} 个子事件 - 完成进度：{selectedEventProgress.percent}%
                        </span>
                      </p>
                      {!canManageTimeline ? (
                        <p className="package-workbench-readonly">
                          当前为协作视角，你可以查看和导出时间线，安装记录由项目 Owner 统一维护。
                        </p>
                      ) : null}
                    </div>
                    {canManageTimeline ? (
                      <div className="operation-actions">
                        <Button
                          className="solid-button"
                          type="button"
                          onClick={() =>
                            openOperationDialog(
                              { eventId: selectedEvent.id, operation: null },
                              'document',
                            )
                          }
                        >
                          <Plus size={14} weight="bold" /> 新建文档
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {selectedEvent.operations.length === 0 ? (
                    canManageTimeline ? (
                      <button
                        className="operation-empty-card"
                        type="button"
                        onClick={() =>
                          openOperationDialog({ eventId: selectedEvent.id, operation: null }, 'document')
                        }
                      >
                        <strong>点击开始编辑事件文档</strong>
                        <span>点击这里，直接开始编辑这个事件的文档内容。</span>
                      </button>
                    ) : (
                      <p className="operation-empty">还没有事件级文档。</p>
                    )
                  ) : (
                    <div className="operation-stream">
                      {sortByCreatedAt(selectedEvent.operations).map((operation) => (
                        <article className={getOperationCardClassName(operation, todosById)} key={operation.id}>
                          <button
                            className="operation-entry-main"
                            type="button"
                            onClick={() =>
                              canManageTimeline
                                ? openOperationDialog(
                                    { eventId: selectedEvent.id, operation },
                                    operation.kind,
                                  )
                                : undefined
                            }
                            disabled={!canManageTimeline}
                          >
                            <span className="operation-entry-kind">
                              {operation.kind === 'document' ? '文档' : '事件'}
                            </span>
                            <div className="operation-entry-headline">
                              <strong>{operationHeading(operation)}</strong>
                              <small>{operation.createdAt}</small>
                            </div>
                          </button>
                          <Select
                            value={operation.status}
                            onValueChange={(value) =>
                              void onUpdateOperation(operation.id, {
                                status: value as ProjectPackageEventStatus,
                              })
                            }
                            disabled={!canManageTimeline}
                          >
                            <SelectTrigger
                              className="operation-document-status-select"
                              aria-label={`选择文档状态 ${operationHeading(operation)}`}
                            >
                              <SelectValue placeholder="文档状态" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">{eventStatusLabel('pending')}</SelectItem>
                              <SelectItem value="success">{eventStatusLabel('success')}</SelectItem>
                              <SelectItem value="failed">{eventStatusLabel('failed')}</SelectItem>
                            </SelectContent>
                          </Select>
                          {renderOperationTodoChips(operation, todosById)}
                          {canManageTimeline ? (
                            <div className="operation-entry-actions">
                              <button
                                className="icon-button operation-action-button"
                                type="button"
                                aria-label="操作待办关联"
                                onClick={() => openOperationTodoDialog(operation)}
                              >
                                操作
                              </button>
                              <DeleteConfirmDialog
                                confirmLabel="删除记录"
                                description={`删除「${operationHeading(operation)}」后，这条交付记录将从当前事件中移除。`}
                                onConfirm={() => onDeleteOperation(operation.id)}
                                title="确认删除这条交付记录？"
                                trigger={(
                                  <button
                                    className="icon-button operation-delete-button"
                                    type="button"
                                    aria-label="删除记录"
                                  >
                                    <Trash size={15} />
                                  </button>
                                )}
                              />
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </section>

              {selectedEvent.groups.length > 0 ? (
                <section className="project-detail-layout">
                  <aside className="project-package-list">
                    <div className="project-package-list-head">
                      <div>
                        <h3>安装包列表</h3>
                      </div>
                    </div>

                    <div className="project-package-items">
                      {selectedEvent.groups.map((group) => (
                        <div
                          className={group.id === selectedGroup?.id ? 'project-package-item active' : 'project-package-item'}
                          key={group.id}
                        >
                          <button
                            className="project-package-tab-button"
                            type="button"
                            onClick={() => setSelectedGroupId(group.id)}
                          >
                            <strong>{group.packageName}</strong>
                            <span className="package-meta-text">{summarizeGroup(group) || `${group.items.length} 条记录`}</span>
                          </button>
                          {canManageTimeline ? (
                            <DeleteConfirmDialog
                              confirmLabel="删除安装包"
                              description={`删除「${group.packageName}」后，这个安装包下的时间线记录会一起移除。`}
                              onConfirm={() => onDeleteGroup(group.id)}
                              title="确认删除这个安装包？"
                              trigger={(
                                <button
                                  className="icon-button project-package-delete-button"
                                  type="button"
                                  aria-label={`删除安装包 ${group.packageName}`}
                                >
                                  <Trash size={15} />
                                </button>
                              )}
                            />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </aside>

                  <section className="project-timeline-panel">
                    <div className="project-timeline-head">
                      <div>
                        <h3>{selectedGroup?.packageName ?? '包级时间线'}</h3>
                        {selectedGroup ? (
                          <p className="package-meta-text">{summarizeGroup(selectedGroup)}</p>
                        ) : null}
                      </div>
                      {canManageTimeline && selectedGroup ? (
                        <div className="operation-actions">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button className="solid-button" type="button">
                                添加事件文档 <CaretDown size={14} weight="bold" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={8}>
                              <DropdownMenuItem
                                onSelect={() =>
                                  openOperationDialog(
                                    { eventId: selectedEvent.id, groupId: selectedGroup.id, operation: null },
                                    'document',
                                  )
                                }
                              >
                                空文档
                              </DropdownMenuItem>
                              {operationEventOptions.map((option) => (
                                <DropdownMenuItem
                                  key={option.type}
                                  onSelect={() => void createPackageEventOperation(option.label)}
                                >
                                  {option.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ) : null}
                    </div>

                    <div className="timeline-list">
                      {packageTimelineNodes.length === 0 ? (
                        <p className="operation-empty">这个安装包还没有补充文档或事件记录。</p>
                      ) : (
                        packageTimelineNodes.map((operation, index) => (
                          <article
                            className={index === packageTimelineNodes.length - 1 ? 'timeline-card latest' : 'timeline-card'}
                            key={operation.id}
                          >
                            <div className="timeline-body operation-node">
                              <article className={getOperationCardClassName(operation, todosById)}>
                                <button
                                  className="operation-entry-main"
                                  type="button"
                                  onClick={() =>
                                    canManageTimeline
                                      ? openOperationDialog(
                                          {
                                            eventId: selectedEvent.id,
                                            groupId: selectedGroup.id,
                                            operation,
                                          },
                                          operation.kind,
                                        )
                                      : undefined
                                  }
                                  disabled={!canManageTimeline}
                                >
                                  <span className="operation-entry-kind">
                                    {operation.kind === 'document' ? '文档' : '事件'}
                                  </span>
                                  <div className="operation-entry-headline">
                                    <strong>{operationHeading(operation)}</strong>
                                    <small>{operation.createdAt}</small>
                                  </div>
                                </button>
                                <Select
                                  value={operation.status}
                                  onValueChange={(value) =>
                                    void onUpdateOperation(operation.id, {
                                      status: value as ProjectPackageEventStatus,
                                    })
                                  }
                                  disabled={!canManageTimeline}
                                >
                                  <SelectTrigger
                                    className="operation-document-status-select"
                                    aria-label={`选择文档状态 ${operationHeading(operation)}`}
                                  >
                                    <SelectValue placeholder="文档状态" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">{eventStatusLabel('pending')}</SelectItem>
                                    <SelectItem value="success">{eventStatusLabel('success')}</SelectItem>
                                    <SelectItem value="failed">{eventStatusLabel('failed')}</SelectItem>
                                  </SelectContent>
                                </Select>
                                {renderOperationTodoChips(operation, todosById)}
                                {canManageTimeline ? (
                                  <div className="operation-entry-actions">
                                    <button
                                      className="icon-button operation-action-button"
                                      type="button"
                                      aria-label="操作待办关联"
                                      onClick={() => openOperationTodoDialog(operation)}
                                    >
                                      操作
                                    </button>
                                    <DeleteConfirmDialog
                                      confirmLabel="删除记录"
                                      description={`删除「${operationHeading(operation)}」后，这条交付记录将从当前安装包时间线移除。`}
                                      onConfirm={() => onDeleteOperation(operation.id)}
                                      title="确认删除这条交付记录？"
                                      trigger={(
                                        <button
                                          className="icon-button operation-delete-button"
                                          type="button"
                                          aria-label="删除记录"
                                        >
                                          <Trash size={15} />
                                        </button>
                                      )}
                                    />
                                  </div>
                                ) : null}
                              </article>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                </section>
              ) : null}
            </div>
          </section>
          ) : (
            <section className="event-workspace package-assigned-empty-workspace">
              <div className="package-empty-panel">
                <h3>暂无指派给你的交付事件</h3>
                <p>关闭「只看我被指派的事件」后，可以查看当前项目的全部交付事件。</p>
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={eventDialogOpen} onOpenChange={setEventDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{eventDialogMode === 'create' ? '新增安装事件' : '编辑安装事件'}</DialogTitle>
            <DialogDescription>事件是安装升级时间线的第一层分组，建议按一次初始化或一次升级来建立。</DialogDescription>
          </DialogHeader>
          <div className="package-dialog-form">
            <Label>
              事件类型
              <Select value={eventType} onValueChange={(value) => setEventType(value as ProjectPackageEventType)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择事件类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="init">初始化安装</SelectItem>
                  <SelectItem value="upgrade">升级</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label>
              事件标题
              <Input
                value={eventTitle}
                onChange={(event) => setEventTitle(event.target.value)}
                placeholder="例如：控制台升级到 v5.1.2"
              />
            </Label>
            <Label>
              交付人
              <Select value={eventAssigneeUserId} onValueChange={setEventAssigneeUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择交付人" />
                </SelectTrigger>
                <SelectContent>
                  {memberOptions.map((member) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
          </div>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setEventDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void submitEvent()}
              disabled={!eventTitle.trim() || !eventAssigneeUserId || busyAction === 'event'}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={operationDialogOpen} onOpenChange={setOperationDialogOpen}>
        <DialogContent className="package-operation-dialog operation-todo-dialog">
          <DialogHeader className="operation-doc-header">
            <DialogTitle>
              {pendingOperationTarget?.operation
                ? operationKind === 'document'
                  ? '编辑操作文档'
                  : '编辑事件文档'
                : '添加操作文档'}
            </DialogTitle>
            <DialogDescription>
              支持 Markdown，也可以先选中文本再用工具栏插入格式。
            </DialogDescription>
          </DialogHeader>
          <div className="operation-doc-form">
            <div className="operation-doc-meta-row">
              <Label className="operation-doc-title-field">
                文档标题
                <Input
                  value={operationTitle}
                  onChange={(event) => setOperationTitle(event.target.value)}
                  placeholder={operationKind === 'document' ? '例如：升级前检查事项' : '例如：初始化安装'}
                />
              </Label>
            </div>
            <div className="operation-doc-editor-layout">
              <section className="operation-doc-pane">
                <div className="operation-doc-pane-head">
                  <span>Markdown 内容</span>
                  <div className="operation-doc-toolbar" role="toolbar" aria-label="文档格式工具">
                    <Button
                      className="operation-doc-toolbar-button"
                      variant="outline"
                      size="sm"
                      type="button"
                      title="高亮"
                      onClick={() => formatOperationDocSelection('highlight')}
                    >
                      <Highlighter size={14} /> 高亮
                    </Button>
                    <Button
                      className="operation-doc-toolbar-button"
                      variant="outline"
                      size="sm"
                      type="button"
                      title="行内代码"
                      onClick={() => formatOperationDocSelection('inline-code')}
                    >
                      <Code size={14} /> 行内代码
                    </Button>
                    <Button
                      className="operation-doc-toolbar-button"
                      variant="outline"
                      size="sm"
                      type="button"
                      title="代码块"
                      onClick={() => formatOperationDocSelection('code-block')}
                    >
                      <CodeBlock size={14} /> 代码块
                    </Button>
                  </div>
                </div>
                <Textarea
                  ref={operationTextareaRef}
                  className="operation-doc-textarea"
                  value={operationContent}
                  onChange={(event) => setOperationContent(event.target.value)}
                  placeholder={`支持 Markdown，也可以先选中文本再用上方工具栏插入格式。\n\n例如：\n## 操作事项\n- 检查版本\n- 记录执行人\n\n\`\`\`bash\nkubectl get pods -A\n\`\`\``}
                />
              </section>
              <section className="operation-doc-pane operation-doc-preview-pane" aria-live="polite">
                <div className="operation-doc-pane-head">
                  <span>实时预览</span>
                  <small>支持 Markdown，也支持工具栏一键插入格式</small>
                </div>
                <div
                  className="operation-doc-preview"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(operationContent) }}
                />
              </section>
            </div>
          </div>
          <p className="operation-doc-hint">
            支持直接输入 Markdown，也可以先选中文字再点击上方工具栏。高亮会自动转成 <code>==内容==</code>，行内代码会转成 <code>`命令`</code>，代码块会自动插入三反引号围栏。
          </p>
          <DialogFooter className="operation-doc-footer">
            <Button variant="outline" type="button" onClick={() => setOperationDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void submitOperation()}
              disabled={
                busyAction === 'operation' ||
                !operationTitle.trim() ||
                (operationKind === 'document' && !operationContent.trim())
              }
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportPreviewOpen} onOpenChange={setExportPreviewOpen}>
        <DialogContent className="package-operation-dialog">
          <DialogHeader className="operation-doc-header">
            <DialogTitle>导出 {project.name || '项目'} 时间线</DialogTitle>
            <DialogDescription>
              确认项目「{project.name || '未命名项目'}」的时间线内容无误后，再点击右下角确认导出。
            </DialogDescription>
          </DialogHeader>
          <div className="operation-doc-form">
            <div className="operation-doc-editor-layout">
              <section className="operation-doc-pane">
                <div className="operation-doc-pane-head">
                  <span>导出内容</span>
                  <div className="operation-doc-toolbar" role="toolbar" aria-label="导出内容格式工具">
                    <Button
                      className="operation-doc-toolbar-button"
                      variant="outline"
                      size="sm"
                      type="button"
                      title="高亮"
                      onClick={() => formatExportPreviewSelection('highlight')}
                    >
                      <Highlighter size={14} /> 高亮
                    </Button>
                    <Button
                      className="operation-doc-toolbar-button"
                      variant="outline"
                      size="sm"
                      type="button"
                      title="行内代码"
                      onClick={() => formatExportPreviewSelection('inline-code')}
                    >
                      <Code size={14} /> 行内代码
                    </Button>
                    <Button
                      className="operation-doc-toolbar-button"
                      variant="outline"
                      size="sm"
                      type="button"
                      title="代码块"
                      onClick={() => formatExportPreviewSelection('code-block')}
                    >
                      <CodeBlock size={14} /> 代码块
                    </Button>
                  </div>
                </div>
                <Textarea
                  ref={exportTextareaRef}
                  className="operation-doc-textarea"
                  value={exportContent}
                  onChange={(event) => setExportContent(event.target.value)}
                  placeholder="这里会展示导出的项目时间线 Markdown 内容。"
                />
              </section>
              <section className="operation-doc-pane operation-doc-preview-pane" aria-live="polite">
                <div className="operation-doc-pane-head">
                  <span>实时预览</span>
                  <small>确认无误后再导出</small>
                </div>
                <div
                  className="operation-doc-preview"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownPreview(exportContent) }}
                />
              </section>
            </div>
          </div>
          <p className="operation-doc-hint">
            导出前可以直接调整 Markdown 内容，也可以先选中文字再点击上方工具栏插入格式。
          </p>
          <DialogFooter className="operation-doc-footer">
            <Button variant="outline" type="button" onClick={() => setExportPreviewOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={confirmExport} disabled={!exportContent.trim()}>
              确认导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={operationTodoDialogOpen}
        onOpenChange={(open) => {
          setOperationTodoDialogOpen(open)
          if (!open) clearOperationTodoDialogState()
        }}
      >
        <DialogContent className="package-operation-dialog">
          <DialogHeader>
            <DialogTitle>操作待办</DialogTitle>
            <DialogDescription>
              在这里统一管理待办关联、完成状态和备注说明；复选框会与外部待办列表的勾选状态保持同步。
            </DialogDescription>
          </DialogHeader>
          {selectableTodos.length > 0 ? (
            <div className="operation-todo-picker">
              <span className="operation-todo-picker-label">选择待办</span>
              <DropdownMenu open={todoPickerOpen} onOpenChange={setTodoPickerOpen}>
                <DropdownMenuTrigger asChild>
                  <Button className="operation-todo-picker-trigger" variant="outline" type="button">
                    <span className="operation-todo-picker-trigger-content">
                      {todoDialogSelectedTodos.length === 0 ? (
                        <span className="operation-todo-picker-placeholder">搜索并选择待办</span>
                      ) : (
                        <span className="operation-todo-picker-tags">
                          {todoDialogSelectedTodos.slice(0, 3).map((todo) => (
                            <span className="operation-todo-picker-tag" key={todo.id}>
                              {todo.title}
                            </span>
                          ))}
                          {todoDialogSelectedTodos.length > 3 ? (
                            <span className="operation-todo-picker-tag">
                              +{todoDialogSelectedTodos.length - 3}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </span>
                    <CaretDown
                      className={todoPickerOpen ? 'operation-todo-picker-caret open' : 'operation-todo-picker-caret'}
                      size={14}
                      weight="bold"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="operation-todo-picker-content"
                  collisionPadding={20}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  sideOffset={8}
                >
                  <div className="operation-todo-picker-search">
                    <Input
                      ref={todoPickerSearchRef}
                      value={todoDialogSearch}
                      onChange={(event) => setTodoDialogSearch(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder="搜索标题、负责人、提交人、截止日期"
                    />
                  </div>
                  <div className="operation-todo-picker-options">
                    {filteredTodoDialogTodos.length === 0 ? (
                      <p className="operation-empty">没有搜索到匹配的待办。</p>
                    ) : (
                      filteredTodoDialogTodos.map((todo) => {
                        const selected = todoDialogSelectedIds.has(todo.id)
                        const done = Boolean(todoDialogTodoDoneMap[todo.id])
                        const meta = [
                          done ? '已完成' : '未完成',
                          `截止 ${todo.dueDate}`,
                          priorityLabel(todo.priority),
                          todo.assigneeName ? `@${todo.assigneeName}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')
                        return (
                          <button
                            className={selected ? 'operation-todo-picker-option selected' : 'operation-todo-picker-option'}
                            key={todo.id}
                            type="button"
                            onClick={() => toggleTodoDialogTodo(todo.id)}
                          >
                            <span className="operation-todo-picker-option-check" aria-hidden="true" />
                            <span className="operation-todo-picker-option-text">
                              <strong>
                                {todo.title}
                                {todo.moduleName ? (
                                  <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                                ) : null}
                              </strong>
                              <small>{meta}</small>
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
          <div className="operation-todo-dialog-list">
            {selectableTodos.length === 0 ? (
              <div className="operation-todo-dialog-empty-state">
                <strong>暂未关联待办</strong>
                <span>当前项目还没有已确认的待办可供关联。</span>
              </div>
            ) : todoDialogSelectedTodos.length === 0 ? (
              <div className="operation-todo-dialog-empty-state">
                <strong>暂未关联待办</strong>
                <span>先在上方搜索并选择待办，选择后再填写备注并同步完成状态。</span>
              </div>
            ) : (
              todoDialogSelectedTodos.map((todo) => {
                const done = Boolean(todoDialogTodoDoneMap[todo.id])
                const meta = [
                  done ? '已完成' : '未完成',
                  `截止 ${todo.dueDate}`,
                  priorityLabel(todo.priority),
                  todo.assigneeName ? `@${todo.assigneeName}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <article
                    className={done ? 'operation-todo-dialog-item selected done' : 'operation-todo-dialog-item selected'}
                    key={todo.id}
                  >
                    <span className="operation-todo-dialog-item-head">
                      <span className="operation-todo-dialog-item-text">
                        <strong>
                          {todo.title}
                          {todo.moduleName ? (
                            <Badge className="todo-module-badge">{todo.moduleName}</Badge>
                          ) : null}
                        </strong>
                        <small>{meta}</small>
                      </span>
                      <span className="operation-todo-dialog-item-controls">
                        <label className="operation-todo-dialog-done-toggle">
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={() => toggleTodoDialogDone(todo.id)}
                          />
                          <span>完成待办</span>
                        </label>
                      </span>
                    </span>
                    <Textarea
                      className="operation-todo-dialog-note"
                      placeholder="写一下未完成原因、完成情况或补充说明..."
                      value={todoDialogRelatedTodoNotes[todo.id] ?? ''}
                      onChange={(event) => updateTodoDialogNote(todo.id, event.target.value)}
                    />
                  </article>
                )
              })
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setOperationTodoDialogOpen(false)
                clearOperationTodoDialogState()
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void saveOperationTodoDialog()}
              disabled={!todoDialogOperation || busyAction === `operation-todo-link-${todoDialogOperation.id}`}
            >
              保存操作
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={marketOpen} onOpenChange={setMarketOpen}>
        <DialogContent className="package-market-dialog">
          <DialogHeader>
            <DialogTitle>安装包市场</DialogTitle>
            <DialogDescription>
              为项目「{project.name}」当前事件选择安装包。临时下载链接有效期约 {marketExpireMinutes || '-'} 分钟。
            </DialogDescription>
          </DialogHeader>
          <div className="package-market-grid">
            <div className="package-market-sidebar">
              <Label>
                搜索
                <Input
                  value={marketSearch}
                  onChange={(event) => setMarketSearch(event.target.value)}
                  placeholder="sealos / db / app"
                />
              </Label>
              <div className="package-market-rule-list">
                {(
                  [
                    { id: 'base' as const, label: '基础包', rules: groupedMarketRules.base },
                    { id: 'apps' as const, label: 'APPS', rules: groupedMarketRules.apps },
                    { id: 'middleware' as const, label: 'SEALOS-PRO 中间件', rules: groupedMarketRules.middleware },
                  ] satisfies Array<{
                    id: 'base' | 'apps' | 'middleware'
                    label: string
                    rules: PackageMarketRule[]
                  }>
                ).map((group) => (
                  <section
                    className={marketExpandedGroups[group.id] ? 'package-market-group' : 'package-market-group collapsed'}
                    key={group.id}
                  >
                    <button
                      className="package-market-group-toggle"
                      type="button"
                      onClick={() =>
                        setMarketExpandedGroups((current) => ({
                          ...current,
                          [group.id]: !current[group.id],
                        }))
                      }
                    >
                      <span>{group.label}</span>
                      {marketExpandedGroups[group.id] ? (
                        <CaretDown size={14} weight="bold" />
                      ) : (
                        <CaretRight size={14} weight="bold" />
                      )}
                    </button>
                    {marketExpandedGroups[group.id] ? (
                      <div className="package-market-group-list">
                        {group.rules.length === 0 ? (
                          <p className="package-market-group-empty">当前分组没有匹配到安装包。</p>
                        ) : (
                          group.rules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              className={rule.id === marketSelectedPackage ? 'package-market-rule active' : 'package-market-rule'}
                              onClick={() => {
                                setMarketSelectedPackage(rule.id)
                                setMarketReleaseVersion('')
                                setMarketCiVersion('')
                                void refreshMarketDetail({ packageId: rule.id, releaseVersion: '', ciVersion: '' })
                              }}
                            >
                              <strong>{rule.name}</strong>
                              <small>{rule.id}</small>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>
            <div className="package-market-main">
              <div className="package-market-controls">
                <Label>
                  渠道
                  <Select
                    value={marketChannel}
                    onValueChange={(value) => {
                      const next = value as PackageMarketChannel
                      setMarketChannel(next)
                      setMarketCiVersion('')
                      setMarketReleaseVersion('')
                      void refreshMarketDetail({ channel: next, ciVersion: '', releaseVersion: '' })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="release">正式包</SelectItem>
                      {marketSelectedPackage !== 'base-pro' && marketSelectedPackage !== 'base-oss' ? (
                        <SelectItem value="ci">测试包</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </Label>
                <Label>
                  架构
                  <Select
                    value={marketArch}
                    onValueChange={(value) => {
                      const next = value as 'amd64' | 'arm64'
                      setMarketArch(next)
                      setMarketCiVersion('')
                      setMarketReleaseVersion('')
                      void refreshMarketDetail({ arch: next, ciVersion: '', releaseVersion: '' })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="amd64">amd64</SelectItem>
                      <SelectItem value="arm64">arm64</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
                {marketChannel === 'release' && marketReleaseVersions.length > 0 ? (
                  <Label className="package-market-version-control">
                    正式版本
                    <Select
                      value={marketReleaseVersion || marketReleaseVersions[0]?.version || ''}
                      onValueChange={(value) => {
                        setMarketReleaseVersion(value)
                        void refreshMarketDetail({ releaseVersion: value })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择版本" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketReleaseVersions.map((version) => (
                          <SelectItem key={version.version ?? version.label} value={version.version ?? version.label}>
                            {version.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                ) : null}
                {marketChannel === 'ci' && marketCiVersions.length > 0 ? (
                  <Label className="package-market-version-control">
                    测试版本
                    <Select
                      value={marketCiVersion || marketCiVersions[0]?.hash || ''}
                      onValueChange={(value) => {
                        setMarketCiVersion(value)
                        void refreshMarketDetail({ ciVersion: value })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择版本" />
                      </SelectTrigger>
                      <SelectContent>
                        {marketCiVersions.map((version) => (
                          <SelectItem key={version.hash ?? version.label} value={version.hash ?? version.label}>
                            {version.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                ) : null}
              </div>
              <div className="package-market-detail-area">
                {marketError ? <p className="form-error">{marketError}</p> : null}
                {marketLoading ? (
                  <p className="empty-state">正在读取 OSS 包信息...</p>
                ) : marketDetail ? (
                  <div className="package-market-link-list">
                    {marketDetail.links.length === 0 ? (
                      <p className="empty-state">当前参数下没有找到可用对象。</p>
                    ) : (
                      marketDetail.links.map((link) => (
                        <article className="package-market-link-card" key={`${link.objectKey}-${link.version}`}>
                          <div className="package-market-link-head">
                            <div>
                              <strong>{link.name}</strong>
                              <small>{` · ${link.version}${link.size ? ` · ${formatBytes(link.size)}` : ''}`}</small>
                            </div>
                            <div className="package-market-link-actions">
                              <Button
                                className="ghost-button"
                                variant="outline"
                                type="button"
                                onClick={() =>
                                  void copyToClipboard(
                                    link.downloadUrl,
                                    `copy-download-url-${link.objectKey}`,
                                  )
                                }
                              >
                                <Copy size={15} /> {copiedLabel(`copy-download-url-${link.objectKey}`, '复制下载链接')}
                              </Button>
                              <Button
                                className="ghost-button"
                                variant="outline"
                                type="button"
                                onClick={() => {
                                  setCartItems((current) => [
                                    ...current,
                                    {
                                      sourcePackageId: marketSelectedPackage,
                                      sourcePackageName: marketDetail.title,
                                      packageName: link.name,
                                      channel: marketChannel,
                                      channelLabel: channelLabel(marketChannel),
                                      arch: marketArch,
                                      version: link.version,
                                      objectKey: link.objectKey,
                                      objectLastModified: link.lastModified,
                                      sizeBytes: link.size,
                                    },
                                  ])
                                }}
                              >
                                <Package size={16} /> 添加
                              </Button>
                            </div>
                          </div>
                          <code>{link.objectKey}</code>
                          <div className="package-market-link-footer">
                            <a href={link.downloadUrl} target="_blank" rel="noreferrer">
                              查看临时链接
                            </a>
                            <Button
                              className="ghost-button"
                              variant="outline"
                              type="button"
                              onClick={() =>
                                void copyToClipboard(link.objectKey, `copy-object-key-${link.objectKey}`)
                              }
                            >
                              <Copy size={15} /> {copiedLabel(`copy-object-key-${link.objectKey}`, '复制 Key')}
                            </Button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                ) : (
                  <p className="empty-state">选择一个包后查看详情。</p>
                )}
              </div>
              <div className="package-market-expire-row">
                <Label>
                  配置链接有效期
                  <Select
                    value={String(marketExpireMinutes)}
                    onValueChange={(value) => {
                      const nextExpireMinutes = Number(value)
                      setMarketExpireMinutes(nextExpireMinutes)
                      void refreshMarketDetail({ expireMinutes: nextExpireMinutes })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {packageMarketExpireOptions.map((option) => (
                        <SelectItem key={option.value} value={String(option.value)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
                <small>影响当前弹窗内“查看临时链接”和“复制下载链接”的有效期。</small>
              </div>
            </div>
          </div>
          <div className="package-cart-strip">
            <div>
              <strong>待加入当前事件：{cartItems.length} 项</strong>
              <small>
                {cartItems.map((item) => `${item.packageName} · ${item.version}`).join('；') || '还没有选择安装包'}
              </small>
            </div>
            <div className="package-cart-actions">
              <Button
                variant="outline"
                type="button"
                onClick={() => setCartItems([])}
                disabled={cartItems.length === 0}
              >
                清空
              </Button>
              <Button type="button" onClick={() => void submitCart()} disabled={cartItems.length === 0 || busyAction === 'cart'}>
                <ShoppingCartSimple size={16} /> 添加到当前事件
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})
