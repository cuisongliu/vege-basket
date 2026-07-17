# Runbook

## Prerequisites

- Node.js 24 and npm.
- PostgreSQL for any API runtime. Use a disposable development database locally.
- Alibaba OSS credentials only when testing package-market or todo-image workflows.
- Encryption keys generated and stored outside Git.
- A company-owned Feishu custom application whose availability scope is restricted to
  intended internal users before using OAuth as the shared-AI account bootstrap path.

Use `.env.example` as a shape reference. Never commit `.env`, access keys, session
tokens, database URLs with credentials, or encryption material.

## Read-Only Verification

These commands do not connect to or mutate PostgreSQL:

```bash
npm ci
npm run build
npm run lint
npm test
git diff --check
```

For a scoped backend change, also run:

```bash
npx eslint server/index.ts server/package-market.ts server/project-package-timeline.ts server/schema.ts
```

Do not use `npm run dev:api`, `npm run db:init`, or `npm run db:encrypt-existing` as a
read-only check. Importing the running API validates encryption config and applies
`server/schema.ts` to `DATABASE_URL`.

`npm run worker:todo-digest` is also not a read-only check. It creates and updates digest
runs and may send personal Feishu messages. Run it only with an authorized database,
configured Feishu application, and explicit permission to deliver messages.

## Local Runtime

Only after selecting a disposable database and authorizing database writes:

```bash
npm run dev:api
npm run dev
```

The API listens on `PORT` (default `8787`); Vite serves the client and proxies `/api` to
`http://127.0.0.1:8787` during local development. A minimal runtime probe is:

```bash
curl --fail --silent http://127.0.0.1:8787/api/health
```

Expected response: `{"ok":true}`. This health endpoint proves the process is serving;
it does not prove database, OSS, Feishu, or AI workflows.

## Database Operations

`npm run db:init` applies the current idempotent schema. `npm run db:encrypt-existing`
applies the schema and encrypts supported legacy plaintext fields. Both are mutating
operations and require explicit approval, a current backup or snapshot, the intended
`DATABASE_URL`, and the complete encryption key ring.

Before an encryption-key change:

1. Back up the database and the current key ring separately.
2. Add the new key to `APP_ENCRYPTION_KEYS` and make its ID active.
3. Keep every old key needed by existing envelopes. Changing the active key does not
   re-encrypt old ciphertext.
4. Verify representative old and new records before removing any key. Do not remove an
   old key while its key ID exists in stored envelopes.

## Deployment

Production images are `linux/amd64` unless ARM is explicitly requested. A release
operator should:

1. Run the read-only verification commands.
2. Build and publish an immutable amd64 tag.
3. Set `originImageName`, the application container `image`, and the todo-digest CronJob
   `image` in `.sealos/template/index.yaml` to the same verified tag.
4. Pass database, encryption, shared AI, Feishu, and OSS configuration through the
   deployment environment; confirm real credential values are absent from the image and Git.
5. Deploy to a test environment first, then verify health, sign-in, one authorized
   project read, and any changed integration.
   For Feishu OAuth, re-check the custom application's availability scope is limited to
   the intended company users; the server treats successful OAuth as internal identity.
6. Re-read the live application image digest and the CronJob template image. Do not infer
   deployment success from `.sealos/build/build-result.json` or `.sealos/state.json` alone.
7. For the digest workflow, verify the CronJob schedule, one completed Job, and the run
   record in an authorized test database before enabling a real user's subscription.

Useful preflight checks:

```bash
docker buildx build --platform linux/amd64 --load -t vege-basket:verify .
rg -n 'originImageName:|^[[:space:]]+image:' .sealos/template/index.yaml
```

Publishing an image or mutating a cluster requires explicit authorization.

## Rollback

Application rollback means restoring the previous immutable amd64 image in both the
application Deployment and todo-digest CronJob while retaining the current database and
all encryption keys. Suspend the CronJob first when the incident involves duplicate or
incorrect digest delivery. Because startup DDL has no down migration, an image rollback
is safe only when the previous server can read the current schema.

If a release performed an incompatible data change, stop writes and restore the
pre-release database snapshot together with the previous image. Never run ad hoc reverse
SQL against production. After rollback, verify `/api/health`, authentication, an old
encrypted record, and the workflow that triggered rollback.

## Troubleshooting

- Startup fails with `DATABASE_URL is required`: inject a PostgreSQL URL; do not use a
  production URL for local verification.
- Startup reports an encryption-key mismatch: ensure the active ID names a 32-byte
  base64 key in `APP_ENCRYPTION_KEYS` and retain keys for older envelopes.
- Package market fails: verify the HTTPS OSS origin, bucket credentials, bundled or
  configured rules file, and allowed object-key roots.
- Todo image upload fails: verify OSS config, upload size/type, and the URL-signing secret
  or its documented fallback.
- AI returns 503: verify `AI_API_BASE`, `AI_API_KEY`, and `AI_MODEL` are all present in the
  application environment. The URL must be HTTPS and resolve only to public addresses.
- Veges AI rejects a text attachment message as too long: split the input or reduce the
  attachments. The composer enforces both its attachment limits and the effective
  `AI_MAX_MESSAGE_LENGTH` returned by `GET /api/ai/status`; raising the provider limit
  requires a deliberate deployment configuration change.
- AI reports that its base URL is not public: inspect the system DNS result. Hostnames
  mapped by a local proxy to `198.18.0.0/15` are rechecked through public DNS-over-HTTPS;
  if that verification fails, restore access to `https://cloudflare-dns.com` or exclude
  the provider hostname from Fake-IP mode. Literal and ordinary private addresses are
  intentionally rejected.
- Password registration returns 403 while AI is enabled: use a current project invite or
  sign in through Feishu OAuth; existing password accounts can still log in normally.
- Daily digest is not sent: verify the user subscription is enabled, the user has a bound
  Feishu `open_id`, `FEISHU_DELIVERY_ENABLED` is not `false`, the CronJob uses the current
  image, and the latest digest run is not `failed` or `skipped`.
- Feishu callback returns 401: verify the callback token matches
  `FEISHU_VERIFICATION_TOKEN`; challenge payloads are authenticated too.
- Unexpected users can complete Feishu OAuth: narrow the company custom application's
  availability scope before re-enabling sign-in; Veges does not maintain a second tenant
  or email-domain allowlist.
