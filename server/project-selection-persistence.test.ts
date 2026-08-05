import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('project basket selection is restored after a browser refresh', () => {
  assert.match(appSource, /const selectedProjectStorageKey = 'veges\.selectedProject\.v1'/u)
  assert.match(appSource, /useState<number \| null>\(\(\)\s*=>\s*loadStoredSelectedProjectId\(\),?\s*\)/u)
  assert.match(appSource, /localStorage\.setItem\(selectedProjectStorageKey, String\(selectedProjectId\)\)/u)
  assert.match(appSource, /const preferredProjectId = current \?\? loadStoredSelectedProjectId\(\)/u)
})
