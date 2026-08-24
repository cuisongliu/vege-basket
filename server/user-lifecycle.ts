import { query } from './db.ts'

export async function getDepartedUserIds() {
  const result = await query<{ id: string }>(
    `select id from users where account_status = 'departed' order by id`,
  )
  return result.rows.map((row) => Number(row.id))
}
