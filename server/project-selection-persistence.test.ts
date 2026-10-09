import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const organizationWorkbenchSource = readFileSync(
  new URL('../src/components/organization-workbench.tsx', import.meta.url),
  'utf8',
)

test('project basket selection is restored after a browser refresh', () => {
  assert.match(appSource, /const selectedProjectStorageKey = 'veges\.selectedProject\.v1'/u)
  assert.match(appSource, /useState<number \| null>\(\(\)\s*=>\s*loadStoredSelectedProjectId\(\),?\s*\)/u)
  assert.match(appSource, /localStorage\.setItem\(selectedProjectStorageKey, String\(selectedProjectId\)\)/u)
  assert.match(appSource, /const preferredProjectId = current \?\? loadStoredSelectedProjectId\(\)/u)
})

test('project basket defaults to active projects while preserving explicit status filters', () => {
  assert.match(appSource, /useState<ProjectStatus \| 'all'>\('active'\)/u)
  assert.match(appSource, /const matchesStatus = statusFilter === 'all' \|\| project\.status === statusFilter/u)
  assert.match(appSource, /<SelectItem value="all">全部<\/SelectItem>/u)
  assert.match(appSource, /<SelectItem value="paused">暂停<\/SelectItem>/u)
  assert.match(appSource, /<SelectItem value="completed">已结束<\/SelectItem>/u)
  assert.match(appSource, /<SelectItem value="archived">归档<\/SelectItem>/u)
})

test('project basket hides non-open todos by default while preserving explicit status filters', () => {
  const todoListStart = appSource.indexOf('function TodoList(')
  const todoListSource = appSource.slice(todoListStart)

  assert.ok(todoListStart >= 0)
  assert.match(todoListSource, /const hasExplicitStatusFilter = todoFilterConditions\.some\(\(condition\) => condition\.field === 'status'\)/u)
  assert.match(todoListSource, /const useDefaultOpenFilter = !todoFilterPersistenceEnabled && !hasExplicitStatusFilter/u)
  assert.match(todoListSource, /\(!useDefaultOpenFilter \|\| compact \|\| todo\.todoStatus === 'open'\)/u)
})

test('personal project basket restores its own creation entry while organization creation stays managed', () => {
  assert.match(appSource, /isNewProjectDialogOpen/u)
  assert.match(appSource, /function NewProjectForm\(/u)
  assert.match(appSource, /selectedOrganizationId === null/u)
  assert.match(appSource, /<DialogTitle>新建项目<\/DialogTitle>/u)
  assert.match(organizationWorkbenchSource, /\{detail\.canManageProjects \? \(/u)
  assert.match(organizationWorkbenchSource, /<DialogTitle>新建项目<\/DialogTitle>/u)
  assert.match(organizationWorkbenchSource, /await createProject\(\{/u)
})
