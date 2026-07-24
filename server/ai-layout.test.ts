import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const appCss = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

function getRule(selector: string) {
  const ruleStart = appCss.indexOf(`${selector} {`)
  assert.notEqual(ruleStart, -1, `Missing CSS rule: ${selector}`)

  const bodyStart = appCss.indexOf('{', ruleStart) + 1
  const bodyEnd = appCss.indexOf('}', bodyStart)
  return appCss.slice(bodyStart, bodyEnd)
}

function getDeclaration(rule: string, property: string) {
  const match = rule.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*([^;]+);`, 'u'))
  assert.ok(match, `Missing CSS declaration: ${property}`)
  return match[1].trim()
}

function getVerticalPadding(value: string) {
  const parts = value.split(/\s+/u)
  return [parts[0], parts.length < 3 ? parts[0] : parts[2]]
}

test('aligns the workspace and artifact header borders', () => {
  const workspaceHeader = getRule('.veges-ai-toolbar')
  const artifactHeader = getRule('.veges-ai-artifacts-header')

  assert.equal(
    getDeclaration(artifactHeader, 'min-height'),
    getDeclaration(workspaceHeader, 'min-height'),
  )
  assert.deepEqual(
    getVerticalPadding(getDeclaration(artifactHeader, 'padding')),
    getVerticalPadding(getDeclaration(workspaceHeader, 'padding')),
  )
})
