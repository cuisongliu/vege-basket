import assert from 'node:assert/strict'
import test from 'node:test'
import { isPackageMarketObjectKeyAllowedForRule, type PackageMarketRule } from './package-market.ts'
import {
  canonicalPackageMarketRuleId,
  defaultOrganizationPackageMarketPolicy,
  filterPackageMarketRules,
  isPackageMarketRuleVisible,
  mergeOrganizationPackageMarketPolicy,
  normalizeOrganizationPackageMarketRuleIds,
  organizationPackageMarketPolicyHasVisibleChannel,
  packageMarketDependencyChannel,
  packageMarketRuleSupportsChannel,
  type OrganizationPackageMarketPolicy,
} from '../shared/organization-package-market.ts'
import { schemaSql } from './schema.ts'

const rules = [
  { id: 'sealos-pro', category: 'apps' as const, parent: '' },
  { id: 'sealos-oss', category: 'apps' as const, parent: '' },
  { id: 'offline-center', category: 'apps' as const, parent: '' },
  { id: 'devbox-runtime', category: 'dependency' as const, parent: 'devbox' },
  { id: 'devbox', category: 'apps' as const, parent: '' },
]

function policy(overrides: Partial<OrganizationPackageMarketPolicy> = {}): OrganizationPackageMarketPolicy {
  return {
    ...defaultOrganizationPackageMarketPolicy,
    ...overrides,
    channels: {
      ...defaultOrganizationPackageMarketPolicy.channels,
      ...overrides.channels,
    },
  }
}

test('canonicalizes base package rule ids for organization selections', () => {
  assert.equal(canonicalPackageMarketRuleId('sealos-pro'), 'base-pro')
  assert.equal(canonicalPackageMarketRuleId('sealos-oss'), 'base-oss')
  assert.deepEqual(normalizeOrganizationPackageMarketRuleIds(['sealos-pro', 'base-pro', 'devbox']), [
    'base-pro',
    'devbox',
  ])
})

test('selected mode can expose exactly one package and its dependency', () => {
  const next = policy({
    channels: {
      release: { enabled: true, mode: 'selected', ruleIds: ['devbox'] },
      ci: { enabled: false, mode: 'all', ruleIds: [] },
    },
  })
  assert.deepEqual(
    filterPackageMarketRules(rules, next, 'release').map((rule) => rule.id),
    ['devbox-runtime', 'devbox'],
  )
  assert.equal(isPackageMarketRuleVisible(rules[0], next, 'release'), false)
})

test('release and ci policies are independent', () => {
  const next = policy({
    channels: {
      release: { enabled: true, mode: 'selected', ruleIds: ['sealos-pro'] },
      ci: { enabled: false, mode: 'all', ruleIds: [] },
    },
  })
  assert.equal(isPackageMarketRuleVisible(rules[0], next, 'release'), true)
  assert.equal(isPackageMarketRuleVisible(rules[0], next, 'ci'), false)
  assert.equal(isPackageMarketRuleVisible(rules[2], next, 'release'), false)
})

test('dependency visibility follows its own channel and the parent selection', () => {
  const ciDependency = { ...rules[3], dependencyRoots: ['offline/ci/'] }
  assert.equal(packageMarketDependencyChannel(ciDependency), 'ci')
  const releaseOnly = policy({
    channels: {
      release: { enabled: true, mode: 'selected', ruleIds: ['devbox'] },
      ci: { enabled: false, mode: 'all', ruleIds: [] },
    },
  })
  assert.equal(isPackageMarketRuleVisible(ciDependency, releaseOnly, 'release'), false)
  assert.equal(isPackageMarketRuleVisible(ciDependency, releaseOnly, 'ci'), false)
  const ciSelected = policy({
    channels: {
      release: { enabled: true, mode: 'selected', ruleIds: ['devbox'] },
      ci: { enabled: true, mode: 'selected', ruleIds: ['devbox'] },
    },
  })
  assert.equal(isPackageMarketRuleVisible(ciDependency, ciSelected, 'ci'), true)
})

test('an empty selected policy has no visible channel', () => {
  const next = policy({
    channels: {
      release: { enabled: true, mode: 'selected', ruleIds: [] },
      ci: { enabled: false, mode: 'all', ruleIds: [] },
    },
  })
  assert.equal(organizationPackageMarketPolicyHasVisibleChannel(next), false)
})

test('base OSS does not advertise a CI channel', () => {
  assert.equal(packageMarketRuleSupportsChannel('base-oss', 'release'), true)
  assert.equal(packageMarketRuleSupportsChannel('base-oss', 'ci'), false)
})

test('rule selection input is bounded and rejects unsafe identifiers', () => {
  assert.equal(normalizeOrganizationPackageMarketRuleIds('devbox'), null)
  assert.equal(normalizeOrganizationPackageMarketRuleIds(['bad/id']), null)
  assert.equal(normalizeOrganizationPackageMarketRuleIds(Array.from({ length: 501 }, () => 'devbox')), null)
})

test('organization package-market schema keeps feature and channel policies separate', () => {
  assert.match(schemaSql, /create table if not exists organization_feature_settings/u)
  assert.match(schemaSql, /create table if not exists organization_package_market_channel_policies/u)
  assert.match(schemaSql, /create table if not exists organization_package_market_selections/u)
  assert.match(schemaSql, /channel in \('release', 'ci'\)/u)
  assert.match(schemaSql, /mode in \('all', 'selected'\)/u)
})

test('missing policy fields resolve to enabled all-channel defaults', () => {
  const merged = mergeOrganizationPackageMarketPolicy({
    channels: { release: { enabled: false } },
  })
  assert.equal(merged.enabled, true)
  assert.equal(merged.channels.release.enabled, false)
  assert.equal(merged.channels.release.mode, 'all')
  assert.equal(merged.channels.ci.enabled, true)
})

test('package item object keys stay bound to the claimed package rule and channel', () => {
  const allowedRule: PackageMarketRule = {
    id: 'allowed',
    name: 'allowed',
    category: 'apps',
    mode: 'release',
    releaseRoots: ['offline/sealos-apps/allowed/release/'],
    flatFileRoots: [],
    dependencyRoots: [],
    dependencyFilePatterns: [],
    fileNameFormats: ['allowed-cluster-%s-%s.tar.gz'],
    ciFileNameFormats: ['allowed-cluster-main-%s-%s.tar.gz'],
    flatFileNamePrefix: '',
    flatFileNameSuffix: '',
    flatFileNameSuffixes: [],
    parent: '',
  }
  const hiddenRule: PackageMarketRule = {
    ...allowedRule,
    id: 'hidden',
    name: 'hidden',
    releaseRoots: ['offline/sealos-apps/hidden/release/'],
    fileNameFormats: ['hidden-cluster-%s-%s.tar.gz'],
  }
  const rules = [allowedRule, hiddenRule]
  assert.equal(
    isPackageMarketObjectKeyAllowedForRule({
      channel: 'release',
      objectKey: 'offline/sealos-apps/allowed/release/v5.1.2/allowed-cluster-v5.1.2-amd64.tar.gz',
      packageId: 'allowed',
      rules,
    }),
    true,
  )
  assert.equal(
    isPackageMarketObjectKeyAllowedForRule({
      channel: 'release',
      objectKey: 'offline/sealos-apps/hidden/release/v5.1.2/hidden-cluster-v5.1.2-amd64.tar.gz',
      packageId: 'allowed',
      rules,
    }),
    false,
  )
  assert.equal(
    isPackageMarketObjectKeyAllowedForRule({
      channel: 'ci',
      objectKey: 'offline/sealos-apps/allowed/ci/main/882f04e/allowed-cluster-main-882f04e-amd64.tar.gz',
      packageId: 'allowed',
      rules,
    }),
    true,
  )
  assert.equal(
    isPackageMarketObjectKeyAllowedForRule({
      channel: 'release',
      objectKey: 'offline/sealos-apps/allowed/ci/main/882f04e/allowed-cluster-main-882f04e-amd64.tar.gz',
      packageId: 'allowed',
      rules,
    }),
    false,
  )
})
