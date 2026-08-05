import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveExistingOperationInteraction } from '../src/project-package-operation-access.ts'

const workbenchSource = readFileSync(
  new URL('../src/components/project-package-workbench.tsx', import.meta.url),
  'utf8',
)
const timelineSource = readFileSync(
  new URL('./project-package-timeline.ts', import.meta.url),
  'utf8',
)
const indexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

test('published event and package documents remain openable for read-only viewing', () => {
  assert.deepEqual(resolveExistingOperationInteraction(false), {
    disabled: false,
    readOnly: true,
  })
})

test('draft event documents remain openable for editing', () => {
  assert.deepEqual(resolveExistingOperationInteraction(true), {
    disabled: false,
    readOnly: false,
  })
})

test('published operation documents keep todo management without restoring document mutations', () => {
  const todoActionPattern = /\{canManageProject \? \(\s*<div className="operation-entry-actions">[\s\S]*?aria-label="关联待办"[\s\S]*?\{canManageTimeline \? \(\s*<DeleteConfirmDialog/gu
  assert.equal([...workbenchSource.matchAll(todoActionPattern)].length, 2)
  assert.match(
    timelineSource,
    /const operation = await findOperationMeta\([\s\S]*?if \(!operation\)[\s\S]*?if \(operation\.published_at && updates\.length > 0\)[\s\S]*?Published events are read-only/u,
  )
})

test('existing operation todo management opens without a default filter', () => {
  const openTodoDialogSource = workbenchSource.slice(
    workbenchSource.indexOf('function openOperationTodoDialog'),
    workbenchSource.indexOf('function clearOperationTodoDialogState'),
  )
  assert.match(openTodoDialogSource, /setTodoDialogSearch\(''\)/u)
  assert.match(openTodoDialogSource, /setTodoFilterConditions\(\[\]\)/u)
  assert.match(openTodoDialogSource, /setTodoFilterJoin\('and'\)/u)
  assert.doesNotMatch(openTodoDialogSource, /createTodoFilterCondition/u)
})

test('event wizard keeps the stepper below its compact header without a return-list action', () => {
  const headerSource = workbenchSource.slice(
    workbenchSource.indexOf('<header className="event-wizard-header">'),
    workbenchSource.indexOf('<div className="event-wizard-steps-row">'),
  )
  const editorTopSource = workbenchSource.slice(
    workbenchSource.indexOf('<header className="event-wizard-header">'),
    workbenchSource.indexOf('<div className="event-wizard-content">'),
  )
  assert.match(headerSource, /event-wizard-heading/u)
  assert.doesNotMatch(headerSource, /event-wizard-steps/u)
  assert.match(editorTopSource, /<\/header>[\s\S]*event-wizard-main[\s\S]*event-wizard-steps-row[\s\S]*event-wizard-steps/u)
  assert.match(editorTopSource, /item\.step <= eventEditorStep \? 'reached'/u)
  assert.doesNotMatch(headerSource, /返回列表/u)
})

test('selecting a draft event opens its summary instead of the editor', () => {
  const listSelectionSource = workbenchSource.slice(
    workbenchSource.indexOf('function selectEventFromList'),
    workbenchSource.indexOf('function openOperationDialog'),
  )
  const imperativeSelectionSource = workbenchSource.slice(
    workbenchSource.indexOf('selectEvent: (eventId: number) => {'),
    workbenchSource.indexOf('  }))', workbenchSource.indexOf('selectEvent: (eventId: number) => {')),
  )
  assert.doesNotMatch(listSelectionSource, /openDraftEventEditor/u)
  assert.match(listSelectionSource, /setEventEditorOpen\(false\)/u)
  assert.doesNotMatch(imperativeSelectionSource, /openDraftEventEditor/u)
})

test('deleting the edited event closes its editor and advances to the next visible event', () => {
  const deletionSource = workbenchSource.slice(
    workbenchSource.indexOf('async function deleteEventFromList'),
    workbenchSource.indexOf('function openOperationDialog'),
  )
  assert.match(deletionSource, /visibleEvents\[deletedIndex \+ 1\]/u)
  assert.match(deletionSource, /visibleEvents\[deletedIndex - 1\]/u)
  assert.match(deletionSource, /const deleted = await onDeleteEvent\(event\.id\)/u)
  assert.match(deletionSource, /if \(!deleted \|\| !deletingActiveEvent\) return/u)
  assert.match(deletionSource, /setEventEditorOpen\(false\)/u)
  assert.match(deletionSource, /setEventEditorEventId\(null\)/u)
  assert.match(workbenchSource, /onConfirm=\{\(\) => deleteEventFromList\(event\)\}/u)
})

test('event wizard keeps optional todo associations scoped to each step-three document', () => {
  const stepThreeSource = workbenchSource.slice(
    workbenchSource.indexOf('{eventEditorStep === 3 ? ('),
    workbenchSource.indexOf('<footer className="event-wizard-footer">'),
  )
  assert.match(stepThreeSource, /<strong>关联待办<\/strong>/u)
  assert.match(stepThreeSource, /关联结果仅应用于当前文档/u)
  assert.match(stepThreeSource, /documentTodoFilterSummary/u)
  assert.match(stepThreeSource, /<TodoFilterBuilderDialog/u)
  assert.match(stepThreeSource, /conditions=\{documentTodoFilterConditions\}/u)
  assert.match(
    workbenchSource,
    /documentTodoFilterConditions, setDocumentTodoFilterConditions\] = useState<TodoFilterCondition\[\]>\(\[\]\)/u,
  )
  assert.match(workbenchSource, /relatedTodoIds: eventDocumentRelatedTodoIds/u)
  assert.match(workbenchSource, /relatedTodoIds: document\?\.relatedTodoIds \?\? \[\]/u)
  assert.match(workbenchSource, /event-wizard-footer-actions[\s\S]*event-wizard-navigation[\s\S]*event-wizard-save-actions/u)
})

test('aggregate event save validates and persists document todo links transactionally', () => {
  assert.match(indexSource, /relatedTodoIds: Array\.isArray\(value\.relatedTodoIds\)/u)
  assert.match(
    timelineSource,
    /return withTransaction\(async \(client\) => \{\s*await ensureProjectTodoIds\([\s\S]*?let eventId = params\.eventId/u,
  )
  assert.match(
    timelineSource,
    /insert into project_package_operations[\s\S]*?returning id[\s\S]*?replaceOperationTodoLinks\(/u,
  )
})
