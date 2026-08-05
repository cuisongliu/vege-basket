import assert from 'node:assert/strict'
import test from 'node:test'
import {
  matchesBugFilterConditions,
  type BugFilterCondition,
} from '../src/components/bug-filter.ts'
import type { TestBug } from '../src/test-workbench-types.ts'

const baseBug: TestBug = {
  actualResult: '页面返回 500',
  assigneeName: '开发甲',
  assigneeUserId: 11,
  comments: [],
  createdAt: '2026-08-04T12:30:00.000Z',
  environment: 'Chrome 128',
  expectedResult: '保存成功',
  id: 6,
  priority: 'high',
  reporterName: '测试乙',
  reporterUserId: 12,
  reproductionSteps: '打开页面并保存',
  severity: 'critical',
  status: 'assigned',
  testPlanId: 22,
  testPlanName: '8 月回归',
  testSpaceId: 30,
  testSpaceName: '控制台',
  testSubjectId: 21,
  testSubjectName: '用户管理',
  title: '保存用户时报错',
  updatedAt: '2026-08-04T13:00:00.000Z',
}

function condition(
  field: BugFilterCondition['field'],
  operator: BugFilterCondition['operator'],
  value: string,
): BugFilterCondition {
  return { field, id: `${field}-${operator}`, operator, value }
}

test('bug filters match linked test fields and people by stable ids', () => {
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('testSubject', 'equals', '21'),
    condition('testPlan', 'equals', '22'),
    condition('reporter', 'equals', '12'),
    condition('assignee', 'equals', '11'),
  ], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('testSubject', 'equals', '99'),
    condition('testPlan', 'equals', '22'),
  ], 'and'), false)
})

test('bug filters support status, text, date range, and or matching', () => {
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('status', 'equals', 'assigned'),
    condition('title', 'contains', '用户'),
    condition('createdAt', 'between', '2026-08-01..2026-08-05'),
  ], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('severity', 'equals', 'minor'),
    condition('environment', 'contains', 'chrome'),
  ], 'or'), true)
})

test('bug filters distinguish unassigned and unplanned bugs', () => {
  const unassignedBug: TestBug = {
    ...baseBug,
    assigneeName: undefined,
    assigneeUserId: undefined,
    testPlanId: undefined,
    testPlanName: undefined,
  }
  assert.equal(matchesBugFilterConditions(unassignedBug, [
    condition('assignee', 'is_empty', ''),
    condition('testPlan', 'is_empty', ''),
  ], 'and'), true)
  assert.equal(matchesBugFilterConditions(baseBug, [
    condition('assignee', 'is_empty', ''),
  ], 'and'), false)
})
