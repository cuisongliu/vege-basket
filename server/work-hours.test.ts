import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parseWorkDate, parseWorkMinutes, WorkHoursError } from './work-hours.ts'

test('enterprise work minutes use quarter-hour increments within the daily limit', () => {
  assert.equal(parseWorkMinutes(15), 15)
  assert.equal(parseWorkMinutes('90'), 90)
  assert.equal(parseWorkMinutes(1_440), 1_440)
  assert.equal(parseWorkMinutes('', { required: false }), null)

  for (const value of [0, 16, 1_441, 12.5]) {
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

test('work-hour schema preserves task-project identity and bounded states', () => {
  const schema = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8')

  assert.match(schema, /create table if not exists todo_work_hours/u)
  assert.match(schema, /status in \('pending', 'confirmed'\)/u)
  assert.match(schema, /foreign key \(todo_id, project_id\) references todos\(id, project_id\)/u)
  assert.match(schema, /minutes > 0 and minutes <= 1440 and minutes % 15 = 0/u)
})
