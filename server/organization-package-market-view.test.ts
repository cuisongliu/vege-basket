import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterOrganizationPackageMarketRules,
  organizationPackageMarketPoliciesEqual,
  paginateOrganizationPackageMarketRules,
  toggleOrganizationPackageMarketRule,
} from '../src/organization-package-market-view.ts'
import type { OrganizationPackageMarketCatalogRule } from '../src/organization-types.ts'
import { defaultOrganizationPackageMarketPolicy } from '../shared/organization-package-market.ts'

const rules: OrganizationPackageMarketCatalogRule[] = [
  {
    canonicalId: 'terminal',
    category: 'apps',
    ciFileNameFormats: [],
    ciSupported: true,
    ciVisible: true,
    dependencyFilePatterns: [],
    dependencyRoots: [],
    fileNameFormats: [],
    flatFileRoots: [],
    id: 'terminal',
    mode: 'release',
    name: 'Sealos Terminal',
    releaseRoots: [],
    releaseVisible: true,
    selectable: true,
  },
  {
    canonicalId: 'registry',
    category: 'middleware',
    ciFileNameFormats: [],
    ciSupported: true,
    ciVisible: true,
    dependencyFilePatterns: [],
    dependencyRoots: [],
    fileNameFormats: [],
    flatFileRoots: [],
    id: 'registry',
    mode: 'release',
    name: 'Sealos Registry',
    releaseRoots: [],
    releaseVisible: true,
    selectable: true,
  },
  {
    canonicalId: 'base-oss',
    category: 'apps',
    ciFileNameFormats: [],
    ciSupported: false,
    ciVisible: false,
    dependencyFilePatterns: [],
    dependencyRoots: [],
    fileNameFormats: [],
    flatFileRoots: [],
    id: 'sealos-oss',
    mode: 'release',
    name: 'Sealos OSS',
    releaseRoots: [],
    releaseVisible: true,
    selectable: true,
  },
  {
    canonicalId: 'terminal-runtime',
    category: 'dependency',
    ciFileNameFormats: [],
    ciSupported: true,
    ciVisible: true,
    dependencyFilePatterns: [],
    dependencyRoots: ['offline/ci/'],
    fileNameFormats: [],
    flatFileRoots: [],
    id: 'terminal-runtime',
    mode: 'release',
    name: 'Terminal Runtime',
    parent: 'terminal',
    releaseRoots: [],
    releaseVisible: true,
    selectable: false,
  },
]

test('package market catalog filters by channel, category, query, and selection', () => {
  assert.deepEqual(
    filterOrganizationPackageMarketRules(rules, { channel: 'ci' }).map((rule) => rule.canonicalId),
    ['terminal', 'registry'],
  )
  assert.deepEqual(
    filterOrganizationPackageMarketRules(rules, {
      category: 'middleware',
      channel: 'release',
      query: 'REGISTRY',
    }).map((rule) => rule.canonicalId),
    ['registry'],
  )
  assert.deepEqual(
    filterOrganizationPackageMarketRules(rules, {
      channel: 'release',
      onlySelected: true,
      selectedIds: ['terminal'],
    }).map((rule) => rule.canonicalId),
    ['terminal'],
  )
})

test('package market pagination clamps the requested page and keeps a stable page size', () => {
  const page = paginateOrganizationPackageMarketRules(['a', 'b', 'c'], 4, 2)
  assert.deepEqual(page, {
    items: ['c'],
    page: 2,
    pageSize: 2,
    totalItems: 3,
    totalPages: 2,
  })
  assert.equal(paginateOrganizationPackageMarketRules(['a'], 1, 0).pageSize, 12)
})

test('package market selection toggles one stable rule id at a time', () => {
  assert.deepEqual(toggleOrganizationPackageMarketRule([], 'terminal'), ['terminal'])
  assert.deepEqual(toggleOrganizationPackageMarketRule(['terminal', 'registry'], 'terminal'), ['registry'])
})

test('package market policy equality ignores selection ordering', () => {
  const left = {
    ...defaultOrganizationPackageMarketPolicy,
    channels: {
      ...defaultOrganizationPackageMarketPolicy.channels,
      release: { enabled: true, mode: 'selected' as const, ruleIds: ['registry', 'terminal'] },
    },
  }
  const right = {
    ...left,
    channels: {
      ...left.channels,
      release: { ...left.channels.release, ruleIds: ['terminal', 'registry'] },
    },
  }
  assert.equal(organizationPackageMarketPoliciesEqual(left, right), true)
})
