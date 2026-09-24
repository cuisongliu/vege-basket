import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartLine, CheckCircle, Clock, DownloadSimple, MagnifyingGlass, PencilSimple, Plus, Trash, TrendUp } from '@phosphor-icons/react'
import {
  createWorkHour, fetchMyWorkHours, fetchOrganizationWorkHours, fetchProjectTodos,
  fetchProjectWorkHours, removeWorkHour, updateWorkHour,
  type WorkHourEntry, type WorkHourSummary,
} from '../api'
import type { Project, Todo } from '../types'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
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

function rangeForPeriod(period: 'week' | 'month') {
  const end = new Date()
  const start = new Date(end)
  if (period === 'week') start.setDate(end.getDate() - ((end.getDay() + 6) % 7))
  else start.setDate(1)
  return { endDate: dateInputValue(end), startDate: dateInputValue(start) }
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

function csvCell(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`
}

const emptySummary: WorkHourSummary = {
  byDate: [], byProject: [], byUser: [], confirmedMinutes: 0, pendingMinutes: 0,
  projectCount: 0, taskCount: 0, totalHours: 0, totalMinutes: 0,
}

type Props = {
  mode: 'mine' | 'organization' | 'project'
  organizationId?: number | null
  project?: Project
  projects: Project[]
  currentUserId?: number
  currentUserName?: string
  onTodoClick?: (projectId: number, todoId: number) => void
  onProjectClick?: (projectId: number) => void
}

export function WorkHoursWorkbench({
  mode, organizationId, project, projects, currentUserId, currentUserName,
  onTodoClick, onProjectClick,
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
  const [taskQuery, setTaskQuery] = useState('')
  const [taskStatus, setTaskStatus] = useState<'all' | 'open' | 'done'>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<WorkHourEntry | null>(null)
  const [deletingEntry, setDeletingEntry] = useState<WorkHourEntry | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(project?.id ?? null)
  const [selectedTodoId, setSelectedTodoId] = useState<number | null>(null)
  const [minutes, setMinutes] = useState('60')
  const [workDate, setWorkDate] = useState(dateInputValue(new Date()))
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const projectId = project?.id

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    const filters = { startDate: range.startDate, endDate: range.endDate, status }
    const request = mode === 'organization' && organizationId
      ? fetchOrganizationWorkHours(organizationId, filters)
      : mode === 'project' && projectId
        ? fetchProjectWorkHours(projectId, filters)
        : fetchMyWorkHours({ ...filters, projectId: projectFilter === 'all' ? undefined : projectFilter })
    void request.then((data) => { setEntries(data.entries); setSummary(data.summary) })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '工时加载失败。'))
      .finally(() => setLoading(false))
  }, [mode, organizationId, projectFilter, projectId, range.endDate, range.startDate, status])

  useEffect(() => { reload() }, [reload])
  useEffect(() => { setRange(rangeForPeriod(period)) }, [period])
  useEffect(() => {
    if (!selectedProjectId || mode !== 'mine') { setTodos([]); return }
    const selectedProject = projects.find((candidate) => candidate.id === selectedProjectId)
    void fetchProjectTodos(selectedProjectId)
      .then((data) => setTodos(data.todos.filter((todo) => !todo.done && (
        todo.assigneeUserId === currentUserId || (todo.assigneeUserId == null && selectedProject?.ownerUserId === currentUserId)
      ))))
      .catch(() => setTodos([]))
  }, [currentUserId, mode, projects, selectedProjectId])

  const projectOptions = useMemo(() => projects.filter((candidate) => candidate.organizationId != null), [projects])
  const filteredTasks = useMemo(() => (summary.tasks ?? []).filter((task) => {
    const matchesQuery = !taskQuery.trim() || task.title.toLowerCase().includes(taskQuery.trim().toLowerCase()) || task.assigneeName?.toLowerCase().includes(taskQuery.trim().toLowerCase())
    return matchesQuery && (taskStatus === 'all' || (taskStatus === 'done' ? task.done : !task.done))
  }), [summary.tasks, taskQuery, taskStatus])

  function openRecorder(entry?: WorkHourEntry) {
    setError('')
    setEditingEntry(entry ?? null)
    setSelectedProjectId(entry?.projectId ?? project?.id ?? projectOptions[0]?.id ?? null)
    setSelectedTodoId(entry?.todoId ?? null)
    setMinutes(String(entry?.minutes ?? 60))
    setWorkDate(entry?.workDate ?? dateInputValue(new Date()))
    setDescription(entry?.description ?? '')
    setDialogOpen(true)
  }

  async function saveRecord() {
    const amount = Number(minutes)
    if (!description.trim()) { setError('请填写本次工作的说明。'); return }
    if (!selectedTodoId || !Number.isInteger(amount) || amount < 15 || amount > 1440 || amount % 15 !== 0) {
      setError('请选择任务；工时须按 15 分钟递增，且不超过 24 小时。')
      return
    }
    setSaving(true)
    try {
      if (editingEntry) await updateWorkHour(editingEntry.id, { minutes: amount, workDate, description: description.trim() })
      else await createWorkHour({ todoId: selectedTodoId, minutes: amount, workDate, description: description.trim() })
      setDialogOpen(false)
      reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时保存失败。')
    } finally { setSaving(false) }
  }

  function exportEntries() {
    const csv = [['日期', '项目', '任务', '说明', '小时', '状态'], ...entries.map((entry) => [entry.workDate, entry.projectName ?? '', entry.todoTitle ?? '', entry.description, entry.hours, entry.status === 'confirmed' ? '已确认' : '待确认'])]
      .map((row) => row.map(csvCell).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `我的工时-${range.startDate}-${range.endDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const maxDateMinutes = Math.max(...summary.byDate.map((item) => item.minutes), 1)
  const estimatedMinutes = summary.estimatedMinutes ?? summary.byProject.reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0)
  const selectedTask = summary.tasks?.find((task) => task.taskId === selectedTaskId)
  const selectedTaskEntries = entries.filter((entry) => entry.todoId === selectedTaskId)

  return (
    <section className="work-hours-workbench">
      <header className="work-hours-header">
        <div><p className="work-hours-eyebrow">{mode === 'mine' ? `${currentUserName ?? '我'} · 个人工时` : mode === 'project' ? '项目工时台账' : '企业工时管理'}</p><h3>{mode === 'mine' ? '我的工时' : mode === 'project' ? project?.name : '工时统计'}</h3></div>
        {mode === 'mine' ? <div className="work-hours-actions"><Button type="button" variant="outline" onClick={exportEntries}><DownloadSimple size={16} />导出</Button><Button type="button" onClick={() => openRecorder()}><Plus size={16} />填报工时</Button></div> : null}
      </header>

      <nav className="work-hours-tabs" aria-label="工时视图">
        {mode === 'mine' ? <><button className={mineTab === 'stats' ? 'is-active' : ''} onClick={() => setMineTab('stats')} type="button">工时统计</button><button className={mineTab === 'records' ? 'is-active' : ''} onClick={() => setMineTab('records')} type="button">工时记录</button></> : <>
          <button className={managementTab === 'projects' ? 'is-active' : ''} onClick={() => setManagementTab('projects')} type="button">{mode === 'project' ? '项目概览' : '项目投入'}</button>
          <button className={managementTab === 'members' ? 'is-active' : ''} onClick={() => setManagementTab('members')} type="button">成员投入</button>
          <button className={managementTab === 'trend' ? 'is-active' : ''} onClick={() => setManagementTab('trend')} type="button">投入趋势</button>
          {mode === 'project' ? <button className={managementTab === 'tasks' ? 'is-active' : ''} onClick={() => setManagementTab('tasks')} type="button">任务工时</button> : null}
        </>}
      </nav>

      <div className="work-hours-filters">
        <div className="work-hours-period"><button className={period === 'week' ? 'is-active' : ''} onClick={() => setPeriod('week')} type="button">周</button><button className={period === 'month' ? 'is-active' : ''} onClick={() => setPeriod('month')} type="button">月</button></div>
        <div className="work-hours-date-nav"><button onClick={() => setRange((value) => shiftRange(value, period, -1))} type="button">上一周期</button><strong>{range.startDate.replaceAll('-', '.')} - {range.endDate.replaceAll('-', '.')}</strong><button onClick={() => setRange((value) => shiftRange(value, period, 1))} type="button">下一周期</button></div>
        {mode === 'mine' ? <Label>项目<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="all">全部企业项目</option>{projectOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Label> : null}
        <Label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部</option><option value="confirmed">已确认</option><option value="pending">待确认</option></select></Label>
      </div>

      {error ? <div className="work-hours-error" role="alert">{error}</div> : null}
      {mode !== 'mine' || mineTab === 'stats' ? <>
        <div className="work-hours-metrics">
          <div><Clock size={18} /><span>累计投入</span><strong>{hours(summary.totalMinutes)}</strong></div>
          <div><CheckCircle size={18} /><span>已确认</span><strong>{hours(summary.confirmedMinutes)}</strong></div>
          <div><TrendUp size={18} /><span>待确认</span><strong>{hours(summary.pendingMinutes)}</strong></div>
          <div><ChartLine size={18} /><span>{mode === 'mine' ? '参与项目' : '累计预估'}</span><strong>{mode === 'mine' ? summary.projectCount : hours(estimatedMinutes)}</strong></div>
        </div>
        {mode === 'mine' ? <div className="work-hours-grid">
          <section className="work-hours-card"><h4>投入趋势</h4>{summary.byDate.length ? summary.byDate.map((item) => <div className="work-hours-bar-row" key={item.date}><span>{item.date.slice(5)}</span><div className="work-hours-split-bar"><i className="is-confirmed" style={{ width: `${item.confirmedMinutes / maxDateMinutes * 100}%` }} /><i className="is-pending" style={{ width: `${item.pendingMinutes / maxDateMinutes * 100}%` }} /></div><strong>{hours(item.minutes)}</strong></div>) : <p className="work-hours-empty">当前周期暂无记录</p>}</section>
          <section className="work-hours-card"><h4>项目投入</h4>{summary.byProject.map((item) => <button className="work-hours-project-card" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><span>{item.projectName}</span><small>{item.taskCount ?? 0} 个任务</small><strong>{hours(item.minutes)}</strong></button>)}</section>
        </div> : null}
      </> : null}

      {mode !== 'mine' && managementTab === 'projects' ? <section className="work-hours-card work-hours-table-card"><h4>{mode === 'project' ? '项目投入概览' : '全部项目'}</h4><div className="work-hours-table work-hours-project-table"><div className="work-hours-table-row work-hours-table-heading"><span>项目</span><span>任务</span><span>预估</span><span>已确认</span><span>待确认</span><span>偏差</span></div>{summary.byProject.map((item) => <button className="work-hours-table-row" key={item.projectId} onClick={() => onProjectClick?.(item.projectId)} type="button"><strong>{item.projectName}</strong><span>{item.taskCount ?? 0}</span><span>{hours(item.estimatedMinutes)}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><span className={(item.varianceMinutes ?? 0) > 0 ? 'is-overrun' : ''}>{item.varianceMinutes == null ? '-' : `${item.varianceMinutes > 0 ? '+' : ''}${hours(item.varianceMinutes)}`}</span></button>)}</div></section> : null}
      {mode !== 'mine' && managementTab === 'members' ? <section className="work-hours-card work-hours-table-card"><h4>成员投入</h4><div className="work-hours-table work-hours-member-table"><div className="work-hours-table-row work-hours-table-heading"><span>成员</span><span>项目</span><span>任务</span><span>已确认</span><span>待确认</span><span>累计</span></div>{summary.byUser.map((item) => <div className="work-hours-table-row" key={item.userId}><strong>{item.userName}</strong><span>{item.projectCount ?? 0}</span><span>{item.taskCount ?? 0}</span><span>{hours(item.confirmedMinutes)}</span><span>{hours(item.pendingMinutes)}</span><strong>{hours(item.minutes)}</strong></div>)}</div></section> : null}
      {mode !== 'mine' && managementTab === 'trend' ? <section className="work-hours-card"><h4>确认 / 待确认趋势</h4>{summary.byDate.length ? summary.byDate.map((item) => <div className="work-hours-bar-row" key={item.date}><span>{item.date.slice(5)}</span><div className="work-hours-split-bar"><i className="is-confirmed" style={{ width: `${item.confirmedMinutes / maxDateMinutes * 100}%` }} /><i className="is-pending" style={{ width: `${item.pendingMinutes / maxDateMinutes * 100}%` }} /></div><strong>{hours(item.minutes)}</strong></div>) : <p className="work-hours-empty">当前周期暂无记录</p>}</section> : null}
      {mode === 'project' && managementTab === 'tasks' ? <section className="work-hours-card work-hours-table-card"><div className="work-hours-section-heading"><h4>任务工时</h4><div className="work-hours-task-filters"><span><MagnifyingGlass size={15} /><Input value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} placeholder="搜索任务或负责人" /></span><select value={taskStatus} onChange={(event) => setTaskStatus(event.target.value as typeof taskStatus)}><option value="all">全部状态</option><option value="open">进行中</option><option value="done">已完成</option></select></div></div><div className="work-hours-table work-hours-task-table"><div className="work-hours-table-row work-hours-table-heading"><span>任务</span><span>负责人</span><span>预估</span><span>已确认</span><span>待确认</span><span>状态</span></div>{filteredTasks.map((task) => <button className="work-hours-table-row" key={task.taskId} onClick={() => setSelectedTaskId(task.taskId)} type="button"><strong>{task.title}</strong><span>{task.assigneeName ?? '未分配'}</span><span>{hours(task.estimatedMinutes)}</span><span>{hours(task.confirmedMinutes)}</span><span>{hours(task.pendingMinutes)}</span><span>{task.done ? '已完成' : task.confirmationStatus === 'pending_review' ? '待验收' : '进行中'}</span></button>)}</div></section> : null}

      {(mode !== 'mine' || mineTab === 'records') ? <section className="work-hours-card work-hours-records"><h4>{mode === 'mine' ? '工时记录' : '工时明细'}</h4>{loading ? <p className="work-hours-empty">加载中...</p> : entries.length === 0 ? <p className="work-hours-empty">当前周期暂无工时</p> : <div className="work-hours-record-list">{entries.map((entry) => <article className="work-hours-record" key={entry.id}><time>{entry.workDate}</time><div><strong>{entry.projectName ?? '项目'} · {entry.todoTitle ?? `任务 #${entry.todoId}`}</strong><p>{entry.description}</p><small>{entry.userName ? `${entry.userName} · ` : ''}{entry.status === 'confirmed' ? '已确认' : '待确认'}</small></div><b>{hours(entry.minutes)}</b>{mode === 'mine' && entry.status === 'pending' ? <div className="work-hours-record-actions"><Button aria-label="编辑工时" size="icon" variant="ghost" onClick={() => openRecorder(entry)}><PencilSimple size={16} /></Button><Button aria-label="删除工时" size="icon" variant="ghost" onClick={() => setDeletingEntry(entry)}><Trash size={16} /></Button></div> : null}</article>)}</div>}</section> : null}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open) }}><DialogContent className="work-hours-dialog"><DialogHeader><DialogTitle>{editingEntry ? '编辑工时' : '填报工时'}</DialogTitle><DialogDescription>选择本人负责的进行中任务，记录实际完成的工作。</DialogDescription></DialogHeader><div className="work-hours-dialog-form"><Label>项目<select disabled={Boolean(editingEntry)} value={selectedProjectId ?? ''} onChange={(event) => { setSelectedProjectId(Number(event.target.value) || null); setSelectedTodoId(null) }}><option value="">选择项目</option>{projectOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Label><Label>任务<select disabled={Boolean(editingEntry) || !selectedProjectId} value={selectedTodoId ?? ''} onChange={(event) => setSelectedTodoId(Number(event.target.value) || null)}><option value="">{selectedProjectId && todos.length === 0 ? '没有可填报的任务' : '选择任务'}</option>{todos.map((todo) => <option key={todo.id} value={todo.id}>{todo.title}</option>)}</select></Label><div className="work-hours-form-grid"><Label>日期<Input max={dateInputValue(new Date())} type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></Label><Label>时长（小时）<Input min="0.25" max="24" step="0.25" type="number" value={String(Number(minutes) / 60)} onChange={(event) => setMinutes(String(Math.round(Number(event.target.value) * 60)))} /></Label></div><Label>工作说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明本次完成的工作和结果" rows={4} /></Label>{error ? <div className="work-hours-error">{error}</div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)} type="button">取消</Button><Button disabled={saving || !selectedTodoId || !description.trim()} onClick={() => void saveRecord()} type="button">{saving ? '保存中...' : '保存记录'}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={Boolean(selectedTask)} onOpenChange={(open) => { if (!open) setSelectedTaskId(null) }}><DialogContent className="work-hours-task-drawer"><DialogHeader><DialogTitle>{selectedTask?.title}</DialogTitle><DialogDescription>{selectedTask?.assigneeName ?? '未分配负责人'} · {selectedTask?.done ? '已完成' : '进行中'}</DialogDescription></DialogHeader>{selectedTask ? <><div className="work-hours-drawer-metrics"><div><span>预估</span><strong>{hours(selectedTask.estimatedMinutes)}</strong></div><div><span>已确认</span><strong>{hours(selectedTask.confirmedMinutes)}</strong></div><div><span>待确认</span><strong>{hours(selectedTask.pendingMinutes)}</strong></div></div><div className="work-hours-drawer-list"><h4>工时记录</h4>{selectedTaskEntries.length ? selectedTaskEntries.map((entry) => <div key={entry.id}><span>{entry.workDate}<small>{entry.userName ?? ''}</small></span><p>{entry.description}</p><strong>{hours(entry.minutes)}</strong></div>) : <p className="work-hours-empty">当前周期暂无工时记录</p>}</div>{projectId && onTodoClick ? <DialogFooter><Button type="button" onClick={() => onTodoClick(projectId, selectedTask.taskId)}>打开任务详情</Button></DialogFooter> : null}</> : null}</DialogContent></Dialog>
      <ConfirmActionDialog actionKey={`delete-work-hour:${deletingEntry?.id ?? 0}`} open={Boolean(deletingEntry)} onOpenChange={(open) => { if (!open) setDeletingEntry(null) }} title="删除工时记录" description="删除后无法恢复，统计数据会立即更新。" confirmLabel="删除记录" onConfirm={async () => { if (!deletingEntry) return false; await removeWorkHour(deletingEntry.id); setDeletingEntry(null); reload(); return true }} />
    </section>
  )
}
