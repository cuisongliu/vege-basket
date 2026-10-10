import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateAdaptiveListPageSize } from '../src/list-pagination.ts'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const adaptivePageSizeSource = appSource.slice(
  appSource.indexOf('function useAdaptivePageSize('),
  appSource.indexOf('\nconst today =', appSource.indexOf('function useAdaptivePageSize(')),
)

test('adaptive list page size uses stable viewport geometry', () => {
  assert.equal(calculateAdaptiveListPageSize({
    containerTop: 140,
    itemHeight: 70,
    maxPageSize: 14,
    minPageSize: 2,
    pagerHeight: 48,
    reservedHeight: 24,
    viewportHeight: 900,
  }), 9)
})

test('adaptive list page size remains within configured bounds', () => {
  assert.equal(calculateAdaptiveListPageSize({
    containerTop: 780,
    itemHeight: 70,
    maxPageSize: 14,
    minPageSize: 2,
    pagerHeight: 48,
    reservedHeight: 24,
    viewportHeight: 800,
  }), 2)
  assert.equal(calculateAdaptiveListPageSize({
    containerTop: 0,
    itemHeight: 70,
    maxPageSize: 14,
    minPageSize: 2,
    viewportHeight: 2_000,
  }), 14)
})

test('adaptive pagination does not derive page size from content-driven parent height', () => {
  assert.match(adaptivePageSizeSource, /calculateAdaptiveListPageSize/u)
  assert.doesNotMatch(adaptivePageSizeSource, /parentRect|parentElement\?\.getBoundingClientRect/u)
})
