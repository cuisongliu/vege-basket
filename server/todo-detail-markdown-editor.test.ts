import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const editorSource = readFileSync(
  new URL('../src/components/markdown-wysiwyg-editor.tsx', import.meta.url),
  'utf8',
)
const todoDetailEditorSource = appSource.slice(
  appSource.indexOf('function TodoDetailEditor('),
  appSource.indexOf('function TodoDetailViewer('),
)
const todoNotesPanelSource = appSource.slice(
  appSource.indexOf('function TodoNotesPanel('),
  appSource.indexOf('function TodoPropertiesPanel('),
)
const todoEditorDialogSource = appSource.slice(
  appSource.indexOf('function TodoEditorDialog('),
  appSource.indexOf('function TodoList('),
)
const todoListSource = appSource.slice(appSource.indexOf('function TodoList('))
const todoWorkHoursPanelSource = readFileSync(
  new URL('../src/components/todo-work-hours-panel.tsx', import.meta.url),
  'utf8',
)

test('todo details use the stable shared Markdown editor without a page reload', () => {
  assert.match(
    appSource,
    /import \{\s*MarkdownWysiwygEditor\s*\} from '@\/components\/markdown-wysiwyg-editor'/u,
  )
  assert.doesNotMatch(appSource, /window\.location\.reload\(\)/u)
  assert.match(appSource, /stripMarkdownLinksToText\(content\)/u)
  assert.match(appSource, /stripMarkdownLinksToText\(text\)/u)
  assert.match(todoDetailEditorSource, /<MarkdownWysiwygEditor/u)
  assert.doesNotMatch(todoDetailEditorSource, /<MentionTextarea/u)
  assert.match(
    readFileSync(new URL('../src/App.css', import.meta.url), 'utf8'),
    /todo-detail-block-editing[\s\S]*?markdown-wysiwyg-editor[\s\S]*?height: 100%/u,
  )
})

test('todo detail shows the offboarding transfer source beside the title', () => {
  assert.match(appSource, /offboardingTransferredFromName/u)
  assert.match(todoEditorDialogSource, /todo\?\.offboardingTransferredFromName/u)
  assert.match(todoEditorDialogSource, /-离职转移/u)
  assert.match(todoEditorDialogSource, /todo-status-chip[\s\S]*?offboardingTransferredFromName/u)
})

test('todo detail image pastes stay connected to the existing upload flow', () => {
  assert.match(todoDetailEditorSource, /onPasteImages=/u)
  assert.match(todoDetailEditorSource, /uploadImagesIntoTodoDetail/u)
  assert.match(editorSource, /onPasteCapture=\{handlePasteCapture\}/u)
  assert.match(editorSource, /item\.type\.startsWith\('image\/'\)/u)
  assert.match(editorSource, /event\.stopPropagation\(\)/u)
})

test('shared Markdown editor tolerates an unready Tiptap instance', () => {
  assert.match(editorSource, /if \(!currentEditor\) return null/u)
  assert.match(editorSource, /const safeToolbarState = toolbarState \?\? /u)
  assert.match(editorSource, /if \(!editor\) \{\s*return <div className="markdown-wysiwyg-loading"/u)
  assert.match(editorSource, /if \(!editor \|\| value === lastEmittedMarkdownRef\.current/u)
})

test('opening a todo keeps creation bound to the project that rendered the editor', () => {
  assert.match(appSource, /onAddTodo\(project\.id\)/u)
  assert.match(appSource, /onAddTodo: \(projectId: number\) => void \| Promise<void>/u)
})

test('todo notes remain visible when the viewer has no note write callbacks', () => {
  assert.match(todoEditorDialogSource, /const showNotesSidebar = Boolean\(isDetailMode && todo\)/u)
  assert.doesNotMatch(
    todoEditorDialogSource,
    /const showNotesSidebar[\s\S]{0,160}onCreateTodoNote[\s\S]{0,80}onUpdateTodoNote/u,
  )
  assert.match(todoNotesPanelSource, /onCreateNote\?: \(todoId: number, content: string\)/u)
  assert.match(todoNotesPanelSource, /onUpdateNote\?: \(todoId: number, noteId: number, content: string\)/u)
  assert.match(todoNotesPanelSource, /\{onCreateNote \? \(/u)
  assert.match(todoNotesPanelSource, /<div className="todo-notes-list">/u)
  assert.match(todoNotesPanelSource, /const canEdit = Boolean\(onUpdateNote\)/u)
})

test('assigned enterprise todos expose the work-hour entry with locked context', () => {
  assert.match(todoEditorDialogSource, /todo-detail-work-hour-button/u)
  assert.match(todoEditorDialogSource, /onRecordWorkHour\(project\.id, todo\.id\)/u)
  assert.match(todoListSource, /function canRecordWorkHour\(todo: Todo\)/u)
  assert.match(todoListSource, /!todo\.done/u)
  assert.match(todoListSource, /todo\.confirmationStatus !== 'pending_review'/u)
  assert.match(todoListSource, /todo\.assigneeUserId === currentUserId/u)
  assert.match(
    readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8'),
    /initialProjectId\?: number \| null[\s\S]*?initialTodoId\?: number \| null[\s\S]*?autoOpenRecorder\?: boolean/u,
  )
  assert.match(
    readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8'),
    /setSelectedProjectId\(initialProjectId \?\? project\?\.id \?\? null\)/u,
  )
  assert.match(
    readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8'),
    /recorderContextLocked[\s\S]*?disabled=\{Boolean\(editingEntry\) \|\| recorderContextLocked\}/u,
  )
})

test('todo details expose paginated work-hour review controls without a manual checkbox status', () => {
  assert.match(appSource, /<TodoWorkHoursPanel/u)
  assert.match(appSource, /待办标题[\s\S]*负责人[\s\S]*预估时间[\s\S]*已记录[\s\S]*状态[\s\S]*操作/u)
  const compactTodoSource = todoListSource.slice(
    todoListSource.indexOf("className={compact ? 'todo-list compact todo-workflow-table'"),
    todoListSource.indexOf('            return (', todoListSource.indexOf("className={compact ? 'todo-list compact todo-workflow-table'")),
  )
  assert.doesNotMatch(compactTodoSource, /TodoConfirmSelect/u)
  assert.match(todoWorkHoursPanelSource, /fetchTodoWorkHours\(todo\.id/u)
  assert.match(todoWorkHoursPanelSource, /ListPagination label="待办工时明细分页"/u)
  assert.match(todoWorkHoursPanelSource, /removeWorkHour\(deletingEntry\.id\)/u)
  assert.match(todoWorkHoursPanelSource, /确认提交验收/u)
  assert.match(todoWorkHoursPanelSource, /确认验收通过/u)
})
