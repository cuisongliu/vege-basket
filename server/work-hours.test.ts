import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseWorkDate, parseWorkMinutes, WorkHoursError } from './work-hours.ts'

test('work minutes use integer-hour increments within the daily limit', () => {
  assert.equal(parseWorkMinutes(60), 60)
  assert.equal(parseWorkMinutes('120'), 120)
  assert.equal(parseWorkMinutes(1_440), 1_440)
  assert.equal(parseWorkMinutes('', { required: false }), null)

  for (const value of [0, 15, 59, 61, 1_441, 12.5]) {
    assert.throws(() => parseWorkMinutes(value), WorkHoursError)
  }
})

test('work dates reject invalid calendar dates', () => {
  assert.equal(parseWorkDate('2026-09-23'), '2026-09-23')
  assert.throws(() => parseWorkDate('2026-02-30'), WorkHoursError)
  assert.throws(() => parseWorkDate('09/23/2026'), WorkHoursError)
})

test('review authority stays creator-only for enterprise todos without changing personal projects', () => {
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
  assert.match(schema, /status in \('pending', 'confirmed'\)/u)
  assert.match(schema, /foreign key \(todo_id, project_id\) references todos\(id, project_id\)/u)
  assert.match(schema, /legacy_minutes or minutes % 60 = 0/u)
})

test('todo detail work-hour reads stay scoped to the authorized todo and paginate results', () => {
  const source = readFileSync(new URL('./work-hours.ts', import.meta.url), 'utf8')

  assert.match(source, /router\.get\('\/todos\/:todoId\/work-hours'/u)
  assert.match(source, /await projectMember\(client, Number\(todo\.project_id\), userId\)/u)
  assert.match(source, /await managedProject\(userId, Number\(todo\.project_id\), client\)/u)
  assert.match(source, /canReadAll = Boolean\(todo && \(managed \|\| Number\(todo\.created_by_user_id\) === userId\)\)/u)
  assert.match(source, /onlyUser: !canReadAll/u)
  assert.match(source, /const todo = await getTodoForWork\(client, Number\(reference\.todo_id\), userId(?:, true)?\)/u)
  assert.match(source, /TODO_NOT_ACCESSIBLE.*projectMember\(client, Number\(todo\.project_id\), userId\)/su)
  assert.match(source, /filters\.todoId \? `entry\.todo_id =/u)
  assert.match(source, /pagination: \{ offset, limit, total: filteredEntries\.length \}/u)
})

test('workspace todo aggregates join the project before filtering managed visibility', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  assert.match(source, /from todos t\s+join projects p on p\.id = t\.project_id\s+left join lateral \(/u)
  assert.match(source, /hours\.user_id = \$1\s+or t\.created_by_user_id = \$1\s+or \$\{managedOrganizationReadScopeSql\('p\.organization_id', '\$1'\)\}/u)
})

test('demo review queue assigns 崔金睿 as the explicit reviewer', () => {
  const source = readFileSync(new URL('./worktime-demo-seed.ts', import.meta.url), 'utf8')
  assert.match(source, /created_by_user_id,\s*reviewer_user_id, assignee_user_id/u)
  assert.match(source, /\$7, \$7, \$8, \$7/u)
})
