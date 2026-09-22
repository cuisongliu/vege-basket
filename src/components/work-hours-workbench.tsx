import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartLine, CheckCircle, Clock, Plus, TrendUp } from '@phosphor-icons/react'
import {
  createWorkHour,
  fetchMyWorkHours,
  fetchOrganizationWorkHours,
  fetchProjectTodos,
  fetchProjectWorkHours,
  type WorkHourEntry,
  type WorkHourSummary,
} from '../api'
import type { Project, Todo } from '../types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import './work-hours-workbench.css'

function hours(minutes: number) {
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 2)}h`
}

function defaultRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  return {
    endDate: end.toISOString().slice(0, 10),
    startDate: start.toISOString().slice(0, 10),
  }
}

const emptySummary: WorkHourSummary = {
  byDate: [], byProject: [], byUser: [], confirmedMinutes: 0, pendingMinutes: 0,
  projectCount: 0, taskCount: 0, totalHours: 0, totalMinutes: 0,
}

export function WorkHoursWorkbench({
  mode,
  organizationId,
  project,
  projects,
}: {
  mode: 'mine' | 'organization' | 'project'
  organizationId?: number | null
  project?: Project
  projects: Project[]
}) {
  const [range, setRange] = useState(defaultRange)
  const [entries, setEntries] = useState<WorkHourEntry[]>([])
  const [summary, setSummary] = useState<WorkHourSummary>(emptySummary)
  const [todos, setTodos] = useState<Todo[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(project?.id ?? null)
  const [selectedTodoId, setSelectedTodoId] = useState<number | null>(null)
  const [minutes, setMinutes] = useState('60')
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10))
  const [description, setDescription] = useState('')
  const [showRecorder, setShowRecorder] = useState(false)
  const [mineTab, setMineTab] = useState<'records' | 'stats'>('records')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const projectId = project?.id
  const startDate = range.startDate
  const endDate = range.endDate

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    const request = mode === 'organization' && organizationId
      ? fetchOrganizationWorkHours(organizationId, { startDate, endDate })
      : mode === 'project' && projectId
        ? fetchProjectWorkHours(projectId, { startDate, endDate })
        : fetchMyWorkHours({ startDate, endDate })
    void request.then((data) => {
      setEntries(data.entries)
      setSummary(data.summary)
    }).catch((cause) => setError(cause instanceof Error ? cause.message : '工时加载失败。'))
      .finally(() => setLoading(false))
  }, [endDate, mode, organizationId, projectId, startDate])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!selectedProjectId || mode !== 'mine') {
      setTodos([])
      return
    }
    void fetchProjectTodos(selectedProjectId).then((data) => setTodos(data.todos.filter((todo) => !todo.done))).catch(() => setTodos([]))
  }, [mode, selectedProjectId])

  const projectOptions = useMemo(
    () => projects.filter((candidate) => candidate.organizationId != null),
    [projects],
  )

  async function record() {
    if (!selectedTodoId) return
    try {
      await createWorkHour({ todoId: selectedTodoId, minutes: Number(minutes), workDate, description })
      setShowRecorder(false)
      setDescription('')
      reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时保存失败。')
    }
  }

  return (
    <section className="work-hours-workbench">
      <div className="work-hours-header">
        <div>
          <p className="work-hours-eyebrow">{mode === 'mine' ? '我的工时' : mode === 'project' ? '项目工时' : '组织工时统计'}</p>
          <h3>{mode === 'mine' ? '只显示你的投入记录' : mode === 'project' ? project?.name : '企业项目投入总览'}</h3>
        </div>
        {mode === 'mine' ? <Button type="button" onClick={() => setShowRecorder((value) => !value)}><Plus size={16} /> 记录工时</Button> : null}
      </div>
      {mode === 'mine' ? (
        <div className="work-hours-tabs" role="tablist" aria-label="我的工时视图">
          <button className={mineTab === 'records' ? 'is-active' : ''} type="button" role="tab" aria-selected={mineTab === 'records'} onClick={() => setMineTab('records')}>工时记录</button>
          <button className={mineTab === 'stats' ? 'is-active' : ''} type="button" role="tab" aria-selected={mineTab === 'stats'} onClick={() => setMineTab('stats')}>工时统计</button>
        </div>
      ) : null}
      <div className="work-hours-filters">
        <Label>开始日期<Input type="date" value={range.startDate} onChange={(event) => setRange((value) => ({ ...value, startDate: event.target.value }))} /></Label>
        <Label>结束日期<Input type="date" value={range.endDate} onChange={(event) => setRange((value) => ({ ...value, endDate: event.target.value }))} /></Label>
      </div>
      {showRecorder && (mode !== 'mine' || mineTab === 'records') ? (
        <div className="work-hours-recorder">
          <Label>项目<select value={selectedProjectId ?? ''} onChange={(event) => { setSelectedProjectId(Number(event.target.value) || null); setSelectedTodoId(null) }}><option value="">先选择项目</option>{projectOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></Label>
          <Label>任务<select disabled={!selectedProjectId} value={selectedTodoId ?? ''} onChange={(event) => setSelectedTodoId(Number(event.target.value) || null)}><option value="">再选择任务</option>{todos.map((todo) => <option key={todo.id} value={todo.id}>{todo.title}</option>)}</select></Label>
          <Label>日期<Input type="date" value={workDate} onChange={(event) => setWorkDate(event.target.value)} /></Label>
          <Label>时长（分钟）<Input min="15" step="15" type="number" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></Label>
          <Label className="work-hours-recorder-description">说明<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="可选" /></Label>
          <Button type="button" disabled={!selectedTodoId} onClick={() => void record()}>保存记录</Button>
        </div>
      ) : null}
      {error ? <div className="work-hours-error">{error}</div> : null}
      {mode !== 'mine' || mineTab === 'stats' ? <div className="work-hours-metrics">
        <div><Clock size={18} /><span>总投入</span><strong>{hours(summary.totalMinutes)}</strong></div>
        <div><CheckCircle size={18} /><span>已确认</span><strong>{hours(summary.confirmedMinutes)}</strong></div>
        <div><TrendUp size={18} /><span>待确认</span><strong>{hours(summary.pendingMinutes)}</strong></div>
        <div><ChartLine size={18} /><span>{mode === 'project' ? '预估工时' : '参与任务'}</span><strong>{mode === 'project' ? hours(summary.estimatedMinutes ?? 0) : summary.taskCount}</strong></div>
      </div> : null}
      {mode !== 'mine' || mineTab === 'stats' ? <div className="work-hours-grid">
        <div className="work-hours-card"><h4>投入趋势</h4>{summary.byDate.length === 0 ? <p className="work-hours-empty">暂无记录</p> : summary.byDate.map((item) => <div className="work-hours-bar-row" key={item.date}><span>{item.date.slice(5)}</span><div><i style={{ width: `${Math.min(100, item.minutes / Math.max(...summary.byDate.map((value) => value.minutes), 1) * 100)}%` }} /></div><strong>{hours(item.minutes)}</strong></div>)}</div>
        <div className="work-hours-card"><h4>{mode === 'mine' ? '项目投入' : '成员投入'}</h4>{mode === 'mine' ? summary.byProject.map((item) => <div className="work-hours-list-row" key={item.projectId}><span>{item.projectName}</span><strong>{hours(item.minutes)}</strong></div>) : summary.byUser.map((item) => <div className="work-hours-list-row" key={item.userId}><span>{item.userName}</span><strong>{hours(item.minutes)}</strong></div>)}</div>
      </div> : null}
      {mode !== 'mine' || mineTab === 'records' ? <div className="work-hours-card work-hours-table-card"><h4>工时明细</h4>{loading ? <p className="work-hours-empty">加载中...</p> : entries.length === 0 ? <p className="work-hours-empty">当前周期暂无工时</p> : <div className="work-hours-table">{entries.map((entry) => <div className="work-hours-table-row" key={entry.id}><span>{entry.workDate}</span><span>{entry.projectName ?? '项目'}</span><span>{entry.todoTitle ?? `任务 #${entry.todoId}`}</span><strong>{hours(entry.minutes)}</strong><span className={`work-hours-status is-${entry.status}`}>{entry.status === 'confirmed' ? '已确认' : '未确认'}</span></div>)}</div>}</div> : null}
    </section>
  )
}
