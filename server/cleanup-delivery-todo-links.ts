import { pool } from './db.ts'

if (process.env.DELIVERY_TODO_LINK_CLEANUP_CONFIRM !== 'YES') {
  throw new Error('Refusing to mutate delivery links. Set DELIVERY_TODO_LINK_CLEANUP_CONFIRM=YES explicitly.')
}

const client = await pool.connect()
try {
  await client.query('begin')
  const result = await client.query<{ count: string }>(
    'select count(*)::bigint as count from project_package_operation_todos',
  )
  const before = Number(result.rows[0]?.count ?? 0)
  await client.query('delete from project_package_operation_todos')
  await client.query('commit')
  console.log(`已解除 ${before} 条交付事件与待办的历史关联，未删除交付事件或待办。`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
