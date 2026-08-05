import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const weeklyReportsSource = readFileSync(new URL('./weekly-reports.ts', import.meta.url), 'utf8')

test('organization weekly-report collection excludes the admin username', () => {
  const collectionStart = weeklyReportsSource.indexOf('async function loadCollection')
  const collectionEnd = weeklyReportsSource.indexOf('function buildReminderCard', collectionStart)
  const collectionSource = weeklyReportsSource.slice(collectionStart, collectionEnd)

  assert.notEqual(collectionStart, -1)
  assert.notEqual(collectionEnd, -1)
  assert.match(collectionSource, /and lower\(users\.email\) <> 'admin'/u)
})
