import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  PaperPlaneTilt,
  PlusCircle,
  SealCheck,
  XCircle,
  WarningCircle,
} from '@phosphor-icons/react'

import { fetchTodoActivity } from '@/api'
import type { TodoActivityEvent } from '@/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { UserName } from '@/components/user-name'

export function TodoActivityPanel({
  departedUserIds = [],
  previewLimit,
  projectId,
  todoId,
}: {
  departedUserIds?: readonly number[]
  previewLimit?: number
  projectId: number
  todoId?: number
}) {
  const [events, setEvents] = useState<TodoActivityEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const requestVersionRef = useRef(0)

  const load = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    setError('')
    setExpanded(false)
    try {
      const result = await fetchTodoActivity(
        projectId,
        todoId,
        previewLimit == null ? undefined : { limit: previewLimit },
      )
      if (requestVersion !== requestVersionRef.current) return
      setEvents(result.events)
      setTotal(result.total ?? result.events.length)
    } catch (loadError) {
      if (requestVersion !== requestVersionRef.current) return
      setError(
        loadError instanceof Error && loadError.message
          ? loadError.message
          : '无法加载待办动态，请稍后重试。',
      )
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [previewLimit, projectId, todoId])

  const expandAll = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    setLoading(true)
    setError('')
    try {
      const firstPage = await fetchTodoActivity(projectId, todoId, { limit: 200 })
      const allEvents = [...firstPage.events]
      let nextCursor = firstPage.nextCursor
      while (allEvents.length < (firstPage.total ?? 0) && nextCursor && firstPage.snapshotMaxId != null) {
        const nextPage = await fetchTodoActivity(projectId, todoId, {
          cursor: nextCursor,
          limit: 200,
          snapshotMaxId: firstPage.snapshotMaxId,
        })
        if (requestVersion !== requestVersionRef.current) return
        if (nextPage.events.length === 0) {
          throw new Error('待办动态分页不完整，请刷新后重试。')
        }
        allEvents.push(...nextPage.events)
        nextCursor = nextPage.nextCursor
      }
      if (allEvents.length < (firstPage.total ?? 0)) {
        throw new Error('待办动态分页不完整，请刷新后重试。')
      }
      if (requestVersion !== requestVersionRef.current) return
      setEvents(allEvents)
      setTotal(allEvents.length)
      setExpanded(true)
    } catch (loadError) {
      if (requestVersion !== requestVersionRef.current) return
      setError(
        loadError instanceof Error && loadError.message
          ? loadError.message
          : '无法加载全部待办动态，请稍后重试。',
      )
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [projectId, todoId])

  useEffect(() => {
    void load()
    return () => {
      requestVersionRef.current += 1
    }
  }, [load])

  const visibleEvents = useMemo(
    () => (previewLimit == null || expanded ? events : events.slice(0, previewLimit)),
    [events, expanded, previewLimit],
  )
  const canExpand = previewLimit != null && total > previewLimit

  return (
    <Card className="panel todo-activity-panel">
      <div className="todo-activity-header">
        <div>
          <span className="todo-activity-eyebrow">
            <ClockCounterClockwise size={15} weight="bold" /> 待办事实流
          </span>
          <h3>{todoId ? '任务动态' : '待办动态'}</h3>
          <p>{previewLimit == null
            ? (todoId ? '按时间记录当前任务的创建、编辑、工时和确认变化。' : '按时间记录创建、指派、确认或驳回、完成和重开，日总结与周总结会基于这些事实生成。')
            : total
              ? (expanded ? `已展开全部 ${total} 条` : `最近 ${Math.min(total, previewLimit)} 条${canExpand ? `，共 ${total} 条` : ''}`)
              : '记录任务的创建、编辑、工时和确认变化。'}</p>
        </div>
        <div className="todo-activity-header-actions">
          {canExpand ? (
            <Button className="todo-activity-toggle" disabled={loading} type="button" variant="ghost" onClick={() => expanded ? setExpanded(false) : void expandAll()}>
              {expanded ? '收起动态' : '展开全部动态'}
            </Button>
          ) : null}
          <Button
            aria-label="刷新待办动态"
            className="ghost-button todo-activity-refresh"
            disabled={loading}
            size="icon"
            title="刷新待办动态"
            type="button"
            variant="outline"
            onClick={() => void load()}
          >
            <ArrowClockwise className={loading ? 'is-spinning' : ''} size={16} />
          </Button>
        </div>
      </div>

      {loading ? (
        <div aria-live="polite" className="todo-activity-state">
          <span className="todo-activity-loading-mark" aria-hidden />
          <strong>正在加载待办动态</strong>
          <p>正在同步这个项目的创建、指派、确认、完成与重开记录。</p>
        </div>
      ) : error ? (
        <div className="todo-activity-state is-error" role="alert">
          <WarningCircle size={22} weight="fill" />
          <strong>待办动态加载失败</strong>
          <p>{error}</p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            <ArrowClockwise size={15} /> 重试
          </Button>
        </div>
      ) : events.length === 0 ? (
        <div className="todo-activity-state">
          <ClockCounterClockwise size={24} />
          <strong>还没有待办动态</strong>
          <p>创建、指派、确认、完成或重新打开待办后，记录会出现在这里。</p>
        </div>
      ) : (
        <ol className="todo-activity-list">
          {visibleEvents.map((event) => {
            const eventMeta = {
              assigned: {
                className: 'is-assigned',
                description: '更新了这项待办的负责人',
                icon: <PaperPlaneTilt size={18} weight="fill" />,
                label: '已指派',
              },
              completed: {
                className: 'is-completed',
                description: '完成了这项待办',
                icon: <CheckCircle size={18} weight="fill" />,
                label: '已完成',
              },
              confirmed: {
                className: 'is-confirmed',
                description: '确认了这项待办',
                icon: <SealCheck size={18} weight="fill" />,
                label: '已确认',
              },
              created: {
                className: 'is-created',
                description: '创建了这项待办',
                icon: <PlusCircle size={18} weight="fill" />,
                label: '已创建',
              },
              updated: {
                className: 'is-assigned',
                description: '编辑了这项待办',
                icon: <ArrowClockwise size={18} weight="bold" />,
                label: '已编辑',
              },
              rejected: {
                className: 'is-rejected',
                description: '驳回了这项待办',
                icon: <XCircle size={18} weight="fill" />,
                label: '已驳回',
              },
              acceptance_failed: {
                className: 'is-acceptance-failed',
                description: '确认未通过这项待办',
                icon: <XCircle size={18} weight="fill" />,
                label: '验收未通过',
              },
              work_hours_added: {
                className: 'is-created',
                description: '新增了工时记录',
                icon: <PlusCircle size={18} weight="fill" />,
                label: '新增工时',
              },
              work_hours_updated: {
                className: 'is-assigned',
                description: '修改了工时记录',
                icon: <ArrowClockwise size={18} weight="bold" />,
                label: '修改工时',
              },
              work_hours_deleted: {
                className: 'is-rejected',
                description: '删除了工时记录',
                icon: <XCircle size={18} weight="fill" />,
                label: '删除工时',
              },
              work_hours_submitted: {
                className: 'is-confirmed',
                description: '提交了工时验收',
                icon: <PaperPlaneTilt size={18} weight="fill" />,
                label: '工时验收',
              },
              reopened: {
                className: 'is-reopened',
                description: '将这项待办重新设为进行中',
                icon: <ArrowCounterClockwise size={18} weight="bold" />,
                label: '重新打开',
              },
              discarded: {
                className: 'is-rejected',
                description: '废弃了这项待办',
                icon: <XCircle size={18} weight="fill" />,
                label: '已废弃',
              },
            }[event.eventType] ?? {
              className: 'is-assigned',
              description: '更新了这项待办',
              icon: <ArrowClockwise size={18} weight="bold" />,
              label: '已更新',
            }
            return (
              <li key={event.id} className={eventMeta.className}>
                <span className="todo-activity-icon" aria-hidden>
                  {eventMeta.icon}
                </span>
                <div className="todo-activity-copy">
                  <div className="todo-activity-title-row">
                    <strong>{event.todoTitle}</strong>
                    <span>{eventMeta.label}</span>
                  </div>
                  <p>
                    <UserName departedUserIds={departedUserIds} name={event.actorName} userId={event.actorUserId} /> {eventMeta.description}
                    {event.eventType === 'discarded' && event.detail ? `：${event.detail}` : null}
                  </p>
                </div>
                <time dateTime={event.occurredAt}>{event.occurredAt}</time>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
