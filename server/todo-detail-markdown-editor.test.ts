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
const todoEditorDialogSource = appSource.slice(
  appSource.indexOf('function TodoEditorDialog('),
  appSource.indexOf('function TodoList('),
)
const todoListSource = appSource.slice(appSource.indexOf('function TodoList('))
const todoWorkHoursPanelSource = readFileSync(
  new URL('../src/components/todo-work-hours-panel.tsx', import.meta.url),
  'utf8',
)
const workHoursCssSource = readFileSync(
  new URL('../src/components/work-hours-workbench.css', import.meta.url),
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
  assert.match(appSource, /onAddTodo: \(projectId: number\) => Promise<boolean>/u)
})

test('todo details remove the standalone note editor while preserving legacy history', () => {
  assert.match(todoEditorDialogSource, /const showNotesSidebar = false/u)
  assert.doesNotMatch(todoEditorDialogSource, /onCreateNote=\{onCreateTodoNote\}/u)
  assert.doesNotMatch(todoEditorDialogSource, /onUpdateNote=\{onUpdateTodoNote\}/u)
  assert.match(todoEditorDialogSource, /历史补充信息/u)
  assert.match(todoEditorDialogSource, /TodoNoteContent value=\{note\.content\}/u)
})

test('todo creation uses a modal and status filtering has one merged field', () => {
  assert.match(appSource, /<Dialog open onOpenChange=\{\(open\) => \{ if \(!open\) closeTodoCreateDialog\(\) \}\}>/u)
  assert.match(appSource, /className="todo-create-dialog"/u)
  assert.match(appSource, /field === 'status'/u)
  assert.doesNotMatch(appSource, /field === 'confirmationStatus'/u)
  assert.doesNotMatch(appSource, /field === 'done'/u)
  assert.match(todoEditorDialogSource, /待办标题[\s\S]*field-required[\s\S]*优先级/u)
  assert.match(todoEditorDialogSource, /预估工时（小时）[\s\S]*field-required/u)
})

test('project basket keeps work-hour recording in the current project surface', () => {
  assert.match(appSource, /function selectMyWorkHour\(projectId: number, todoId: number\)[\s\S]*?setProjectDetailTab\('tasks'\)[\s\S]*?setView\('project'\)/u)
  assert.match(appSource, /recorderOnly[\s\S]*recorderRequest=\{workHourRecorderContext\}/u)
  const workHoursSource = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')
  assert.match(workHoursSource, /recorderRequest\?: .*projectId: number; todoId: number.*null/u)
  assert.match(workHoursSource, /onRecorderDismiss\?: \(\) => void/u)
  assert.match(workHoursSource, /openRecorderForTodo\(recorderRequest.todoId, recorderRequest.projectId\)/u)
  assert.match(appSource, /workHourRecorderContext &&[\s\S]*view !== 'project'[\s\S]*selectedProjectId !== workHourRecorderContext.projectId/u)
  assert.match(appSource, /workHourRecorderContext\?\.projectId === selectedProject.id/u)
})

test('task work-hour details have an independent paginated scroll surface', () => {
  const workHoursSource = readFileSync(new URL('../src/components/work-hours-workbench.tsx', import.meta.url), 'utf8')
  assert.match(workHoursSource, /fetchTodoWorkHours\(selectedTaskId, \{[\s\S]*?cursor: selectedTaskEntryPage \* 10[\s\S]*?limit: 10/u)
  assert.match(workHoursSource, /任务投入明细分页/u)
  assert.match(workHoursSource, /setSelectedTaskEntryPage\(\(page\) => Math.min\(page, Math.max\(0, Math.ceil\(total \/ 10\) - 1\)\)\)/u)
  assert.match(workHoursCssSource, /work-hours-drawer-list \{[^}]*overflow-y: auto/u)
})

test('project detail keeps tabs and task actions in one aligned bar', () => {
  assert.match(appSource, /className="project-detail-tabbar"/u)
  assert.match(appSource, /className="project-detail-tab-actions"/u)
  const appCssSource = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')
  assert.match(
    appCssSource,
    /project-detail-tabbar[\s\S]*display: flex[\s\S]*project-detail-tabs[\s\S]*flex: 1 1 auto/u,
  )
  assert.match(appCssSource, /detail-layout\.packages-mode \.project-detail-main \{\s*grid-column: 1 \/ -1;/u)
})

test('project work-hour layout grows with content instead of forcing a fixed panel height', () => {
  assert.match(appSource, /detail-layout work-hours-mode/u)
  assert.match(
    readFileSync(new URL('../src/App.css', import.meta.url), 'utf8'),
    /detail-layout\.work-hours-mode[\s\S]*?height: auto;[\s\S]*?overflow: visible/u,
  )
  assert.match(workHoursCssSource, /work-hours-workbench\.mode-project[^}]*height: auto/u)
  assert.match(workHoursCssSource, /work-hours-overview-chart, \.work-hours-overview-members \{ min-height: 0; \}/u)
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
  assert.match(todoWorkHoursPanelSource, /工时验收/u)
  assert.match(todoWorkHoursPanelSource, /提交工时验收/u)
})
