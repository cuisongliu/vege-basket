import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deliveryValuesRoot,
  maxDeliveryOtherScriptLength,
  normalizeDeliveryOther,
  normalizeDeliveryRuntimeConfig,
  normalizeOfflinePackageUrl,
  offlinePackageFileName,
} from './delivery-artifact.ts'

test('accepts an optional shell script as other delivery content', () => {
  assert.deepEqual(normalizeDeliveryOther({ type: 'shell-script', content: 'set -eu\necho ready' }), {
    valid: true,
    value: { type: 'shell-script', content: 'set -eu\necho ready' },
  })
  assert.deepEqual(normalizeDeliveryOther(null), { valid: true, value: null })
})

test('rejects unsupported other delivery methods and invalid shell scripts', () => {
  for (const value of [
    { type: 'python', content: 'print(1)' },
    { type: 'shell-script', content: '' },
    { type: 'shell-script', content: 'echo \u0001' },
  ]) {
    assert.equal(normalizeDeliveryOther(value).valid, false)
  }
})

test('supports shell scripts up to 256 KiB', () => {
  assert.equal(normalizeDeliveryOther({
    type: 'shell-script',
    content: 'x'.repeat(maxDeliveryOtherScriptLength),
  }).valid, true)
  assert.equal(normalizeDeliveryOther({
    type: 'shell-script',
    content: 'x'.repeat(maxDeliveryOtherScriptLength + 1),
  }).valid, false)
})

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

test('accepts item-level environment variables and a YAML values overlay', () => {
  assert.deepEqual(normalizeDeliveryRuntimeConfig({
    environmentVariables: [{ name: 'REGION', value: 'cn-shanghai' }],
    valuesPath: `${deliveryValuesRoot}/admin/values.yaml`,
    valuesPatch: 'replicaCount: 3\nimage:\n  tag: v2',
  }), {
    valid: true,
    value: {
      environmentVariables: [{ name: 'REGION', value: 'cn-shanghai' }],
      valuesPath: `${deliveryValuesRoot}/admin/values.yaml`,
      valuesPatch: 'replicaCount: 3\nimage:\n  tag: v2',
    },
  })
})

test('rejects values paths outside the fixed sealos directory', () => {
  for (const valuesPath of [
    deliveryValuesRoot,
    `${deliveryValuesRoot}-other/app.yaml`,
    `${deliveryValuesRoot}/../secrets/app.yaml`,
    '/etc/passwd',
    'relative/values.yaml',
  ]) {
    assert.equal(normalizeDeliveryRuntimeConfig({ valuesPath }).valid, false)
  }
})

test('requires a Values path and YAML overlay together', () => {
  assert.deepEqual(normalizeDeliveryRuntimeConfig({
    environmentVariables: [],
    valuesPath: '/root/.sealos/cloud/values/app.yaml',
    valuesPatch: '',
  }), {
    error: '填写 Values 文件地址后必须填写 YAML 修改内容。',
    valid: false,
  })
})

test('rejects duplicate variables, control characters, and invalid YAML overlays', () => {
  assert.equal(normalizeDeliveryRuntimeConfig({
    environmentVariables: [{ name: 'REGION', value: 'one' }, { name: 'REGION', value: 'two' }],
  }).valid, false)
  assert.equal(normalizeDeliveryRuntimeConfig({
    environmentVariables: [{ name: 'BAD-NAME', value: 'one' }],
  }).valid, false)
  assert.equal(normalizeDeliveryRuntimeConfig({
    environmentVariables: [{ name: 'REGION', value: 'one\ntwo' }],
  }).valid, false)
  assert.equal(normalizeDeliveryRuntimeConfig({
    valuesPath: `${deliveryValuesRoot}/app.yaml`,
    valuesPatch: 'items: [',
  }).valid, false)
  assert.equal(normalizeDeliveryRuntimeConfig({ valuesPatch: 'replicas: 2' }).valid, false)
})
