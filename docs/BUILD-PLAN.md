# Kick Rocks build plan

This file is the shared contract for everyone building Kick Rocks.
Read `docs/DESIGN.md` first for the why; this file is the what and who.
If this plan and the design disagree, this plan wins and the disagreement should be reported.

## 1. Rules for every agent

### Scope

- Only edit the paths your module owns (section 3).
  Everything else is read-only for you.
- Never change `packages/shared`, `packages/db` (schema or migrations), root configs, or CI unless your module owns them.
- If you need a contract change, do not make it.
  Work around it inside your own paths and list the change under `contractRequests` in your final report, with the exact proposed diff.
- Do not add dependencies unless there is no reasonable alternative.
  If you must, add them to your own package's `package.json` only and list them in your report.

### Tooling

- `export PATH="$HOME/.local/bin:$PATH"` before any pnpm command; pnpm is not on the default PATH.
- In a fresh checkout or worktree run `pnpm install --frozen-lockfile`, then `pnpm data:build`, then `pnpm build`.
  Workspace packages are consumed through their `dist` output, so a package you depend on must be built before your tests can import it.
- Before every commit run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
  All must pass.
  If something outside your paths fails, report it; do not edit it.
- Use the ports and browser session name your prompt assigns, so parallel agents do not collide.
  For `chrome-devtools-axi` set `CHROME_DEVTOOLS_AXI_SESSION=<your session>`.

### Git

- Work on the branch your prompt names.
  Make small, logical commits whose messages explain why.
- Stage files by name, never `git add -A` or `git add .`.
- Never add AI attribution: no `Co-Authored-By` trailers, no "Generated with" lines, no emoji.
- Do not push, rebase, or rewrite history.

### Code style

- TypeScript strict, ESM, Node 22.
  Validate every external input (HTTP bodies, query strings, IMAP data, worker results, dataset files) with zod schemas from `@kickrocks/shared` where one exists.
- Comments explain why, never how.
  If code needs a comment to explain how it works, refactor it.
- Never use the em dash character anywhere: code, comments, docs, UI copy, test names.
- UI copy is plain and short, with no exclamation marks and no emoji.
- Long Markdown files put each sentence on its own line.

### Safety

- Never submit a form on a real broker or company website.
  Loading public pages and reading their DOM is fine, and searching a people-search site for a generic name such as "John Smith" is fine.
- Never send email to a real address.
  Mail tests use GreenMail, which accepts mail for every domain and never relays it.
- Never put real personal data in code, tests, fixtures, or screenshots.
  Use names like "Jordan Example" and domains under `example.com`, `example.org`, or `.test`.
- Never solve or bypass a CAPTCHA, and never add CAPTCHA-solving services or stealth plugins.
  Detect the challenge and block the task for a human.

### Final report

End with a short report: what you built, what you tested and how, the commits on your branch, known gaps, and `contractRequests`.

## 2. Architecture recap

Three processes share one data contract.

- `apps/server` owns all state in an SQLCipher-encrypted SQLite file.
  It serves the REST API for the web UI, runs the scheduler, sends and reads mail, runs the in-process tasks (`email_send`, `inbox_poll`), and exposes browser tasks to the worker over HTTP and to agents over MCP.
- `apps/worker` runs Chrome through Playwright on the user's home connection.
  It claims browser tasks from the server, runs recipes, and never touches the database.
- `apps/web` is the React UI, served by the server in production.

Packages:

- `packages/shared`: zod schemas and types every other part agrees on.
- `packages/db`: Drizzle schema, migrations, and the encrypted connection.
- `packages/brokers`: builds the broker and company datasets from upstream sources.
- `packages/legal`: state privacy law data, legal basis selection, identifier minimization, and email templates.
- `packages/recipes`: recipe files, the recipe loader, and the recipe runner.

## 3. Ownership map

| Module | Branch | Owns |
|---|---|---|
| Foundation backend | main | `packages/shared`, `packages/db`, `packages/recipes/src/loader*`, `apps/server/src/{app,main,config,services}.ts`, `apps/server/src/core/**`, module skeletons, `apps/worker` skeleton, `packages/legal` skeleton, root configs, CI, compose |
| Foundation web | main | `apps/web` shell: router, layout, design tokens, `src/components/ui/**`, `src/api/**`, `mock/` infrastructure, page stubs |
| A auth-profiles | `kr/auth-profiles` | `apps/server/src/modules/{auth,profiles,settings}/**` |
| B mail | `kr/mail` | `apps/server/src/mail/**`, `apps/server/src/modules/mailbox/**` |
| C legal | `kr/legal` | `packages/legal/**` |
| D1 campaigns | `kr/campaigns` | `apps/server/src/modules/{targets,campaigns,requests,dashboard}/**` |
| D2 automation | `kr/automation` | `apps/server/src/{scheduler,runners,handlers}/**`, `apps/server/src/modules/{scans,review}/**` |
| E agent-api | `kr/agent-api` | `apps/server/src/modules/{worker-api,mcp,recipes}/**`, `docs/agents.md` |
| F worker | `kr/worker` | `apps/worker/**` (beyond the skeleton), `packages/recipes/src/runner/**`, `packages/recipes/test/**` |
| G recipes | `kr/recipes` | `packages/recipes/recipes/**` |
| H datasets | `kr/datasets` | `packages/brokers/**` |
| I web-core | `kr/web-core` | `apps/web/src/pages/{setup,login,dashboard,profiles,mailbox,about}/**`, `apps/web/mock/{auth,profiles,mailbox,dashboard,about}.ts` |
| J web-flows | `kr/web-flows` | `apps/web/src/pages/{targets,campaigns,requests,review,settings}/**`, `apps/web/mock/{targets,campaigns,requests,review,settings}.ts` |

Each module's test files live next to its code inside its own paths.

## 4. Contracts built by the foundation

### 4.1 Shared schemas (`packages/shared`)

Every type below is a zod schema plus its inferred type.

**Geography.** `StateCode` is the 50 states plus DC.
`US_STATES` lists code and name.

**Targets.** `Broker` gains these fields:

- `searchUrl: url | null`, where a person finds their own record.
- `requirements: Requirement[]`, from `email_confirmation`, `phone_call`, `id_upload`, `captcha`, `account`, `paid`, `record_url`, `postal_mail`, `fax`.
- `priority: "crucial" | "high" | "normal"`.
- `DataSourceId` adds `badbool` and `kickrocks-companies`; license adds `CC-BY-NC-SA-4.0`.
- `BrokerDataset` carries `license: "CC-BY-NC-SA-4.0"` and an `attribution` string, and `CompanyDataset` carries `license: "PolyForm-Noncommercial-1.0.0"`, because parsing drops any field the schema does not name.
- Every URL field uses `WebUrl` (http or https only), never `z.url()`, which accepts `javascript:` and `data:`.
  `isOnDomain(url, domain)` says whether a URL is on a domain or its subdomains, and `normalizeRecordUrl(url)` gives one spelling to every URL that names the same record.
  Scans, match decisions, and the recipe step that clicks a record all compare record URLs through it.
- `needsRecord({ id, category })` is true for every `people-search` and `background-check` target, except ids listed in `RECORD_NOT_NEEDED`, which starts empty.
  The category decides, not a `record_url` requirement flag, so an import that forgets the flag cannot turn these sites into blind form requests.

`Company` is a target of kind company: id, name, domain, category (`retail`, `finance`, `telecom`, `tech`, `media`, `travel`, `auto`, `health`, `other`), privacyEmail, optOutUrl, privacyRightsUrl, contactMethod, notes, sources, `verifiedAt` date.
`CompanyDataset` mirrors `BrokerDataset`.
`TargetKind` is `broker | company`.

**Identities.** `IdentityKind` is `name | alias | email | phone | address | dob`.
Values by kind:

- name and alias: `{ first, middle?, last }`
- email: `{ address }`
- phone: `{ number }` in E.164
- address: `{ street, unit?, city, state: StateCode, zip }`
- dob: `{ date }` as `YYYY-MM-DD`

An `Identity` is `{ id, kind, value, isPrimary, validFrom: date | null, validTo: date | null }`, validated as a discriminated union on kind.

**Requests.** `RequestRight` is `opt_out | delete`.
A request carries `rights: RequestRight[]` (one email can exercise both).
`RequestStatus` keeps its states, with these transition changes:

- `awaiting_reply -> queued` is allowed, for a channel switch such as a broker answering "use our web form".
- Users may force any non-terminal status to `confirmed`, `no_record`, `rejected`, or `cancelled`; `canTransition(from, to, { actor })` takes the actor (`system | user | worker | agent`) and permits those overrides only for `user`.

`RequestEventType`: `created`, `queued`, `sent`, `send_failed`, `reply_received`, `classified`, `link_followed`, `status_changed`, `follow_up_sent`, `channel_switched`, `task_enqueued`, `task_blocked`, `task_completed`, `task_failed`, `user_action`, `relisted`, `note`.

Every request has a reference `KR-XXXXXX`, six Crockford base32 characters, generated and parsed by helpers in `shared/mail.ts`.

**Mail.** `ReplyClassification`: `bounce`, `auto_ack`, `confirmation_link`, `verification_required`, `completed`, `no_record`, `rejected`, `needs_form`, `unrelated`, `unknown`.
`ProviderPreset`: id, label, smtpHost, smtpPort, smtpSecure, imapHost, imapPort, appPasswordUrl, notes, defaultDailyCap.
Helpers: `formatReference`, `parseReferences(text)`, `outgoingMessageId(requestId, domain)`, `parseOutgoingMessageId(id)`.

**Tasks.** `TaskKind`: `email_send`, `inbox_poll`, `scan`, `form`, `confirm`, `canary`, `agent` (`human_review` is removed; a blocked task is the human queue).
In-process kinds are `email_send` and `inbox_poll`; browser kinds are `scan`, `form`, `confirm`, `canary`, `agent`.
Payload schemas, stored in the database, hold ids only:

- `email_send`: `{ requestId, followUp: boolean }`
- `inbox_poll`: `{ mailboxId }`
- `scan`: `{ profileId, targetId, recipeId: string | null }`
- `form`: `{ requestId, targetId, recipeId: string | null, recordUrl: string | null }`
- `confirm`: `{ requestId, url }`
- `canary`: `{ recipeId }`
- `agent`: `{ purpose: "scan" | "remove", profileId, targetId, requestId: string | null, recordUrl: string | null, reason: "no_recipe" | "recipe_failed", previousError: string | null }`

Result schemas, posted by whoever completes the task:

- `ScanResult`: `{ candidates: Candidate[] }` where `Candidate` is `{ recordUrl, name, age?, locations: string[], relatives?: string[], phones?: string[], emails?: string[] }`
- `FormResult`: `{ outcome: "submitted" | "not_found" | "already_removed" | "awaiting_email_confirmation", confirmationText?, notes? }`
- `ConfirmResult`: `{ confirmed: boolean, finalUrl, notes? }`
- `CanaryResult`: `{ healthy: boolean, missingSelectors: string[] }`
- `AgentResult`: `{ purpose: "scan", scan: ScanResult } | { purpose: "remove", form: FormResult }`

`BlockedReason` keeps its values.
`ClaimedTask` is what a claimer receives: `{ id, kind, attempt, leaseExpiresAt, payload, target: TargetSummary, recipe: Recipe | null, fields: Partial<Record<ProfileField, string>>, instructions: string }`.
`fields` holds only what the recipe declares, or for agent tasks what `identifiersFor` allows, resolved at claim time so personal data never sits in task payloads.

**API.** `shared/api.ts` defines request and response schemas for every route in 4.4, so the web app and the server agree by construction.

### 4.2 Database (`packages/db`)

Regenerate the schema as a single fresh migration `0000`; nothing is deployed yet.
Tables and the columns that matter:

- `profiles`: id, displayName, state, createdAt, updatedAt.
- `identities`: id, profileId, kind, value (json), isPrimary, validFrom, validTo.
- `mailboxes`: id, profileId (unique), provider, address, username, secret, smtp host/port/secure, imap host/port, replyFolder, dailyCap, uidValidity, lastPollUid, lastPolledAt, lastError.
- `targets`: id, kind, name, category, domain, website, privacyEmail, optOutUrl, privacyRightsUrl, searchUrl, contactMethod, region, requiresId, requirements (json), priority, data (json, the full record), datasetVersion, retired; unique on (kind, domain).
- `recipes`: id, targetId, purpose (`scan | remove`), version, definition (json), source (`bundled | proposed | user`), status (`active | pending_review | rejected | retired`), health (`unknown | healthy | broken`), failureCount, lastCheckedAt, notes, createdAt.
- `campaigns`: id, profileId, rights (json), selection (json), createdCount, skipped (json), createdAt.
- `requests`: id, profileId, targetId, campaignId, mailboxId, rights (json), legalBasis, channel, status, reference (unique), outgoingMessageId, recordUrl, followUps, sentAt, dueAt, followUpAt, lastError, createdAt, updatedAt.
- `request_events`: id, requestId, type, actor, payload (json), createdAt.
- `messages`: id, mailboxId, imapUid, uidValidity, requestId, messageIdHeader, inReplyTo, fromAddress, subject, receivedAt, classification, confidence, rationale, links (json), snippet, reviewed, createdAt; unique on (mailboxId, uidValidity, imapUid).
- `scans`: id, profileId, targetId, taskId, startedAt, finishedAt, candidates (json), error.
- `matches`: id, scanId, profileId, targetId, recordUrl, fields (json), decision (`pending | mine | not_mine`), decidedAt, requestId.
- `tasks`: id, kind, status, priority, profileId, targetId, requestId, payload, result, blockedReason, blockedDetail, leaseOwner, leaseExpiresAt, attempts, maxAttempts, runAfter, dedupeKey, lastError, createdAt, updatedAt; partial unique index on dedupeKey where status is `queued`, `leased`, or `blocked`.
- `task_artifacts`: id, taskId, kind (`screenshot`), mime, data (blob), createdAt.
  Screenshots live in the database so they are encrypted at rest.
- `sessions`: id (sha256 of the cookie token), createdAt, lastSeenAt, expiresAt, userAgent.
- `settings`: key, value (json), updatedAt.
  Keys: `auth.passwordHash`, `mcp.tokenHash`, `mcp.enabled`, `schedule`, `llm`, `worker.status`.

### 4.3 Server structure (`apps/server`)

- `config.ts` adds `KICKROCKS_WORKER_TOKEN` (worker API disabled when unset), `KICKROCKS_EXTRA_TARGETS` (path to a JSON file of extra targets, for fixtures and power users), `KICKROCKS_EXTRA_RECIPES` (directory of extra recipe files), `KICKROCKS_SCHEDULER` (`on | off`, default on, tests use off), and `KICKROCKS_PUBLIC_URL` for links shown in the UI.
- `services.ts` builds one `AppServices` object: config, db, clock, logger, `taskQueue`, `requests`, `targets`, `dispatch`, `secrets`, `taskHandlers`, `mail` (from `createMailServices`), `legal` (the `@kickrocks/legal` exports), `auth`.
  Feature code receives services as an argument and never builds its own.
- Every module in `src/modules/<name>/index.ts` exports a Fastify plugin `(app, services) => void` registered under `/api`.
  The foundation registers all of them with routes that return `501 { error: "not_implemented" }`, so feature agents only fill in their own files.
- An `onRequest` hook requires `services.auth.authenticate(request)` for `/api/*` except `/api/health`, `/api/auth/*`, and `/api/worker/*`.
  The foundation stub allows everything; module A replaces it.
- `/api/worker/*` uses the worker bearer token and `/mcp` uses the MCP bearer token, both checked with constant-time comparison in `core/secrets.ts`.

Core services the foundation implements fully, with tests:

- **`core/task-queue.ts`.** `enqueue`, `claim({ workerId, kinds, leaseMs })` (atomic, highest priority then oldest, skipping future `runAfter`), `heartbeat`, `complete`, `block` (optionally storing a screenshot artifact), `fail({ retryable, retryAfterMs })` with exponential backoff until `maxAttempts`, `resume`, `markDone`, `cancel`, `reapExpiredLeases`, `get`, `list`.
  Lease-owning calls reject a caller that does not hold the lease.
  `dedupeKey` prevents duplicate live tasks.
  The clock is injected.
- **`core/task-handlers.ts`.** A registry: `on(kind, "completed" | "blocked" | "failed", handler)`, invoked by the queue after the state change commits.
  Feature modules register handlers at startup.
- **`core/requests.ts`.** `create`, `transition(id, to, { actor, eventType, payload, patch })` enforcing the state machine and writing a `status_changed` event plus any extra event, `addEvent`, `get`.
- **`core/targets.ts`.** On startup, upserts the broker and company datasets (and `KICKROCKS_EXTRA_TARGETS`) into `targets`, sets `datasetVersion`, and marks vanished records `retired` instead of deleting them.
- **`core/dispatch.ts`.** `dispatchRequest(request)` enqueues `email_send` for email requests, and for form requests enqueues `form` with the active remove recipe or `agent` (purpose remove, reason `no_recipe`) when none exists.
  `enqueueScan(profileId, targetId)` enqueues `scan` with the active scan recipe or an `agent` scan task.
  `needsRecord(target)` is the shared rule above.
- **`core/secrets.ts`.** Token generation, sha256 hashing, constant-time comparison, worker and MCP token checks.
- **`core/claim.ts`.** Builds a `ClaimedTask`: loads the target and recipe, resolves `fields` from the profile's identities, and writes `instructions` for agent tasks (what to do, what never to do, and the exact result shape to report).

Interfaces the foundation defines and stubs, implemented by feature modules:

- `src/mail/types.ts` (module B): `MailTransport { verify, send }`, `InboxSource { listFolders, fetchSince }` returning `InboxMessage` objects with uid, messageId, inReplyTo, references, from, to, subject, date, text, html, isBounce, autoSubmitted, and headers, plus `ReplyClassifier { classify(message, context) }` returning classification, confidence, rationale, and extracted links, plus `LinkFollower { follow(url, allowedDomains) }` returning `{ ok, finalUrl, status, needsBrowser, reason }`.
  `createMailServices(config, settings)` lives in `src/mail/index.ts`.
- `@kickrocks/legal` (module C): `resolveLegalBasis(state, asOf)`, `listJurisdictions()`, `identifiersFor(target, identities, purpose, requestedFields?)`, `renderRequestEmail(input)`, as described in 5.C.

### 4.4 REST API

All routes are JSON under `/api`, authenticated by the `kr_session` cookie unless noted.
State-changing routes also require the header `X-Kick-Rocks: 1`, which a cross-site form cannot send.

- Auth: `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password`.
- Profiles: `GET /profiles`, `POST /profiles`, `GET /profiles/:id`, `PATCH /profiles/:id`, `DELETE /profiles/:id`, `PUT /profiles/:id/identities`.
- Mailbox: `GET /mail/providers`, `POST /profiles/:id/mailbox/test`, `PUT /profiles/:id/mailbox`, `DELETE /profiles/:id/mailbox`, `POST /profiles/:id/mailbox/poll`, `GET /profiles/:id/mailbox/folders`.
- Targets: `GET /targets` (kind, category, contactMethod, requirement, priority, q, page, pageSize), `GET /targets/facets`, `GET /targets/:id`.
- Campaigns: `POST /profiles/:id/campaigns/preview` and `POST /profiles/:id/campaigns`, both taking `{ selection, rights }` where selection is `{ targetIds }` or `{ preset: "companies" | "email_brokers" | "people_search" | "everything" }`.
- Requests: `GET /profiles/:id/requests`, `GET /requests/:id`, `POST /requests/:id/actions` with `{ action: "cancel" | "resend" | "mark_confirmed" | "mark_rejected" | "mark_no_record" }`.
- Dashboard: `GET /profiles/:id/dashboard`.
- Scans: `POST /profiles/:id/scans` with `{ targetIds }` or `{ preset: "people_search" }`, `GET /profiles/:id/scans`.
- Review: `GET /review?profileId=`, `POST /tasks/:id/resume`, `POST /tasks/:id/cancel`, `POST /tasks/:id/mark-done`, `GET /tasks/:id/screenshot`, `POST /matches/:id/decision`, `POST /messages/:id/classification`.
- Recipes: `GET /recipes?status=`, `POST /recipes/:id/approve`, `POST /recipes/:id/reject`.
- Settings: `GET /settings`, `PATCH /settings`, `POST /settings/mcp-token`, `GET /settings/jurisdictions`, `GET /settings/data-sources`.
- Worker (bearer worker token): `POST /worker/heartbeat`, `POST /worker/claim`, `POST /worker/tasks/:id/heartbeat`, `POST /worker/tasks/:id/complete`, `POST /worker/tasks/:id/block`, `POST /worker/tasks/:id/fail`.
- MCP (bearer MCP token) at `/mcp`, streamable HTTP, tools in 5.E.

### 4.5 Web shell (`apps/web`)

- React 19, `react-router`, `@tanstack/react-query`, Tailwind v4, `lucide-react` icons.
- Design tokens as CSS variables for light and dark, mapped into Tailwind's theme, following the frontend-pixel-perfect skill.
- A typed API client in `src/api/` built from `shared/api.ts`, which sends the `X-Kick-Rocks` header and redirects to login on 401.
- An app layout with sidebar navigation, a profile switcher (current profile kept in localStorage), and an auth gate that routes to `/setup` or `/login`.
- UI components in `src/components/ui/`: Button, IconButton, Input, Select, Textarea, Checkbox, Field (label, help, error), Card, Badge, StatusPill (one color per request status), Table, Tabs, Dialog, Toast, EmptyState, Skeleton, Spinner, PageHeader, CopyButton, CodeBlock.
- Routes with stub pages: `/setup`, `/login`, `/`, `/profiles`, `/profiles/new`, `/profiles/:id`, `/profiles/:id/mailbox`, `/targets`, `/targets/:id`, `/campaigns/new`, `/requests`, `/requests/:id`, `/review`, `/settings`, `/settings/agents`, `/about`.
- A mock API for UI work: `pnpm --filter @kickrocks/web dev:mock` starts Vite with a plugin that answers `/api/*` from handler modules in `apps/web/mock/`, one file per domain, each validated against the shared schemas and backed by in-memory fixture state.

## 5. Feature modules

### A. auth-profiles

- First run: `POST /auth/setup` sets the instance password (argon2id) only while none exists.
- Sessions: random 32-byte token in an HttpOnly, SameSite=Strict cookie, stored hashed, sliding 30-day expiry, `Secure` when served over HTTPS.
- Login throttling per IP with backoff; constant-time responses.
- Replace the foundation auth stub; enforce `X-Kick-Rocks` on state-changing routes.
- Profiles CRUD and identities replacement with validation (exactly one primary name, at least one email, dates sane).
- Settings: schedule (`pollMinutes` default 15, `peopleSearchRescanDays` 60, `brokerRescanDays` 90, `noResponseDays` 45, `maxFollowUps` 2), LLM (`baseUrl`, `model`, `apiKey` for any OpenAI-compatible endpoint such as Ollama), MCP enable and token rotation (token returned once, stored hashed), jurisdictions and data sources passthrough, worker status.

### B. mail

- Provider presets: Gmail, Google Workspace, Fastmail, iCloud, Yahoo, Proton Mail Bridge, mailbox.org, Zoho, and Other, each with the app-password link and caveats.
  Outlook.com is listed as unsupported with the reason.
- `MailTransport` on nodemailer: verify, and send plain-text mail with our Message-ID, the reference in the subject, and no tracking.
- `InboxSource` on imapflow: list folders, fetch since the last UID in the reply folder, handle UIDVALIDITY resets, parse with mailparser.
- `ReplyClassifier`: correlate by In-Reply-To or References matching our Message-ID, then by the `KR-` reference in subject or body, then by sender domain against awaiting requests (lower confidence).
  Detect bounces from DSN reports and mailer-daemon senders, auto-replies from `Auto-Submitted` and common patterns, and the other classes from keyword rules.
  Extract links and keep only those on the target's domain or its known subdomains.
  When confidence is below 0.6 and an LLM is configured, ask it for a classification with a strict JSON schema; otherwise leave the message for review.
- `LinkFollower`: GET with redirects re-validated hop by hop against the allowed domains, refusing private and loopback addresses, with a size and time limit; report `needsBrowser` when the page needs JavaScript or a button press.
- Mailbox routes in 4.4, with the password never returned to the client.
- Integration tests against GreenMail in Docker; CI provides it as a service.

### C. legal

- Research and encode every US state comprehensive privacy law in effect or enacted as of today: statute name, citation, effective date, rights to opt out of sale and to delete, response deadline and extension, data broker specifics, and a primary-source URL.
  Include California's Delete Act and DROP, and note where DROP should be preferred.
- `resolveLegalBasis(state, asOf)` returns the statute basis when the law is in effect at `asOf`, otherwise a policy-based request that asks the business to honor its own published privacy commitments.
- `identifiersFor` implements data minimization: blind email to marketing or registered brokers discloses name and email only; people-search and background-check requests add city and state; forms disclose only what the recipe declares; date of birth and full street address are disclosed only when a recipe or a broker's verification reply explicitly requires it.
- `renderRequestEmail` covers initial, follow-up, and verification-reply emails for opt-out, delete, or both, citing the statute when one applies.
  The tone is firm, plain, and short.
  It states that the request needs no identity verification for opt-out, asks for written confirmation, and puts the reference in the subject.
- Snapshot tests for every jurisdiction and template combination.

### D1. campaigns

- Targets list, facets, and detail, including recipe availability and source licenses.
- Campaign preview and create.
  Presets select all companies, all brokers with an email channel, all people-search targets, or everything.
  Email-capable targets get an email request.
  Targets that need a record URL start a scan instead of a request, reported as `scan_started`.
  Other form targets get a form request.
  Already active requests for the same target are skipped with a reason.
- Requests list with filters and detail with timeline, messages, and tasks; user actions per 4.4.
- Dashboard counts by status, needs-attention counts, today's sends against the daily cap, and recent events.

### D2. automation

- Scheduler loop, off when `KICKROCKS_SCHEDULER=off`: reap leases, enqueue inbox polls per mailbox on the poll interval, run in-process tasks, move overdue `awaiting_reply` requests to `no_response` then `follow_up_due` and send follow-ups up to `maxFollowUps`, re-scan people-search targets every `peopleSearchRescanDays`, re-send unconfirmed broker requests every `brokerRescanDays`, enqueue weekly canary checks, and delete artifacts of tasks finished more than 30 days ago.
- `email_send` runner: render with `@kickrocks/legal`, send with `MailTransport`, respect the mailbox daily cap over a rolling 24 hours and a jittered gap between sends (20 to 60 seconds), and set `sentAt` and `dueAt` from the legal basis.
- `inbox_poll` runner: fetch, store, classify, and apply.
  `completed` confirms, `no_record` and `rejected` close, `verification_required` moves to `needs_verification`, `confirmation_link` follows the link or enqueues a `confirm` task when a browser is needed, `bounce` switches to the form channel when the target has one, `needs_form` switches channel, `auto_ack` only adds an event, and low-confidence mail waits for review.
- Task handlers: scan results become matches (deduplicated by record URL against earlier decisions), form and agent results move requests forward, blocks add `task_blocked` events, and recipe failures convert the task to an `agent` task and count toward recipe health.
- Scans routes and the review routes in 4.4, including deciding matches (`mine` creates a form request with the record URL and dispatches it) and classifying messages by hand.

### E. agent-api

- Worker API in 4.4 with the worker token, claiming only browser kinds and returning `ClaimedTask`.
- MCP server at `/mcp` using `@modelcontextprotocol/sdk` streamable HTTP, with tools `list_tasks`, `claim_task`, `heartbeat_task`, `complete_task`, `block_task`, `fail_task`, `get_target`, `get_recipe`, and `propose_recipe`.
  Tool inputs and outputs are the shared schemas; `claim_task` returns the `ClaimedTask` with instructions.
- Recipes module: sync bundled recipes from `packages/recipes` and `KICKROCKS_EXTRA_RECIPES` at startup, list proposed recipes, approve or reject them, and update health from canary results.
- `docs/agents.md`: how to connect Claude Code (`claude mcp add --transport http ...`) or any MCP client, what an agent task looks like, and the rules agents must follow.

### F. worker

- `apps/worker`: config from env, typed client for the worker API, claim loop with heartbeats, graceful shutdown, and one task at a time.
- Playwright with a persistent profile, using installed Chrome when present and bundled Chromium otherwise, headed under Xvfb inside Docker.
- Human-paced input: per-key typing delay and small random pauses.
- `packages/recipes/src/runner`: executes recipe steps against a page, resolves selectors (role and label, then test id, then CSS, then text), fills fields, extracts candidates, detects CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile, and Cloudflare or "verify you are human" interstitials) and blocks with a screenshot, and returns typed results or a typed failure.
- Runner tests against local fixture pages with real Chromium.
- Replace the placeholder `apps/worker/Dockerfile` with the real image.
  The foundation already added the `worker` service to `docker-compose.yml`: it builds from that Dockerfile, reads `KICKROCKS_WORKER_TOKEN`, points at `http://server:8420`, keeps the Chrome profile in the `kickrocks-chrome` volume mounted at `/profile` (`KICKROCKS_CHROME_PROFILE`), and has `shm_size: 1gb`.
  It sits under the `worker` compose profile so a plain `docker compose up` still works without a token.
  Do not edit the compose file; list any change you need under `contractRequests`.

### G. recipes

- Author `scan` and `remove` recipes, each with a canary, for the highest-priority people-search sites: Spokeo, Whitepages, BeenVerified, Intelius and the PeopleConnect suppression center, MyLife, Nuwber, SmartBackgroundChecks and PeopleFinders, That's Them, FastPeopleSearch, TruePeopleSearch, USPhonebook, FamilyTreeNow, Radaris, CheckPeople, and ClustrMaps.
- Use these broker ids, which are pinned in `packages/brokers/data/ids.json`.
  A recipe's file name and `brokerId` embed the id, and `apps/server/src/core/bundled-recipes.test.ts` fails when a bundled recipe names a broker that is not in the generated dataset or whose `entryUrl` is off that broker's domain.
  The three marked reserved have no record in the dataset until H lands the BADBOOL import, so write those recipes last and expect that test to fail for them until then.

  | Site | Broker id |
  |---|---|
  | Spokeo | `spokeo` |
  | Whitepages | `whitepages` |
  | BeenVerified | `beenverified` |
  | Intelius | `intelius` |
  | PeopleConnect suppression center | `peopleconnect` |
  | MyLife | `mylife` |
  | Nuwber | `nuwber` |
  | SmartBackgroundChecks | `smartbackgroundchecks` (reserved) |
  | PeopleFinders | `peoplefinders` |
  | That's Them | `thatsthem` |
  | FastPeopleSearch | `fastpeoplesearch` |
  | TruePeopleSearch | `truepeoplesearch` |
  | USPhonebook | `usphonebook` |
  | FamilyTreeNow | `familytreenow` |
  | Radaris | `radaris` (reserved) |
  | CheckPeople | `checkpeople` |
  | ClustrMaps | `clustrmaps` (reserved) |

- Inspect each live page read-only to choose selectors; never submit.
- Record in each recipe's notes what was verified live, what was blocked by bot protection, and when.

### H. datasets

- BADBOOL importer from a pinned copy of its README with its license file, mapping crucial and high-priority markers to `priority`, phone, ID, and paid markers to `requirements`, the search and opt-out links to `searchUrl` and `optOutUrl`, and its notes to `notes`.
  Set `record_url` in `requirements` whenever the BADBOOL entry has a search link or its opt-out asks for a listing URL.
  The request flow does not depend on it (`needsRecord` reads the category), but the target list shows it.
- Merge order: BADBOOL, then Eraser, then the California registry, so the freshest curated people-search data wins.
- Broker ids are permanent.
  `packages/brokers/data/ids.json` maps every domain to its id and is committed.
  The merge keeps the id pinned for a domain whichever source wins, and `pnpm data:build` appends the id of any new domain, so commit the file whenever it changes.
  A test fails when a generated broker has no pinned id.
  The map already reserves the ids of the sites in 5.G whose records are not in the dataset yet, so the BADBOOL import must produce `radaris.com`, `clustrmaps.com`, and `smartbackgroundchecks.com` records and the merge assigns them those ids.
- Registry website cells list several sites; the importer takes the first as the broker's own and records the rest in `notes`.
  A test asserts every generated domain is a valid hostname.
- A hand-curated company dataset of at least 75 major US consumer companies with first-party privacy contacts, each checked against the company's own privacy page with a `verifiedAt` date.
- Other state data broker registries (Vermont, Texas, Oregon) when a structured download exists; otherwise document why not.
- `packages/brokers/data/NOTICE.md` with per-source licenses and the BADBOOL attribution; the generated dataset carries a license field.

### I. web-core

Setup and login, the dashboard, profile list and editor with the identities editor, the mailbox wizard (provider presets, app-password guidance, connection test, folder picker, daily cap), and an about page with data sources and licenses.

### J. web-flows

Target browser and detail, the campaign builder with one-click presets and an email preview, the request list and detail timeline, the review queue (blocked tasks with screenshot and manual instructions, record matches, unclassified mail), and settings (schedule, MCP token and Claude Code setup, worker status, LLM, proposed recipes).

## 6. Integration and end-to-end

After the feature branches merge, the full flow must work through the real UI against a local stack: server, worker, GreenMail, and a fixture broker site with test-only targets and recipes loaded through `KICKROCKS_EXTRA_TARGETS` and `KICKROCKS_EXTRA_RECIPES`.
The flow: set the password, create a profile, connect the GreenMail mailbox, run a one-click campaign, see requests sent, inject broker replies (completed, confirmation link, bounce, verification needed), poll, watch statuses change, run a scan against the fixture site, confirm a match, watch the worker remove it, hit a CAPTCHA fixture, resolve it from the review queue, and claim and complete an agent task over MCP.
The end-to-end suite lives in `e2e/` and runs with `pnpm e2e`.
