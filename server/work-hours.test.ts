import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseWorkDate, parseWorkHourEntryIds, parseWorkMinutes, WorkHoursError } from './work-hours.ts'

test('work minutes use integer-hour increments within the daily limit', () => {
  assert.equal(parseWorkMinutes(60), 60)
  assert.equal(parseWorkMinutes('120'), 120)
  assert.equal(parseWorkMinutes(1_440), 1_440)
  assert.equal(parseWorkMinutes('', { required: false }), null)

  for (const value of [0, 15, 59, 61, 1_441, 12.5]) {
    assert.throws(() => parseWorkMinutes(value), WorkHoursError)
  }
})

test('work-hour description is visibly and semantically required', () => {
  const source = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')

  assert.match(source, /工作说明 <span className="field-required" aria-hidden="true">\*<\/span>/u)
  assert.match(source, /<textarea aria-required="true" required value=\{description\}/u)
  assert.match(source, /if \(!description\.trim\(\)\)/u)
})

test('todo quick-status counts follow the active non-status filters', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

  assert.match(source, /const statusFilteredTodos = useMemo/u)
  assert.match(source, /const quickStatusCounts = useMemo\(\(\) => \(\{[\s\S]*?all: statusFilteredTodos\.length/u)
  assert.match(source, /<span>\{quickStatusCounts\[value\]\}<\/span>/u)
  assert.doesNotMatch(source, /const count = value === 'all' \? todos\.length/u)
})

test('work dates reject invalid calendar dates', () => {
  assert.equal(parseWorkDate('2026-09-23'), '2026-09-23')
  assert.throws(() => parseWorkDate('2026-02-30'), WorkHoursError)
  assert.throws(() => parseWorkDate('09/23/2026'), WorkHoursError)
})

test('selected work-hour IDs are non-empty, unique positive integers', () => {
  assert.deepEqual(parseWorkHourEntryIds([3, '4']), [3, 4])
  assert.throws(() => parseWorkHourEntryIds([]), WorkHoursError)
  assert.throws(() => parseWorkHourEntryIds([1, 1]), WorkHoursError)
  assert.throws(() => parseWorkHourEntryIds([0]), WorkHoursError)
})

test('legacy todo acceptance stays creator-only for enterprise todos without changing personal projects', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

  assert.match(source, /existingTodo\.rows\[0\]\.organization_id != null\s*\? createdByUserId === userId\s*:\s*canUserReviewTodo/u)
  assert.match(source, /lockedTodo\.organization_id != null\s*\? createdByUserId === userId\s*:\s*canUserReviewTodo/u)
})

test('personal todo creation keeps estimate and assignee optional', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(source, /let estimatedWorkMinutes: number \| null = null/u)
  assert.match(source, /else if \(request\.body\.estimatedWorkMinutes != null && request\.body\.estimatedWorkMinutes !== ''\)/u)
  assert.match(source, /if \(projectOrganization\?\.organization_id && !assigneeUserId\)/u)
})

test('work-hour edits and deletes lock the todo before the entry', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')
  assert.match(source, /getTodoForWork\(client, Number\(reference\.todo_id\), userId, true\)/u)
  assert.match(source, /where entry\.id = \$1[^`]*for update of entry/u)
  assert.match(source, /where id = \$1 for update'[,\n]/u)
})

test('work-hour schema preserves task-project identity and bounded states', () => {
  const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')

  assert.match(schema, /create table if not exists todo_work_hours/u)
  assert.match(schema, /status in \('pending', 'submitted', 'confirmed'\)/u)
  assert.match(schema, /returned_at timestamptz/u)
  assert.match(schema, /foreign key \(todo_id, project_id\) references todos\(id, project_id\)/u)
  assert.match(schema, /legacy_minutes or minutes % 60 = 0/u)
})

test('todo detail work-hour reads stay scoped to the authorized todo and paginate results', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')

  assert.match(source, /router\.get\('\/todos\/:todoId\/work-hours'/u)
  assert.match(source, /await organizationMember\(client, Number\(todo\.organization_id\), userId\)/u)
  assert.match(source, /await managedProject\(userId, Number\(todo\.project_id\), client\)/u)
  assert.match(source, /canReadAll = Boolean\(todo && \(managed \|\| Number\(todo\.created_by_user_id\) === userId \|\| assigneeId === userId\)\)/u)
  assert.match(source, /onlyUser: !canReadAll/u)
  assert.match(source, /const todo = await getTodoForWork\(client, Number\(reference\.todo_id\), userId(?:, true)?\)/u)
  assert.match(source, /TODO_NOT_ACCESSIBLE[\s\S]*organizationMember\(client, organization\.organizationId, userId\)/u)
  assert.match(source, /filters\.todoId \? `entry\.todo_id =/u)
  assert.match(source, /pagination: \{ offset, limit, total: filteredEntries\.length \}/u)
})

test('selected work-hour acceptance uses transactional stale-selection checks', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')
  assert.match(source, /work-hours\/submit/u)
  assert.match(source, /work-hours\/accept/u)
  assert.match(source, /work-hours\/return/u)
  assert.match(source, /updateSelectedWorkHours[\s\S]*?const organization = await lockTodoOrganization\(client, todoId, userId\)[\s\S]*?await lockWorkHoursRole\(client, userId\)[\s\S]*?getTodoForWork\(client, todoId, userId, true\)/u)
  assert.match(source, /async function transition[\s\S]*?const organization = await lockTodoOrganization\(client, todoId, userId\)[\s\S]*?await lockWorkHoursRole\(client, userId\)[\s\S]*?getTodoForWork\(client, todoId, userId, true\)/u)
  assert.match(source, /Number\(todo\.organization_id\) !== organization\.organizationId/u)
  assert.match(source, /select membership\.user_id as membership_user_id, role\.user_id as role_user_id/u)
  assert.doesNotMatch(source, /select membership\.id as membership_id/u)
  assert.match(source, /id = any\(\$2::bigint\[\]\)/u)
  assert.match(source, /\(\$3::bigint is null or user_id = \$3::bigint\)/u)
  assert.match(source, /const selectedOwnerId = null/u)
  assert.match(source, /selected\.rows\.length !== entryIds\.length/u)
  assert.match(source, /status = 'submitted'/u)
  assert.match(source, /action === 'accept'[\s\S]*?status = 'confirmed'[\s\S]*?else \{[\s\S]*?status = 'pending'/u)
  assert.match(source, /action !== 'submit' && !organization\?\.isManager/u)
  assert.match(source, /只有组织管理员可以确认或退回工时/u)
  assert.match(source, /confirmed_by_user_id = null,[\s\S]*?confirmed_at = null/u)
  assert.match(source, /const isOrganizationMember = todo\?\.organization_id/u)
})

test('organization members can record and edit hours while only assignees submit them', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/components/todo-work-hours-panel.tsx', import.meta.url), 'utf8')
  assert.match(source, /organizationMember\(client, organization\.organizationId, userId\)/u)
  assert.match(source, /if \(!todo\.assignee_user_id\)[\s\S]*TODO_NOT_ASSIGNED/u)
  assert.doesNotMatch(source, /只能为自己负责的任务记录工时/u)
  assert.doesNotMatch(source, /只能修改自己负责任务的工时/u)
  assert.doesNotMatch(source, /只能删除自己负责任务的工时/u)
  assert.match(source, /action === 'submit' && \(todo\.done \|\| assigneeId == null \|\| assigneeId !== userId\)/u)
  assert.match(client, /const selectableEntries = uniqueAcceptanceEntries\.filter\(\(entry\) => entry\.status === 'pending'\)/u)
})

test('task completion is restricted to the work-hour confirmation transaction', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')
  assert.match(source, /router\.post\('\/todos\/:todoId\/work-hours\/complete'/u)
  assert.match(source, /WORK_HOUR_COMPLETE_FORBIDDEN/u)
  assert.match(source, /只有组织管理员可以完成任务/u)
  assert.match(source, /WORK_HOUR_PENDING_CONFIRMATION/u)
  assert.match(source, /WORK_HOUR_RETURNED_UNRESUBMITTED/u)
  assert.match(source, /returned_at\)/u)
  assert.match(source, /存在已退回工时，请修改并重新提交后再完成任务/u)
  assert.match(source, /status = 'confirmed',[\s\S]*confirmed_by_user_id = \$2/u)
  assert.match(source, /autoConfirmedCount: pendingIds\.length/u)
  assert.match(source, /insertWorkHoursActivityEvent\(client, todo, userId, 'completed'\)/u)
})

test('workspace todo aggregates join the project before filtering managed visibility', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(source, /from todos t\s+join projects p on p\.id = t\.project_id\s+left join lateral \(/u)
  assert.match(source, /hours\.user_id = \$1\s+or t\.created_by_user_id = \$1\s+or \$\{managedOrganizationReadScopeSql\('p\.organization_id', '\$1'\)\}/u)
})

test('demo review queue targets an organization administrator and includes mixed confirmation states', () => {
  const source = readFileSync(new URL('./worktime-demo-seed.ts', import.meta.url), 'utf8')
  assert.match(source, /DEMO_SEED_USER_NAME \?\? '崔金睿'/u)
  assert.match(source, /role\.role = 'organization_admin'/u)
  assert.match(source, /membership\.access_role in \('owner', 'admin'\)/u)
  assert.match(source, /created_by_user_id,\s*reviewer_user_id, assignee_user_id/u)
  assert.match(source, /\$7, \$7, \$8, \$7/u)
  assert.match(source, /'confirmed'\], \[2, userId, -9, 300, 'submitted'\]/u)
  assert.match(source, /\[1, userId, -1, 180, 'pending'\]/u)
  assert.match(source, /客服工作台优化/u)
  assert.match(source, /set returned_at = now\(\)/u)
})

test('work-hour demo seed provides a broad report fixture around 崔金睿', () => {
  const source = readFileSync(new URL('./worktime-demo-seed.ts', import.meta.url), 'utf8')

  assert.match(source, /seed: 'worktime-v6'/u)
  assert.match(source, /数据中台权限治理/u)
  assert.match(source, /新零售年度规划/u)
  assert.match(source, /权限模型与角色矩阵', 4/u)
  assert.match(source, /审计日志检索优化', 1/u)
  assert.match(source, /estimateHours == null \? null : estimateHours \* 60/u)
  assert.match(source, /const currentMonthStart/u)
  assert.match(source, /const currentWeekStart/u)
  assert.match(source, /currentWeekEntries/u)
  assert.match(source, /previousMonthEntries/u)
  assert.match(source, /returnedHours/u)
  assert.match(source, /projectBreakdown/u)
  assert.match(source, /\[16, userId, 0, 240, 'submitted'\]/u)
  assert.match(source, /\[17, assigneeA, -2, 300, 'pending'\]/u)
  assert.match(source, /DEMO_SEED_CONFIRM !== 'YES'/u)
})

test('work-hour workbench exposes trend, distribution, returned, and task metrics', () => {
  const source = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')

  assert.match(source, /我的投入趋势/u)
  assert.match(source, /项目分布/u)
  assert.match(source, /我的项目投入/u)
  assert.match(source, /个人投入占比/u)
  assert.match(source, /已退回/u)
  assert.match(source, /任务工时/u)
  assert.match(source, /累计确认/u)
  assert.match(source, /showBreakdown=\{false\}/u)
  assert.match(source, /work-hours-trend-line is-total/u)
})

test('work-hour reports expose paginated entry queries while preserving full summaries', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')

  assert.match(source, /function parseListPagination\(queryParams/u)
  assert.match(source, /limit: Number\.isSafeInteger\(rawLimit\) \? Math\.min\(50, Math\.max\(1, rawLimit\)\) : 10/u)
  assert.match(source, /async function loadWorkHourPage\(/u)
  assert.match(source, /async function loadWorkHourSummary\(/u)
  assert.match(source, /select count\(\*\)::bigint as total/u)
  assert.match(source, /order by entry\.work_date desc, entry\.created_at desc, entry\.id desc\s+limit \$\$\{pageValues\.length - 1\} offset \$\$\{pageValues\.length\}/u)
  assert.match(source, /coalesce\(sum\(entry\.minutes\) filter \(where entry\.status = 'confirmed'\)/u)
  assert.match(source, /WORK_HOUR_SEARCH_CANDIDATE_LIMIT = 2000/u)
  assert.match(source, /loadWorkHourPage\(userId, filters, request\.query\.q, pagination\)/u)
  assert.match(source, /loadWorkHourSummary\(userId, filters\)/u)
  assert.match(source, /entries: paged\.entries\.map\(serializeEntry\)/u)
  assert.match(client, /offset\?: number/u)
  assert.match(client, /limit\?: number/u)
  assert.match(client, /q\?: string/u)
  assert.match(client, /params\.set\('offset', String\(filters\.offset\)\)/u)
  assert.match(client, /params\.set\('limit', String\(filters\.limit\)\)/u)
  assert.match(client, /params\.set\('q', filters\.q\.trim\(\)\)/u)
})

test('work-hour report UI keeps trend lists paginated and status dimensions explicit', () => {
  const source = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/components/work-hours-workbench.css', import.meta.url), 'utf8')

  assert.match(source, /趋势明细/u)
  assert.match(source, /tableSearch\('搜索日期', '搜索趋势日期'\)/u)
  assert.match(source, /tablePagination\('搜索趋势日期', filteredDates\.length\)/u)
  assert.match(source, /MemberComparison[\s\S]*已确认[\s\S]*未确认/u)
  assert.match(source, /成员投入明细[\s\S]*已退回[\s\S]*累计/u)
  assert.match(source, /任务名称|任务工时/u)
  assert.match(source, /<span>负责人<\/span>[\s\S]*<span>预估<\/span>[\s\S]*<span>累计确认<\/span>[\s\S]*<span>未确认<\/span>[\s\S]*<span>状态<\/span>/u)
  assert.match(source, /getTaskStatus\(task\)/u)
  assert.match(source, /workHourStatus\(entry\)/u)
  assert.match(css, /\.work-hours-grid, \.work-hours-overview-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/u)
  assert.match(css, /overflow-wrap: anywhere/u)
  assert.match(css, /\.work-hours-member-compare-bar \.is-confirmed/u)
  assert.match(css, /\.work-hours-member-compare-bar \.is-pending/u)
})

test('project work-hour workspace expands beyond the viewport without clipping tables', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

  assert.match(source, /projectDetailTab === 'work_hours' \? ' project-work-hours-workspace' : ''/u)
  assert.match(css, /\.cockpit-workspace\.project-work-hours-workspace \{[\s\S]*?height: auto;[\s\S]*?min-height: 100dvh;[\s\S]*?overflow: visible;/u)
  assert.match(css, /\.project-work-hours-workspace \.detail-layout\.work-hours-mode \{[\s\S]*?flex: 0 0 auto;[\s\S]*?overflow: visible;/u)
})

test('project work-hour task rows navigate directly to task details without an intermediate dialog', () => {
  const source = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/components/work-hours-workbench.css', import.meta.url), 'utf8')

  assert.match(source, /const openTaskDetail = \(todoId: number\) => \{[\s\S]*?onTodoClick\?\.\(projectId, todoId\)/u)
  assert.equal(source.match(/onClick=\{\(\) => openTaskDetail\(task\.taskId\)\}/gu)?.length, 2)
  assert.doesNotMatch(source, /setSelectedTaskId|work-hours-task-drawer/u)
  assert.doesNotMatch(css, /\.work-hours-task-drawer/u)
})

test('work-hour tables render bottom pagination and configurable page sizes', () => {
  const source = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /tableTools\(/u)
  assert.match(source, /const tablePagination = \(label: string, total: number\) => total > 10/u)
  assert.match(source, /pageSizeOptions=\{\[10, 20, 50\]\}/u)
  assert.match(source, /tablePagination\('搜索任务投入', filteredTasks\.length\)/u)
  assert.match(source, /tablePagination\('搜索成员投入', filteredUsers\.length\)/u)
  assert.match(source, /tablePagination\('搜索趋势日期', filteredDates\.length\)/u)
  assert.match(source, /tablePagination\('搜索工时记录', entryPagination\.total\)/u)
})
