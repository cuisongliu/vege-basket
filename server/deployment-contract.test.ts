import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
const sealosTemplate = readFileSync(
  new URL('../.sealos/template/index.yaml', import.meta.url),
  'utf8',
)

test('runtime image installs production dependencies from the canonical lockfile', () => {
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('FROM node:24-alpine AS runtime'))

  assert.match(runtimeStage, /COPY package\.json package-lock\.json \.\//u)
  assert.match(runtimeStage, /npm ci --omit=dev/u)
  assert.doesNotMatch(runtimeStage, /printf[\s\S]*?"dependencies"/u)
})

test('Sealos application and digest worker share one required immutable image input', () => {
  assert.match(
    sealosTemplate,
    /VEGES_IMAGE:[\s\S]*?immutable linux\/amd64 image tag or digest[\s\S]*?required: true/iu,
  )
  assert.equal(sealosTemplate.match(/\$\{\{ inputs\.VEGES_IMAGE \}\}/gu)?.length, 3)
  assert.doesNotMatch(
    sealosTemplate,
    /ghcr\.io\/felixqiu014-wq\/vege-basket:/u,
  )
})

test('Sealos does not grant system administration to a predictable default username', () => {
  const adminInput = sealosTemplate.slice(
    sealosTemplate.indexOf('VEGES_ADMIN_USERNAMES:'),
    sealosTemplate.indexOf('AI_API_BASE:'),
  )
  assert.match(adminInput, /default: ''/u)
  assert.doesNotMatch(adminInput, /default: admin/u)
})

test('Sealos bounds application and digest worker database pools separately', () => {
  assert.match(sealosTemplate, /name: DB_POOL_CONNECTION_TIMEOUT_MS\s+value: '3000'/u)
  assert.match(sealosTemplate, /name: DB_POOL_IDLE_TIMEOUT_MS\s+value: '30000'/u)
  assert.equal(sealosTemplate.match(/name: DB_POOL_MAX\s+value: '10'/gu)?.length, 1)
  assert.equal(sealosTemplate.match(/name: DB_POOL_MAX\s+value: '2'/gu)?.length, 1)
})
