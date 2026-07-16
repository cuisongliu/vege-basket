import { useCallback, useEffect, useState } from 'react'
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

export function TodoActivityPanel({ projectId }: { projectId: number }) {
  const [events, setEvents] = useState<TodoActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchTodoActivity(projectId)
      setEvents(result.events)
    } catch (loadError) {
      setError(
        loadError instanceof Error && loadError.message
          ? loadError.message
          : '无法加载待办动态，请稍后重试。',
      )
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card className="panel todo-activity-panel">
      <div className="todo-activity-header">
        <div>
          <span className="todo-activity-eyebrow">
            <ClockCounterClockwise size={15} weight="bold" /> 待办事实流
          </span>
          <h3>待办动态</h3>
          <p>按时间记录创建、指派、确认或驳回、完成和重开，日总结与周总结会基于这些事实生成。</p>
        </div>
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
          {events.map((event) => {
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
              rejected: {
                className: 'is-rejected',
                description: '驳回了这项待办',
                icon: <XCircle size={18} weight="fill" />,
                label: '已驳回',
              },
              reopened: {
                className: 'is-reopened',
                description: '将这项待办重新设为进行中',
                icon: <ArrowCounterClockwise size={18} weight="bold" />,
                label: '重新打开',
              },
            }[event.eventType]
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
                  <p>{event.actorName} {eventMeta.description}</p>
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
