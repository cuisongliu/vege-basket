import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartLine, CheckCircle, Clock, DownloadSimple, MagnifyingGlass, PencilSimple, Plus, Trash, TrendUp } from '@phosphor-icons/react'
import {
  createWorkHour, fetchMyWorkHours, fetchOrganizationWorkHours, fetchProjectTodos,
  fetchProjectWorkHours, removeWorkHour, updateWorkHour,
  type WorkHourEntry, type WorkHourSummary, type WorkHoursResponse,
} from '../api'
import type { Project, Todo } from '../types'
import { buildAiExportPrompt } from '../ai-export-prompt'
import { filterWorkHourEntries, formatWorkHourExport, summarizeWorkHourEntries, summarizeWorkHourStatuses } from '../ai-export-data'
import { AiExportPromptDialog } from './ai-export-prompt-dialog'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { ListPagination } from './list-pagination'
import { ExportScopeDialog } from './export-scope-dialog'
import './work-hours-workbench.css'

function hours(minutes: number | null | undefined) {
  const value = minutes ?? 0
  return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)}h`
}

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function signedHours(minutes: number | null | undefined) {
  const value = minutes ?? 0
  return `${value > 0 ? '+' : ''}${hours(value)}`
}

function workHourStatus(entry: Pick<WorkHourEntry, 'status' | 'returnedAt'>) {
  if (entry.returnedAt) return { label: '已退回', className: 'is-returned' }
  if (entry.status === 'confirmed') return { label: '已确认', className: 'is-confirmed' }
  if (entry.status === 'submitted') return { label: '待确认', className: 'is-submitted' }
  return { label: '未提交', className: 'is-pending' }
}

function getTaskStatus(task: { done: boolean; confirmationStatus: string }) {
  if (task.done) return { label: '已完成', className: 'is-done' }
  if (task.confirmationStatus === 'pending_review') return { label: '待确认', className: 'is-submitted' }
  if (task.confirmationStatus === 'rejected' || task.confirmationStatus === 'acceptance_failed') return { label: '已驳回', className: 'is-returned' }
  return { label: '进行中', className: 'is-open' }
}

function dateRange(startDate: string, endDate: string) {
  const dates: string[] = []
  const cursor = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

type WorkHourTrendPoint = { date: string; minutes: number; confirmedMinutes: number; pendingMinutes: number }

function WorkHourTrendChart({ points, showBreakdown = true }: { points: WorkHourTrendPoint[]; showBreakdown?: boolean }) {
  if (points.length === 0) return <p className="work-hours-empty">当前周期暂无记录</p>
  const width = 720
  const height = 220
  const padding = { top: 18, right: 14, bottom: 30, left: 36 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const maxMinutes = Math.max(...points.flatMap((point) => showBreakdown
    ? [point.minutes, point.confirmedMinutes, point.pendingMinutes]
    : [point.minutes]), 60)
  const x = (index: number) => padding.left + (points.length === 1 ? chartWidth / 2 : index * chartWidth / (points.length - 1))
  const y = (minutes: number) => padding.top + chartHeight - (minutes / maxMinutes) * chartHeight
  const path = (key: 'minutes' | 'confirmedMinutes' | 'pendingMinutes') => points.map((point, index) => `${x(index)},${y(point[key])}`).join(' ')
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
  const gridValues = [maxMinutes, Math.round(maxMinutes / 2), 0]
  return <div className="work-hours-trend-chart" role="img" aria-label="工时投入趋势图">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {gridValues.map((value) => <g key={value}><line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} /><text x={padding.left - 8} y={y(value) + 4} textAnchor="end">{hours(value)}</text></g>)}
      <polyline className="work-hours-trend-line is-total" points={path('minutes')} />
      {showBreakdown ? <>
        <polyline className="work-hours-trend-line is-confirmed" points={path('confirmedMinutes')} />
        <polyline className="work-hours-trend-line is-pending" points={path('pendingMinutes')} />
      </> : null}
      {points.map((point, index) => <circle className="is-total" cx={x(index)} cy={y(point.minutes)} key={`total-${point.date}`} r="3" />)}
      {labelIndexes.map((index) => <text className="work-hours-trend-label" key={points[index].date} x={x(index)} y={height - 8} textAnchor="middle">{points[index].date.slice(5).replace('-', '.')}</text>)}
    </svg>
    <div className="work-hours-legend"><span><i className="is-total" />总投入</span>{showBreakdown ? <><span><i className="is-confirmed" />已确认</span><span><i className="is-pending" />未确认</span></> : null}</div>
  </div>
}

function projectTone(projectId: number) {
  return `is-tone-${Math.abs(projectId) % 6}`
}

function MemberComparison({ members }: { members: WorkHourSummary['byUser'] }) {
  const maxMinutes = Math.max(...members.map((member) => member.minutes), 1)
  return members.length ? <>
    <div className="work-hours-member-legend"><span><i className="is-confirmed" />已确认</span><span><i className="is-pending" />未确认</span></div>
    <div className="work-hours-member-bars">
      {members.map((member) => <div className="work-hours-member-compare-row" key={member.userId}>
        <strong>{member.userName}</strong>
        <div className="work-hours-member-compare-bar" aria-label={`${member.userName} 已确认 ${hours(member.confirmedMinutes)}，未确认 ${hours(member.pendingMinutes)}`}>
          <i className="is-confirmed" style={{ width: `${member.confirmedMinutes / maxMinutes * 100}%` }} />
          <i className="is-pending" style={{ width: `${member.pendingMinutes / maxMinutes * 100}%` }} />
        </div>
        <span>{hours(member.minutes)}</span>
        <small>{hours(member.confirmedMinutes)} / {hours(member.pendingMinutes)}</small>
      </div>)}
    </div>
  </> : <p className="work-hours-empty">当前周期暂无成员投入</p>
}

function rangeForPeriod(period: 'week' | 'month') {
  const end = new Date()
  const start = new Date(end)
  if (period === 'week') start.setDate(end.getDate() - ((end.getDay() + 6) % 7))
  else start.setDate(1)
  return { endDate: dateInputValue(end), startDate: dateInputValue(start) }
}

async function fetchAllWorkHourPages(
  load: (filters: { startDate: string; endDate: string; status: 'all'; offset?: number; limit?: number }) => Promise<WorkHoursResponse>,
  filters: { startDate: string; endDate: string; status: 'all' },
) {
  const entries: WorkHourEntry[] = []
  let offset = 0
  let lastPage: WorkHoursResponse | undefined
  while (true) {
    const page = await load({ ...filters, offset, limit: 50 })
    entries.push(...page.entries)
    lastPage = page
    if (!page.pagination || entries.length >= page.pagination.total || page.entries.length === 0) break
    offset += page.entries.length
  }
  return { entries, summary: lastPage?.summary ?? { ...emptySummary } }
}

function shiftRange(range: { startDate: string; endDate: string }, period: 'week' | 'month', direction: -1 | 1) {
  const start = new Date(`${range.startDate}T12:00:00`)
  const end = new Date(`${range.endDate}T12:00:00`)
  if (period === 'week') {
    start.setDate(start.getDate() + direction * 7)
    end.setDate(end.getDate() + direction * 7)
  } else {
    start.setMonth(start.getMonth() + direction)
    end.setMonth(end.getMonth() + direction)
  }
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) }
}

const emptySummary: WorkHourSummary = {
  byDate: [], byProject: [], byUser: [], confirmedMinutes: 0, pendingMinutes: 0,
  projectCount: 0, taskCount: 0, totalHours: 0, totalMinutes: 0,
}

type Props = {
  mode: 'mine' | 'organization' | 'project'
  isActive?: boolean
  organizationId?: number | null
  project?: Project
  projects: Project[]
  currentUserId?: number
  currentUserName?: string
  initialProjectId?: number | null
  initialTodoId?: number | null
  autoOpenRecorder?: boolean
  recorderOnly?: boolean
  recorderRequest?: { projectId: number; todoId: number } | null
  onRecorderContextConsumed?: () => void
  onRecorderDismiss?: () => void
  onTodoClick?: (projectId: number, todoId: number) => void
  onProjectClick?: (projectId: number) => void
  topbarActionHost?: HTMLElement | null
}

export function WorkHoursWorkbench({
  mode, isActive = true, organizationId, project, projects,
  initialProjectId = null, initialTodoId = null, autoOpenRecorder = false, onRecorderContextConsumed,
  recorderOnly = false, recorderRequest = null, onRecorderDismiss, onTodoClick, onProjectClick, topbarActionHost,
}: Props) {
  const [period, setPeriod] = useState<'week' | 'month'>('month')
  const [range, setRange] = useState(() => rangeForPeriod('month'))
  const [entries, setEntries] = useState<WorkHourEntry[]>([])
  const [summary, setSummary] = useState<WorkHourSummary>(emptySummary)
  const [todos, setTodos] = useState<Todo[]>([])
  const [mineTab, setMineTab] = useState<'stats' | 'records'>('stats')
  const [managementTab, setManagementTab] = useState<'projects' | 'members' | 'trend' | 'tasks'>('projects')
  const [status, setStatus] = useState<'all' | 'pending' | 'confirmed'>('all')
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all')
  const [projectPickerPage, setProjectPickerPage] = useState(0)
  const [projectQuery, setProjectQuery] = useState('')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskPage, setTaskPage] = useState(0)
  const [tableQuery, setTableQuery] = useState('')
  const [tablePage, setTablePage] = useState(0)
  const [tablePageSize, setTablePageSize] = useState(10)
  const [entryPagination, setEntryPagination] = useState({ offset: 0, limit: 10, total: 0 })
  const [taskFilter, setTaskFilter] = useState<'all' | 'open' | 'done'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<WorkHourEntry | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<WorkHourEntry | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initialProjectId ?? project?.id ?? null)
  const [selectedTodoId, setSelectedTodoId] = useState<number | null>(initialTodoId)
  const [recorderContextLocked, setRecorderContextLocked] = useState(initialTodoId != null)
  const [minutes, setMinutes] = useState('60')
  const [workDate, setWorkDate] = useState(dateInputValue(new Date()))
  const [description, setDescription] = useState('')
  const [exportPrompt, setExportPrompt] = useState<{ fileName: string; prompt: string; summary: string } | null>(null)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportScopeOpen, setExportScopeOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const reloadRequestId = useRef(0)
  const projectId = project?.id

  const reload = useCallback(() => {
    const requestId = ++reloadRequestId.current
    setLoading(true)
    setError('')
    const filters = {
      startDate: range.startDate,
      endDate: range.endDate,
      status: mode === 'mine' && mineTab === 'records' ? status : 'all' as const,
      ...(mode === 'mine' && mineTab === 'records'
        ? { offset: tablePage * tablePageSize, limit: tablePageSize, q: tableQuery }
        : {}),
    }
    const request = mode === 'organization' && organizationId
      ? fetchOrganizationWorkHours(organizationId, filters)
      : mode === 'project' && projectId
        ? fetchProjectWorkHours(projectId, filters)
        : fetchMyWorkHours({ ...filters, projectId: projectFilter === 'all' ? undefined : projectFilter })
    void request.then((data) => {
      if (requestId !== reloadRequestId.current) return
      setEntries(data.entries)
      setEntryPagination(data.pagination ?? { offset: 0, limit: data.entries.length, total: data.entries.length })
      setSummary(data.summary)
    })
      .catch((cause) => {
        if (requestId === reloadRequestId.current) setError(cause instanceof Error ? cause.message : '工时加载失败。')
      })
      .finally(() => {
        if (requestId === reloadRequestId.current) setLoading(false)
      })
  }, [mineTab, mode, organizationId, projectFilter, projectId, range.endDate, range.startDate, status, tablePage, tablePageSize, tableQuery])

  useEffect(() => {
    if (!isActive) return
    reload()
  }, [isActive, reload])
  useEffect(() => { setRange(rangeForPeriod(period)) }, [period])
  useEffect(() => {
    if (!isActive) return
    if (!selectedProjectId || mode !== 'mine') { setTodos([]); return }
    void fetchProjectTodos(selectedProjectId)
      .then((data) => setTodos(data.todos.filter((todo) => todo.assigneeUserId != null && !todo.done && todo.confirmationStatus !== 'pending_review')))
      .catch(() => setTodos([]))
  }, [isActive, mode, projects, selectedProjectId])

  useEffect(() => {
    if (!isActive) return
    if (mode !== 'mine' || !autoOpenRecorder || initialTodoId == null) return
    setSelectedProjectId(initialProjectId ?? project?.id ?? null)
    setSelectedTodoId(initialTodoId)
    setRecorderContextLocked(true)
    setEditingEntry(null)
    setError('')
    setDialogOpen(true)
    onRecorderContextConsumed?.()
  }, [autoOpenRecorder, initialProjectId, initialTodoId, isActive, mode, onRecorderContextConsumed, project?.id])

  function openRecorderForTodo(todoId: number, todoProjectId: number) {
    setError('')
    setEditingEntry(null)
    setSelectedProjectId(todoProjectId)
    setSelectedTodoId(todoId)
    setRecorderContextLocked(true)
    setMinutes('60')
    setWorkDate(dateInputValue(new Date()))
    setDescription('')
    setDialogOpen(true)
  }

  useEffect(() => {
    if (!isActive) return
    if (mode !== 'mine' || !recorderRequest) return
    openRecorderForTodo(recorderRequest.todoId, recorderRequest.projectId)
  }, [isActive, mode, recorderRequest])

  const projectOptions = useMemo(() => projects.filter((candidate) => candidate.organizationId != null), [projects])
  const filteredProjectOptions = useMemo(() => projectOptions.filter((candidate) => !projectQuery.trim() || candidate.name.toLowerCase().includes(projectQuery.trim().toLowerCase())), [projectOptions, projectQuery])
  const projectPickerSize = 10
  const projectPickerPages = Math.max(1, Math.ceil(filteredProjectOptions.length / projectPickerSize))
  const visibleProjectOptions = filteredProjectOptions.slice(projectPickerPage * projectPickerSize, (projectPickerPage + 1) * projectPickerSize)
  const filteredTasks = useMemo(() => (summary.tasks ?? []).filter((task) => {
    const matchesQuery = !tableQuery.trim() || task.title.toLowerCase().includes(tableQuery.trim().toLowerCase()) || task.assigneeName?.toLowerCase().includes(tableQuery.trim().toLowerCase())
    return matchesQuery && (taskFilter === 'all' || (taskFilter === 'done' ? task.done : !task.done))
  }), [summary.tasks, tableQuery, taskFilter])
  const recorderTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase()
    return todos.filter((todo) => {
      return todo.assigneeUserId != null && !todo.done && todo.confirmationStatus !== 'pending_review' && (
        !query || todo.title.toLowerCase().includes(query)
      )
    })
  }, [taskQuery, todos])
  const recorderTaskPages = Math.max(1, Math.ceil(recorderTasks.length / 20))
  const visibleRecorderTasks = recorderTasks.slice(taskPage * 20, (taskPage + 1) * 20)

  useEffect(() => { setProjectPickerPage((page) => Math.min(page, projectPickerPages - 1)) }, [projectPickerPages])
  useEffect(() => { setTaskPage((page) => Math.min(page, recorderTaskPages - 1)) }, [recorderTaskPages])
  useEffect(() => { setTaskPage(0) }, [selectedProjectId, taskQuery])
  useEffect(() => { setTablePage(0) }, [managementTab, mineTab, mode, tableQuery, taskFilter])
  useEffect(() => {
    if (entryPagination.total === 0) return
    setTablePage((page) => Math.min(page, Math.max(0, Math.ceil(entryPagination.total / tablePageSize) - 1)))
  }, [entryPagination.total, tablePageSize])

  function openRecorder(entry?: WorkHourEntry) {
    setError('')
    setEditingEntry(entry ?? null)
    setRecorderContextLocked(false)
    setSelectedProjectId(entry?.projectId ?? project?.id ?? null)
    setSelectedTodoId(entry?.todoId ?? null)
    setMinutes(String(entry?.minutes ?? 60))
    setWorkDate(entry?.workDate ?? dateInputValue(new Date()))
    setDescription(entry?.description ?? '')
    setDialogOpen(true)
  }

  async function saveRecord() {
    const amount = Number(minutes)
    if (!description.trim()) { setError('请填写本次工作的说明。'); return }
    if (!selectedTodoId || !Number.isInteger(amount) || amount < 60 || amount > 1440 || amount % 60 !== 0) {
      setError('请选择任务；工时须按整数小时填写，且不超过 24 小时。')
      return
    }
    setSaving(true)
    try {
      if (editingEntry) await updateWorkHour(editingEntry.id, { minutes: amount, workDate, description: description.trim() })
      else await createWorkHour({ todoId: selectedTodoId, minutes: amount, workDate, description: description.trim() })
      setDialogOpen(false)
      onRecorderDismiss?.()
      reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时保存失败。')
    } finally { setSaving(false) }
  }

  async function openExportPrompt(scope: 'all' | 'filtered' = 'filtered') {
    if (mode === 'mine') return
    setExportLoading(true)
    setError('')
    try {
      const filters = { startDate: range.startDate, endDate: range.endDate, status: 'all' as const }
      const response = mode === 'organization' && organizationId
        ? await fetchAllWorkHourPages((pageFilters) => fetchOrganizationWorkHours(organizationId, pageFilters), filters)
        : mode === 'project' && projectId
          ? await fetchAllWorkHourPages((pageFilters) => fetchProjectWorkHours(projectId, pageFilters), filters)
          : null
      if (!response) throw new Error('当前导出范围无效。')
      const filtered = scope === 'all' ? response.entries : filterWorkHourEntries(
        response.entries,
        tableQuery,
        mode === 'project' ? taskFilter : 'all',
        response.summary.tasks,
      )
      const filteredSummary = scope === 'filtered' && (tableQuery.trim() || mode === 'project' && taskFilter !== 'all')
        ? summarizeWorkHourEntries(filtered, response.summary)
        : response.summary
      const prompt = buildAiExportPrompt({
        title: mode === 'project' ? `${project?.name ?? '项目'}工时` : '组织工时统计',
        scope: [
          `模式：${mode === 'project' ? '项目工时' : '工时统计'}`,
          `组织或项目：${mode === 'project' ? project?.name ?? `项目 #${projectId}` : `组织 #${organizationId}`}`,
          `日期范围：${range.startDate} 至 ${range.endDate}`,
          '状态：全部状态（未提交、待确认、已确认）',
          scope === 'filtered' && tableQuery.trim() ? `搜索条件：${tableQuery.trim()}` : '搜索条件：无',
          scope === 'filtered' && mode === 'project' ? `任务状态：${taskFilter === 'done' ? '已完成' : taskFilter === 'open' ? '进行中' : '全部'}` : '任务状态：全部',
          `包含数量：${filtered.length} 条工时记录、${filteredSummary.taskCount} 个任务、${filteredSummary.projectCount} 个项目`,
        ],
        fields: ['日期、项目、任务、人员、分钟数/小时数、未提交/待确认/已确认状态、工作说明', '统计摘要：预估工时、实际投入、已确认工时、待确认工时和偏差'],
        data: `## 汇总\n${JSON.stringify(filteredSummary, null, 2)}\n\n## 状态分布（pending=未提交，submitted=待确认，confirmed=已确认）\n${JSON.stringify(summarizeWorkHourStatuses(filtered), null, 2)}\n\n## 按任务分组的工时明细\n${formatWorkHourExport(filtered)}`,
        instructions: ['按项目和任务汇总实际投入，指出已确认、待确认与未提交记录的差异。', '比较预估与实际投入，标记明显偏差和需要跟进的任务。'],
      })
      setExportPrompt({
        fileName: `${project?.name ?? '组织'}工时分析提示词`,
        prompt,
        summary: `AI 提示词包将包含 ${filtered.length} 条工时记录、${filteredSummary.taskCount} 个任务，日期范围为 ${range.startDate} 至 ${range.endDate}；不包含项目日记、图片、临时链接、权限配置和通知历史。`,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时导出数据加载失败。')
    } finally {
      setExportLoading(false)
    }
  }

  const estimatedMinutes = summary.estimatedMinutes ?? summary.byProject.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)
  const selectedProjectName = projects.find((candidate) => candidate.id === selectedProjectId)?.name
  const trendPoints = useMemo(() => dateRange(range.startDate, range.endDate).map((date) => {
    const point = summary.byDate.find((item) => item.date === date)
    return { date, minutes: point?.minutes ?? 0, confirmedMinutes: point?.confirmedMinutes ?? 0, pendingMinutes: point?.pendingMinutes ?? 0 }
  }), [range.endDate, range.startDate, summary.byDate])
  const projectVarianceMinutes = summary.totalMinutes - estimatedMinutes
  const normalizedTableQuery = tableQuery.trim().toLocaleLowerCase('zh-CN')
  const filteredEntries = mode === 'mine' && mineTab === 'records'
    ? entries
    : entries.filter((entry) => !normalizedTableQuery || [entry.projectName, entry.todoTitle, entry.description, entry.userName, entry.workDate, entry.returnedAt ? '已退回' : '', entry.status === 'confirmed' ? '已确认' : entry.status === 'submitted' ? '待确认' : '未提交'].join(' ').toLocaleLowerCase('zh-CN').includes(normalizedTableQuery))
  const filteredProjects = summary.byProject.filter((item) => !normalizedTableQuery || item.projectName.toLocaleLowerCase('zh-CN').includes(normalizedTableQuery))
  const filteredUsers = summary.byUser.filter((item) => !normalizedTableQuery || item.userName.toLocaleLowerCase('zh-CN').includes(normalizedTableQuery))
  const filteredDates = summary.byDate.filter((item) => !normalizedTableQuery || item.date.includes(normalizedTableQuery))
  const activeTableRows = mode === 'mine'
    ? mineTab === 'records' ? Array.from({ length: entryPagination.total }) : filteredProjects
    : managementTab === 'members' ? filteredUsers
      : managementTab === 'trend' ? filteredDates
        : managementTab === 'tasks' ? filteredTasks : filteredProjects
  const tablePages = Math.max(1, Math.ceil(activeTableRows.length / tablePageSize))
  const safeTablePage = Math.min(tablePage, tablePages - 1)
  const pageRows = <T,>(rows: T[]) => rows.slice(safeTablePage * tablePageSize, (safeTablePage + 1) * tablePageSize)
  const visibleEntries = mode === 'mine' && mineTab === 'records' ? filteredEntries : pageRows(filteredEntries)
  const visibleProjects = pageRows(filteredProjects)
  const visibleUsers = pageRows(filteredUsers)
  const visibleDates = pageRows(filteredDates)
  const visibleTasks = pageRows(filteredTasks)
  const exportFilteredCount = mode === 'mine'
    ? filteredEntries.length
    : tableQuery.trim() ? Math.max(filteredEntries.length, activeTableRows.length) : entryPagination.total
  const tableSearch = (placeholder: string, label: string) => (
    <label className="work-hours-list-search"><MagnifyingGlass size={15} /><Input aria-label={label} placeholder={placeholder} value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} /></label>
  )
  const tablePagination = (label: string, total: number) => total > 10 ? (
    <ListPagination
      label={`${label}分页`}
      page={safeTablePage}
      pageSize={tablePageSize}
      pageSizeOptions={[10, 20, 50]}
      total={total}
      onPageChange={setTablePage}
      onPageSizeChange={(size) => { setTablePageSize(size); setTablePage(0) }}
    />
  ) : null
  const openTaskDetail = (todoId: number) => {
    if (projectId) onTodoClick?.(projectId, todoId)
  }
  const recorderProjectPicker = <div className="work-hours-recorder-picker">
    <Input aria-label="搜索项目" placeholder="搜索项目名称" value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPickerPage(0) }} />
    <div aria-label="选择项目" className="work-hours-picker-options" role="listbox">
      {visibleProjectOptions.map((item) => <button aria-selected={selectedProjectId === item.id} className={selectedProjectId === item.id ? 'is-selected' : ''} disabled={Boolean(editingEntry) || recorderContextLocked} key={item.id} onClick={() => { setSelectedProjectId(item.id); setSelectedTodoId(null); setTaskPage(0) }} role="option" type="button">{item.name}</button>)}
      {visibleProjectOptions.length === 0 ? <span className="work-hours-picker-empty">没有匹配的项目</span> : null}
    </div>
    {editingEntry && selectedProjectName ? <span className="work-hours-picker-selected">已选择：{selectedProjectName}</span> : null}
    {projectPickerPages > 1 ? <ListPagination label="填报工时项目分页" page={projectPickerPage} pageSize={projectPickerSize} total={filteredProjectOptions.length} disabled={Boolean(editingEntry) || recorderContextLocked} onPageChange={setProjectPickerPage} /> : null}
  </div>
  const recorderTaskPicker = <div className="work-hours-recorder-picker">
    <Input aria-label="搜索任务" placeholder="搜索任务标题" value={taskQuery} onChange={(event) => { setTaskQuery(event.target.value); setTaskPage(0) }} />
    <div aria-label="选择任务" className="work-hours-picker-options" role="listbox">
      {visibleRecorderTasks.map((todo) => <button aria-selected={selectedTodoId === todo.id} className={selectedTodoId === todo.id ? 'is-selected' : ''} disabled={Boolean(editingEntry) || recorderContextLocked || !selectedProjectId} key={todo.id} onClick={() => setSelectedTodoId(todo.id)} role="option" type="button">{todo.title}</button>)}
      {visibleRecorderTasks.length === 0 ? <span className="work-hours-picker-empty">{selectedProjectId ? '没有可填报的任务' : '请先选择项目'}</span> : null}
    </div>
    {recorderTaskPages > 1 ? <ListPagination label="填报工时任务分页" page={taskPage} pageSize={20} total={recorderTasks.length} disabled={Boolean(editingEntry) || recorderContextLocked || !selectedProjectId} onPageChange={setTaskPage} /> : null}
  </div>

  const exportToolbar = topbarActionHost && mode !== 'mine' ? createPortal(<div className="export-scope-trigger">
    <Button type="button" variant="outline" disabled={exportLoading} onClick={() => setExportScopeOpen((open) => !open)}>
      <DownloadSimple size={16} />{exportLoading ? '导出中，请稍等' : '一键导出'}
    </Button>
    <ExportScopeDialog open={exportScopeOpen} busy={exportLoading} filteredCount={exportFilteredCount} onConfirm={(scope) => { setExportScopeOpen(false); void openExportPrompt(scope) }} />
  </div>, topbarActionHost) : null

  return (
    <section className={`work-hours-workbench mode-${mode}${recorderOnly ? ' is-recorder-only' : ''}`}>
      {exportToolbar}
      {mode === 'mine' ? <div className="work-hours-actions work-hours-actions-only"><Button type="button" onClick={() => openRecorder()}><Plus size={16} />填报工时</Button></div> : null}

      <nav className="work-hours-tabs" aria-label="工时视图">
        {mode === 'mine' ? <><button className={mineTab === 'records' ? 'is-active' : ''} onClick={() => setMineTab('records')} type="button">工时记录</button><button className={mineTab === 'stats' ? 'is-active' : ''} onClick={() => setMineTab('stats')} type="button">工时统计</button></> : <>
          <button className={managementTab === 'projects' ? 'is-active' : ''} onClick={() => setManagementTab('projects')} type="button">{mode === 'project' ? '项目总览' : '全部项目'}</button>
          <button className={managementTab === 'members' ? 'is-active' : ''} onClick={() => setManagementTab('members')} type="button">成员投入</button>
          <button className={managementTab === 'trend' ? 'is-active' : ''} onClick={() => setManagementTab('trend')} type="button">周 / 月趋势</button>
          {mode === 'project' ? <button className={managementTab === 'tasks' ? 'is-active' : ''} onClick={() => setManagementTab('tasks')} type="button">任务明细</button> : null}
        </>}
      </nav>

      <div className="work-hours-filters">
        <div className="work-hours-period"><button className={period === 'week' ? 'is-active' : ''} onClick={() => setPeriod('week')} type="button">周</button><button className={period === 'month' ? 'is-active' : ''} onClick={() => setPeriod('month')} type="button">月</button></div>
        <div className="work-hours-date-nav"><button onClick={() => setRange((value) => shiftRange(value, period, -1))} type="button">上一周期</button><strong>{range.startDate.replaceAll('-', '.')} - {range.endDate.replaceAll('-', '.')}</strong><button onClick={() => setRange((value) => shiftRange(value, period, 1))} type="button">下一周期</button></div>
        {mode === 'mine' ? <div className="work-hours-project-picker" aria-label="按项目筛选">
          <Input value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPickerPage(0) }} placeholder="搜索项目" aria-label="搜索项目" />
          <button className={projectFilter === 'all' ? 'is-active' : ''} onClick={() => setProjectFilter('all')} type="button">全部项目</button>
          {visibleProjectOptions.map((item) => <button className={projectFilter === item.id ? 'is-active' : ''} key={item.id} onClick={() => setProjectFilter(item.id)} type="button">{item.name}</button>)}
          {projectPickerPages > 1 ? <span className="work-hours-project-pager"><button aria-label="上一页项目" disabled={projectPickerPage === 0} onClick={() => setProjectPickerPage((page) => Math.max(0, page - 1))} type="button">‹</button><span>{projectPickerPage + 1}/{projectPickerPages}</span><button aria-label="下一页项目" disabled={projectPickerPage >= projectPickerPages - 1} onClick={() => setProjectPickerPage((page) => Math.min(projectPickerPages - 1, page + 1))} type="button">›</button></span> : null}
        </div> : null}
        {mode === 'mine' && mineTab === 'records' ? <Label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="confirmed">已确认</option><option value="pending">待确认</option></select></Label> : null}
      </div>

      {error ? <div className="work-hours-error" role="alert">{error}</div> : null}
      {mode !== 'mine' || mineTab === 'stats' ? <>
        <div className="work-hours-metrics">
          <div><Clock size={18} /><span>{mode === 'mine' ? '本周期已记录' : mode === 'organization' ? '任务预估' : '预估'}</span><strong>{mode === 'organization' ? hours(estimatedMinutes) : mode === 'project' ? hours(estimatedMinutes) : hours(summary.totalMinutes)}</strong></div>
          <div><CheckCircle size={18} /><span>{mode === 'mine' ? '本周期已确认' : '已确认'}</span><strong>{hours(summary.confirmedMinutes)}</strong></div>
          <div><TrendUp size={18} /><span>{mode === 'mine' ? '本周期未确认' : '未确认'}</span><strong>{hours(summary.pendingMinutes)}</strong></div>
          <div><ChartLine size={18} /><span>{mode === 'mine' ? '参与项目' : '偏差'}</span><strong>{mode === 'mine' ? summary.projectCount : mode === 'organization' ? signedHours(summary.byProject.reduce((sum, item) => sum + (item.varianceMinutes ?? 0), 0)) : signedHours(projectVarianceMinutes)}</strong></div>
        </div>
        {mode === 'mine' ? <div className="work-hours-grid">
          <section className="work-hours-card work-hours-table-card"><h4>我的投入趋势</h4><p className="work-hours-card-note">{period === 'week' ? '按工作日期每日汇总' : '按自然月日期汇总'}</p><WorkHourTrendChart points={trendPoints} /></section>
          <section className="work-hours-card"><h4>项目分布</h4><p className="work-hours-card-note">按当前周期已记录工时分布</p>{filteredProjects.length ? filteredProjects.map((item) => <button className="work-hours-project-card" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><span><i className={`work-hours-project-dot ${projectTone(item.projectId)}`} />{item.projectName}</span><small>{item.taskCount ?? 0} 个参与任务</small><strong>{hours(item.minutes)}</strong></button>) : <p className="work-hours-empty">当前周期暂无项目投入</p>}</section>
        </div> : null}
        {mode === 'mine' ? <section className="work-hours-card work-hours-table-card work-hours-personal-table"><div className="work-hours-section-heading"><div><h4>我的项目投入</h4><p className="work-hours-card-note">展示本人在当前周期参与的任务和投入占比</p></div></div>{tableSearch('搜索项目', '搜索我的项目投入')}{filteredProjects.length ? <div className="work-hours-table"><div className="work-hours-table-row work-hours-table-heading"><span>项目</span><span>参与任务</span><span>已确认</span><span>未确认</span><span>已记录</span><span>个人投入占比</span></div>{visibleProjects.map((item) => <button className="work-hours-table-row" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><strong><i className={`work-hours-project-dot ${projectTone(item.projectId)}`} />{item.projectName}</strong><span>{item.taskCount ?? 0}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><span>{hours(item.minutes)}</span><span>{summary.totalMinutes ? `${(item.minutes / summary.totalMinutes * 100).toFixed(1)}%` : '0%'}</span></button>)}</div> : <p className="work-hours-empty">当前周期暂无项目投入</p>}{tablePagination('搜索我的项目投入', filteredProjects.length)}</section> : null}
      </> : null}

      {mode !== 'mine' && managementTab === 'projects' ? <>
        <div className="work-hours-overview-grid">
          <section className="work-hours-card work-hours-table-card">
            <div className="work-hours-section-heading"><div><h4>投入趋势</h4><p className="work-hours-card-note">{period === 'week' ? '按工作日期汇总' : '按自然月日期汇总'}</p></div><span className="work-hours-history-summary">{summary.byDate.length} 个工作日</span></div>
            <WorkHourTrendChart points={trendPoints} />
          </section>
          <section className="work-hours-card work-hours-overview-members">
            <div className="work-hours-section-heading"><div><h4>成员投入</h4><p className="work-hours-card-note">按实际填报人归属</p></div></div>
            <MemberComparison members={summary.byUser} />
          </section>
        </div>
        {mode === 'project' ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><div><h4>任务工时</h4><p className="work-hours-card-note">点击任务进入任务详情</p></div></div>{tableSearch('搜索任务或负责人', '搜索任务投入')}<div className="work-hours-table work-hours-task-table"><div className="work-hours-table-row work-hours-table-heading"><span>任务</span><span>负责人</span><span>预估</span><span>累计确认</span><span>未确认</span><span>状态</span></div>{visibleTasks.map((task) => { const state = getTaskStatus(task); return <button className="work-hours-table-row" key={task.taskId} onClick={() => openTaskDetail(task.taskId)} type="button"><strong>{task.title}</strong><span>{task.assigneeName ?? '未分配'}</span><span>{hours(task.estimatedMinutes)}</span><span>{hours(task.confirmedMinutes)}</span><span>{hours(task.pendingMinutes)}</span><span><b className={`work-hours-status-badge ${state.className}`}>{state.label}</b></span></button> })}</div>{filteredTasks.length === 0 ? <p className="work-hours-empty">当前周期暂无任务投入</p> : null}{tablePagination('搜索任务投入', filteredTasks.length)}</section> : <section className="work-hours-card work-hours-table-card"><h4>项目投入明细</h4>{tableSearch('搜索项目', '搜索项目投入')}<div className="work-hours-table work-hours-project-table"><div className="work-hours-table-row work-hours-table-heading"><span>项目</span><span>任务</span><span>预估</span><span>已确认</span><span>待确认</span><span>偏差</span></div>{visibleProjects.map((item) => <button className="work-hours-table-row" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><strong>{item.projectName}</strong><span>{item.taskCount ?? 0}</span><span>{hours(item.estimatedMinutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><span className={(item.varianceMinutes ?? 0) > 0 ? 'is-overrun' : ''}>{item.varianceMinutes == null ? '-' : signedHours(item.varianceMinutes)}</span></button>)}</div>{tablePagination('搜索项目投入', filteredProjects.length)}</section>}
      </> : null}
      {mode !== 'mine' && managementTab === 'members' ? <>
        <section className="work-hours-card work-hours-overview-members"><h4>成员投入对比</h4><p className="work-hours-card-note">按成员分别对比已确认和未确认投入</p><MemberComparison members={summary.byUser} /></section>
        <section className="work-hours-card work-hours-table-card"><h4>成员投入明细</h4>{tableSearch('搜索成员', '搜索成员投入')}<div className="work-hours-table work-hours-member-table"><div className="work-hours-table-row work-hours-table-heading"><span>成员</span><span>项目</span><span>任务</span><span>已确认</span><span>未确认</span><span>已退回</span><span>累计</span></div>{visibleUsers.map((item) => <div className="work-hours-table-row" key={item.userId}><strong>{item.userName}</strong><span>{item.projectCount ?? 0}</span><span>{item.taskCount ?? 0}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><span>{hours(item.returnedMinutes)}</span><strong>{hours(item.minutes)}</strong></div>)}</div>{tablePagination('搜索成员投入', filteredUsers.length)}</section>
      </> : null}
      {mode !== 'mine' && managementTab === 'trend' ? mode === 'project'
        ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><div><h4>确认 / 待确认趋势</h4><p className="work-hours-card-note">按工作日期列表展示确认状态</p></div><span className="work-hours-history-summary">{summary.byDate.length} 个工作日</span></div>{tableSearch('搜索日期', '搜索每日投入')}{summary.byDate.length ? <div className="work-hours-table work-hours-date-table"><div className="work-hours-table-row work-hours-table-heading"><span>日期</span><span>总投入</span><span>已确认</span><span>未确认</span></div>{visibleDates.map((item) => <div className="work-hours-table-row" key={item.date}><strong>{item.date}</strong><span>{hours(item.minutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span></div>)}</div> : <p className="work-hours-empty">当前周期暂无记录</p>}{tablePagination('搜索每日投入', filteredDates.length)}</section>
        : <><section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><div><h4>投入趋势</h4><p className="work-hours-card-note">仅展示当前周期总投入趋势</p></div><span className="work-hours-history-summary">{summary.byDate.length} 个工作日</span></div><WorkHourTrendChart points={trendPoints} showBreakdown={false} /></section><section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><div><h4>趋势明细</h4><p className="work-hours-card-note">按工作日期查看全部投入</p></div></div>{tableSearch('搜索日期', '搜索趋势日期')}{filteredDates.length ? <div className="work-hours-table work-hours-date-table"><div className="work-hours-table-row work-hours-table-heading"><span>日期</span><span>总投入</span><span>已确认</span><span>未确认</span></div>{visibleDates.map((item) => <div className="work-hours-table-row" key={item.date}><strong>{item.date}</strong><span>{hours(item.minutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span></div>)}</div> : <p className="work-hours-empty">当前周期暂无记录</p>}{tablePagination('搜索趋势日期', filteredDates.length)}</section></>
        : null}
      {mode === 'project' && managementTab === 'tasks' ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><h4>任务明细</h4><div className="work-hours-task-filters"><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value as typeof taskFilter)}><option value="all">全部状态</option><option value="open">进行中</option><option value="done">已完成</option></select></div></div>{tableSearch('搜索任务或负责人', '搜索任务明细')}<div className="work-hours-table work-hours-task-table"><div className="work-hours-table-row work-hours-table-heading"><span>任务</span><span>负责人</span><span>预估</span><span>累计确认</span><span>未确认</span><span>状态</span></div>{visibleTasks.map((task) => { const state = getTaskStatus(task); return <button className="work-hours-table-row" key={task.taskId} onClick={() => openTaskDetail(task.taskId)} type="button"><strong>{task.title}</strong><span>{task.assigneeName ?? '未分配'}</span><span>{hours(task.estimatedMinutes)}</span><span>{hours(task.confirmedMinutes)}</span><span>{hours(task.pendingMinutes)}</span><span><b className={`work-hours-status-badge ${state.className}`}>{state.label}</b></span></button> })}</div>{tablePagination('搜索任务明细', filteredTasks.length)}</section> : null}

      {mode === 'mine' && mineTab === 'records' ? <section className="work-hours-card work-hours-records"><h4>工时记录</h4>{tableSearch('搜索项目、任务、说明或日期', '搜索工时记录')}{loading ? <p className="work-hours-empty">加载中...</p> : filteredEntries.length === 0 ? <p className="work-hours-empty">当前周期暂无匹配工时</p> : <div className="work-hours-record-list">{visibleEntries.map((entry) => { const state = workHourStatus(entry); return <article className="work-hours-record" key={entry.id}><time>{entry.workDate}</time><div><strong>{entry.projectName ?? '项目'} · {entry.todoTitle ?? `任务 #${entry.todoId}`}</strong><p>{entry.description}</p><small>{entry.userName ? `${entry.userName} · ` : ''}<b className={`work-hours-status-badge ${state.className}`}>{state.label}</b></small></div><b>{hours(entry.minutes)}</b>{entry.status === 'pending' ? <div className="work-hours-record-actions"><Button aria-label="编辑工时" size="icon" variant="ghost" onClick={() => openRecorder(entry)}><PencilSimple size={16} /></Button><Button aria-label="删除工时" size="icon" variant="ghost" onClick={() => setDeletingEntry(entry)}><Trash size={16} /></Button></div> : null}</article> })}</div>}{tablePagination('搜索工时记录', entryPagination.total)}</section> : null}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) { setDialogOpen(open); if (!open) onRecorderDismiss?.() } }}><DialogContent className="work-hours-dialog"><DialogHeader><DialogTitle>{editingEntry ? '编辑工时' : '填报工时'}</DialogTitle><DialogDescription>{recorderContextLocked && !editingEntry ? '已从待办带入项目和任务，请填写本次实际完成的工作。' : '选择组织内可访问的进行中任务，记录本人实际完成的工作。'}</DialogDescription></DialogHeader><div className="work-hours-dialog-form">{recorderContextLocked && !editingEntry ? <div className="work-hours-locked-context" aria-label="已选择的项目和任务"><div><span>项目</span><strong>{selectedProjectName ?? '当前项目'}</strong></div><div><span>任务</span><strong>{todos.find((todo) => todo.id === selectedTodoId)?.title ?? `任务 #${selectedTodoId}`}</strong></div></div> : <><Label>项目{recorderProjectPicker}</Label><Label>任务{recorderTaskPicker}</Label></>}<div className="work-hours-form-grid"><Label>日期<Input max={dateInputValue(new Date())} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></Label><Label>时长（小时）<Input min="1" max="24" step="1" type="number" value={String(Number(minutes) / 60)} onChange={(event) => setMinutes(String(Math.round(Number(event.target.value) * 60)))} /></Label></div><Label><span>工作说明 <span className="field-required" aria-hidden="true">*</span></span><textarea aria-required="true" required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明本次完成的工作和结果" rows={4} /></Label>{error ? <div className="work-hours-error">{error}</div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)} type="button">取消</Button><Button disabled={saving || !selectedTodoId || !description.trim()} onClick={() => void saveRecord()} type="button">{saving ? '保存中...' : '保存记录'}</Button></DialogFooter></DialogContent></Dialog>
      <ConfirmActionDialog actionKey={`delete-work-hour:${deletingEntry?.id ?? 0}`} open={Boolean(deletingEntry)} onOpenChange={(open) => { if (!open) setDeletingEntry(null) }} title="删除工时记录" description="删除后无法恢复，统计数据会立即更新。" confirmLabel="删除记录" onConfirm={async () => { if (!deletingEntry) return false; await removeWorkHour(deletingEntry.id); setDeletingEntry(null); reload(); return true }} />
      <AiExportPromptDialog open={Boolean(exportPrompt)} onOpenChange={(open) => { if (!open) setExportPrompt(null) }} title="确认导出工时提示词" prompt={exportPrompt?.prompt ?? ''} fileName={exportPrompt?.fileName ?? '工时分析提示词'} summary={exportPrompt?.summary} />
    </section>
  )
}
