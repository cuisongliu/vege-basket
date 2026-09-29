import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Clock, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import {
  acceptWorkHours,
  fetchTodoWorkHours,
  removeWorkHour,
  submitWorkHours,
  updateWorkHour,
  type WorkHourEntry,
  type WorkHourSummary,
} from '../api'
import type { Todo } from '../types'
import { ConfirmActionDialog } from './confirm-action-dialog'
import { ListPagination } from './list-pagination'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import './todo-work-hours-panel.css'

const emptySummary: WorkHourSummary = {
  byDate: [], byProject: [], byUser: [], confirmedMinutes: 0, pendingMinutes: 0,
  projectCount: 0, taskCount: 0, totalHours: 0, totalMinutes: 0,
}

const MAX_SELECTED_ENTRIES = 100

function formatHours(minutes: number | null | undefined) {
  const value = minutes ?? 0
  return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)}h`
}

function formatVariance(actualMinutes: number, estimatedMinutes: number | null | undefined) {
  if (estimatedMinutes == null) return '未预估'
  const variance = actualMinutes - estimatedMinutes
  return `${variance > 0 ? '+' : ''}${formatHours(variance)}`
}

function todoStatus(todo: Todo) {
  if (todo.done) return '已完成'
  if (todo.confirmationStatus === 'pending_review') return '待验收'
  return '进行中'
}

export function TodoWorkHoursPanel({
  canRecord,
  canReview,
  currentUserId,
  onRecord,
  todo,
}: {
  canRecord: boolean
  canReview: boolean
  currentUserId?: number
  onRecord: () => void
  todo: Todo
}) {
  const [entries, setEntries] = useState<WorkHourEntry[]>([])
  const [summary, setSummary] = useState(emptySummary)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editingEntry, setEditingEntry] = useState<WorkHourEntry | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editHours, setEditHours] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingEntry, setDeletingEntry] = useState<WorkHourEntry | null>(null)
  const [acceptanceOpen, setAcceptanceOpen] = useState(false)
  const [acceptanceMode, setAcceptanceMode] = useState<'submit' | 'accept'>('submit')
  const [acceptanceEntries, setAcceptanceEntries] = useState<WorkHourEntry[]>([])
  const [acceptanceLoading, setAcceptanceLoading] = useState(false)
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([])
  const pageSize = 10
  const historicalEntries = acceptanceEntries.filter((entry) => entry.workDate < entry.createdAt.slice(0, 10))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetchTodoWorkHours(todo.id, {
        cursor: page * pageSize,
        limit: pageSize,
        q: query,
      })
      setEntries(response.entries)
      setSummary(response.summary)
      setTotal(response.pagination?.total ?? response.entries.length)
      const lastPage = Math.max(0, Math.ceil((response.pagination?.total ?? response.entries.length) / pageSize) - 1)
      if (page > lastPage) setPage(lastPage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时明细加载失败。')
    } finally {
      setLoading(false)
    }
  }, [page, query, todo.id])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPage(0) }, [query, todo.id])
  useEffect(() => {
    if (!acceptanceOpen) return
    let active = true
    setAcceptanceLoading(true)
    setSelectedEntryIds([])
    void (async () => {
      const allEntries: WorkHourEntry[] = []
      let cursor = 0
      while (true) {
        const response = await fetchTodoWorkHours(todo.id, { cursor, limit: 50 })
        allEntries.push(...response.entries)
        if (!response.pagination || allEntries.length >= response.pagination.total) break
        cursor += response.pagination.limit
      }
      if (active) setAcceptanceEntries(allEntries)
    })().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : '待验收工时加载失败。')
    }).finally(() => {
      if (active) setAcceptanceLoading(false)
    })
    return () => { active = false }
  }, [acceptanceOpen, todo.id])

  function beginEdit(entry: WorkHourEntry) {
    setEditingEntry(entry)
    setEditDate(entry.workDate)
    setEditHours(String(entry.hours))
    setEditDescription(entry.description)
    setError('')
  }

  async function saveEdit() {
    if (!editingEntry) return
    const minutes = Math.round(Number(editHours) * 60)
    if (!editDescription.trim() || !Number.isInteger(minutes) || minutes < 60 || minutes > 1440 || minutes % 60 !== 0) {
      setError('请填写工作说明，工时须按整数小时填写且不超过 24 小时。')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateWorkHour(editingEntry.id, { workDate: editDate, minutes, description: editDescription.trim() })
      setEditingEntry(null)
      setSuccess('工时记录已更新。')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时更新失败。')
    } finally {
      setSaving(false)
    }
  }

  async function runWorkflow(action: () => Promise<boolean>, message: string) {
    setSaving(true)
    setError('')
    try {
      const saved = await action()
      if (!saved) return false
      setSuccess(message)
      await load()
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工时验收操作失败。')
      return false
    } finally {
      setSaving(false)
    }
  }

  function openAcceptance(mode: 'submit' | 'accept') {
    setAcceptanceMode(mode)
    setAcceptanceEntries([])
    setSelectedEntryIds([])
    setError('')
    setAcceptanceOpen(true)
  }

  const selectableEntries = acceptanceEntries.filter((entry) => acceptanceMode === 'submit'
    ? entry.status === 'pending' && entry.userId === currentUserId
    : entry.status === 'submitted')
  const selectableBatch = selectableEntries.slice(0, MAX_SELECTED_ENTRIES)
  const selectedEntries = selectableEntries.filter((entry) => selectedEntryIds.includes(entry.id))
  const selectedMinutes = selectedEntries.reduce((sum, entry) => sum + entry.minutes, 0)

  return (
    <section className="todo-work-hours-panel" aria-label="待办工时明细">
      <div className="todo-work-hours-heading">
        <div>
          <span>工时明细</span>
          <strong>{todoStatus(todo)}</strong>
        </div>
        <div className="todo-work-hours-actions">
          {canRecord ? <Button type="button" variant="outline" onClick={onRecord}><Plus size={15} />记录工时</Button> : null}
          {canRecord && !todo.done ? <Button type="button" onClick={() => openAcceptance('submit')}>提交工时验收</Button> : null}
          {canReview ? <Button type="button" variant="outline" onClick={() => openAcceptance('accept')}><CheckCircle size={15} />验收工时</Button> : null}
        </div>
      </div>

      <div className="todo-work-hours-metrics">
        <div><span>预估</span><strong>{formatHours(todo.estimatedWorkMinutes)}</strong></div>
        <div><span>已确认</span><strong>{formatHours(summary.confirmedMinutes)}</strong></div>
        <div><span>未确认</span><strong>{formatHours(summary.pendingMinutes)}</strong></div>
      </div>

      <label className="todo-work-hours-search">
        <MagnifyingGlass size={15} />
        <Input aria-label="搜索工时明细" placeholder="搜索成员、说明、日期或状态" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {error ? <p className="todo-work-hours-message is-error" role="alert">{error}</p> : null}
      {success ? <p className="todo-work-hours-message is-success" role="status">{success}</p> : null}
      {loading && entries.length === 0 ? <p className="todo-work-hours-empty"><Clock className="spin" size={18} />正在加载工时明细...</p> : null}
      {!loading && total === 0 ? <p className="todo-work-hours-empty">暂无匹配的工时记录</p> : null}
      {entries.length > 0 ? (
        <div className="todo-work-hours-list" aria-busy={loading}>
          {entries.map((entry) => (
            <article key={entry.id}>
              <time>{entry.workDate}</time>
              <div><strong>{entry.userName ?? '项目成员'}</strong><p>{entry.description}</p><small>{entry.status === 'confirmed' ? '已确认' : entry.status === 'submitted' ? '待验收' : '未提交'}</small></div>
              <b>{formatHours(entry.minutes)}</b>
              {entry.status === 'pending' && entry.userId === currentUserId ? (
                <span>
                  <Button aria-label="编辑工时" size="icon" variant="ghost" type="button" onClick={() => beginEdit(entry)}><PencilSimple size={15} /></Button>
                  <Button aria-label="删除工时" size="icon" variant="ghost" type="button" onClick={() => setDeletingEntry(entry)}><Trash size={15} /></Button>
                </span>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
      {total > pageSize ? <ListPagination label="待办工时明细分页" page={page} pageSize={pageSize} total={total} disabled={loading} onPageChange={setPage} /> : null}

      <Dialog open={Boolean(editingEntry)} onOpenChange={(open) => { if (!open && !saving) setEditingEntry(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑工时</DialogTitle><DialogDescription>只能修改本人尚未确认的工时记录。</DialogDescription></DialogHeader>
          <div className="todo-work-hours-edit-form">
            <Label>日期<Input type="date" value={editDate} onChange={(event) => setEditDate(event.target.value)} /></Label>
          <Label>时长（小时）<Input min="1" max="24" step="1" type="number" value={editHours} onChange={(event) => setEditHours(event.target.value)} /></Label>
            <Label>工作说明<textarea rows={4} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></Label>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>取消</Button><Button type="button" disabled={saving || !editDescription.trim()} onClick={() => void saveEdit()}>{saving ? '保存中...' : '保存修改'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={acceptanceOpen} onOpenChange={(open) => { if (!saving) setAcceptanceOpen(open) }}>
        <DialogContent className="todo-work-hours-acceptance-dialog">
          <DialogHeader><DialogTitle>{acceptanceMode === 'submit' ? '提交工时验收' : '验收工时'}</DialogTitle><DialogDescription>{acceptanceMode === 'submit' ? '选择本次需要提交的工时，未选择的记录仍可继续修改。' : '选择本次确认的待验收工时，未选择的记录保持待验收。'}</DialogDescription></DialogHeader>
          <div className="todo-work-hours-acceptance-summary">
            <div><span>预估工时</span><strong>{formatHours(todo.estimatedWorkMinutes)}</strong></div>
            <div><span>实际工时</span><strong>{formatHours(summary.totalMinutes)}</strong></div>
            <div><span>已确认</span><strong>{formatHours(summary.confirmedMinutes)}</strong></div>
            <div><span>未确认</span><strong>{formatHours(summary.pendingMinutes)}</strong></div>
            <div className={todo.estimatedWorkMinutes != null && summary.totalMinutes > todo.estimatedWorkMinutes ? 'is-over' : ''}><span>工时偏差</span><strong>{formatVariance(summary.totalMinutes, todo.estimatedWorkMinutes)}</strong></div>
          </div>
          <section className="todo-work-hours-selection" aria-busy={acceptanceLoading}>
            <div className="todo-work-hours-selection-heading"><div><h4>{acceptanceMode === 'submit' ? '可提交工时' : '待验收工时'}</h4><span>已选 {selectedEntryIds.length} 条 · {formatHours(selectedMinutes)}{selectableEntries.length > MAX_SELECTED_ENTRIES ? ` · 单次最多 ${MAX_SELECTED_ENTRIES} 条` : ''}</span></div>{selectableEntries.length ? <label><input type="checkbox" checked={selectableBatch.length > 0 && selectedEntryIds.length === selectableBatch.length && selectableBatch.every((entry) => selectedEntryIds.includes(entry.id))} onChange={(event) => setSelectedEntryIds(event.target.checked ? selectableBatch.map((entry) => entry.id) : [])} />{selectableEntries.length > MAX_SELECTED_ENTRIES ? `选择前 ${MAX_SELECTED_ENTRIES} 条` : '全选'}</label> : null}</div>
            {acceptanceLoading ? <p className="todo-work-hours-empty"><Clock className="spin" size={18} />正在加载工时...</p> : selectableEntries.length ? selectableEntries.map((entry) => <label className="todo-work-hours-selection-row" key={entry.id}><input type="checkbox" checked={selectedEntryIds.includes(entry.id)} disabled={!selectedEntryIds.includes(entry.id) && selectedEntryIds.length >= MAX_SELECTED_ENTRIES} onChange={(event) => setSelectedEntryIds((current) => event.target.checked ? current.length < MAX_SELECTED_ENTRIES ? [...current, entry.id] : current : current.filter((id) => id !== entry.id))} /><time>{entry.workDate}</time><div><strong>{entry.userName ?? '项目成员'}</strong><p>{entry.description}</p></div><b>{formatHours(entry.minutes)}</b></label>) : <p className="todo-work-hours-empty">{acceptanceMode === 'submit' ? '当前没有可提交的工时记录' : '当前没有待验收的工时记录'}</p>}
          </section>
          {historicalEntries.length ? <section className="todo-work-hours-history-records"><h4>历史日期记录</h4>{historicalEntries.map((entry) => <div key={entry.id}><span>{entry.workDate}</span><p>{entry.description}</p><strong>{formatHours(entry.minutes)}</strong></div>)}</section> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAcceptanceOpen(false)}>取消</Button>
            <Button type="button" disabled={saving || acceptanceLoading || selectedEntryIds.length === 0} onClick={() => void runWorkflow(async () => { if (acceptanceMode === 'submit') await submitWorkHours(todo.id, selectedEntryIds); else await acceptWorkHours(todo.id, selectedEntryIds); return true }, acceptanceMode === 'submit' ? '所选工时已提交验收。' : '所选工时已确认。').then((saved) => { if (saved) setAcceptanceOpen(false) })}>{saving ? '处理中...' : acceptanceMode === 'submit' ? '提交所选工时' : '确认所选工时'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        actionKey={`delete-work-hour:${deletingEntry?.id ?? 0}`}
        open={Boolean(deletingEntry)}
        onOpenChange={(open) => { if (!open) setDeletingEntry(null) }}
        title="删除工时记录"
        description="删除后无法恢复，待办统计会立即更新。"
        confirmLabel="删除记录"
        onConfirm={async () => {
          if (!deletingEntry) return false
          await removeWorkHour(deletingEntry.id)
          setDeletingEntry(null)
          setSuccess('工时记录已删除。')
          await load()
          return true
        }}
      />
    </section>
  )
}
