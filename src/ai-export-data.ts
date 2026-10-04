import {
  fetchTodoDetail,
  fetchTodoWorkHours,
  type WorkHourEntry,
  type WorkHourSummary,
} from './api'
import type { Todo } from './types'

export type CompleteTodoExport = {
  todo: Todo
  records: WorkHourEntry[]
}

export async function mapWithConcurrency<Input, Output>(
  items: Input[],
  limit: number,
  mapper: (item: Input, index: number) => Promise<Output>,
) {
  const results = new Array<Output>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker))
  return results
}

export async function fetchAllTodoWorkHours(todoId: number) {
  const records: WorkHourEntry[] = []
  let cursor = 0
  while (true) {
    const page = await fetchTodoWorkHours(todoId, { cursor, limit: 50 })
    records.push(...page.entries)
    const next = page.pagination ? page.pagination.offset + page.entries.length : records.length
    if (!page.pagination || next >= page.pagination.total || page.entries.length === 0) return records
    cursor = next
  }
}

export async function fetchCompleteTodoExport(todo: Todo, includeWorkHours = true) {
  const [{ todo: completeTodo }, records] = await Promise.all([
    fetchTodoDetail(todo.id),
    includeWorkHours ? fetchAllTodoWorkHours(todo.id) : Promise.resolve([]),
  ])
  return { todo: completeTodo, records }
}

export function workHourStatusLabel(status: WorkHourEntry['status']) {
  return status === 'confirmed' ? '已确认' : status === 'submitted' ? '待确认' : '未提交'
}

export function summarizeWorkHourEntries(entries: WorkHourEntry[], base: WorkHourSummary): WorkHourSummary {
  const byDate = new Map<string, { minutes: number; pendingMinutes: number; confirmedMinutes: number }>()
  const byProject = new Map<number, { projectId: number; projectName: string; minutes: number; pendingMinutes: number; confirmedMinutes: number; estimatedMinutes: number }>()
  const byUser = new Map<number, { userId: number; userName: string; minutes: number; pendingMinutes: number; confirmedMinutes: number; projectIds: Set<number>; todoIds: Set<number> }>()
  const todoEstimates = new Map<number, number>()
  const todoProjects = new Map<number, number>()
  const taskTotals = new Map<number, { totalMinutes: number; pendingMinutes: number; confirmedMinutes: number }>()
  let confirmedMinutes = 0
  let pendingMinutes = 0
  for (const entry of entries) {
    const isConfirmed = entry.status === 'confirmed'
    if (isConfirmed) confirmedMinutes += entry.minutes
    else pendingMinutes += entry.minutes
    const date = byDate.get(entry.workDate) ?? { minutes: 0, pendingMinutes: 0, confirmedMinutes: 0 }
    date.minutes += entry.minutes
    if (isConfirmed) date.confirmedMinutes += entry.minutes
    else date.pendingMinutes += entry.minutes
    byDate.set(entry.workDate, date)
    const project = byProject.get(entry.projectId) ?? { projectId: entry.projectId, projectName: entry.projectName ?? '未命名项目', minutes: 0, pendingMinutes: 0, confirmedMinutes: 0, estimatedMinutes: 0 }
    project.minutes += entry.minutes
    if (isConfirmed) project.confirmedMinutes += entry.minutes
    else project.pendingMinutes += entry.minutes
    if (entry.estimatedWorkMinutes != null) todoEstimates.set(entry.todoId, entry.estimatedWorkMinutes)
    todoProjects.set(entry.todoId, entry.projectId)
    const task = taskTotals.get(entry.todoId) ?? { totalMinutes: 0, pendingMinutes: 0, confirmedMinutes: 0 }
    task.totalMinutes += entry.minutes
    if (isConfirmed) task.confirmedMinutes += entry.minutes
    else task.pendingMinutes += entry.minutes
    taskTotals.set(entry.todoId, task)
    byProject.set(entry.projectId, project)
    const user = byUser.get(entry.userId) ?? { userId: entry.userId, userName: entry.userName ?? '未知', minutes: 0, pendingMinutes: 0, confirmedMinutes: 0, projectIds: new Set(), todoIds: new Set() }
    user.minutes += entry.minutes
    if (isConfirmed) user.confirmedMinutes += entry.minutes
    else user.pendingMinutes += entry.minutes
    user.projectIds.add(entry.projectId)
    user.todoIds.add(entry.todoId)
    byUser.set(entry.userId, user)
  }
  for (const [todoId, estimated] of todoEstimates) {
    const project = byProject.get(todoProjects.get(todoId) ?? 0)
    if (project) project.estimatedMinutes += estimated
  }
  const estimatedMinutes = entries.length ? [...todoEstimates.values()].reduce((sum, value) => sum + value, 0) : base.estimatedMinutes ?? 0
  const includedTodoIds = new Set(entries.map((entry) => entry.todoId))
  return {
    ...base,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    totalHours: entries.reduce((sum, entry) => sum + entry.minutes, 0) / 60,
    confirmedMinutes,
    pendingMinutes,
    projectCount: byProject.size,
    taskCount: new Set(entries.map((entry) => entry.todoId)).size,
    estimatedMinutes,
    estimatedHours: estimatedMinutes / 60,
    tasks: base.tasks?.filter((task) => includedTodoIds.has(task.taskId)).map((task) => ({
      ...task,
      ...(taskTotals.get(task.taskId) ?? { totalMinutes: 0, pendingMinutes: 0, confirmedMinutes: 0 }),
    })),
    byDate: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, hours: value.minutes / 60, ...value })),
    byProject: [...byProject.values()].map((value) => ({ ...value, varianceMinutes: value.minutes - value.estimatedMinutes })),
    byUser: [...byUser.values()].map((value) => ({ userId: value.userId, userName: value.userName, minutes: value.minutes, pendingMinutes: value.pendingMinutes, confirmedMinutes: value.confirmedMinutes, projectCount: value.projectIds.size, taskCount: value.todoIds.size })),
  }
}

export function summarizeWorkHourStatuses(entries: WorkHourEntry[]) {
  const summary: Record<WorkHourEntry['status'], { count: number; minutes: number }> = {
    pending: { count: 0, minutes: 0 },
    submitted: { count: 0, minutes: 0 },
    confirmed: { count: 0, minutes: 0 },
  }
  for (const entry of entries) {
    summary[entry.status].count += 1
    summary[entry.status].minutes += entry.minutes
  }
  return summary
}

export function filterWorkHourEntries(
  entries: WorkHourEntry[],
  query: string,
  taskStatus: 'all' | 'open' | 'done',
  tasks: NonNullable<WorkHourSummary['tasks']> = [],
) {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const allowedTodoIds = taskStatus === 'all'
    ? null
    : new Set(tasks.filter((task) => taskStatus === 'done' ? task.done : !task.done).map((task) => task.taskId))
  return entries.filter((entry) => (
    (!allowedTodoIds || allowedTodoIds.has(entry.todoId)) &&
    (!normalizedQuery || [entry.projectName, entry.todoTitle, entry.description, entry.userName, entry.workDate, workHourStatusLabel(entry.status)]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(normalizedQuery))
  ))
}

export function formatWorkHourExport(entries: WorkHourEntry[]) {
  if (!entries.length) return '无数据'
  const groups = new Map<number, WorkHourEntry[]>()
  for (const entry of entries) groups.set(entry.todoId, [...(groups.get(entry.todoId) ?? []), entry])
  return [...groups.values()].map((records) => {
    const first = records[0]
    return [
      `### 任务：${first.todoTitle ?? `任务 #${first.todoId}`}`,
      `- 任务 ID：${first.todoId}`,
      `- 项目：${first.projectName ?? '未命名项目'}`,
      `- 预估工时：${first.estimatedWorkMinutes ?? 0} 分钟`,
      `- 实际投入：${records.reduce((sum, entry) => sum + entry.minutes, 0)} 分钟`,
      '- 工时记录：',
      ...records.map((entry) => `  - ${entry.workDate} · ${entry.userName ?? '未知'} · ${entry.minutes} 分钟 · ${workHourStatusLabel(entry.status)}（${entry.status}） · ${entry.description || '无说明'}`),
    ].join('\n')
  }).join('\n\n')
}

export function formatTodoExport(todo: Todo, records: WorkHourEntry[]) {
  const priority = { high: '高', medium: '中', low: '低' }[todo.priority]
  const confirmation = {
    acceptance_failed: '验收未通过',
    confirmed: '已确认',
    pending_review: '待确认',
    rejected: '已退回',
  }[todo.confirmationStatus]
  return [
    `### ${todo.title}`,
    `- 待办 ID：${todo.id}`,
    `- 详情：${todo.detail || '无'}`,
    `- 备注：${todo.notes.map((note) => `${note.authorName ?? '未知'}：${note.content}`).join('；') || '无'}`,
    `- 创建日期：${todo.createdAt || '无'}`,
    `- 截止日期：${todo.dueDate || '无'}`,
    `- 优先级：${priority}（${todo.priority}）`,
    `- 完成状态：${todo.done ? '已完成' : '未完成'}`,
    `- 确认状态：${confirmation}（${todo.confirmationStatus}）`,
    `- 负责人：${todo.assigneeName ?? '未分配'}；创建人：${todo.creatorName ?? '未知'}`,
    `- 模块：${todo.moduleName ?? '无'}；子项目：${todo.subprojectName ?? '无'}`,
    `- 工时摘要：预估 ${todo.estimatedWorkMinutes ?? 0} 分钟；已记录 ${todo.recordedWorkMinutes ?? 0} 分钟；已确认 ${todo.confirmedWorkMinutes ?? 0} 分钟；待确认 ${todo.pendingWorkMinutes ?? 0} 分钟`,
    records.length ? `- 工时记录：\n${records.map((entry) => `  - ${entry.workDate} · ${entry.userName ?? '未知'} · ${entry.minutes} 分钟 · ${workHourStatusLabel(entry.status)} · ${entry.description || '无说明'}`).join('\n')}` : '- 工时记录：无',
  ].join('\n')
}
