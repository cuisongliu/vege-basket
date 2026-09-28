import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Clock, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import {
  fetchTodoWorkHours,
  removeWorkHour,
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

function formatHours(minutes: number | null | undefined) {
  const value = minutes ?? 0
  return `${(value / 60).toFixed(value % 60 === 0 ? 0 : 1)}h`
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
  onAccept,
  onRecord,
  onReturn,
  onSubmitReview,
  todo,
}: {
  canRecord: boolean
  canReview: boolean
  currentUserId?: number
  onAccept: () => Promise<boolean>
  onRecord: () => void
  onReturn: (reason: string) => Promise<boolean>
  onSubmitReview: () => Promise<boolean>
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
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const pageSize = 10

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
    if (!editDescription.trim() || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440 || minutes % 15 !== 0) {
      setError('请填写工作说明，工时须按 0.25 小时递增且不超过 24 小时。')
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
    const saved = await action()
    if (!saved) return false
    setSuccess(message)
    await load()
    return true
  }

  return (
    <section className="todo-work-hours-panel" aria-label="待办工时明细">
      <div className="todo-work-hours-heading">
        <div>
          <span>工时明细</span>
          <strong>{todoStatus(todo)}</strong>
        </div>
        <div className="todo-work-hours-actions">
          {canRecord ? <Button type="button" variant="outline" onClick={onRecord}><Plus size={15} />记录工时</Button> : null}
          {canRecord && !todo.done && todo.confirmationStatus !== 'pending_review' ? (
            <ConfirmActionDialog
              actionKey={`todo-submit-review:${todo.id}`}
              title="确认提交验收？"
              description="提交后工时将等待创建人确认，任务状态变为待验收。"
              confirmLabel="提交验收"
              variant="default"
              onConfirm={() => runWorkflow(onSubmitReview, '待办已提交验收。')}
              trigger={<Button type="button">提交验收</Button>}
            />
          ) : null}
          {canReview && todo.confirmationStatus === 'pending_review' ? (
            <>
              <Button type="button" variant="outline" onClick={() => setReturnOpen(true)}>退回修改</Button>
              <ConfirmActionDialog
                actionKey={`todo-accept:${todo.id}`}
                title="确认验收通过？"
                description="任务将标记为已完成，所有未确认工时将一并确认。"
                confirmLabel="验收通过"
                variant="default"
                onConfirm={() => runWorkflow(onAccept, '验收已通过，工时已确认。')}
                trigger={<Button type="button"><CheckCircle size={15} />验收通过</Button>}
              />
            </>
          ) : null}
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
              <div><strong>{entry.userName ?? '项目成员'}</strong><p>{entry.description}</p><small>{entry.status === 'confirmed' ? '已确认' : '未确认'}</small></div>
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
            <Label>时长（小时）<Input min="0.25" max="24" step="0.25" type="number" value={editHours} onChange={(event) => setEditHours(event.target.value)} /></Label>
            <Label>工作说明<textarea rows={4} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></Label>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>取消</Button><Button type="button" disabled={saving || !editDescription.trim()} onClick={() => void saveEdit()}>{saving ? '保存中...' : '保存修改'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>退回待办</DialogTitle><DialogDescription>说明未通过原因，负责人修改后需要重新提交验收。</DialogDescription></DialogHeader>
          <Label>退回原因<textarea rows={4} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} placeholder="请说明需要补充或修改的内容" /></Label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setReturnOpen(false)}>取消</Button><Button type="button" variant="destructive" disabled={!returnReason.trim()} onClick={() => void runWorkflow(() => onReturn(returnReason.trim()), '待办已退回修改。').then((saved) => { if (saved) { setReturnOpen(false); setReturnReason('') } })}>确认退回</Button></DialogFooter>
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
