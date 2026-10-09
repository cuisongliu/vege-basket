import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serverSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')
const migrationSource = readFileSync(new URL('./migrations/20261008_personal_todo_lifecycle.sql', import.meta.url), 'utf8')
const activityMigrationSource = readFileSync(new URL('./migrations/20261009_todo_activity_detail.sql', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const activityPanelSource = readFileSync(new URL('../src/components/todo-activity-panel.tsx', import.meta.url), 'utf8')
const shareViewSource = readFileSync(new URL('../src/components/todo-share-view.tsx', import.meta.url), 'utf8')
const workHoursSource = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')

test('personal todo lifecycle has explicit open, completed, and discarded states', () => {
  assert.match(schemaSource, /todo_status text not null default 'open'/u)
  assert.match(schemaSource, /todo_status in \('open', 'completed', 'discarded'\)/u)
  assert.match(schemaSource, /discard_reason text/u)
  assert.match(migrationSource, /confirmation_status = 'confirmed'/u)
  assert.match(serverSource, /requestedTodoStatus === 'discarded' && !discardReason/u)
  assert.match(serverSource, /discard_reason = case when \$3::text = 'discarded' then \$5::text/u)
})

test('personal and enterprise todo lifecycle writes keep their separate completion rules', () => {
  assert.match(serverSource, /企业待办请通过工时确认流程完成/u)
  assert.match(serverSource, /个人项目待办由当前用户本人负责，不支持指派负责人或确认人/u)
  assert.match(serverSource, /个人项目不支持预估工时/u)
  assert.match(serverSource, /只有已废弃待办可以重新打开/u)
  assert.match(serverSource, /const assigneeUserId = isPersonalProject\s+\? null/u)
  assert.match(serverSource, /const reviewerUserId = isPersonalProject\s+\? null/u)
})

test('enterprise todo discard is transactionally limited to tasks without work hours', () => {
  assert.match(serverSource, /select exists\(select 1 from todo_work_hours where todo_id = \$1\) as has_work_hours/u)
  assert.match(serverSource, /已有工时记录的企业待办不能废弃/u)
  assert.match(serverSource, /requestedTodoStatus === 'open'[\s\S]*?current\.todo_status !== 'discarded'/u)
  assert.match(serverSource, /await lockProjectMutation\(lifecycleClient, projectId\)/u)
  assert.match(workHoursSource, /TODO_DISCARDED/u)
  assert.match(appSource, /\['discarded', '已废弃'\]/u)
})

test('personal project UI restores creation and removes assignment controls', () => {
  assert.match(appSource, /view === 'search' && selectedOrganizationId === null/u)
  assert.match(appSource, /scopeLabel === '个人项目'/u)
  assert.match(appSource, /requiresEnterpriseTodoFields \? \(/u)
  assert.match(appSource, /todoStatus === 'discarded'/u)
  assert.match(appSource, /废弃理由（必填）/u)
  assert.match(appSource, /editingProject\.organizationId \? \{/u)
  assert.match(appSource, /canViewSelectedProjectDelivery = canViewProjectDelivery && selectedProject\?\.organizationId != null/u)
})

test('discard reasons are encrypted activity details instead of standalone detail blocks', () => {
  assert.match(schemaSource, /detail text not null default ''/u)
  assert.match(activityMigrationSource, /add column if not exists detail text not null default ''/u)
  assert.match(activityMigrationSource, /set detail = todo\.discard_reason/u)
  assert.match(activityMigrationSource, /order by latest\.occurred_at desc, latest\.id desc/u)
  assert.match(serverSource, /payload\.eventType === 'discarded' && payload\.detail \? encryptText\(payload\.detail\) : ''/u)
  assert.match(serverSource, /detail: requestedTodoStatus === 'discarded' \? discardReason : undefined/u)
  assert.match(serverSource, /detail: event\.event_type === 'discarded' && event\.detail \? decryptText\(event\.detail\) : undefined/u)
  assert.match(activityPanelSource, /event\.eventType === 'discarded' && event\.detail/u)
  assert.doesNotMatch(appSource, /废弃理由：\{todo\.discardReason\}/u)
  assert.doesNotMatch(shareViewSource, /废弃理由：\{data\.discardReason\}/u)
})
