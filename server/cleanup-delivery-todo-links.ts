import { pool } from './db.ts'

if (process.env.DELIVERY_TODO_LINK_CLEANUP_CONFIRM !== 'YES') {
  throw new Error('Refusing to mutate delivery links. Set DELIVERY_TODO_LINK_CLEANUP_CONFIRM=YES explicitly.')
}

const projectArgument = process.argv.find((argument) => argument.startsWith('--project-id='))
const expectedArgument = process.argv.find((argument) => argument.startsWith('--expected-count='))
const projectId = projectArgument ? Number(projectArgument.slice('--project-id='.length)) : NaN
const expectedCount = expectedArgument ? Number(expectedArgument.slice('--expected-count='.length)) : NaN
if (!Number.isSafeInteger(projectId) || projectId <= 0) {
  throw new Error('Refusing to mutate delivery links. Pass --project-id=<positive id>.')
}
if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
  throw new Error('Refusing to mutate delivery links. Pass --expected-count=<non-negative count>.')
}

const client = await pool.connect()
try {
  await client.query('begin')
  const result = await client.query<{ count: string }>(
    `select count(*)::bigint as count
       from project_package_operation_todos links
       join project_package_operations operations on operations.id = links.project_package_operation_id
       join project_package_events events on events.id = operations.project_package_event_id
      where events.project_id = $1`,
    [projectId],
  )
  const before = Number(result.rows[0]?.count ?? 0)
  if (before !== expectedCount) {
    throw new Error(`Refusing to mutate delivery links. Expected ${expectedCount}, found ${before}.`)
  }
  await client.query(
    `delete from project_package_operation_todos links
       using project_package_operations operations, project_package_events events
      where links.project_package_operation_id = operations.id
        and operations.project_package_event_id = events.id
        and events.project_id = $1`,
    [projectId],
  )
  await client.query('commit')
  console.log(`已解除项目 ${projectId} 的 ${before} 条交付事件与待办历史关联，未删除交付事件或待办。`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
