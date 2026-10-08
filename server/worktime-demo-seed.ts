import { pool, query } from './db.ts'
import { decryptText, encryptJson, encryptText } from './crypto.ts'

if (process.env.DEMO_SEED_CONFIRM !== 'YES') {
  throw new Error('Refusing to write demo data. Set DEMO_SEED_CONFIRM=YES explicitly.')
}

const requestedUserId = Number(process.env.DEMO_SEED_USER_ID ?? '')
const requestedUserName = String(process.env.DEMO_SEED_USER_NAME ?? '崔金睿').trim()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())

function shiftDate(days: number) {
  const date = new Date(`${today}T12:00:00+08:00`)
  date.setDate(date.getDate() + days)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}

function weekStartDate(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`)
  const day = date.getDay() || 7
  date.setDate(date.getDate() - day + 1)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date)
}

const currentMonthStart = `${today.slice(0, 7)}-01`
const currentWeekStart = weekStartDate(today)

const user = await query<{ id: string; organization_id: string | null }>(
  `select u.id::text, membership.organization_id::text
     from users u
     join lateral (
       select membership.organization_id
       from organization_memberships membership
       join user_roles role on role.user_id = membership.user_id and role.role = 'organization_admin'
       where membership.user_id = u.id
         and membership.status = 'active'
         and membership.access_role in ('owner', 'admin')
       order by membership.organization_id
       limit 1
     ) membership on true
    where u.account_status = 'active'
      and ($1::bigint is null or u.id = $1)
      and ($2 = '' or u.display_name = $2)
    order by u.id
    limit 1`,
  [Number.isSafeInteger(requestedUserId) && requestedUserId > 0 ? requestedUserId : null, requestedUserId ? '' : requestedUserName],
)
if (!user.rows[0]?.organization_id) {
  throw new Error(`No active organization user found for ${requestedUserId || requestedUserName}.`)
}

const userId = Number(user.rows[0].id)
const organizationId = Number(user.rows[0].organization_id)
const members = await query<{
  id: string
  display_name: string
  email: string
  access_role: string
}>(
  `select u.id::text, u.display_name, u.email, membership.access_role
     from users u
     join organization_memberships membership
       on membership.user_id = u.id
      and membership.organization_id = $1
      and membership.status = 'active'
    where u.account_status = 'active'
    order by membership.access_role in ('owner', 'admin') desc, u.id`,
  [organizationId],
)
const memberIds = members.rows.map((row) => Number(row.id)).filter((id) => id !== userId)
const managerId = members.rows.find((row) => ['owner', 'admin'].includes(row.access_role))?.id
  ? Number(members.rows.find((row) => ['owner', 'admin'].includes(row.access_role))?.id)
  : userId
const assigneeA = memberIds[0] ?? userId
const assigneeB = memberIds[1] ?? userId
const assigneeC = memberIds[2] ?? userId

const client = await pool.connect()
try {
  await client.query('begin')
  await client.query(
    `delete from projects
      where organization_id = $1
        and user_id = $2
        and tags @> array['demo','worktime-v5']::text[]`,
    [organizationId, userId],
  )

  const projectSeeds = [
    ['零售后台重构', '收银、库存与售后体验的统一升级', ['demo', 'worktime-v5', '核心业务', '交付'], 'on_track'],
    ['门店巡检小程序', '从现场巡检到异常闭环，让门店协作更轻', ['demo', 'worktime-v5', '门店运营'], 'at_risk'],
    ['供应链数据看板', '打通采购、履约与库存分析', ['demo', 'worktime-v5', '数据服务'], 'on_track'],
    ['客服工作台优化', '统一客服分派、响应与服务质量指标', ['demo', 'worktime-v5', '客户体验'], 'on_track'],
    ['数据中台权限治理', '统一数据权限、审计与访问申请流程', ['demo', 'worktime-v5', '治理专项'], 'at_risk'],
    ['新零售年度规划', '用于校验无当前周期工时的项目展示和空态', ['demo', 'worktime-v5', '规划储备'], 'on_track'],
  ] as const
  const projectIds: number[] = []
  for (const [name, description, tags, healthStatus] of projectSeeds) {
    const result = await client.query<{ id: string }>(
      `insert into projects (user_id, organization_id, name, description_encrypted, status, tags, tags_encrypted, health_status)
       values ($1, $2, $3, $4, 'active', $5, $6, $7)
       returning id`,
      [userId, organizationId, encryptText(name), encryptText(description), tags, encryptJson(tags), healthStatus],
    )
    projectIds.push(Number(result.rows[0].id))
  }

  for (const projectId of projectIds) {
    for (const member of members.rows.filter((row) => Number(row.id) !== userId).slice(0, 5)) {
      await client.query(
        `insert into project_memberships
          (project_id, owner_user_id, invited_user_id, invited_email, invited_email_lookup, role, status, accepted_at)
         values ($1, $2, $3, $4, $5, 'member', 'active', now())
         on conflict (project_id, invited_email) do update set status = 'active', accepted_at = now()`,
        [projectId, userId, Number(member.id), member.email || member.display_name, (member.email || member.display_name).toLowerCase()],
      )
    }
  }

  const todoSeeds = [
    [projectIds[0], '重构结算页优惠计算', 16, assigneeA, 'done', 1],
    [projectIds[0], '库存预警接口与消息卡片', 12, userId, 'open', 0],
    [projectIds[0], '退款单状态机补齐', 20, userId, 'pending_review', 2],
    [projectIds[0], '结算流程回归与兼容性验证', 8, assigneeB, 'pending_review', 3],
    [projectIds[0], '细化门店数据访问权限', 6, managerId, 'done', 4],
    [projectIds[0], '补齐商品搜索空态', 4, assigneeB, 'done', 5],
    [projectIds[1], '巡检离线缓存与补传', 18, userId, 'open', 6],
    [projectIds[1], '门店巡检回归测试', 14, assigneeB, 'open', 7],
    [projectIds[1], '巡检结果导出', 8, managerId, 'done', 8],
    [projectIds[2], '采购看板聚合接口', 22, userId, 'open', 9],
    [projectIds[2], '履约趋势可视化', 16, assigneeC, 'done', 10],
    [projectIds[2], '统一指标计算口径', 8, managerId, 'done', 11],
    [projectIds[3], '客服分派规则与响应队列', 12, userId, 'open', 12],
    [projectIds[3], '服务质量指标看板', 10, assigneeA, 'open', 13],
    [projectIds[3], '客服工单回访流程', 8, managerId, 'done', 14],
    [projectIds[3], '历史工单数据清理', 6, assigneeB, 'done', 15],
    [projectIds[4], '权限模型与角色矩阵', 4, userId, 'open', 16],
    [projectIds[4], '访问申请审批流', 2, assigneeA, 'pending_review', 17],
    [projectIds[4], '审计日志检索优化', 1, managerId, 'done', 18],
    [projectIds[4], '历史权限数据盘点', null, assigneeB, 'done', 19],
    [projectIds[5], '年度目标拆解', 24, userId, 'open', 20],
    [projectIds[5], '门店经营指标规划', null, assigneeC, 'open', 21],
    [projectIds[5], '资源投入测算', 16, managerId, 'open', 22],
    [projectIds[5], '风险清单与里程碑', 8, assigneeA, 'pending_review', 23],
  ] as const
  const todoIds: number[] = []
  for (const [projectId, title, estimateHours, assigneeUserId, confirmationStatus, offset] of todoSeeds) {
    const storedConfirmationStatus = confirmationStatus === 'pending_review' ? 'pending_review' : 'confirmed'
    const result = await client.query<{ id: string }>(
      `insert into todos (
       project_id, title, detail, due_date, priority, done, created_by_user_id,
         reviewer_user_id, assignee_user_id, assigned_by_user_id, assigned_at, estimated_work_minutes,
         confirmation_status, submitted_at, accepted_at, accepted_by_user_id, completed_at, completed_by_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $7, now(), $9, $10, $11, $12, $13, $14, $13)
       returning id`,
      [
        projectId,
        encryptText(title),
        encryptText(`演示待办：${title}，请按照 worktime-v5 原型核对交付成果和投入。`),
        shiftDate(2),
        offset % 4 === 0 ? 'high' : 'medium',
        confirmationStatus === 'done',
        userId,
        assigneeUserId,
        estimateHours == null ? null : estimateHours * 60,
        storedConfirmationStatus,
        confirmationStatus === 'pending_review' ? new Date().toISOString() : null,
        confirmationStatus === 'done' ? new Date().toISOString() : null,
        confirmationStatus === 'done' ? managerId : null,
        confirmationStatus === 'done' ? new Date().toISOString() : null,
      ],
    )
    todoIds.push(Number(result.rows[0].id))
  }
  await client.query(
    `update todos
        set needs_revision = true,
            rejection_reason = $2,
            updated_at = now()
      where id = $1`,
    [todoIds[1], encryptText('验收未通过：请补充异常重试场景和回归截图后再次提交。')],
  )

  const workSeeds = [
    [0, userId, -20, 300, 'confirmed'], [0, userId, -14, 360, 'confirmed'], [0, userId, -7, 240, 'confirmed'], [0, userId, -2, 180, 'confirmed'],
    [1, userId, -1, 180, 'pending'], [1, userId, 0, 120, 'submitted'],
    [2, userId, -18, 420, 'confirmed'], [2, userId, -9, 300, 'submitted'], [2, userId, -2, 180, 'submitted'],
    [3, assigneeB, -12, 180, 'submitted'], [3, assigneeB, -4, 180, 'submitted'],
    [4, managerId, -16, 300, 'confirmed'], [4, managerId, -8, 240, 'confirmed'],
    [5, assigneeB, -10, 180, 'confirmed'],
    [6, userId, -15, 360, 'pending'], [6, userId, -3, 240, 'pending'], [6, userId, -1, 120, 'pending'],
    [7, assigneeB, -11, 300, 'pending'], [7, assigneeB, -2, 180, 'pending'],
    [8, managerId, -17, 360, 'confirmed'], [8, managerId, -6, 120, 'confirmed'],
    [9, userId, -13, 420, 'pending'], [9, userId, -6, 360, 'pending'], [9, userId, -1, 180, 'submitted'],
    [10, assigneeC, -14, 540, 'confirmed'], [10, assigneeC, -7, 240, 'confirmed'], [10, assigneeC, -2, 120, 'confirmed'],
    [11, managerId, -9, 420, 'confirmed'],
    [12, userId, -35, 240, 'confirmed'], [12, userId, -34, 120, 'submitted'],
    [13, assigneeA, -32, 180, 'pending'], [14, managerId, -36, 300, 'confirmed'],
    [15, assigneeB, -4, 240, 'submitted'],
    [16, userId, 0, 240, 'submitted'], [16, userId, -1, 180, 'confirmed'],
    [17, assigneeA, -2, 300, 'pending'], [18, userId, -3, 120, 'confirmed'], [19, managerId, -5, 240, 'confirmed'],
  ] as const
  let returnedEntryId: number | null = null
  for (const [todoIndex, authorId, offset, minutes, status] of workSeeds) {
    const inserted = await client.query<{ id: string }>(
      `insert into todo_work_hours (project_id, todo_id, user_id, work_date, minutes, status, description, confirmed_by_user_id, confirmed_at)
       select t.project_id, t.id, $2, $3, $4, $5, $6, $7, case when $5 = 'confirmed' then now() else null end
         from todos t where t.id = $1 returning id`,
      [todoIds[todoIndex], authorId, shiftDate(offset), minutes, status, encryptText('演示记录：完成开发、联调与结果核验。'), status === 'confirmed' ? managerId : null],
    )
    if (inserted.rows[0]) {
      const entryId = Number(inserted.rows[0].id)
      if (returnedEntryId == null && todoIndex === 1 && status === 'pending') returnedEntryId = entryId
    }
  }
  if (returnedEntryId != null) {
    await client.query('update todo_work_hours set returned_at = now() where id = $1', [returnedEntryId])
  }

  for (const [projectIndex, daysAgo, authorId, content] of [
    [0, 0, userId, '本周交付与验收安排\n结算链路进入回归阶段，库存预警继续联调。'],
    [0, 1, assigneeA, '接口联调进展\n库存预警接口已接通，待补充失败重试验证。'],
    [0, 7, managerId, '风险记录\n灰度切换前核对迁移结果、备份记录与环境配置。'],
    [1, 2, userId, '巡检闭环\n离线缓存与异常补传进入联调。'],
    [2, 4, assigneeC, '指标口径\n履约趋势和采购聚合口径已完成对齐。'],
    [4, 1, userId, '权限治理\n角色矩阵进入审批联调，审计日志检索待补充边界校验。'],
    [5, 8, managerId, '年度规划\n项目已建立，等待下一周期拆解投入。'],
  ] as const) {
    await client.query(
      `insert into journal_entries (project_id, author_user_id, content, visibility, created_at)
       values ($1, $2, $3, 'public', ($4::date + interval '16 hours 42 minutes'))`,
      [projectIds[projectIndex], authorId, encryptText(content), shiftDate(-daysAgo)],
    )
  }

  const reportStats = await client.query<{
    total_entries: string
    total_minutes: string
    current_week_entries: string
    current_month_entries: string
    previous_month_entries: string
    pending_entries: string
    submitted_entries: string
    confirmed_entries: string
    returned_entries: string
    returned_minutes: string
  }>(
    `select count(*)::int as total_entries,
            coalesce(sum(minutes), 0)::bigint as total_minutes,
            count(*) filter (where work_date >= $2::date)::int as current_week_entries,
            count(*) filter (where work_date >= $3::date)::int as current_month_entries,
            count(*) filter (where work_date < $3::date)::int as previous_month_entries,
            count(*) filter (where status = 'pending')::int as pending_entries,
            count(*) filter (where status = 'submitted')::int as submitted_entries,
            count(*) filter (where status = 'confirmed')::int as confirmed_entries,
            count(*) filter (where returned_at is not null)::int as returned_entries,
            coalesce(sum(minutes) filter (where returned_at is not null), 0)::bigint as returned_minutes
       from todo_work_hours
      where project_id = any($1::bigint[])`,
    [projectIds, currentWeekStart, currentMonthStart],
  )
  const projectStats = await client.query<{
    project_name: string
    task_count: string
    entry_count: string
    minutes: string
  }>(
    `select p.name as project_name, count(distinct t.id)::int as task_count,
            coalesce(hours.entry_count, 0)::int as entry_count,
            coalesce(hours.minutes, 0)::bigint as minutes
       from projects p
       left join todos t on t.project_id = p.id
       left join lateral (
         select count(*)::int as entry_count, coalesce(sum(minutes), 0)::bigint as minutes
           from todo_work_hours e where e.project_id = p.id
       ) hours on true
      where p.id = any($1::bigint[])
      group by p.id, p.name, hours.entry_count, hours.minutes
      order by p.id`,
    [projectIds],
  )

  for (const [projectIndex, title, daysAgo, status, packageName, version, content] of [
    [0, '零售后台 v2.4 灰度交付', 2, 'delivering', 'retail-api', '2.4.0', '交付前检查\n核对迁移校验结果、备份记录与环境配置。\n灰度验证\n先在试点门店验证订单、退款与库存链路。'],
    [0, '库存消息服务 v1.8 交付', 9, 'delivered', 'inventory-service', '1.8.0', '交付记录\n安装包核对完成，消息订阅与异常恢复已验证。'],
    [1, '门店巡检小程序 v1.3 发布', 5, 'delivering', 'store-inspection', '1.3.0', '发布前检查\n现场巡检、异常闭环和回滚准备。'],
  ] as const) {
    const event = await client.query<{ id: string }>(
      `insert into project_package_events
        (project_id, type, status, title, created_by_user_id, assignee_user_id, assigned_by_user_id, assigned_at, delivery_date, delivery_start_at, delivery_end_at, published_at, published_by_user_id, completed_by_user_id, completed_at, delivery_result)
       values ($1::bigint, 'upgrade', $4::text, $2::text, $3::bigint, $3::bigint, $3::bigint, now(), $5::date, ($5::date::timestamp at time zone 'Asia/Shanghai'), (($5::date::timestamp + interval '1 day' - interval '1 second') at time zone 'Asia/Shanghai'), now(), $3::bigint, case when $4::text = 'delivered' then $3::bigint else null::bigint end, case when $4::text = 'delivered' then now() else null::timestamptz end, case when $4::text = 'delivered' then 'success'::text else null::text end)
       returning id`,
      [projectIds[projectIndex], encryptText(title), managerId, status, shiftDate(-daysAgo)],
    )
    const eventId = Number(event.rows[0].id)
    const group = await client.query<{ id: string }>(
      `insert into project_package_groups (project_package_event_id, package_name) values ($1, $2) returning id`,
      [eventId, packageName],
    )
    const groupId = Number(group.rows[0].id)
    await client.query(
      `insert into project_package_items
        (project_package_group_id, source_package_id, source_package_name, channel, channel_label, arch, version, object_key, size_bytes, created_by_user_id)
       values ($1, $2, $2, 'release', '正式版', 'amd64', $3, $4, 1048576, $5)`,
      [groupId, packageName, version, `release/${packageName}/${version}/${packageName}-${version}.tar.gz`, managerId],
    )
    await client.query(
      `insert into project_package_operations
        (project_package_event_id, project_package_group_id, kind, status, title, label, content, completed, created_by_user_id)
       values ($1, null, 'document', 'success', $2, '变更记录', $3, $4, $5)`,
      [eventId, encryptText(title), encryptText(content), status === 'delivered', managerId],
    )
  }

  await client.query('commit')
  const stats = reportStats.rows[0]
  console.log(JSON.stringify({
    seed: 'worktime-v6',
    account: requestedUserName,
    userId,
    organizationId,
    projects: projectIds.length,
    todos: todoIds.length,
    members: members.rows.length,
    workHours: {
      entries: Number(stats?.total_entries ?? 0),
      hours: Number(stats?.total_minutes ?? 0) / 60,
      currentWeekEntries: Number(stats?.current_week_entries ?? 0),
      currentMonthEntries: Number(stats?.current_month_entries ?? 0),
      previousMonthEntries: Number(stats?.previous_month_entries ?? 0),
      pendingEntries: Number(stats?.pending_entries ?? 0),
      submittedEntries: Number(stats?.submitted_entries ?? 0),
      confirmedEntries: Number(stats?.confirmed_entries ?? 0),
      returnedEntries: Number(stats?.returned_entries ?? 0),
      returnedHours: Number(stats?.returned_minutes ?? 0) / 60,
    },
    projectBreakdown: projectStats.rows.map((row) => ({
      name: decryptText(row.project_name),
      tasks: Number(row.task_count),
      entries: Number(row.entry_count),
      hours: Number(row.minutes) / 60,
    })),
  }, null, 2))
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
