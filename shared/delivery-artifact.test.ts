import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeOfflinePackageUrl, offlinePackageFileName } from './delivery-artifact.ts'

test('accepts HTTPS offline package URLs without changing signed queries', () => {
  const signed = 'https://downloads.example.com/app.tar?signature=a%2Bb&expires=123'
  assert.deepEqual(normalizeOfflinePackageUrl(signed), { valid: true, value: signed })
})

test('rejects unsafe offline package URL forms', () => {
  for (const value of [
    '',
    'ftp://downloads.example.com/app.tar',
    'http://10.0.0.8/releases/app.tar',
    'https://user:pass@downloads.example.com/app.tar',
    'javascript:alert(1)',
    'https://downloads.example.com/app.tar\n--quiet',
  ]) {
    assert.equal(normalizeOfflinePackageUrl(value).valid, false)
  }
})

test('derives a shell-safe archive name without mutating the source URL', () => {
  assert.equal(offlinePackageFileName('https://example.com/releases/admin%20bundle.tar?token=x', 0), 'admin-bundle.tar')
  assert.equal(offlinePackageFileName('https://example.com/', 2), 'offline-package-3.tar')
})
