import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  parseOrganizationContext,
  serializeOrganizationContext,
} from '../shared/organization-context.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('parses only canonical organization contexts', () => {
  assert.equal(parseOrganizationContext('personal'), null)
  assert.equal(parseOrganizationContext(' 12 '), 12)
  assert.equal(parseOrganizationContext(''), undefined)
  assert.equal(parseOrganizationContext('0'), undefined)
  assert.equal(parseOrganizationContext('01'), undefined)
  assert.equal(parseOrganizationContext('1.5'), undefined)
  assert.equal(parseOrganizationContext(['12']), undefined)
})

test('serializes personal and organization contexts for API requests', () => {
  assert.equal(serializeOrganizationContext(null), 'personal')
  assert.equal(serializeOrganizationContext(12), '12')
})

test('personal project navigation keeps only daily work entries visible', () => {
  assert.match(appSource, /selectedOrganizationId !== null \? \(\s*<NavButton active=\{view === 'weekly_report'\}/u)
  assert.match(appSource, /selectedOrganizationId !== null \? \(\s*<NavGroup label="协作与交付"/u)
  assert.match(appSource, /selectedOrganizationId !== null && isOrganizationAdmin/u)
  assert.match(appSource, /<MyWorkWorkbench\s+key=\{selectedOrganizationId \?\? 'personal'\}\s+organizationId=\{selectedOrganizationId\}\s+projects=\{scopedProjects\}/u)
})
