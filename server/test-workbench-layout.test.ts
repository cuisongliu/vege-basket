import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const testWorkbenchCss = readFileSync(new URL('../src/components/test-workbench.css', import.meta.url), 'utf8')

function getRule(selector: string) {
  const ruleStart = testWorkbenchCss.indexOf(`${selector} {`)
  assert.notEqual(ruleStart, -1, `Missing CSS rule: ${selector}`)

  const bodyStart = testWorkbenchCss.indexOf('{', ruleStart) + 1
  const bodyEnd = testWorkbenchCss.indexOf('}', bodyStart)
  return testWorkbenchCss.slice(bodyStart, bodyEnd)
}

function getDeclaration(rule: string, property: string) {
  const match = rule.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([^;]+);`, 'u'))
  assert.ok(match, `Missing CSS declaration: ${property}`)
  return match[1].trim()
}

test('keeps Bug comment attachment previews fully inside the viewport', () => {
  const dialog = getRule('.test-evidence-preview-dialog')
  const shell = getRule('.test-evidence-preview-shell')
  const media = getRule('.test-evidence-preview-media')

  assert.equal(getDeclaration(dialog, 'overflow'), 'visible')
  assert.equal(getDeclaration(shell, 'overflow'), 'visible')
  assert.equal(getDeclaration(media, 'width'), 'auto')
  assert.equal(getDeclaration(media, 'height'), 'auto')
  assert.match(getDeclaration(media, 'max-width'), /100vw/u)
  assert.match(getDeclaration(media, 'max-height'), /100dvh/u)
  assert.equal(getDeclaration(media, 'object-fit'), 'contain')
})
