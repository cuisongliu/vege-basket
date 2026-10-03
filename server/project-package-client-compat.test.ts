import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeProjectPackageTimelineRuntimeConfigs } from '../src/api.ts'
import type { ProjectPackageTimeline } from '../src/types.ts'

test('normalizes runtime configuration omitted by an older API replica', () => {
  const timeline = {
    events: [{
      containerImages: [{ id: 1, image: 'ghcr.io/example/app:v1' }],
      groups: [{ items: [{ id: 2 }], operations: [] }],
      offlinePackages: [{ id: 3, url: 'https://example.com/app.tar' }],
    }],
  } as unknown as ProjectPackageTimeline

  const normalized = normalizeProjectPackageTimelineRuntimeConfigs(timeline)
  assert.deepEqual(normalized.events[0].containerImages[0].runtimeConfig, {
    environmentVariables: [],
    valuesPatch: '',
    valuesPath: '',
  })
  assert.deepEqual(normalized.events[0].groups[0].items[0].runtimeConfig, {
    environmentVariables: [],
    valuesPatch: '',
    valuesPath: '',
  })
  assert.deepEqual(normalized.events[0].offlinePackages[0].runtimeConfig, {
    environmentVariables: [],
    valuesPatch: '',
    valuesPath: '',
  })
})

test('rejects malformed runtime configuration from the API boundary', () => {
  const timeline = {
    events: [{
      containerImages: [{
        id: 1,
        image: 'ghcr.io/example/app:v1',
        runtimeConfig: { environmentVariables: [], valuesPath: '/tmp/values.yaml', valuesPatch: 'a: 1' },
      }],
      groups: [],
      offlinePackages: [],
    }],
  } as unknown as ProjectPackageTimeline

  assert.throws(
    () => normalizeProjectPackageTimelineRuntimeConfigs(timeline),
    /Values 文件必须是 \/root\/\.sealos\/cloud\/values\//u,
  )
})
