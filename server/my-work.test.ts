import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { paginateMyWork, parseMyWorkFilters, workBucket, workItemKey } from './my-work-policy.ts'

const myWorkSource = readFileSync(new URL('./my-work.ts', import.meta.url), 'utf8')
const myWorkWorkbenchSource = readFileSync(new URL('../src/components/my-work-workbench.tsx', import.meta.url), 'utf8')
const myWorkWorkbenchCss = readFileSync(new URL('../src/components/my-work-workbench.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('parses bounded my work filters', () => {
  assert.deepEqual(parseMyWorkFilters({ kind: 'bug', limit: '999', cursor: '-1' }), {
    review: false,
    kind: 'bug',
    due: undefined,
    limit: 50,
    status: 'open',
    sort: 'due_desc',
    cursor: undefined,
    projectId: undefined,
    creator: undefined,
    q: undefined,
  })
})

test('defaults the work-hour confirmation queue to ten rows without changing ordinary work defaults', () => {
  assert.equal(parseMyWorkFilters({ review: 'true' }).limit, 10)
  assert.equal(parseMyWorkFilters({}).limit, 50)
  assert.equal(parseMyWorkFilters({ review: 'true', limit: '20' }).limit, 20)
})

test('accepts concrete work statuses and falls back for unknown values', () => {
  assert.equal(parseMyWorkFilters({ status: 'confirmed' }).status, 'confirmed')
  assert.equal(parseMyWorkFilters({ status: 'acceptance_failed' }).status, 'acceptance_failed')
  assert.equal(parseMyWorkFilters({ creator: '  邱天丰  ' }).creator, '邱天丰')
  assert.equal(parseMyWorkFilters({ status: 'todo:confirmed' }).status, 'todo:confirmed')
  assert.equal(parseMyWorkFilters({ status: 'pending_verification' }).status, 'pending_verification')
  assert.equal(parseMyWorkFilters({ status: 'unknown:confirmed' }).status, 'open')
  assert.equal(parseMyWorkFilters({ status: 'not-a-status' }).status, 'open')
})

test('parses the independent work-hour confirmation queue filter', () => {
  assert.equal(parseMyWorkFilters({ review: 'true' }).review, true)
  assert.equal(parseMyWorkFilters({ review: '1' }).review, true)
  assert.equal(parseMyWorkFilters({ review: 'false' }).review, false)
  assert.match(myWorkSource, /\$7::boolean = false/u)
  assert.match(myWorkSource, /and not t\.done/u)
  assert.doesNotMatch(myWorkSource, /work\.submitted_minutes > 0/u)
  assert.match(myWorkWorkbenchSource, /mode === 'review'/u)
  assert.match(apiSource, /params\.set\('review', 'true'\)/u)
})

test('defaults my work sorting to descending due dates', () => {
  assert.equal(parseMyWorkFilters({}).sort, 'due_desc')
  assert.equal(parseMyWorkFilters({ sort: 'due_asc' }).sort, 'due_asc')
  assert.equal(parseMyWorkFilters({ sort: 'updated' }).sort, 'due_desc')
})

test('classifies due date buckets', () => {
  assert.equal(workBucket('2026-07-28', '2026-07-29', '2026-08-02'), 'overdue')
  assert.equal(workBucket('2026-07-29', '2026-07-29', '2026-08-02'), 'today')
  assert.equal(workBucket('2026-08-02', '2026-07-29', '2026-08-02'), 'this_week')
  assert.equal(workBucket('2026-08-03', '2026-08-02', '2026-08-02'), 'later')
  assert.equal(workBucket(undefined, '2026-07-29', '2026-08-02'), 'unscheduled')
})

test('builds stable work item keys', () => {
  assert.equal(workItemKey('todo', 42), 'todo:42')
})

test('moves submitted todos from the assignee list to the effective reviewer', () => {
  assert.match(myWorkSource, /t\.assignee_user_id = \$1\s+and t\.confirmation_status <> 'pending_review'/u)
  assert.match(myWorkSource, /t\.reviewer_user_id = \$1/u)
  assert.match(myWorkSource, /when t\.reviewer_user_id = \$1 then 'reviewer'/u)
  assert.doesNotMatch(myWorkSource, /coalesce\(t\.reviewer_user_id, t\.created_by_user_id, p\.user_id\) = \$1/u)
})

test('keeps ordinary responsibility separate from the organization-admin work-hour confirmation queue', () => {
  assert.match(myWorkSource, /t\.assignee_user_id = \$1\s+and t\.confirmation_status <> 'pending_review'/u)
  assert.match(myWorkSource, /\$7::boolean = false\s+and \([\s\S]*?or t\.reviewer_user_id = \$1\s+\)/u)
  assert.match(myWorkSource, /\$7::boolean = true\s+and \$\{managedOrganizationReadScopeSql\('p\.organization_id', '\$1'\)\}\s+and not t\.done/u)
  assert.doesNotMatch(myWorkSource, /\$7::boolean = true[\s\S]*?work_hours\.submitted_minutes > 0/u)
  assert.doesNotMatch(myWorkSource, /\$7::boolean = true\s+and coalesce\(t\.created_by_user_id, p\.user_id\) = \$1/u)
  assert.match(myWorkSource, /p\.organization_id is null[\s\S]*?coalesce\(t\.created_by_user_id, p\.user_id\) = \$1/u)
})

test('navigation count matches the actionable work-hour confirmation queue', () => {
  const confirmationCountQuery = serverSource.match(
    /\) as open_todo_count,[\s\S]*?\(\s*select count\(\*\)[\s\S]*?\) as work_hour_confirmation_count/u,
  )?.[0] ?? ''
  assert.match(confirmationCountQuery, /not t\.done/u)
  assert.doesNotMatch(confirmationCountQuery, /hours\.status = 'submitted'/u)
})

test('navigation count uses the same mixed actionable-item scope as My Work', () => {
  const countSource = serverSource.slice(serverSource.indexOf("app.get('/api/navigation-counts'"))
  assert.match(countSource, /union all[\s\S]*project_package_events/u)
  assert.match(countSource, /union all[\s\S]*project_milestones/u)
  assert.match(countSource, /union all[\s\S]*test_bugs/u)
  assert.match(countSource, /t\.reviewer_user_id = \$1::bigint/u)
})

test('tester sessions hide delivery work from My Work and its navigation count', () => {
  assert.match(myWorkSource, /\$8::boolean = false or work\.kind <> 'delivery'/u)
  assert.match(serverSource, /\{ hideDelivery: roleSession\?\.activeRole === 'tester' \}/u)
  assert.match(serverSource, /and \$3::text <> 'tester'/u)
})

test('renders failed acceptance status in Chinese', () => {
  assert.match(myWorkWorkbenchSource, /acceptance_failed: '验收未通过'/u)
})

test('renders Bug confirmation status in Chinese', () => {
  assert.match(myWorkWorkbenchSource, /pending_confirmation: '待确认'/u)
})

test('renders My Work grid rows with valid table descendants', () => {
  assert.match(myWorkWorkbenchSource, /className="my-work-table-header-group" role="rowgroup"/u)
  assert.match(myWorkWorkbenchSource, /className="my-work-table-body" role="rowgroup"/u)
  assert.match(myWorkWorkbenchSource, /role="columnheader"/u)
  assert.match(myWorkWorkbenchSource, /className="my-work-table-cell my-work-main-cell" role="cell">\s*<button/u)
  assert.doesNotMatch(myWorkWorkbenchSource, /role="row">\s*<button/u)
})

test('work-hour confirmation shows aligned totals and reviews selected entries in the detail drawer', () => {
  assert.match(myWorkSource, /sum\(hours\.minutes\).*cumulative_minutes/u)
  assert.match(myWorkSource, /hours\.status = 'submitted'/u)
  assert.match(myWorkWorkbenchSource, /预估[\s\S]*累计[\s\S]*待确认[\s\S]*查看工时/u)
  assert.match(myWorkWorkbenchSource, /<span role="columnheader">状态<\/span>/u)
  assert.match(myWorkWorkbenchSource, /completeTodoFromWorkHours/u)
  assert.match(myWorkWorkbenchSource, /当前仍有 \$\{pendingCount\} 条未提交工时/u)
  assert.match(myWorkWorkbenchSource, /fetchTodoDetail\(todoId\)/u)
  assert.match(myWorkWorkbenchSource, /fetchTodoWorkHours\(todoId/u)
  assert.match(myWorkWorkbenchSource, /selectedEntryIds/u)
  assert.match(myWorkWorkbenchSource, /MAX_SELECTED_WORK_HOURS = 100/u)
  assert.match(myWorkWorkbenchSource, /pageSize: isReview \? 10 : 20/u)
  assert.match(myWorkWorkbenchSource, /pageSizeOptions=\{isReview \? \[10, 20, 50\] : undefined\}/u)
  assert.match(myWorkWorkbenchSource, /reviewEntries\.length === 0/u)
  assert.match(myWorkWorkbenchSource, /returnWorkHours\(todoId, entryIds\)/u)
  assert.match(myWorkWorkbenchSource, /acceptWorkHours\(todoId, entryIds\)/u)
  assert.match(myWorkWorkbenchSource, /退回修改/u)
  assert.match(myWorkWorkbenchSource, /确认工时/u)
  assert.doesNotMatch(myWorkWorkbenchSource, /验收所选/u)
  assert.doesNotMatch(myWorkWorkbenchSource, /onAcceptTodos/u)
  assert.match(myWorkWorkbenchCss, /\.my-work-confirmation-row[\s\S]*grid-template-columns/u)
  assert.match(myWorkWorkbenchCss, /\.my-work-confirmation-dialog[\s\S]*right: 0[\s\S]*width: min\(820px/u)
  assert.match(myWorkWorkbenchCss, /\.my-work-confirmation-content[\s\S]*overflow-y: auto/u)
  assert.match(myWorkWorkbenchCss, /\.my-work-confirmation-entry[\s\S]*min-height: 54px/u)
  assert.match(appSource, /> 工时确认/u)
  assert.match(appSource, /const canNavigateToReview = Boolean\(selectedOrganizationId !== null && canManageSelectedOrganization\)/u)
  assert.match(serverSource, /workHourConfirmationCount/u)
})

test('aligns grid headings with icon-offset titles and matching cell content', () => {
  assert.match(myWorkWorkbenchCss, /\.my-work-table-header > :first-child \{ padding-inline-start: 41px; \}/u)
  assert.match(myWorkWorkbenchCss, /\.my-work-action-heading \{\s*text-align: right;/u)
  assert.match(myWorkWorkbenchCss, /\.my-work-confirmation-action \{[\s\S]*?justify-content: flex-end;/u)
  assert.match(appCss, /\.todo-workflow-table-header > :first-child \{\s*padding-inline-start: 30px;/u)
  assert.match(appCss, /\.todo-workflow-table-header > :nth-child\(5\) \{\s*padding-inline-start: 7px;\s*text-align: left;/u)
  assert.match(appCss, /\.todo-workflow-table-header > :last-child \{\s*text-align: right;/u)
})

test('renders My Work secondary text with the readable workbench token', () => {
  assert.match(myWorkWorkbenchCss, /--my-work-muted-readable:\s*var\(--muted-text\)/u)
  assert.match(myWorkWorkbenchCss, /--my-work-positive-readable:/u)
  assert.doesNotMatch(myWorkWorkbenchCss, /color:\s*var\(--muted-foreground\)/u)
})

test('marks todos transferred through offboarding', () => {
  assert.match(myWorkSource, /account_offboarding_asset_transfers/u)
  assert.match(myWorkSource, /offboarding_transferred_from_name/u)
  assert.match(myWorkSource, /previous_assignee_user_id/u)
  assert.match(myWorkSource, /transfer.next_assignee_user_id = \$1::bigint/u)
  assert.match(myWorkWorkbenchSource, /item\.offboardingTransferredFromName/u)
  assert.match(myWorkWorkbenchSource, /-离职转移/u)
  assert.match(myWorkWorkbenchSource, /离职转移/u)
})

test('scopes my work to the requested organization context', () => {
  assert.match(myWorkSource, /p\.organization_id/u)
  assert.match(myWorkSource, /space\.organization_id/u)
  assert.match(myWorkSource, /work\.organization_id is not distinct from \$6::bigint/u)
  assert.match(myWorkSource, /organizationId,/u)
  assert.match(apiSource, /fetchMyWork\(organizationId: OrganizationContext/u)
  assert.match(apiSource, /params\.set\('organizationId', serializeOrganizationContext\(organizationId\)\)/u)
  assert.match(serverSource, /app\.get\('\/api\/my-work'/u)
  assert.match(serverSource, /parseOrganizationContext\(request\.query\.organizationId\)/u)
})

test('work-hour confirmation reads require an organization administrator', () => {
  const routeStart = serverSource.indexOf("app.get('/api/my-work'")
  const routeEnd = serverSource.indexOf("app.get('/api/navigation-counts'", routeStart)
  const routeSource = serverSource.slice(routeStart, routeEnd)
  assert.match(routeSource, /if \(filters\.review\)/u)
  assert.match(routeSource, /role\.role = 'organization_admin'/u)
  assert.match(routeSource, /membership\.access_role in \('owner', 'admin'\)/u)
  assert.match(routeSource, /只有当前组织的组织管理员可以查看工时确认/u)
})

test('filters dates across all records before paging and counts the complete match', () => {
  const items = Array.from({ length: 625 }, (_, index) => ({
    id: `todo:${index}`, kind: 'todo' as const, sourceId: index, title: 'Work',
    status: 'assigned', updatedAt: '', relation: 'assignee' as const,
    dueAt: index < 600 ? '2026-09-23' : '2026-09-22',
  }))
  const first = paginateMyWork(items, { due: 'today', limit: 20 }, '2026-09-22', '2026-09-27')
  assert.equal(first.total, 25)
  assert.equal(first.items[0].sourceId, 600)
  assert.equal(first.nextCursor, '20')
  const second = paginateMyWork(items, { due: 'today', limit: 20, cursor: '20' }, '2026-09-22', '2026-09-27')
  assert.equal(second.items.length, 5)
  assert.equal(second.nextCursor, undefined)
  const shrunk = paginateMyWork(items.slice(0, 610), { due: 'today', limit: 20, cursor: '20' }, '2026-09-22', '2026-09-27')
  assert.equal(shrunk.offset, 0)
  assert.equal(shrunk.items.length, 10)
  const empty = paginateMyWork([], { limit: 20, cursor: '40' }, '2026-09-22', '2026-09-27')
  assert.equal(empty.offset, 0)
  assert.equal(empty.total, 0)
})

test('paginates the eleventh work-hour confirmation task onto the second default page', () => {
  const filters = parseMyWorkFilters({ review: 'true' })
  const items = Array.from({ length: 11 }, (_, index) => ({
    id: `todo:${index + 1}`, kind: 'todo' as const, sourceId: index + 1, title: `Task ${index + 1}`,
    status: 'assigned', updatedAt: '', relation: 'assignee' as const,
  }))
  const first = paginateMyWork(items, filters, '2026-09-30', '2026-10-04')
  const second = paginateMyWork(items, { ...filters, cursor: '10' }, '2026-09-30', '2026-10-04')
  assert.equal(first.items.length, 10)
  assert.equal(first.nextCursor, '10')
  assert.equal(second.items.length, 1)
  assert.equal(second.items[0]?.sourceId, 11)
})

test('validates date filters before paging', () => {
  assert.equal(parseMyWorkFilters({ due: 'today' }).due, 'today')
  assert.equal(parseMyWorkFilters({ due: 'invalid' }).due, undefined)
})
