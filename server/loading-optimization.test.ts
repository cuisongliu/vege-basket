import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const organizationClientSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)
const organizationServerSource = readFileSync(new URL('./organizations.ts', import.meta.url), 'utf8')
const testClientSource = readFileSync(
  new URL('../src/components/test-workbench.tsx', import.meta.url),
  'utf8',
)
const testServerSource = readFileSync(new URL('./test-workbench.ts', import.meta.url), 'utf8')

test('role and view changes do not invalidate unrelated application data', () => {
  assert.doesNotMatch(appSource, /workspaceHydratedRef/u)
  assert.match(
    appSource,
    /\[applyCanonicalAiTurnOutcome, authUserId, loggedIn, replaceAiConversationTurns\]/u,
  )
  assert.match(appSource, /\[authUserId, loggedIn, organizationRefreshVersion\]/u)
  assert.match(appSource, /initialOrganizations=\{organizations\}/u)
})

test('test workbench sections are opt-in and merged without replacing unloaded data', () => {
  assert.match(testServerSource, /if \(value === undefined\) return undefined/u)
  assert.match(testServerSource, /const includes = \(section: TestWorkbenchSection\) => !sections \|\| sections\.has\(section\)/u)
  assert.match(testServerSource, /const workbenchQuery = createLimitedQuery\(\)/u)
  assert.match(testServerSource, /loadedSections: sections \? \[\.\.\.sections\] : undefined/u)
  assert.match(testClientSource, /mergeTestWorkbenchData/u)
  assert.match(testClientSource, /sections: initialSections/u)
  assert.match(testClientSource, /caseScopeRef/u)
  assert.match(testClientSource, /'core',\s*'notifications',\s*\.\.\.testWorkbenchSectionsForTab/u)
  assert.match(testClientSource, /caseScopeRef\.current = 'all'/u)
  assert.match(testClientSource, /if \(tab === 'bugs'\) return \['bugs', 'cases'\]/u)
  assert.match(testClientSource, /if \(tab === 'plans'\) return \['plans', 'cases'\]/u)
  assert.match(testServerSource, /end as actionable/u)
})

test('organization sections preserve the complete default and avoid multiplied counts', () => {
  assert.match(organizationServerSource, /if \(value === undefined\) return undefined/u)
  assert.match(organizationServerSource, /!sections \|\| candidates\.some/u)
  assert.match(organizationServerSource, /const detailQuery = createLimitedQuery\(\)/u)
  assert.match(organizationServerSource, /loadedSections: sections \? \[\.\.\.sections\] : undefined/u)
  assert.doesNotMatch(organizationServerSource, /left join test_plans p on p\.test_space_id = s\.id/u)
  assert.doesNotMatch(organizationServerSource, /left join test_bugs b on b\.test_space_id = s\.id/u)
  assert.match(organizationClientSource, /mergeOrganizationDetail/u)
})
