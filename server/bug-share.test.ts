import assert from 'node:assert/strict'
import test from 'node:test'
import { hashBugShareToken } from './organization-policy.ts'
import { schemaSql } from './schema.ts'

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
