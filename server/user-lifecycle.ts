import { query } from './db.ts'

export async function getDepartedUserIds() {
  const result = await query<{ id: string }>(
    `select id from users where account_status = 'departed' order by id`,
  )
  return result.rows.map((row) => Number(row.id))
}

export async function getDepartedUsers() {
  const result = await query<{ id: string; name: string }>(
    `select id, coalesce(nullif(display_name, ''), email) as name
     from users
     where account_status = 'departed'
     order by lower(coalesce(nullif(display_name, ''), email)), id`,
  )
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name }))
}
