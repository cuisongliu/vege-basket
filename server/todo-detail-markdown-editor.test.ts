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
