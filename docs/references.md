# Reference

## Source Map

| Concern | Source of truth |
| --- | --- |
| Scripts and dependency roles | `package.json`, `package-lock.json` |
| Browser API and AI stream contracts | `src/api.ts`, `src/types.ts`, `shared/ai-conversation-wire.ts`, `shared/server-sent-events.ts` |
| WYSIWYG Markdown editor contract | `src/components/markdown-wysiwyg-editor.tsx`, `src/App.css` |
| HTTP routes and authorization | `server/index.ts` |
| Database schema | `server/schema.ts` |
| Encryption format | `server/crypto.ts` |
| Shared AI provider and limits | `server/ai-provider.ts`, `server/ai-rate-limit.ts` |
| AI summary/proposal contracts | `server/ai-period-summary.ts`, `server/ai-todo-proposals.ts` |
| AI workspace-review facts and source lineage | `server/ai-workspace-review.ts`, `server/ai-workspace-review-store.ts`, `server/ai-conversation-store.ts` |
| Todo proposal review defaults and confirmation insert | `src/todo-proposal-defaults.ts`, `server/ai-todo-confirmation.ts` |
| AI conversations and turn lifecycle | `server/ai-conversations.ts`, `server/ai-conversation-store.ts`, `server/ai-turn-stream.ts`, `shared/ai-input-intent.ts` |
| Daily digest schedule and worker | `server/todo-digest.ts`, `server/todo-digest-worker.ts` |
| Package timeline transactions | `server/project-package-timeline.ts` |
| OSS rules and URL signing | `server/package-market.ts`, `server/trial-combo-package-rules.yaml` |
| Container runtime | `Dockerfile` |
| Sealos install surface | `.sealos/template/index.yaml` |

## Environment Variables

Required for server startup:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `APP_ENCRYPTION_ACTIVE_KEY_ID` | Key ID used for new AES-256-GCM writes. |
| `APP_ENCRYPTION_KEYS` | Comma-separated `key-id:base64-key` ring; each key is 32 bytes. |

Core and AI controls:

| Variable | Default / behavior |
| --- | --- |
| `PORT` | `8787`. |
| `AI_API_BASE` | Shared OpenAI-compatible HTTPS public base URL; `198.18.0.0/15` proxy Fake-IP answers require successful public DNS-over-HTTPS verification. |
| `AI_API_KEY` | Shared provider key; required to enable AI and never returned to the browser. |
| `AI_MODEL` | Shared provider model name; required to enable AI. |
| `AI_RATE_LIMIT` | `5` requests per user per in-memory window. |
| `AI_GLOBAL_RATE_LIMIT` | `30` total requests per application replica per window. |
| `AI_RATE_WINDOW_MS` | `60000`. |
| `AI_MAX_MESSAGE_LENGTH` | `2000` characters. |
| `AI_MAX_CONTEXT_CHARS` | `12000` characters. |

AI provider URL, key, and model are deployment-level environment variables shared by all
authenticated users. There is no user-level AI settings table or API. With all three
provider variables configured, password registration requires an active project invite;
Feishu OAuth remains the internal identity path. The rate limiter is replica-local, so a
future multi-replica deployment needs a shared quota or upstream budget policy.

Feishu integration:

| Variable | Purpose |
| --- | --- |
| `FEISHU_APP_ID`, `FEISHU_APP_SECRET` | OAuth, identity lookup, message fetch, and delivery. |
| `FEISHU_OAUTH_REDIRECT_URI` | Explicit OAuth callback URL; otherwise derived from the request origin. |
| `FEISHU_OAUTH_STATE_SECRET` | OAuth state signing secret; falls back to app secret or encryption key ring. |
| `FEISHU_VERIFICATION_TOKEN` | Required token for `/api/integrations/feishu/events`. |
| `FEISHU_WEBHOOK_USER_EMAIL` | Veges account receiving conversation-analysis output. |
| `FEISHU_WEBHOOK_BASIC_USER`, `FEISHU_WEBHOOK_BASIC_PASSWORD` | Basic credentials for the conversation-analysis webhook. |
| `FEISHU_DELIVERY_ENABLED` | Set to `false` to disable outbound notification delivery. |

`FEISHU_ENCRYPT_KEY` is declared in deployment metadata but is not consumed by the
current server.

Successful Feishu OAuth is treated as internal identity and may create a user without a
project invite. The Feishu custom application's availability scope must therefore be
restricted to the intended company users; Veges has no separate tenant/domain allowlist.

OSS and package market:

| Variable | Default / behavior |
| --- | --- |
| `OSS_ENDPOINT` | Required HTTPS origin when OSS features are used. |
| `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_BUCKET` | OSS credentials and bucket. |
| `PACKAGE_MARKET_RULES_FILE` | Defaults to `server/trial-combo-package-rules.yaml`. |
| `PACKAGE_MARKET_MIDDLEWARE_ROOT` | Allowed middleware prefix. |
| `PACKAGE_MARKET_BASE_OBJECT_TEMPLATE` | Exact base-package object template. |
| `PACKAGE_MARKET_BASE_LIST_PREFIX_TEMPLATE` | Versioned base-package listing prefix. |
| `PACKAGE_MARKET_DOWNLOAD_EXPIRE_SECONDS` | Default signed URL lifetime; fallback is 30 minutes. |
| `TODO_IMAGE_UPLOAD_MAX_BYTES` | Default `10485760` bytes. |
| `TODO_IMAGE_OBJECT_PREFIX` | Default `todo-images`. |
| `TODO_IMAGE_URL_SECRET` | HMAC secret; falls back to OAuth state secret or encryption key ring. |

Compatibility aliases remain accepted for `OSS_UI_MIDDLEWARE_ROOT`,
`OSS_UI_BASE_OBJECT_TEMPLATE`, `OSS_UI_BASE_LIST_PREFIX_TEMPLATE`,
`OSS_UI_DOWNLOAD_EXPIRE_SECONDS`, and `TRIAL_COMBO_PACKAGE_RULES_FILE`. New deployments
should use the `PACKAGE_MARKET_*` names.

## HTTP API Families

Protected JSON endpoints use `Authorization: Bearer <session-token>`. The primary route
families are:

| Family | Routes |
| --- | --- |
| Health | `GET /api/health` (public) |
| Authentication | `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/password`, `/api/auth/feishu/oauth/*` |
| Workspace | `GET /api/workspace`, `GET /api/notifications`, notification read/dismiss routes, `GET/PUT /api/notification-subscription` |
| Projects | `/api/projects`, journals, risks, modules, invitations, invite links, Feishu project settings, `GET /api/projects/:projectId/todo-activity` |
| Todos | `/api/todos`, todo notes, `POST /api/todo-images`, signed `GET /api/todo-images` |
| Drafts and summaries | `/api/drafts`, draft archive/delete, `/api/summaries` |
| Package market | `/api/package-market/rules`, package details, release versions, CI versions |
| Package timeline | `/api/projects/:projectId/package-timeline/*`, package-item download URLs and timeline export |
| AI | `GET /api/ai/status`, `GET /api/ai/conversations`, `GET/POST /api/ai/conversations/:conversationId/turns`, `POST .../turns/:turnId/retry`, `POST .../turns/:turnId/cancel`, `POST .../turns/:turnId/reconcile`, `PATCH/DELETE /api/ai/conversations/:conversationId`, `POST /api/projects/:projectId/summaries`, todo-proposal read/confirm routes |
| Feishu webhooks | `/api/integrations/feishu/conversation-analysis`, `/api/integrations/feishu/events` |

Authentication and authorization rules are defined in `server/index.ts`; route presence
does not imply every project member can perform every action. Nested resource lookups
must remain bound to the authorized project ID.

## Data And Status Contracts

- Project status: `active`, `paused`, `completed`, `archived`.
- Todo priority: `high`, `medium`, `low`.
- Todo confirmation: `confirmed`, `rejected`.
- Todo activity event: `created`, `assigned`, `confirmed`, `rejected`, `completed`, `reopened`.
- Todo proposal batch: `pending`, `confirmed`, `discarded`; proposal item: `pending`, `accepted`, `rejected`.
- AI conversation context: `general`, `project`, `conversation-analysis`; AI turn intent:
  `chat`, `project-summary`, `workspace-review`, `todo-extraction`,
  `conversation-analysis`; AI turn status: `processing`, `completed`, `failed`,
  `cancelled`.
- Daily digest run: `pending`, `processing`, `retry`, `sent`, `failed`, `skipped`.
- Package event type: `init`, `upgrade`.
- Package event status: `draft`, `delivering`, `delivered`.
- Package operation kind: `document`, `event`.
- Package operation status: `pending`, `success`, `failed`.
- Package market channel: `release`, `ci`.
- Supported todo images: PNG, JPEG, WebP, GIF.
- Package download expiry choices: 30, 60, 90, 120, 300, or 600 minutes.

`GET /api/ai/status` returns `configured`, `model`, and the effective positive
`maxMessageLength`; the browser uses that limit to reject an oversized composed message
before the provider can silently trim it. Veges AI text attachments are read locally and
sent with one turn rather than uploaded to a separate object route. The server encrypts the
original name and content; turn responses contain attachment metadata but never content.
The composer accepts at most four supported text files, 64 KiB each and 20,000 combined
attachment characters; the effective message limit may be lower.

Conversation list pagination uses an opaque `(lastTurnAt, id)` cursor and returns newest
activity first. Turn pagination uses `beforeTurn` and returns each page oldest-to-newest for
rendering. A new conversation is created
lazily by the first `POST .../turns`, using browser-generated UUIDs for the conversation and
turn. Repeating the same turn UUID with identical content is idempotent; reusing it with a
different payload is `409`. Project conversations are visible only while the user owns or is
an active member of that project. Rename accepts 1-80 characters. Deleting a conversation is
permanent for its chat history and linked pending proposal batches, but does not delete saved
summaries, processed proposal audit batches, or already-created todos. The deleted UUID remains
reserved by a server tombstone, so delayed requests receive `404` instead of recreating it.

The unified turn endpoint records ordinary replies and routes explicit project summary,
workspace review, Markdown todo extraction, and conversation-analysis intent through the same
timeline. Turn creation and retry accept `text/event-stream` and emit ordered `started`, `delta`,
`progress`, `heartbeat`, `completed`, `failed`, or `cancelled` events with a positive `sequence`.
The `started` event declares `text` or `progress` mode. Text mode is used for chat and
conversation analysis; project summaries, workspace reviews, and todo extraction emit only
`preparing`, `generating`, `validating`, or `saving` progress until a canonical terminal result.
Heartbeats are sent every 10 seconds. A non-SSE JSON response remains accepted by the browser
only after the same runtime turn-result validation.

An explicit current-day or current-week progress-review request in a general conversation is
classified as `workspace-review`. It accepts no attachment and no project binding. The backend
loads all projects the caller owns or actively belongs to, the caller's own period journals,
authorized todo activity, visible open todos, and current risks. Project owners receive the
project-wide todo and risk scope; members receive only their own journals plus todo facts where
they are actor or assignee. Fact lists are bounded to 200 displayed projects, 300 journals, 500
todo events, 500 open todos, and 300 risks; the true authorized project count is retained and
bounded lists are labeled as samples. The generated response is completed as assistant text and
does not create a summary artifact. Ordinary `chat` never receives this implicit workspace
context. With a selected project, the same natural wording stays in that project conversation
instead of broadening to workspace scope; historical or capability questions remain ordinary
chat.

Ordinary model requests time out after 45 seconds, structured project summary, workspace review,
or todo extraction after 90 seconds, and a processing lease lasts 120 seconds.
`finish_reason: length`, a stream that ends without a valid terminal marker, or an otherwise
truncated provider response fails with `AI_RESPONSE_INCOMPLETE`; partial content is never
committed as a completed turn.
First responses and idempotent replays use the same stable summary or proposal-batch reference;
the browser refreshes the workspace or fetches the batch to open the artifact. Confirmed and
discarded proposal batches reopen read-only, and confirmed reads expose accepted candidates
instead of their rejected source copies. Project-context confirmation cannot move a candidate
to another project and rechecks project, module, assignee, and caller access in the write
transaction. The server supplies at most three prior completed turns (six messages) plus the
current user input to the provider.

Project-bound AI writes and project deletion share `ai-project:<projectId>` advisory lock
keys; multi-project proposal confirmation acquires IDs in ascending order.

Each completed workspace review records every source project in `ai_turn_project_sources` in the
same transaction as its assistant content. Completion locks source projects in numeric order and
rechecks ownership or active membership before committing. Source rows deliberately retain the
numeric project ID without a project foreign key, so deleting a project preserves the lineage
needed to deny future reads. Turn pagination, direct turn reads, reconcile, idempotent replay, and
later model history all hide a workspace-review turn while any source project is deleted or no
longer accessible. Restoring active access to every retained source makes the turn readable
again. Deleting the conversation cascades its source rows; deleting the conversation does not
remove independent summaries or already-created todos.

`POST .../reconcile` returns the canonical conversation and requested turn, and atomically marks
an expired processing lease as `failed` with `AI_REQUEST_STALE`; an active or terminal turn is
unchanged. Cancel and start share the conversation advisory lock plus a per-user cancellation
lock. A cancel that arrives before the turn
creates a short-lived, per-user claim (at most 20 current claims); the delayed start observes
that stable rejection and returns `AI_REQUEST_CANCELLED` before persistence or provider
execution. Replays remain cancelled for the claim's 10-minute lifetime.
`POST /api/ai/chat` and the old `POST /api/ai/todo-proposals` remain temporarily as
compatibility responses for an already-open old SPA. Both return
`AI_CLIENT_UPGRADE_REQUIRED` with a refresh instruction and do not call the provider or
create data.

Project-bound daily and weekly AI summaries are generated from authorized period facts and saved
immediately as summary documents. Workspace reviews remain conversation text and are not saved
as summary documents. Markdown ingestion accepts `.md` content only; AI may
infer project, module, assignee, due date, priority, title, and detail, but project and due
date must be resolved before selected proposals can be confirmed in one transaction. When
an editable pending candidate has no inferred due date, the browser initializes its review
field to the current `Asia/Shanghai` calendar date. An inferred date is preserved, and
confirmed or discarded history never receives a synthetic date.

The daily digest subscription is Feishu-only, defaults to disabled at `10:00`
`Asia/Shanghai`, and sends previous-day completion/reopen activity plus the current
outstanding backlog at delivery time. Users may change the send time. Disconnecting
Feishu disables the subscription.

Errors use JSON `{ "error": "..." }`. Common status codes are 400 for invalid input,
401 for missing or invalid authentication, 403 for insufficient role, 404 for absent or
inaccessible resources, 409 for state conflicts, 413 for an oversized Markdown/AI
context, 415 for unsupported image media, 429 for AI throttling, and 503 for an
unconfigured dependency.

Package-item batch failures additionally return `code`, `requestId`, and `details`.
`details.phase` is one of `validate_object_keys`, `persist_package_items`, or
`read_package_timeline`; database failures may include safe `databaseCode`, `constraint`,
`table`, `column`, and redacted `databaseDetail` fields. Responses never include a stack,
raw SQL, credentials, encryption material, or unknown exception messages.
