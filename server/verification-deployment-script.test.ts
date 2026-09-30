import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createClusterImageVerificationScript,
  createDeliveryExecutionScript,
  createPackageVerificationScript,
} from './verification-deployment-script.ts'

test('builds a per-archive download and run command without retaining the link', () => {
  const script = createPackageVerificationScript([
    {
      downloadUrl: 'https://download.example.invalid/releases/admin-v1.tar?temporary=true',
      objectKey: 'offline/apps/admin/admin-v1.tar',
    },
  ])
  assert.equal(
    script,
    "wget 'https://download.example.invalid/releases/admin-v1.tar?temporary=true' -O 'admin-v1.tar' && sealos run -f 'admin-v1.tar'",
  )
})

test('builds one deterministic script for object packages, offline URLs, and images', () => {
  assert.equal(
    createDeliveryExecutionScript({
      packages: [{ downloadUrl: 'https://oss.example/app.tar?token=x', objectKey: 'release/app.tar' }],
      offlinePackages: [{ downloadUrl: 'https://downloads.example/app.tar', fileName: 'app.tar' }],
      images: ['ghcr.io/example/worker:v2'],
    }),
    "delivery_dir=\"$(mktemp -d)\" && \\\n" +
      "trap 'rm -rf \"$delivery_dir\"' EXIT && \\\n" +
      "wget 'https://oss.example/app.tar?token=x' -O \"$delivery_dir/app.tar\" && sealos run -f \"$delivery_dir/app.tar\" && \\\n" +
      "wget 'https://downloads.example/app.tar' -O \"$delivery_dir/app-2.tar\" && sealos run -f \"$delivery_dir/app-2.tar\" && \\\n" +
      "sealos run -f 'ghcr.io/example/worker:v2'",
  )
})

test('quotes untrusted delivery addresses and never writes archives into the working directory', () => {
  const script = createDeliveryExecutionScript({
    packages: [],
    offlinePackages: [{
      downloadUrl: "https://example.com/package.tar?value=';$()",
      fileName: '.bashrc',
    }],
    images: [],
  })
  assert.match(script, /delivery_dir="\$\(mktemp -d\)"/u)
  assert.match(script, /-O "\$delivery_dir\/\.bashrc"/u)
  assert.match(script, /value='\\'';\$\(\)/u)
  assert.doesNotMatch(script, /-O '\.bashrc'/u)
})

test('chains multiple cluster images and gives duplicate archive names separate files', () => {
  assert.equal(
    createClusterImageVerificationScript(['ghcr.io/example/admin:v1', 'ghcr.io/example/worker:v1']),
    "sealos run -f 'ghcr.io/example/admin:v1' && \\\nsealos run -f 'ghcr.io/example/worker:v1'",
  )
  assert.match(
    createPackageVerificationScript([
      { downloadUrl: 'https://download.example.invalid/a', objectKey: 'one/admin.tar' },
      { downloadUrl: 'https://download.example.invalid/b', objectKey: 'two/admin.tar' },
    ]),
    /-O 'admin-2\.tar'/u,
  )
})
