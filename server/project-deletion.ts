import type { PoolClient } from 'pg'

export async function deleteOwnedProjectWithAiCleanup(
  client: Pick<PoolClient, 'query'>,
  projectId: number,
  userId: number,
) {
  await client.query('begin')
  try {
    await client.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-project:${projectId}`],
    )
    const project = await client.query<{ id: string }>(
      `select id from projects where id = $1 and user_id = $2`,
      [projectId, userId],
    )
    if (!project.rows[0]) {
      await client.query('commit')
      return false
    }
    await client.query(
      `select id from ai_conversations where project_id = $1 for update`,
      [projectId],
    )
    await client.query(
      `
      delete from ai_todo_proposal_batches b
      using ai_turns t, ai_conversations c, projects p
      where b.source_turn_id = t.id
        and t.conversation_id = c.id
        and c.project_id = p.id
        and p.id = $1
        and b.status = 'pending'
      `,
      [projectId],
    )
    const lockedProject = await client.query<{ id: string }>(
      `select id from projects where id = $1 and user_id = $2 for update`,
      [projectId, userId],
    )
    if (!lockedProject.rows[0]) {
      await client.query('commit')
      return false
    }
    const deleted = await client.query<{ id: string }>(
      `delete from projects where id = $1 and user_id = $2 returning id`,
      [projectId, userId],
    )
    await client.query('commit')
    return Boolean(deleted.rows[0])
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}
