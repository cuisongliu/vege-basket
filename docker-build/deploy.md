# Container Build Receipt

Generated on 2026-07-25 at 00:45 China Standard Time.

## Image

Image: ghcr.io/felixqiu014-wq/vege-basket:20260725-004429

Digest: sha256:f5e1fe96c0b157c02ff2cb5a2ef773f8133d6abfbeb96beae25ea1ebdabe568d

Platform: linux/amd64

## Required Runtime Configuration

- DATABASE_URL
- APP_ENCRYPTION_ACTIVE_KEY_ID
- APP_ENCRYPTION_KEYS

Optional AI, Feishu, OSS, package-market, and digest settings remain documented in
docs/references.md.

## Runtime

The container listens on port 8787 and starts with node server/index.ts.
Startup applies the idempotent PostgreSQL schema before accepting traffic.

No container startup or database validation was performed during this build because the
packaging request did not authorize database writes. The image contents and remote
linux/amd64 manifest were verified without starting the application.
