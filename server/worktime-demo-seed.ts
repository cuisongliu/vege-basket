import { pool, query } from './db.ts'
import { encryptJson, encryptText } from './crypto.ts'

if (process.env.DEMO_SEED_CONFIRM !== 'YES') {
  throw new Error('Refusing to write demo data. Set DEMO_SEED_CONFIRM=YES explicitly.')
}

const requestedUserId = Number(process.env.DEMO_SEED_USER_ID ?? '')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

const user = await query<{ id: string; organization_id: string | null }>(
  `select u.id::text, membership.organization_id::text
   from users u
   left join lateral (
     select organization_id
     from organization_memberships
     where user_id = u.id and status = 'active'
     order by organization_id
     limit 1
   ) membership on true
   where u.account_status = 'active' and ($1::bigint is null or u.id = $1)
   order by u.id
   limit 1`,
  [Number.isSafeInteger(requestedUserId) && requestedUserId > 0 ? requestedUserId : null],
)
if (!user.rows[0]?.organization_id) {
  throw new Error('No active user with an organization membership was found.')
}

const userId = Number(user.rows[0].id)
const organizationId = Number(user.rows[0].organization_id)
const client = await pool.connect()
try {
  await client.query('begin')
  const existing = await client.query<{ id: string }>(
    `select id::text from projects where user_id = $1 and organization_id = $2 and tags @> array['demo','worktime-v5']::text[] limit 1 for update`,
    [userId, organizationId],
  )
  const isNewProject = !existing.rows[0]
  const projectId = existing.rows[0]
    ? Number(existing.rows[0].id)
    : Number((await client.query<{ id: string }>(
      `insert into projects (user_id, organization_id, name, status, tags, tags_encrypted)
       values ($1, $2, $3, 'active', array['demo','worktime-v5'], $4) returning id`,
      [userId, organizationId, encryptText('演示 · 企业工时工作台'), encryptJson(['demo', 'worktime-v5'])],
    )).rows[0].id)

  const todoSeed = [
    ['梳理月度经营指标', 240, '完成指标口径整理并输出评审结论。', 'confirmed', 120],
    ['实现工时趋势卡片', 360, '补齐周月趋势、成员投入和任务明细展示。', 'pending', 90],
    ['准备验收演示数据', 120, '为验收准备可重复的演示记录。', 'pending', 60],
  ] as const
  for (const [title, estimate, detail, status, minutes] of isNewProject ? todoSeed : []) {
    const todo = await client.query<{ id: string }>(
      `insert into todos (
         project_id, title, detail, due_date, priority, created_by_user_id,
         assignee_user_id, assigned_by_user_id, assigned_at, estimated_work_minutes,
         confirmation_status
       )
       select $1, $2, $3, $4, 'medium', $5, $5, $5, now(), $6, $7
       where not exists (
         select 1 from todos where project_id = $1 and title = $2
       )
       returning id`,
      [projectId, encryptText(title), encryptText(detail), today, userId, estimate, status === 'confirmed' ? 'confirmed' : 'pending_review'],
    )
    const todoId = Number(todo.rows[0]?.id)
    if (!todoId) continue
    await client.query(
      `insert into todo_work_hours (project_id, todo_id, user_id, work_date, minutes, status, description)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [projectId, todoId, userId, today, minutes, status, encryptText(`演示数据：${detail}`)],
    )
  }
  await client.query('commit')
  console.log(`Seeded work-time demo project ${projectId} for user ${userId}.`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
