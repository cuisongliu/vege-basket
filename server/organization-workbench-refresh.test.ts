import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workbenchSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)

test('organization weekly collection does not reload from whole detail object refreshes', () => {
  assert.match(workbenchSource, /const weeklyOrganizationId = detail\?\.id \?\? 0/u)
  assert.match(workbenchSource, /const canManageWeeklyReports = detail\?\.canManageWeeklyReports \?\? false/u)
  assert.match(workbenchSource, /fetchWeeklyReportCollection\(weeklyOrganizationId, weekStart\)/u)
  assert.match(workbenchSource, /\}, \[canManageWeeklyReports, weekStart, weeklyOrganizationId\]\)/u)
  assert.match(workbenchSource, /weeklyCollectionLoading && !weeklyCollection/u)
  assert.doesNotMatch(workbenchSource, /weeklyCollectionLoading \? <EmptyRow/u)
})

test('organization detail loading cannot render the empty organization state early', () => {
  assert.match(workbenchSource, /const \[detailLoading, setDetailLoading\] = useState\(false\)/u)
  assert.match(workbenchSource, /setDetailLoading\(nextId !== 0\)/u)
  assert.match(workbenchSource, /if \(!detail && \(loading \|\| detailLoading\)\)/u)
})

test('organization weekly reports use the previous week until its deadline', () => {
  assert.match(workbenchSource, /getWeeklyReportTargetWeekStart\(\{ now, rules, weekStartsOn \}\)/u)
  assert.match(workbenchSource, /const weekStart = reportWeekStart\(/u)
})
