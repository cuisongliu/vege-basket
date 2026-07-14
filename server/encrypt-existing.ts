import 'dotenv/config'
import { pool, query } from './db.ts'
import { schemaSql } from './schema.ts'
import { blindIndex, encryptJson, encryptText, isEncryptedText } from './crypto.ts'

function maybeEncrypt(value: string) {
  return isEncryptedText(value) ? value : encryptText(value)
}

async function encryptColumn(table: string, column: string) {
  const result = await query<{ id: string; value: string }>(
    `select id, ${column} as value from ${table}`,
  )
  for (const row of result.rows) {
    if (!row.value || isEncryptedText(row.value)) continue
    await query(`update ${table} set ${column} = $1 where id = $2`, [
      encryptText(row.value),
      Number(row.id),
    ])
  }
}

async function main() {
  await query(schemaSql)

  const projects = await query<{ id: string; name: string; tags: string[]; tags_encrypted: string | null }>(
    'select id, name, tags, tags_encrypted from projects',
  )
  for (const project of projects.rows) {
    await query(
      `
      update projects
      set name = $1,
          tags_encrypted = $2,
          tags = '{}'
      where id = $3
      `,
      [
        maybeEncrypt(project.name),
        project.tags_encrypted && isEncryptedText(project.tags_encrypted)
          ? project.tags_encrypted
          : encryptJson(project.tags ?? []),
        Number(project.id),
      ],
    )
  }

  await encryptColumn('journal_entries', 'content')
  await encryptColumn('todos', 'title')
  await encryptColumn('todos', 'detail')
  await encryptColumn('risks', 'content')
  await encryptColumn('draft_items', 'content')
  await encryptColumn('summaries', 'title')
  await encryptColumn('summaries', 'period')
  await encryptColumn('summaries', 'content')

  const collaborators = await query<{ id: string; name: string; role: string }>(
    'select id, name, role from collaborators',
  )
  for (const collaborator of collaborators.rows) {
    const plainName = isEncryptedText(collaborator.name) ? '' : collaborator.name
    await query(
      `
      update collaborators
      set name = $1,
          name_lookup = coalesce(name_lookup, $2),
          role = $3
      where id = $4
      `,
      [
        maybeEncrypt(collaborator.name),
        plainName ? blindIndex(plainName) : null,
        collaborator.role ? maybeEncrypt(collaborator.role) : '',
        Number(collaborator.id),
      ],
    )
  }

  const memberships = await query<{ id: string; invited_email: string; invited_email_lookup: string | null }>(
    'select id, invited_email, invited_email_lookup from project_memberships',
  )
  for (const membership of memberships.rows) {
    const plainEmail = isEncryptedText(membership.invited_email) ? '' : membership.invited_email
    await query(
      `
      update project_memberships
      set invited_email = $1,
          invited_email_lookup = coalesce(invited_email_lookup, $2)
      where id = $3
      `,
      [
        maybeEncrypt(membership.invited_email),
        plainEmail ? blindIndex(plainEmail) : membership.invited_email_lookup,
        Number(membership.id),
      ],
    )
  }

  const aiSettings = await query<{ user_id: string; base_url: string; api_key: string; model: string }>(
    'select user_id, base_url, api_key, model from ai_settings',
  )
  for (const settings of aiSettings.rows) {
    await query(
      `
      update ai_settings
      set base_url = $1,
          api_key = $2,
          model = $3,
          updated_at = now()
      where user_id = $4
      `,
      [
        settings.base_url ? maybeEncrypt(settings.base_url) : '',
        settings.api_key ? maybeEncrypt(settings.api_key) : '',
        settings.model ? maybeEncrypt(settings.model) : '',
        Number(settings.user_id),
      ],
    )
  }

  console.log('Existing sensitive fields are encrypted.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
