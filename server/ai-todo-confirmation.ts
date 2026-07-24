import type { AiTodoPriority } from './ai-todo-proposals.ts'

type ConfirmedTodoInsert = {
  assigneeUserId: number | null
  createdByUserId: number
  detail: string
  dueDate: string
  moduleId: number | null
  priority: AiTodoPriority
  projectId: number
  title: string
}

export function buildConfirmedTodoInsertQuery(todo: ConfirmedTodoInsert) {
  return {
    text: `
      insert into todos (
        project_id,
        title,
        detail,
        due_date,
        priority,
        project_module_id,
        created_by_user_id,
        assignee_user_id,
        assigned_by_user_id,
        assigned_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, case when $8::bigint is null then null else $7::bigint end, case when $8::bigint is null then null else now() end)
      returning id
    `,
    values: [
      todo.projectId,
      todo.title,
      todo.detail,
      todo.dueDate,
      todo.priority,
      todo.moduleId,
      todo.createdByUserId,
      todo.assigneeUserId,
    ],
  }
}
