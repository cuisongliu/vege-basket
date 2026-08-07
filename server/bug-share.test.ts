import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hashBugShareToken } from './organization-policy.ts'
import { schemaSql } from './schema.ts'

const bugShareSource = readFileSync(new URL('./bug-share.ts', import.meta.url), 'utf8')
const bugShareDialogSource = readFileSync(
  new URL('../src/components/bug-share-dialog.tsx', import.meta.url),
  'utf8',
)

test('Bug share tokens are deterministic one-way digests', () => {
  const token = 'share-token-for-test'
  assert.equal(hashBugShareToken(token), hashBugShareToken(token))
  assert.notEqual(hashBugShareToken(token), token)
})

test('Bug share schema keeps raw tokens encrypted and links revocable', () => {
  assert.match(schemaSql, /create table if not exists bug_share_links/i)
  assert.match(schemaSql, /token_hash text not null unique/i)
  assert.match(schemaSql, /token_encrypted text not null/i)
  assert.match(schemaSql, /where revoked_at is null/i)
})

test('Bug share creation bounds database waits while retaining the authorization row lock', () => {
  assert.match(bugShareSource, /set local lock_timeout/u)
  assert.match(bugShareSource, /set local statement_timeout/u)
  assert.match(bugShareSource, /for update of b/u)
})

test('Bug share links fall back to a same-site path when no public origin is configured', () => {
  assert.match(bugShareSource, /return origin \? `\$\{origin\}\$\{path\}` : path/u)
  assert.doesNotMatch(bugShareSource, /Public sharing is not configured/u)
})

test('Bug share dialog ignores a stale link request after its Bug or open state changes', () => {
  assert.match(bugShareDialogSource, /const requestIdRef = useRef\(0\)/u)
  assert.match(bugShareDialogSource, /requestIdRef\.current !== requestId/u)
  assert.match(bugShareDialogSource, /requestIdRef\.current \+= 1/u)
})
