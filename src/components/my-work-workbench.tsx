import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, Bug, CalendarBlank, Check, CheckCircle, Clock, Eye, FolderSimple, FunnelSimple, ListChecks, MagnifyingGlass, Flag, SortAscending, SortDescending } from '@phosphor-icons/react'
import { acceptWorkHours, fetchMyWork, fetchTodoDetail, fetchTodoWorkHours, returnWorkHours, type WorkHourEntry, type WorkHourSummary } from '../api'
import type { Project, Todo } from '../types'
import type { MyWorkData, MyWorkItem, MyWorkKind, MyWorkFilters, MyWorkViewState } from '../my-work-types'
import type { OrganizationContext } from '../../shared/organization-context'
import { startVisibleRefreshSchedule, workspaceRefreshIntervalMs } from '../refresh-schedule'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { ListPagination } from './list-pagination'
import { MarkdownPreview } from './markdown-preview'
import './my-work-workbench.css'

const MAX_SELECTED_WORK_HOURS = 100

const emptyWorkHourSummary: WorkHourSummary = {
  byDate: [], byProject: [], byUser: [], confirmedMinutes: 0, pendingMinutes: 0,
  projectCount: 0, taskCount: 0, totalHours: 0, totalMinutes: 0,
}

function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null) return '-'
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`
}

function workHourStatusLabel(status: WorkHourEntry['status']) {
  if (status === 'confirmed') return '已确认'
  if (status === 'submitted') return '待确认'
  return '已退回'
}

async function fetchWorkHourConfirmationDetails(todoId: number) {
  const [detail, firstPage] = await Promise.all([
    fetchTodoDetail(todoId),
    fetchTodoWorkHours(todoId, { limit: 50 }),
  ])
  const entries = [...firstPage.entries]
  let cursor = firstPage.pagination?.limit ?? entries.length
  while (firstPage.pagination && entries.length < firstPage.pagination.total) {
    const page = await fetchTodoWorkHours(todoId, { cursor, limit: 50 })
    entries.push(...page.entries)
    cursor += page.pagination?.limit ?? page.entries.length
    if (page.entries.length === 0) break
  }
  return {
    entries: [...new Map(entries.map((entry) => [entry.id, entry])).values()],
    summary: firstPage.summary,
    todo: detail.todo,
  }
}

const kindLabels: Record<MyWorkKind, string> = {
  todo: '待办',
  delivery: '交付事件',
  bug: 'Bug',
  milestone: '里程碑',
}

const statusLabels: Record<string, string> = {
  assigned: '待处理',
  achieved: '已达成',
  cancelled: '已取消',
  confirmed: '已确认',
  acceptance_failed: '验收未通过',
  closed: '已关闭',
  completed: '已完成',
  delivering: '交付中',
  delivered: '已交付',
  draft: '草稿',
  in_progress: '进行中',
  pending_confirmation: '待确认',
  pending_verification: '待验证',
  new: '新建',
  pending: '待达成',
  in_review: '验收中',
  pending_review: '待审核',
  reopened: '重新打开',
  rejected: '已拒绝',
  duplicate: '重复',
}

function formatDueDate(value?: string) {
  if (!value) return '未排期'
  return value.replaceAll('-', '/')
}

function TableFilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="my-work-table-heading-filter">
      <span>{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={`my-work-filter-icon${value !== 'all' ? ' is-active' : ''}`} type="button" aria-label={`筛选${label}`}>
            <FunnelSimple size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="my-work-filter-menu">
          {options.map((option) => (
            <DropdownMenuItem className="my-work-filter-menu-item" key={option.value} onSelect={() => onChange(option.value)}>
              {value === option.value ? <Check size={15} /> : <span className="my-work-filter-check-placeholder" />}
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function MyWorkWorkbench({
  mode = 'work',
  scope,
  savedView,
  onViewChange,
  organizationId,
  projects,
  onTodoClick,
  onDeliveryClick,
  onBugClick,
  onMilestoneClick,
  onWorkHoursChanged,
}: {
  mode?: 'work' | 'review'
  scope: string
  savedView?: MyWorkViewState
  onViewChange: (view: MyWorkViewState) => void
  organizationId: OrganizationContext
  projects: Project[]
  onTodoClick: (projectId: number, todoId: number) => void
  onDeliveryClick: (projectId: number, eventId: number) => void
  onBugClick: (bugId: number) => void
  onMilestoneClick: (projectId: number) => void
  onWorkHoursChanged?: () => void
}) {
  const isReview = mode === 'review'
  const [view, setView] = useState<MyWorkViewState>(() => savedView?.scope === scope ? savedView : {
    scope, filters: isReview ? { review: true, kind: 'todo', status: 'all', sort: 'due_desc' } : { status: 'open', sort: 'due_desc' }, page: 0, pageSize: 20, scrollTop: 0,
  })
  const [result, setResult] = useState<{ data: MyWorkData; view: MyWorkViewState }>()
  const [loading, setLoading] = useState(true)
  const [backgroundRefreshVersion, setBackgroundRefreshVersion] = useState(0)
  const [error, setError] = useState('')
  const [reviewItem, setReviewItem] = useState<MyWorkItem | null>(null)
  const [reviewTodo, setReviewTodo] = useState<Todo | null>(null)
  const [reviewEntries, setReviewEntries] = useState<WorkHourEntry[]>([])
  const [reviewSummary, setReviewSummary] = useState<WorkHourSummary>(emptyWorkHourSummary)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewSaving, setReviewSaving] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewSuccess, setReviewSuccess] = useState('')
  const [selectedEntryIds, setSelectedEntryIds] = useState<number[]>([])
  const tableRef = useRef<HTMLDivElement>(null)
  const onViewChangeRef = useRef(onViewChange)
  useEffect(() => { onViewChangeRef.current = onViewChange }, [onViewChange])
  const data = result?.data
  const { kind = 'all', projectId: selectedProjectId, creator = 'all', q: query = '', status = isReview ? 'all' : 'open', sort = 'due_desc', due: dueFilter = 'all' } = view.filters
  const projectId = selectedProjectId == null ? 'all' : String(selectedProjectId)
  function changeFilters(patch: Partial<MyWorkFilters>) {
    setView((current) => ({ ...current, filters: { ...current.filters, ...patch }, page: 0, scrollTop: 0 }))
  }

  useEffect(() => startVisibleRefreshSchedule({
    clearInterval: (handle) => window.clearInterval(handle),
    intervalMs: workspaceRefreshIntervalMs,
    isVisible: () => document.visibilityState === 'visible',
    onFocus: (listener) => {
      window.addEventListener('focus', listener)
      return () => window.removeEventListener('focus', listener)
    },
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
    refresh: () => setBackgroundRefreshVersion((current) => current + 1),
    minRefreshGapMs: 1_000,
    setInterval: (listener, delay) => window.setInterval(listener, delay),
  }), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void fetchMyWork(organizationId, {
      ...view.filters,
      q: view.filters.q?.trim() || undefined,
      cursor: String(view.page * view.pageSize),
      limit: view.pageSize,
    }).then((next) => {
      if (!active) return
      const canonicalView = { ...view, page: Math.floor(next.offset / view.pageSize) }
      setResult({ data: next, view: canonicalView })
      if (canonicalView.page !== view.page) setView(canonicalView)
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : '我的待办加载失败。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [backgroundRefreshVersion, organizationId, view])

  useEffect(() => {
    if (!reviewItem) return
    let active = true
    setReviewLoading(true)
    setReviewError('')
    setReviewSuccess('')
    setReviewTodo(null)
    setReviewEntries([])
    setReviewSummary(emptyWorkHourSummary)
    setSelectedEntryIds([])
    void fetchWorkHourConfirmationDetails(reviewItem.sourceId).then((details) => {
      if (!active) return
      setReviewTodo(details.todo)
      setReviewEntries(details.entries)
      setReviewSummary(details.summary)
    }).catch((cause) => {
      if (active) setReviewError(cause instanceof Error ? cause.message : '工时详情加载失败。')
    }).finally(() => {
      if (active) setReviewLoading(false)
    })
    return () => { active = false }
  }, [reviewItem])

  // Revalidation preserves the viewport. Explicit navigation and remounts restore
  // their own position only after the corresponding records are committed.
  const committedViewRef = useRef<MyWorkViewState | null>(null)
  useLayoutEffect(() => {
    if (!result) return
    const previous = committedViewRef.current
    const next = result.view
    if (tableRef.current && (!previous || previous.page !== next.page || previous.pageSize !== next.pageSize || previous.filters !== next.filters)) {
      tableRef.current.scrollTop = next.scrollTop
    }
    committedViewRef.current = next
    onViewChangeRef.current({ ...next, scrollTop: tableRef.current?.scrollTop ?? 0 })
  }, [result])

  const visibleItems = data?.items ?? []
  const submittedEntries = reviewEntries.filter((entry) => entry.status === 'submitted')
  const selectableBatch = submittedEntries.slice(0, MAX_SELECTED_WORK_HOURS)
  const selectedEntries = submittedEntries.filter((entry) => selectedEntryIds.includes(entry.id))
  const selectedMinutes = selectedEntries.reduce((sum, entry) => sum + entry.minutes, 0)
  const submittedMinutes = submittedEntries.reduce((sum, entry) => sum + entry.minutes, 0)
  const statusOptions = useMemo(() => {
    const concreteStatuses = (data?.filterOptions.statuses ?? []).map((value) => {
      const [kind, status] = value.split(':')
      return { value, label: `${kindLabels[kind as MyWorkKind]}-${statusLabels[status] ?? status}` }
    }).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
    return [
      { label: '未完成', value: 'open' },
      { label: '全部状态', value: 'all' },
      ...concreteStatuses.filter((option) => option.value !== 'open' && option.value !== 'all'),
    ]
  }, [data?.filterOptions.statuses])

  const creatorOptions = useMemo(() => {
    const creators = [...(data?.filterOptions.creators ?? [])]
      .sort((left, right) => (left === '__unrecorded__' ? '未记录' : left).localeCompare(right === '__unrecorded__' ? '未记录' : right, 'zh-CN'))
    return [
      { label: '全部创建人', value: 'all' },
      ...creators.map((value) => ({ label: value === '__unrecorded__' ? '未记录' : value, value })),
    ]
  }, [data?.filterOptions.creators])

  function openItem(item: MyWorkItem) {
    if (result) onViewChange({ ...result.view, scrollTop: tableRef.current?.scrollTop ?? 0 })
    if (item.kind === 'todo' && item.projectId) onTodoClick(item.projectId, item.sourceId)
    if (item.kind === 'delivery' && item.projectId) onDeliveryClick(item.projectId, item.sourceId)
    if (item.kind === 'bug') onBugClick(item.sourceId)
    if (item.kind === 'milestone' && item.projectId) onMilestoneClick(item.projectId)
  }

  async function runWorkHourReview(action: 'return' | 'accept') {
    if (!reviewItem || selectedEntryIds.length === 0) return
    const todoId = reviewItem.sourceId
    const entryIds = [...selectedEntryIds]
    const expectedStatus: WorkHourEntry['status'] = action === 'accept' ? 'confirmed' : 'pending'
    setReviewSaving(true)
    setReviewError('')
    setReviewSuccess('')
    try {
      let mutationError: unknown
      try {
        if (action === 'accept') await acceptWorkHours(todoId, entryIds)
        else await returnWorkHours(todoId, entryIds)
      } catch (cause) {
        mutationError = cause
      }
      const details = await fetchWorkHourConfirmationDetails(todoId)
      const reconciled = entryIds.every((entryId) => details.entries.some((entry) => entry.id === entryId && entry.status === expectedStatus))
      if (mutationError && !reconciled) throw mutationError
      setReviewTodo(details.todo)
      setReviewEntries(details.entries)
      setReviewSummary(details.summary)
      setSelectedEntryIds([])
      setReviewSuccess(action === 'accept' ? '所选工时已确认。' : '所选工时已退回修改。')
      setBackgroundRefreshVersion((version) => version + 1)
      onWorkHoursChanged?.()
      if (!details.entries.some((entry) => entry.status === 'submitted')) setReviewItem(null)
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : '工时确认操作失败。')
    } finally {
      setReviewSaving(false)
    }
  }

  return (
    <section className={`panel my-work-panel${isReview ? ' my-work-review-panel' : ''}`}>
      <div className="my-work-heading">
        <div>
          <p className="my-work-eyebrow">{isReview ? '待确认工时' : '日常工作'}</p>
        </div>
        {isReview && result ? <span className="my-work-review-hint">共 {result.data.total} 项</span> : null}
      </div>
      <div className="my-work-toolbar">
        <label className="my-work-search">
          <MagnifyingGlass size={17} />
          <Input value={query} onChange={(event) => changeFilters({ q: event.target.value })} placeholder={isReview ? '搜索任务或项目' : '搜索事项、项目或状态'} />
        </label>
      </div>

      {loading && !result ? <div className="my-work-empty"><Clock className="spin" size={24} />正在加载{isReview ? '工时确认' : '我的待办'}...</div> : null}
      {error ? <div className="my-work-load-error" role="alert">{error}{result ? ' 列表仍显示上次加载的结果。' : ''}<Button type="button" variant="ghost" disabled={loading} onClick={() => setBackgroundRefreshVersion((version) => version + 1)}>重试</Button></div> : null}
      {result && isReview ? (
        <div className="my-work-table my-work-confirmation-table" role="table" aria-label="工时确认列表" aria-busy={loading} ref={tableRef} onScroll={(event) => {
          onViewChange({ ...result.view, scrollTop: event.currentTarget.scrollTop })
        }}>
          <div className="my-work-table-header-group" role="rowgroup">
            <div className="my-work-table-header my-work-confirmation-row" role="row">
              <span role="columnheader">任务</span>
              <div role="columnheader"><TableFilterMenu label="项目" value={projectId} onChange={(value) => changeFilters({ projectId: value === 'all' ? undefined : Number(value) })} options={[{ label: '全部项目', value: 'all' }, ...projects.map((project) => ({ label: project.name, value: String(project.id) }))]} /></div>
              <span className="my-work-number-heading" role="columnheader">预估</span>
              <span className="my-work-number-heading" role="columnheader">累计</span>
              <span className="my-work-number-heading" role="columnheader">待确认</span>
              <span className="my-work-action-heading" role="columnheader">操作</span>
            </div>
          </div>
          <div className="my-work-table-body" role="rowgroup">
            {visibleItems.length === 0 ? <div className="my-work-table-row my-work-confirmation-row" role="row"><div className="my-work-empty" role="cell" aria-colspan={6}><CheckCircle size={28} />当前没有待确认的工时</div></div> : null}
            {visibleItems.map((item) => (
              <div className="my-work-table-row my-work-confirmation-row" key={item.id} role="row">
                <div className="my-work-table-cell my-work-main-cell" role="cell"><span className="my-work-kind-icon is-todo"><ListChecks size={17} /></span><strong className="my-work-confirmation-title">{item.title}</strong></div>
                <span className="my-work-table-cell" role="cell">{item.projectName ?? '未关联项目'}</span>
                <span className="my-work-table-cell my-work-number-cell" role="cell">{formatMinutes(item.estimatedWorkMinutes)}</span>
                <span className="my-work-table-cell my-work-number-cell" role="cell">{formatMinutes(item.cumulativeWorkMinutes ?? 0)}</span>
                <strong className="my-work-table-cell my-work-number-cell is-pending" role="cell">{formatMinutes(item.submittedWorkMinutes ?? 0)}</strong>
                <span className="my-work-table-cell my-work-confirmation-action" role="cell"><Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => setReviewItem(item)}><Eye size={15} />查看工时</Button></span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {result && !isReview ? (
        <div className="my-work-table" role="table" aria-label="我的待办列表" aria-busy={loading} ref={tableRef} onScroll={(event) => {
          onViewChange({ ...result.view, scrollTop: event.currentTarget.scrollTop })
        }}>
          <div className="my-work-table-header-group" role="rowgroup">
            <div className="my-work-table-header" role="row">
              <span role="columnheader">事项</span>
              <div role="columnheader"><TableFilterMenu label="项目" value={projectId} onChange={(value) => changeFilters({ projectId: value === 'all' ? undefined : Number(value) })} options={[{ label: '全部项目', value: 'all' }, ...projects.map((project) => ({ label: project.name, value: String(project.id) }))]} /></div>
              <div role="columnheader"><TableFilterMenu label="类型" value={kind} onChange={(value) => changeFilters({ kind: value === 'all' ? undefined : value as MyWorkKind })} options={[{ label: '全部类型', value: 'all' }, ...Object.entries(kindLabels).map(([value, label]) => ({ label, value }))]} /></div>
              <div role="columnheader"><TableFilterMenu label="状态" value={status} onChange={(value) => changeFilters({ status: value })} options={statusOptions} /></div>
              <div className="my-work-date-heading" role="columnheader">
                <TableFilterMenu label="截止日期" value={dueFilter} onChange={(value) => changeFilters({ due: value === 'all' ? undefined : value as MyWorkFilters['due'] })} options={[{ label: '全部日期', value: 'all' }, { label: '已逾期', value: 'overdue' }, { label: '今天', value: 'today' }, { label: '本周', value: 'this_week' }, { label: '更晚', value: 'later' }, { label: '未排期', value: 'unscheduled' }]} />
                <button
                  aria-label={sort === 'due_desc' ? '当前按截止日期倒序排列，点击切换为正序' : '当前按截止日期正序排列，点击切换为倒序'}
                  className={`my-work-sort-icon${sort === 'due_desc' ? ' is-active' : ''}`}
                  title={sort === 'due_desc' ? '切换为截止日期正序' : '切换为截止日期倒序'}
                  type="button"
                  onClick={() => changeFilters({ sort: sort === 'due_desc' ? 'due_asc' : 'due_desc' })}
                >
                  {sort === 'due_desc' ? <SortDescending size={15} /> : <SortAscending size={15} />}
                </button>
              </div>
              <div role="columnheader"><TableFilterMenu label="创建人" value={creator} onChange={(value) => changeFilters({ creator: value === 'all' ? undefined : value })} options={creatorOptions} /></div>
            </div>
          </div>
          <div className="my-work-table-body" role="rowgroup">
            {visibleItems.length === 0 ? <div className="my-work-table-row" role="row"><div className="my-work-empty" role="cell" aria-colspan={6}><CheckCircle size={28} />当前没有需要你推进的事项</div></div> : null}
            {visibleItems.map((item) => (
              <div className="my-work-table-row" key={item.id} role="row">
                <div className="my-work-table-cell my-work-main-cell" role="cell">
                  <button className="my-work-row-main" type="button" disabled={loading} onClick={() => openItem(item)}>
                    <span className={`my-work-kind-icon is-${item.kind}`}>
                      {item.kind === 'bug' ? <Bug size={17} /> : item.kind === 'milestone' ? <Flag size={17} /> : item.kind === 'delivery' ? <FolderSimple size={17} /> : <ListChecks size={17} />}
                    </span>
                    <span className="my-work-row-copy">
                      <span className="my-work-item-title">
                        <strong>{item.title}</strong>
                        {item.offboardingTransferredFromName ? <Badge className="my-work-offboarding-badge" variant="outline">{item.offboardingTransferredFromName}-离职转移</Badge> : null}
                      </span>
                    </span>
                  </button>
                </div>
                <span className="my-work-table-cell" role="cell">{item.projectName ?? item.contextName ?? '未关联项目'}</span>
                <span className="my-work-table-cell" role="cell"><Badge variant="outline">{kindLabels[item.kind]}</Badge></span>
                <span className="my-work-table-cell" role="cell"><span className={`my-work-status is-${item.status}`}>{statusLabels[item.status] ?? item.status}</span></span>
                <span className="my-work-table-cell my-work-due" role="cell"><CalendarBlank size={16} />{formatDueDate(item.dueAt)}</span>
                <span className="my-work-table-cell" role="cell">{item.creatorName ?? '未记录'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {result ? (
        <ListPagination label={isReview ? '工时确认分页' : '我的待办分页'} page={result.view.page} pageSize={result.view.pageSize} total={result.data.total} disabled={loading || Boolean(error)}
          onPageChange={(page) => setView({ ...result.view, page, scrollTop: 0 })}
          onPageSizeChange={(pageSize) => setView({ ...result.view, pageSize, page: 0, scrollTop: 0 })} />
      ) : null}
      <Dialog open={Boolean(reviewItem)} onOpenChange={(open) => { if (!open && !reviewSaving) setReviewItem(null) }}>
        <DialogContent className="my-work-confirmation-dialog fixed inset-y-0 right-0 left-auto z-50 h-full w-[min(820px,calc(100vw-64px))] translate-x-0 translate-y-0 gap-0 rounded-none border-l p-0 shadow-xl">
          <DialogHeader><DialogTitle>查看工时</DialogTitle><DialogDescription>{reviewItem?.title ?? '任务工时详情'}</DialogDescription></DialogHeader>
          {reviewLoading ? <div className="my-work-confirmation-loading"><Clock className="spin" size={22} />正在加载任务与工时...</div> : null}
          {!reviewLoading && reviewTodo ? (
            <div className="my-work-confirmation-content">
              <section className="my-work-confirmation-task" aria-label="任务详情">
                <div className="my-work-confirmation-task-heading"><div><span>任务详情</span><strong>{reviewTodo.title}</strong></div><Badge variant="outline">{reviewTodo.done ? '已完成' : reviewTodo.confirmationStatus === 'pending_review' ? '待验收' : '进行中'}</Badge></div>
                <dl className="my-work-confirmation-properties"><div><dt>项目</dt><dd>{reviewItem?.projectName ?? '未关联项目'}</dd></div><div><dt>负责人</dt><dd>{reviewTodo.assigneeName ?? '未分配'}</dd></div><div><dt>创建人</dt><dd>{reviewTodo.creatorName ?? '未记录'}</dd></div><div><dt>截止日期</dt><dd>{formatDueDate(reviewTodo.dueDate)}</dd></div></dl>
                <div className="my-work-confirmation-detail">{reviewTodo.detail.trim() ? <MarkdownPreview content={reviewTodo.detail} compact /> : <span>暂无任务详情</span>}</div>
              </section>
              <section className="my-work-confirmation-hours" aria-label="工时情况">
                <div className="my-work-confirmation-metrics"><div><span>预估</span><strong>{formatMinutes(reviewTodo.estimatedWorkMinutes)}</strong></div><div><span>累计</span><strong>{formatMinutes(reviewSummary.totalMinutes)}</strong></div><div><span>已确认</span><strong>{formatMinutes(reviewSummary.confirmedMinutes)}</strong></div><div><span>待确认</span><strong>{formatMinutes(submittedMinutes)}</strong></div></div>
                <div className="my-work-confirmation-selection-heading"><div><strong>工时记录</strong><span>已选 {selectedEntryIds.length} 条 · {formatMinutes(selectedMinutes)}</span></div>{submittedEntries.length ? <label><input type="checkbox" checked={selectableBatch.length > 0 && selectedEntryIds.length === selectableBatch.length && selectableBatch.every((entry) => selectedEntryIds.includes(entry.id))} onChange={(event) => setSelectedEntryIds(event.target.checked ? selectableBatch.map((entry) => entry.id) : [])} />{submittedEntries.length > MAX_SELECTED_WORK_HOURS ? `选择前 ${MAX_SELECTED_WORK_HOURS} 条` : '全选待确认'}</label> : null}</div>
                <div className="my-work-confirmation-entry-list">{reviewEntries.length ? reviewEntries.map((entry) => {
                  const selectable = entry.status === 'submitted'
                  return <label className={`my-work-confirmation-entry is-${entry.status}`} key={entry.id}><input type="checkbox" checked={selectedEntryIds.includes(entry.id)} disabled={!selectable || (!selectedEntryIds.includes(entry.id) && selectedEntryIds.length >= MAX_SELECTED_WORK_HOURS)} onChange={(event) => setSelectedEntryIds((current) => event.target.checked ? current.length < MAX_SELECTED_WORK_HOURS ? [...current, entry.id] : current : current.filter((id) => id !== entry.id))} /><time>{entry.workDate}</time><div><strong>{entry.userName ?? '项目成员'}</strong><p>{entry.description}</p></div><span>{workHourStatusLabel(entry.status)}</span><b>{formatMinutes(entry.minutes)}</b></label>
                }) : <p className="my-work-confirmation-empty">暂无工时记录</p>}</div>
              </section>
            </div>
          ) : null}
          {reviewError ? <p className="my-work-confirmation-message is-error" role="alert">{reviewError}</p> : null}
          {reviewSuccess ? <p className="my-work-confirmation-message is-success" role="status">{reviewSuccess}</p> : null}
          <DialogFooter className="my-work-confirmation-footer"><Button type="button" variant="outline" disabled={reviewSaving || selectedEntryIds.length === 0} onClick={() => void runWorkHourReview('return')}><ArrowCounterClockwise size={16} />{reviewSaving ? '处理中...' : '退回修改'}</Button><Button type="button" disabled={reviewSaving || selectedEntryIds.length === 0} onClick={() => void runWorkHourReview('accept')}><CheckCircle size={16} />{reviewSaving ? '处理中...' : '确认工时'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
