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
  A module that lives in `apps/server` (A, B, D1, D2, E) does not edit `apps/server/package.json` or the lockfile, because five modules share them and parallel edits would conflict; list what it needs under `contractRequests` and the foundation adds it.
  The foundation already added `htmlparser2` for extracting links from mail and `mailauth` for verifying DKIM signatures.
  A module with its own package adds dependencies to that package's `package.json` only and lists them in the report.

### Tooling

- `export PATH="$HOME/.local/bin:$PATH"` before any pnpm command; pnpm is not on the default PATH.
- In a fresh checkout or worktree run `pnpm install --frozen-lockfile`, then `pnpm data:build`, then `pnpm build`.
  Workspace packages are consumed through their `dist` output, so a package you depend on must be built before your tests can import it.
- Before every commit run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
  All must pass.
  A test that needs GreenMail or Chromium skips itself when the service is missing and fails in CI, which sets `KICKROCKS_REQUIRE_INTEGRATION=1`; see `apps/server/src/test-utils/README.md`.
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
| I web-core | `kr/web-core` | `apps/web/src/pages/{setup,login,dashboard,profiles,mailbox,about}/**`, `apps/web/mock/{auth,profiles,mailbox,dashboard,about}.ts`, and the tests beside them, `apps/web/mock/{auth,profiles,mailbox,dashboard,about}.test.ts` and `apps/web/src/pages/<page>/*.test.tsx` |
| J web-flows | `kr/web-flows` | `apps/web/src/pages/{targets,campaigns,requests,review,settings}/**`, `apps/web/mock/{targets,campaigns,requests,review,settings}.ts`, and the tests beside them, `apps/web/mock/{targets,campaigns,requests,review,settings}.test.ts` and `apps/web/src/pages/<page>/*.test.tsx` |
| K data-rights | `kr2/data-rights` | `apps/server/src/modules/data-rights/**`, the retention hook in `apps/server/src/scheduler/scheduler.ts`, `packages/shared/src/{data-rights,api,settings,index}.ts` and their tests (contract additions accepted for this module), `apps/web/mock/{profiles,settings,store}.ts`, `apps/server/src/modules/{index,profiles,settings}/`, the in-flight-delete guard in `apps/server/src/runners/email-send.ts`, and the export, retention, and reset cards in `apps/web/src/pages/{profiles/detail,settings}/` |
| L companies | `kr2/companies` | the company contacts in `packages/brokers/data/**` and the company import in `packages/brokers/src/**` |
| M legal-accuracy | `kr2/legal-accuracy` | `packages/legal/**`, and the DROP advisory the campaign planner shows |
| N notify | `kr2/notify` | `apps/server/src/modules/notifications/**`, `packages/shared/src/notifications.ts`, `apps/web/mock/notifications.ts`, and the Notifications tab in `apps/web/src/pages/settings/notifications/**` |
| O recipes-live | `kr2/recipes-live` | `packages/recipes/recipes/**`, re-read against the live sites |
| P agent-worker | `kr2/agent-worker` | `apps/agent-worker/**`, its Dockerfile and compose profile, and "Running a model as the agent" in `docs/agents.md` |
| Q install-docs | `kr2/fix-install-docs` | `README.md`, `install.sh`, `docker-compose.yml`, `docs/*.md` except `docs/agents.md`, `packages/legal/README.md`, the site checks gate in `apps/server/src/scheduler/canaries.ts` and its setting, and the setup, login, targets, and settings copy in `apps/web/src/pages/` |

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
`RequestStatus` keeps its states.
`canTransition(from, to, { actor })` takes the actor (`system | user | worker | agent`), and a user may force any non-terminal status to `confirmed`, `no_record`, `rejected`, or `cancelled`.
The table is built around the rule that a reply or a form result is applied to whatever status the request is in when it arrives:

- `queued` can go straight to `awaiting_reply`, `confirmed`, `no_record`, `rejected`, or `needs_verification`, so a form that finds nothing never writes a `sent` event that did not happen.
  The email runner moves `queued -> sent -> awaiting_reply` in one call.
- `sent` is a resting state only for a moment, but a reply can arrive in it, so it can end in any outcome and can go back to `queued`.
- `needs_verification` goes to `queued`, not to `sent`: an approved verification reply is dispatched through the queue like every send.
  It can also close (`confirmed`, `rejected`, `no_record`), bounce, or lapse to `no_response`.
- `no_response` and `follow_up_due` accept a late reply: `awaiting_reply`, `confirmed`, `rejected`, `needs_verification`, `no_record`, `bounced`, and `queued`.
- `rejected` can be appealed (`queued`) or overturned (`confirmed`, `no_record`).
- `awaiting_reply -> queued` is a channel switch, such as a broker answering "use our web form".

`REPLY_OUTCOMES` says which status each `ReplyClassification` moves a request to, and `FORM_OUTCOMES` does the same for each form outcome (`submitted` and `awaiting_email_confirmation` to `awaiting_reply`; `not_found` and `already_removed` to `no_record`).
The inbox runner applies a reply when `canTransition` allows the move and records it without changing the status when it does not.
A table test in `requests.test.ts` applies every classification and every form outcome to every status a reply can arrive in.

`availableActions(request, { hasLiveTask })` is the one rule for which `RequestAction`s apply, and `RequestDetail.actions` carries its answer so the page never offers a button the server refuses.
`resend` re-queues the request on its current channel.
It is allowed from `rejected`, `bounced`, `no_response`, `follow_up_due`, `awaiting_reply`, and from `queued` when no task is live.
`resendEmailKind(status)` says whether it sends a follow-up (from `awaiting_reply`, `no_response`, `follow_up_due`) or a fresh request (from `rejected`, `bounced`, `queued`).
A verification reply is never a resend: it has its own route, because it needs the fields the person approved.

`RequestRecord.awaitingConfirmationSince` is set while a submitted form waits for the broker's confirmation email and is cleared by every status change, so it is only ever set in `awaiting_reply`.

`RequestEventType`: `created`, `queued`, `sent`, `send_failed`, `reply_received`, `classified`, `link_followed`, `status_changed`, `follow_up_sent`, `channel_switched`, `awaiting_confirmation`, `task_enqueued`, `task_blocked`, `task_completed`, `task_failed`, `task_cancelled`, `task_resumed`, `task_retrying`, `user_action`, `relisted`, `note`.
`REQUEST_EVENT_PAYLOADS` has one schema per type, `RequestEvent` is a union on `type`, and `requests.addEvent` and `requests.transition` validate every payload before it is stored.
For example `status_changed` is `{ from, to }`, `sent` is `{ channel, kind, messageId, mailboxId }`, `classified` is `{ messageId, classification, confidence, correlation }`, and `task_failed` is `{ taskId, kind, error, failureKind }`.
`describeEvent(event)` in `apps/web/src/lib/events.ts` turns any of them into a sentence, for the request timeline and the dashboard.

Every request has a reference `KR-XXXXXX`, six Crockford base32 characters, generated and parsed by helpers in `shared/mail.ts`.

**Mail.** `ReplyClassification`: `bounce`, `auto_ack`, `confirmation_link`, `verification_required`, `completed`, `no_record`, `rejected`, `needs_form`, `unrelated`, `unknown`.
`EmailKind` is `initial | follow_up | verification_reply`.
`ProviderPreset`: id, label, smtpHost, smtpPort, smtpSecure, imapHost, imapPort, appPasswordUrl, notes, defaultDailyCap.
`MessageSummary.requestedFields` lists the profile fields a broker asked for in a verification reply (names, never values), and `MessageDetail` adds the stored message text (cut to 20,000 characters).
`MailboxTestBody` is a connection whose password is optional, so a saved mailbox can be tested without typing it again.
Helpers: `formatReference`, `parseReferences(text)`, `outgoingMessageId(requestId, domain)`, `parseOutgoingMessageId(id)`.

**Tasks.** `TaskKind`: `email_send`, `inbox_poll`, `scan`, `form`, `confirm`, `canary`, `agent` (`human_review` is removed; a blocked task is the human queue).
In-process kinds are `email_send` and `inbox_poll`; browser kinds are `scan`, `form`, `confirm`, `canary`, `agent`.
Payload schemas, stored in the database, hold ids only:

- `email_send`: `{ requestId, kind: EmailKind, fields: ProfileField[], inReplyTo: string | null }`.
  `fields` is the approved identifiers of a verification reply, as names; it is non-empty exactly when the kind is `verification_reply`.
  Whoever queues the send sets the kind, and dispatch never infers it.
- `inbox_poll`: `{ mailboxId }`
- `scan`: `{ profileId, targetId, recipeId: string | null, variant: { nameId, addressId } | null }`.
  A variant searches under a past name, alias, or address, since listings are keyed by old ones.
- `form`: `{ requestId, targetId, recipeId: string | null, recordUrl: string | null }`
- `confirm`: `{ requestId, url }`
- `canary`: `{ recipeId }`
- `agent`: `{ purpose: "scan" | "remove", profileId, targetId, requestId: string | null, recordUrl: string | null, variant, reason: "no_recipe" | "recipe_failed" | "blocked", previousError: string | null, blockedReason: BlockedReason | null }`

Result schemas, posted by whoever completes the task:

- `ScanResult`: `{ candidates: Candidate[] }` where `Candidate` is `{ recordUrl, name, age?, locations: string[], relatives?: string[], phones?: string[], emails?: string[] }`
- `FormResult`: `{ outcome: "submitted" | "not_found" | "already_removed" | "awaiting_email_confirmation", confirmationText?, confirmationFrom?, notes? }`.
  `confirmationFrom` is the domain the confirmation email will come from, when the page says so.
  It is kept only when it is the same organizational domain as the target (relaxed alignment over the public suffix list) or is listed in the target's curated `replyDomains`, and never when it is a shared host.
- `ConfirmResult`: `{ confirmed: boolean, finalUrl, notes? }`
- `CanaryResult`: `{ healthy: boolean, missingSelectors: string[] }`
- `AgentResult`: `{ purpose: "scan", scan: ScanResult } | { purpose: "remove", form: FormResult }`

`resultSchemaFor(task)` is the schema a task's result must match, and for an agent task it follows the payload's purpose, so a scan task cannot be completed with a removal outcome.

`BlockedReason` is `captcha`, `phone_verification`, `id_upload`, `email_verification`, `login_required`, `bot_detection`, `unknown`.
A broken recipe is not a block: it is a failure of kind `recipe`.
`FailureKind` is `recipe | site | network | internal`, carried by `TaskFailureReport` (default `internal`, plus an optional `step`) and by a failed recipe run.
A `recipe` failure is always final, whatever `retryable` says, because the same script would fail the same way.
The server counts only `recipe` failures against a recipe's health and hands that task to an agent.
`TaskUsage` is `{ inputTokens?, outputTokens?, costUsd?, durationMs? }`, reported with a complete, a failure, or a block, and summed over every attempt.
`TaskSummary` also carries `blockedUrl`, `failureKind`, `failureStep`, `finishedBy` (the worker that last ended its lease), `claimerKind` (`builtin | mcp | model`, set by the route that claimed it), and `usage`.

`WORKER_DEFAULT_KINDS` (`scan`, `form`, `confirm`, `canary`) is what `POST /worker/claim` takes when it is not told, and `AGENT_DEFAULT_KINDS` (`agent`) is what the MCP `claim_task` takes, so neither claimer leases work meant for the other.
Claiming a task by id ignores the kinds.

`ClaimedTask` is what a claimer receives: `{ id, kind, attempt, leaseExpiresAt, payload, target: TargetSummary, recipe: Recipe | null, fields: Partial<Record<ProfileField, string>>, instructions: string }`.
`fields` holds only what the recipe declares, or for agent tasks what `identifiersFor` allows, resolved at claim time so personal data never sits in task payloads.
The `email` field of a form or agent removal is always the address of the request's mailbox, never another address on the profile, because the confirmation email lands in the mailbox Kick Rocks polls.
`TargetSummary` carries `optOutUrl`, `searchUrl`, `californiaRegistered` (listed in the California registry, which is what makes the Delete Act apply), and `retired`, so an agent does not need a second call to find where to go.

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
- `requests`: id, profileId, targetId, campaignId, mailboxId, rights (json), legalBasis, channel, status, reference (unique), outgoingMessageId, recordUrl, followUps, sentAt, dueAt, followUpAt, awaitingConfirmationSince, lastError, createdAt, updatedAt.
- `request_events`: id, requestId, type, actor, payload (json, validated against `REQUEST_EVENT_PAYLOADS`), createdAt.
- `outgoing_mail`: id, mailboxId, requestId, kind, messageId, sentAt.
  The email runner writes a row for every send, and the daily cap, the pacing, and the dashboard's "sent today" all read it through `mailQuota`.
- `messages`: id, mailboxId, imapUid, uidValidity, requestId, messageIdHeader, inReplyTo, fromAddress, subject, receivedAt, classification, confidence, rationale, links (json), requestedFields (json), snippet, text (cut to 20,000 characters), reviewed, createdAt; unique on (mailboxId, uidValidity, imapUid).
- `scans`: id, profileId, targetId, taskId, startedAt, finishedAt, candidates (json), error.
- `matches`: id, scanId, profileId, targetId, recordUrl, fields (json), decision (`pending | mine | not_mine`), decidedAt, requestId.
- `tasks`: id, kind, status, priority, profileId, targetId, requestId, payload, result, blockedReason, blockedDetail, blockedUrl, leaseOwner, leaseExpiresAt, attempts, maxAttempts, runAfter, dedupeKey, lastError, failureKind, failureStep, finishedBy, claimerKind, usage (json), createdAt, updatedAt; partial unique index on dedupeKey where status is `queued`, `leased`, or `blocked`.
- `task_artifacts`: id, taskId, kind (`screenshot`), mime, data (blob), createdAt.
  Screenshots live in the database so they are encrypted at rest.
- `sessions`: id (sha256 of the cookie token), createdAt, lastSeenAt, expiresAt, userAgent.
- `settings`: key, value (json), updatedAt.
  Keys: `auth.passwordHash`, `mcp.tokenHash`, `mcp.enabled`, `schedule`, `llm`, `worker.status`.

### 4.3 Server structure (`apps/server`)

- `config.ts` adds `KICKROCKS_WORKER_TOKEN` (worker API disabled when unset), `KICKROCKS_EXTRA_TARGETS` (path to a JSON file of extra targets, for fixtures and power users), `KICKROCKS_EXTRA_RECIPES` (directory of extra recipe files), `KICKROCKS_SCHEDULER` (`on | off`, default on, tests use off), `KICKROCKS_PUBLIC_URL` for links shown in the UI, `KICKROCKS_TRUST_PROXY` (`off`, a number of proxy hops, or a list of proxy addresses, default off, for running behind a reverse proxy; read as `config.trustProxy` and passed to Fastify, and a bare `on` is refused because it would believe a client-written X-Forwarded-For), `KICKROCKS_ALLOWED_HOSTS` (extra hostnames the Host and Origin headers may name, besides loopback, IP addresses, and the public URL's host, read as `config.allowedHosts`), and `KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS`, a comma separated list of hostnames the link follower may reach even on a private or loopback address (empty by default; the end-to-end suite lists its fixture broker site), exposed as `config.linkFollower.allowedPrivateHosts`, `KICKROCKS_PLAINTEXT_MAIL_HOSTS`, a comma separated list of hostnames the mailbox may reach without TLS besides this machine (empty by default; the development stack lists GreenMail), `KICKROCKS_DKIM_TEST_KEYS`, a path to a JSON file of `selector._domainkey.domain` key records that the server believes in place of DNS (test only: read as `config.mail.dkimTestKeysPath` and ignored when `NODE_ENV` is production; the development stack sets it and `NODE_ENV=development`), and `KICKROCKS_SEND_GAP_MS`, the pause between sends as `<ms>` or `<min>-<max>` (default 20 to 60 seconds; the development stack sets 0).
- `services.ts` builds one `AppServices` object: config, db, clock, logger, `taskQueue`, `requests`, `targets`, `dispatch`, `composer`, `mailQuota`, `startup`, `secrets`, `taskHandlers`, `recipeHealth`, `settings`, `mail` (from `createMailServices`), `legal` (the `@kickrocks/legal` exports), `auth`.
  Feature code receives services as an argument and never builds its own.
- Every module in `src/modules/<name>/index.ts` exports a Fastify plugin `(app, services) => void` registered under `/api`.
  The foundation registers all of them with routes that return `501 { error: "not_implemented" }`, so feature agents only fill in their own files.
  Register routes with `registerRoute` from `core/http.ts`, which takes the route from `API_ROUTES`, validates params, query, and body, and tells the guard who may call it.
- **Startup order** in `buildApp`: sync the datasets into `targets`, register every module, run the steps modules added with `services.startup.onReady(name, step)` in order, then start the scheduler.
  A module that stores rows pointing at targets (module E's recipe sync) does it in a startup step and never when its plugin registers.
  A step that throws stops the server from starting, naming itself.
- **The guard** (`core/guard.ts`) is the single place that decides who may call what, from the route table: `auth: "session"` runs `services.auth.authenticate(request)`, `auth: "worker"` checks the worker bearer token, `auth: "none"` is open, and `/mcp` checks the MCP bearer token.
  `/api/auth/password` is a session route, like every route the table marks `session`; an `/api` route nobody declared needs a session too.
  It also enforces the CSRF header: every method that changes state under `/api` needs `X-Kick-Rocks: 1`, the `/api/auth/*` routes included, and a request without it gets 403 before its body is parsed.
  Bearer-token calls are exempt.
  `AuthService.authenticate(request, reply)` therefore only decides whether there is a session, and module A does not check the header.
  It receives the reply so a valid session can re-issue its cookie, which lets the cookie lifetime slide on every call.
  The foundation stub allows everything; module A replaces it.
- The server sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a Content-Security-Policy of `default-src 'self'` with `frame-ancestors 'none'` on every response.
- `GET /api/health` answers `{ ok, version }` to anyone; the counts are `GET /api/status`, behind the session.
- `/api/worker/*` uses the worker bearer token and `/mcp` uses the MCP bearer token, both checked with constant-time comparison in `core/secrets.ts`.

Core services the foundation implements fully, with tests:

- **`core/task-queue.ts`.** `enqueue`, `claim`, `heartbeat`, `complete`, `block`, `fail`, `release`, `resume`, `markDone`, `cancel`, `cancelForRequest`, `reapExpiredLeases`, `get`, `list`, `hasLiveTask`, `summarize`, `screenshot`, `purgeArtifacts`.
  Everything is synchronous and runs in one transaction with the handlers it triggers.
  - `claim({ workerId, kinds, leaseMs, taskId?, profileId?, excludeProfileIds?, claimerKind? })` is atomic and takes the highest priority, then the oldest, skipping future `runAfter`.
    It first recovers expired leases, so it always sees the current queue even with the scheduler off.
    `excludeProfileIds` is how the email runner skips a mailbox that is at its cap.
  - `block` stores the reason, the detail, the page where the run got stuck (`url`), and optionally a screenshot artifact.
  - `fail({ retryable, retryAfterMs, kind, step })` retries with an exponential backoff until `maxAttempts`, except that a `recipe` failure is never retried.
  - `release(id, { workerId, runAfter? })` hands a leased task back as if it had never been claimed: no event and no attempt counted.
    It is what a worker uses when it shuts down mid-task and what the email runner uses when the daily cap defers a send.
  - Lease-owning calls reject a caller that does not hold the lease.
    `heartbeat` refuses an expired lease with `lease_expired`, so a late worker finds out.
    `complete`, `block`, and `fail` are still accepted from the worker that holds an expired lease until someone else claims the task, because finished work is better kept than redone.
    This includes a task the expiry failed because no attempt was left: the failed row keeps the lapsed holder as `leaseOwner`, and the holder's real result replaces the expiry failure until a person dismisses the task.
  - `complete` validates the result against `resultSchemaFor(task)`, which follows the agent payload's purpose.
    `markDone(id, { actor, result?, note? })` validates a person's result the same way and stores it, so a handler can tell "I submitted it by hand" from "already removed".
  - `enqueue` takes `dedupeKey`, which prevents duplicate live tasks, and `sameWork`, the other kinds that count as the same work: the key names the work, not the kind, so an agent task holding `form:<requestId>` is returned when a recipe is approved and the request is dispatched again.
  - Every finished task records `finishedBy`, `claimerKind`, `failureKind`, `failureStep`, and the summed `usage`.
  - The clock is injected.
- **`core/task-handlers.ts`.** A registry: `on(kinds, names, (event, tx) => void)`, where an event is `completed`, `blocked`, `failed` (final), `retrying`, `cancelled`, or `resumed`.
  Handlers are synchronous and run inside the transaction that changed the task, so the task change and everything a handler writes commit or roll back together.
  Run after the commit, a crash between the two would lose the consequence for good (a scan's candidates never becoming matches, a form result never advancing its request) and nothing would show it was missing.
  Core services called from a handler join its transaction, because the database is one connection and a nested transaction becomes a savepoint.
  A handler must tolerate a world that has moved on, such as a request the person has since cancelled, by doing nothing; it throws only for a bug, which rolls the change back and gives the worker a 500 while it still holds its lease.
  A handler that returns a promise is rejected.
  Work that cannot be undone, such as sending mail, is queued as a task from a handler and done by a runner.
- **`core/task-audit.ts`.** Registered first, so it runs before module handlers: it puts what happens to a task on its request's timeline (`task_completed`, `task_blocked`, `task_failed`, `task_retrying`, `task_cancelled`, `task_resumed`) and sets `requests.lastError` on a final failure.
  Modules do not write those events themselves; they apply consequences, such as moving a request along.
  A final failure leaves the request with no live task, which is why `ReviewQueue.failedTasks` lists it and `POST /tasks/:id/retry` is the way back.
- **`core/requests.ts`.** `create` (404 for a missing profile or target, 409 `target_retired` for a retired one), `transition(id, to, { actor, event?, patch? })` enforcing the state machine and writing `status_changed` plus any extra event, `update`, `addEvent`, `events`, `get`.
  Moving to `confirmed`, `no_record`, `cancelled`, or `rejected` cancels the request's live tasks in the same transaction, so nothing keeps acting for a settled request.
- **`core/request-flow.ts`.** `requests.open({ profileId, targetId, rights, channel, recordUrl?, campaignId?, actor })` resolves the legal basis, picks the profile's mailbox, creates the request, moves it from draft to queued, and dispatches it, all or nothing.
  `requests.requeue(id, { actor, reason, kind, channel?, fields?, inReplyTo?, patch?, events? })` moves a request back to `queued` and dispatches it again, for a resend, a follow-up, a verification reply, and a channel switch.
  D1 campaigns, D2 match decisions, relisting, and the follow-up scheduler all call these and do not rewrite the steps.
- **`core/composer.ts`.** `composer.requestEmail(request, kind, { requestedFields? })` returns the rendered email, the exact `RenderRequestEmailInput` it came from, the recipient, and the mailbox.
  It cites the legal basis stored on the request (`legal.getLegalBasis`), so a follow-up cites the statute the first request cited, and it works for a request that does not exist yet.
  The campaign preview and the email runner both call it, so the preview is the mail that goes out.
- **`core/mail-quota.ts`.** `mailQuota.sentSince(mailboxId, since)`, `sentLastDay`, `remaining(mailboxId)` (the cap less what went out in the last 24 hours), `lastSentAt`, and `record`, backed by `outgoing_mail`.
  The email runner records every send, and the daily cap, the 20 to 60 second pacing, and `Dashboard.sending` all read it.
- **`core/targets.ts`.** On startup, upserts the broker and company datasets (and `KICKROCKS_EXTRA_TARGETS`) into `targets`, sets `datasetVersion`, and marks vanished records `retired` instead of deleting them.
  A dataset that is unavailable, including a missing company file, keeps its existing targets instead of retiring them.
- **`core/dispatch.ts`.** Every task a module needs has one helper with one dedupe key, so no two modules disagree.
  - `dispatchRequest(requestId, { kind?, fields?, inReplyTo? })` reads the request from the database and requires `queued`.
    For email it enqueues `email_send` of the kind it is given (default `initial`), after checking that there is a mailbox and the target has an address.
    For a form request it enqueues `form` with the newest active remove recipe that is not marked broken, or an `agent` task (purpose remove, reason `no_recipe`, or `recipe_failed` when every recipe is broken) when there is none.
    A form request needs a mailbox when the recipe types an `email` or the target lists `email_confirmation`, because the form is filled in with the mailbox address.
    It writes a `task_enqueued` event when a task is created.
  - `enqueueScan(profileId, targetId, variant?)` enqueues `scan` with the active scan recipe or an `agent` scan task, creates the `scans` row, and includes the variant in the dedupe key.
  - `fallbackToAgent(task, { reason, error })` replaces a scan or form task with an agent task under the same dedupe key and repoints `scans.taskId`, in one transaction.
  - `handToAgent(taskId, actor)` does the same for a blocked task, with reason `blocked` and the `blockedReason`, so an agent knows which human check stopped the worker.
  - `enqueueConfirm(requestId, url)` uses key `confirm:<requestId>:<sha256(url)>`, `enqueueCanary(recipeId)` uses `canary:<recipeId>`, and `enqueueInboxPoll(mailboxId)` uses `inbox_poll:<mailboxId>`; each sets `targetId` and `profileId` so the claim can be built.
  - Dispatch and scan refuse a retired target (`target_retired`) and answer 404 for a missing profile or target.
  - `needsRecord(target)` is the shared rule above.
- **`core/secrets.ts`.** Token generation, sha256 hashing, constant-time comparison, worker and MCP token checks.
- **`core/claim.ts`.** `claimTask(services, { workerId, kinds, leaseMs, taskId?, claimerKind })` leases the next browser task and builds a `ClaimedTask`: loads the target and recipe, resolves `fields` from the profile's identities (the scan's variant picks a past name or address), and writes `instructions` for agent tasks (what to do, where to start, what never to do, and the exact result shape to report).
  - A form or agent removal for a request that is no longer `queued`, and a confirmation for a request that is no longer active, is cancelled instead of claimed, and the claim moves on to the next task.
  - A confirmation URL that is not on the target's domain is never handed out; the task fails.
  - With `taskId`, a queued task is leased as it is, and a blocked task is first handed to an agent and the new task leased in the same call, which is how an MCP client picks up a blocked task.
  - A task that cannot be prepared is failed on the spot with kind `internal`.
- **`core/recipe-catalog.ts`.** `recipeTargetProblems(recipe, targets)` reports a recipe whose broker is not in the dataset or whose pages are on another site.
  Module E's startup sync calls it, and `core/bundled-recipes.test.ts` runs it over every bundled recipe.

Interfaces the foundation defines and stubs, implemented by feature modules:

- `src/mail/types.ts` (module B): `MailTransport { verify, send }`, `InboxSource { listFolders, fetchSince }` returning `InboxMessage` objects with uid, messageId, inReplyTo, references, from, to, subject, date, text, html, isBounce, autoSubmitted, and headers, plus `ReplyClassifier { classify(message, context) }` returning classification, confidence, rationale, extracted links, and `requestedFields`, plus `LinkFollower { follow(url, allowedDomains) }` returning `{ ok, finalUrl, status, needsBrowser, reason }`.
  `fetchSince(folder, afterUid, uidValidity, { since, limit })` maps `since` to IMAP SINCE and returns at most `limit` messages, oldest first, with `hasMore` and the folder's `highestUid`: the caller stores `highestUid` as its cursor when nothing is left, so a first poll never downloads years of mail and a UIDVALIDITY reset does not either.
  A `ClassifierRequest` carries `channel`, `recordUrl`, and `awaitingConfirmation`, which says that a submitted form waits for a confirmation email, from which domains, and with what link text.
  A confirmation email carries no reference of ours, so the matching rule is documented there: a `confirmation_link` from one of the expected domains belongs to the oldest request waiting for that profile and target (or the one for the record the message names), with confidence at least 0.8, and the link follower is given those domains as well as the target's.
  `createMailServices(config, settings)` lives in `src/mail/index.ts`.
- `@kickrocks/legal` (module C): `resolveLegalBasis({ state, target, rights, asOf })`, `getLegalBasis(id, state)`, `listJurisdictions()`, `identifiersFor(target, identities, purpose, requestedFields?, asOf?)`, `renderRequestEmail(input)`, as described in 5.C.
  The target and rights matter because the data broker statutes cover only data brokers and some statutes give no right to deletion, and `getLegalBasis` returns a stored basis as it was, so a follow-up can cite the original after a newer law takes effect.

### 4.4 REST API

All routes are JSON under `/api`, authenticated by the `kr_session` cookie unless noted.
State-changing routes also require the header `X-Kick-Rocks: 1`, which a cross-site form cannot send.
The guard enforces it for every route, so a module does not check it.
A validation failure answers 400 with `issues`, each with a `path` that starts with where the value was read from (`body`, `query`, or `params`), such as `["body", "identities", 0, "value", "address"]`.
The server and the web mock both build issues with `toApiIssues`, and the web client's `fieldErrors` drops a leading `body`.

- Core: `GET /health` (open, `{ ok, version }`), `GET /status` (profile and target counts).
- Auth: `GET /auth/state`, `POST /auth/setup`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/password` (needs a session).
- Profiles: `GET /profiles`, `POST /profiles`, `GET /profiles/:id`, `PATCH /profiles/:id`, `DELETE /profiles/:id`, `PUT /profiles/:id/identities`.
- Mailbox: `GET /mail/providers`, `POST /profiles/:id/mailbox/test` (the password may be left out to test the stored one), `PUT /profiles/:id/mailbox`, `DELETE /profiles/:id/mailbox`, `POST /profiles/:id/mailbox/poll`, `GET /profiles/:id/mailbox/folders`.
- Targets: `GET /targets` (kind, category, contactMethod, requirement, priority, q, page, pageSize; each item says which of its scan and remove recipes are automated and how healthy), `GET /targets/facets`, `GET /targets/:id`.
- Campaigns: `POST /profiles/:id/campaigns/preview` and `POST /profiles/:id/campaigns`, both taking `{ selection, rights }` where selection is `{ targetIds }` or `{ preset: "companies" | "email_brokers" | "people_search" | "everything" }`.
  An outcome can be skipped for `already_active`, `no_contact_method`, `scan_in_progress`, `no_mailbox`, `already_confirmed`, `unsupported_channel`, or `covered_by_platform`, with a `detail` sentence.
- Requests: `GET /profiles/:id/requests`, `GET /requests/:id` (with `actions`), `POST /requests/:id/actions` with `{ action: "cancel" | "resend" | "mark_confirmed" | "mark_rejected" | "mark_no_record" }`, `POST /requests/:id/verification` with `{ messageId, fields }`.
  The verification route answers a broker that asked for more identifiers: `fields` is the person's approved subset of the message's `requestedFields`, and the request goes `needs_verification -> queued` and sends a `verification_reply` email.
- Dashboard: `GET /profiles/:id/dashboard` (`attention` counts blocked tasks, pending matches, unreviewed messages, requests needing verification, and failed tasks).
- Scans: `POST /profiles/:id/scans` with `{ targetIds }` or `{ preset: "people_search" }`, `GET /profiles/:id/scans`.
- Review: `GET /review?profileId=` (blocked tasks, matches, verifications, failed tasks, and unclassified messages), `POST /tasks/:id/resume`, `POST /tasks/:id/cancel`, `POST /tasks/:id/mark-done` with `{ result?, note? }`, `POST /tasks/:id/hand-off`, `POST /tasks/:id/retry`, `GET /tasks/:id/screenshot`, `POST /matches/:id/decision` with `{ decision, rights }`, `GET /messages/:id` (the whole message), `POST /messages/:id/classification`.
  `hand-off` takes a blocked scan, form, or agent task away from the built-in worker and gives it to an agent.
  `retry` dispatches the request of a task that failed for good again.
- Recipes: `GET /recipes?status=`, `POST /recipes/:id/approve`, `POST /recipes/:id/reject`.
- Settings: `GET /settings`, `PATCH /settings`, `POST /settings/mcp-token`, `GET /settings/jurisdictions`, `GET /settings/data-sources`.
- Worker (bearer worker token): `POST /worker/heartbeat`, `POST /worker/claim`, `POST /worker/tasks/:id/heartbeat`, `POST /worker/tasks/:id/complete`, `POST /worker/tasks/:id/block`, `POST /worker/tasks/:id/fail`, `POST /worker/tasks/:id/release`.
- MCP (bearer MCP token) at `/mcp`, streamable HTTP, tools in 5.E.

### 4.5 Web shell (`apps/web`)

- React 19, `react-router`, `@tanstack/react-query`, Tailwind v4, `lucide-react` icons.
- Design tokens as CSS variables for light and dark, mapped into Tailwind's theme, following the frontend-pixel-perfect skill.
- A typed API client in `src/api/` built from `shared/api.ts`, which sends the `X-Kick-Rocks` header and redirects to login on 401.
- An app layout with sidebar navigation, a profile switcher (current profile kept in localStorage), and an auth gate that routes to `/setup` or `/login`.
- UI components in `src/components/ui/`: Button, IconButton, Input, Select, Textarea, Checkbox, Field (label, help, error), Card, Badge, StatusPill (one color per request status), Table, Tabs, Dialog, Toast, EmptyState, Skeleton, Spinner, PageHeader, CopyButton, CodeBlock.
- Routes with stub pages: `/setup`, `/login`, `/`, `/profiles`, `/profiles/new`, `/profiles/:id`, `/profiles/:id/mailbox`, `/targets`, `/targets/:id`, `/campaigns/new`, `/requests`, `/requests/:id`, `/review`, `/settings`, `/settings/agents`, `/about`.
- A mock API for UI work: `pnpm --filter @kickrocks/web dev:mock` starts Vite with a plugin that answers `/api/*` from handler modules in `apps/web/mock/`, one file per domain, each validated against the shared schemas and backed by in-memory fixture state.
  `mock/mock.test.ts` holds only what is true of the mock as a whole (coverage, the server's rules, reserved domains, determinism); what a domain's handlers do is tested in `mock/<domain>.test.ts`, which the page agent that owns the handlers owns, using `mock/test-helpers.ts`.
  Validation issues carry the same `body`, `query`, or `params` prefix the server sends, built by the shared `toApiIssues`.
- Web tests: `.test.ts` files run in Node and `.test.tsx` files in jsdom with Testing Library (`@testing-library/react`, `user-event`, `jest-dom`), all installed by the foundation, so a page agent never edits `package.json` or the lockfile.
  `src/test/render.tsx` has `renderPage(<Page />, { route?, path?, mockOptions? })`, which wraps a page in the query client, router, toast provider, and current-profile provider with `fetch` answered by the mock API.

## 5. Feature modules

### A. auth-profiles

- First run: `POST /auth/setup` sets the instance password (argon2id) only while none exists.
- Sessions: random 32-byte token in an HttpOnly, SameSite=Strict cookie, stored hashed, sliding 30-day expiry, `Secure` when served over HTTPS.
- Login throttling per IP with backoff; constant-time responses.
- Replace the foundation auth stub.
  The guard already enforces `X-Kick-Rocks` on every state-changing route and routes `/api/auth/password` through `authenticate` like any session route, so `authenticate` only decides whether there is a session.
- Profiles CRUD and identities replacement with validation (exactly one primary name, at least one email, dates sane).
  The shared schema checks everything that does not depend on today's date; the one rule that does, that a date of birth is not in the future, is `validateIdentities(inputs, today)` with `today` taken from `services.clock`, and a failure is answered as a 400 with `body`-prefixed issue paths.
- Settings: schedule (`pollMinutes` default 15, `peopleSearchRescanDays` 60, `brokerRescanDays` 90, `noResponseDays` 45, `maxFollowUps` 2), LLM (`baseUrl`, `model`, `apiKey` for any OpenAI-compatible endpoint such as Ollama), MCP enable and token rotation (token returned once, stored hashed), jurisdictions and data sources passthrough, worker status.

### B. mail

- Provider presets: Gmail, Google Workspace, Fastmail, iCloud, Yahoo, Proton Mail Bridge, mailbox.org, Zoho, and Other, each with the app-password link and caveats.
  Outlook.com is listed as unsupported with the reason.
- `MailTransport` on nodemailer: verify, and send plain-text mail with our Message-ID, the reference in the subject, and no tracking.
- `InboxSource` on imapflow: list folders, fetch since the last UID in the reply folder, handle UIDVALIDITY resets, parse with mailparser.
  `fetchSince` honors `since` (IMAP SINCE) and `limit`, and reports `hasMore` and `highestUid`, as described in 4.3.
  Parse links out of the HTML body with `htmlparser2`, which the foundation added to `apps/server`, rather than with regular expressions.
  Verify DKIM on the raw source of each fetched message (`mail/dkim.ts`, on `mailauth`) and expose a lazy check on `InboxMessage.verifyDkim` that returns the signatures that verified over the whole body and align with the given domains, each with the In-Reply-To, References, and Subject values it covers.
  The resolver has a short timeout and a small cache, and a DNS failure or timeout means no domain is verified, so the message goes to review and the poll goes on.
  Authentication-Results headers are never read, because a provider can echo sender-controlled text into them.
- `ReplyClassifier`: correlate by In-Reply-To or References matching our Message-ID, then by the `KR-` reference in subject or body, then by sender domain against awaiting requests (lower confidence).
  The recipient address is never a trust input.
  A reply changes a request (completed, no_record, rejected, verification_required, needs_form, or a bounce that switches channel) only when at least one DKIM signature verifies over the whole body with a d= that shares an organizational domain (public suffix list) with the target's domain or one of its known sender domains, and that same signature binds the message to this request.
  A signature binds when its h= covers In-Reply-To or References and those signed headers hold this request's outgoing Message-ID (any sequence variant), or its h= covers Subject and the signed Subject holds this request's `KR-` reference, or the body it fully covers holds the reference.
  Signed headers are read raw from the instance the signature hashed (the bottom-most per RFC 6376), with only folding removed.
  A reply that fails either test is capped below 0.6 so it goes to review, and its rationale says "not signed by the broker" or "does not quote this request".
  A `confirmation_link` needs only the first test, keeping the link-domain restriction and the company-deletion rule.
  Detect bounces from DSN reports and mailer-daemon senders, auto-replies from `Auto-Submitted` and common patterns, and the other classes from keyword rules.
  Extract links and keep only those on the target's domain, its known subdomains, or an expected sender in `awaitingConfirmation.fromDomains`.
  For `verification_required`, return the identifiers the broker asked for as `requestedFields` (profile field names only).
  A broker's confirmation email after a form submission has no `KR-` reference and no In-Reply-To, so apply the matching rule documented on `ClassifierRequest.awaitingConfirmation`, with confidence of at least 0.8, because following a link on the sender's own domain needs only that a DKIM signature of the sender verified.
  Store each message with its text cut to 20,000 characters, for `GET /messages/:id`.
  When confidence is below 0.6 and an LLM is configured, ask it for a classification with a strict JSON schema; otherwise leave the message for review.
- `LinkFollower`: GET with redirects re-validated hop by hop against the allowed domains, refusing private and loopback addresses unless the host is in `config.linkFollower.allowedPrivateHosts`, with a size and time limit; report `needsBrowser` when the page needs JavaScript or a button press.
- Mailbox routes in 4.4, with the password never returned to the client.
  `POST /profiles/:id/mailbox/test` falls back to the stored secret when no password is sent.
- Integration tests against GreenMail in Docker; CI provides it as a service.

### C. legal

- Research and encode every US state comprehensive privacy law in effect or enacted as of today: statute name, citation, effective date, rights to opt out of sale and to delete, response deadline and extension, data broker specifics, and a primary-source URL.
  Include California's Delete Act and DROP, and note where DROP should be preferred.
- `resolveLegalBasis({ state, target, rights, asOf })` returns the statute basis when a law is in effect at `asOf` and covers this target and these rights, otherwise a policy-based request that asks the business to honor its own published privacy commitments.
  The data broker statutes (California's Delete Act, and the Vermont, Texas, and Oregon broker laws) apply only to data brokers, some statutes give a right to opt out of sale but not to deletion, and DROP is preferred only for a broker registered with California.
  `getLegalBasis(id, state)` returns the basis a stored id names, as it was, so a follow-up can cite the statute the first request cited even after a newer law takes effect; it is null for an id the package does not know.
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
  A target that is left out is reported with a `SkipReason` and a `detail` sentence: `already_active`, `no_contact_method`, `scan_in_progress`, `no_mailbox` (an email request and no mailbox), `already_confirmed` (nothing is re-sent after a confirmed removal unless a re-scan finds the person again), `unsupported_channel` (only postal mail, fax, a phone call, or payment), and `covered_by_platform` (California's DROP covers a registered broker).
  Create requests with `services.requests.open`, and build the preview's `sampleEmail` with `services.composer.requestEmail`, so the preview is the mail that goes out.
- Requests list with filters and detail with timeline, messages, tasks, and `actions` from `availableActions`; user actions per 4.4, with `resend` implemented by `services.requests.requeue` (kind from `resendEmailKind`).
- `POST /requests/:id/verification`: check that the message belongs to the request and that `fields` is a subset of its `requestedFields`, then `requests.requeue` with kind `verification_reply`, the fields, and `inReplyTo` set to the message's Message-ID, writing a `user_action` event.
- Dashboard counts by status, needs-attention counts (including failed tasks), today's sends against the daily cap from `services.mailQuota`, and recent events.

### D2. automation

- Scheduler loop, off when `KICKROCKS_SCHEDULER=off`: reap leases, enqueue inbox polls per mailbox on the poll interval, run in-process tasks, move overdue `awaiting_reply` requests to `no_response` then `follow_up_due` and send follow-ups up to `maxFollowUps`, re-scan people-search targets every `peopleSearchRescanDays`, re-send unconfirmed broker requests every `brokerRescanDays`, enqueue weekly canary checks only after a password is set and Settings has site checks turned on (with it off, canaries still waiting are cancelled, so no browser task visits a broker site on its own), run the notification pass, and delete the artifacts of finished tasks older than the screenshot retention window (30 days by default, set in Settings).
- `email_send` runner: compose with `services.composer.requestEmail` (the payload's kind, fields, and inReplyTo), send with `MailTransport`, record the send with `mailQuota.record`, and set `sentAt` and `dueAt` from the legal basis.
  Respect the mailbox daily cap and a jittered gap between sends (20 to 60 seconds) using `mailQuota.remaining` and `mailQuota.lastSentAt`: claim with `excludeProfileIds` for mailboxes that are capped, and `release` a task that has to wait, with `runAfter`, instead of failing it.
- `inbox_poll` runner: fetch (from the mailbox's creation time or its oldest outstanding send, never the whole folder), store, classify, and apply, using `REPLY_OUTCOMES` and `canTransition`; a reply the machine will not apply is only recorded.
  `completed` confirms, `no_record` and `rejected` close, `verification_required` moves to `needs_verification` and stores the message's `requestedFields` for the review queue, `confirmation_link` follows the link or enqueues a `confirm` task when a browser is needed, `bounce` switches to the form channel when the target has one, `needs_form` switches channel (both through `requests.requeue` with a `channel_switched` event), `auto_ack` only adds an event, and low-confidence mail waits for review.
- Task handlers, synchronous and inside the transaction of the task change (see `core/task-handlers.ts`): scan results become matches (deduplicated against earlier decisions by `normalizeRecordUrl`), form and agent results move a `queued` request along with `FORM_OUTCOMES` (and a request that has moved on is left alone), and a `recipe` failure calls `dispatch.fallbackToAgent` and `recipeHealth.recordRun` (only `recipe` failures count toward health).
  A form result with `awaiting_email_confirmation` sets `awaitingConfirmationSince` and writes `awaiting_confirmation` from the recipe's `email_confirmation` step or `FormResult.confirmationFrom`.
  Either sender is kept only when it is the same organizational domain as the target or is in the target's curated `replyDomains`, and never a shared host.
  A sender that merely belongs to some other target in the dataset does not count, because a company platform that relays user content would then vouch for mail it does not control.
  Broker `replyDomains` live in `packages/brokers/data/reply-domains.yaml` with a note each, and `pnpm data:build` fails when a bundled recipe's `email_confirmation` `fromDomain` is neither its broker's own site nor one of those domains.
  The task timeline events are written by `core/task-audit.ts`; handlers do not write them.
  A person's result from `POST /tasks/:id/mark-done` reaches handlers as the task result, null when they gave none.
- Scans routes and the review routes in 4.4, including deciding matches (`mine` calls `requests.open` for a form request with the record URL and the body's `rights`), classifying messages by hand, `GET /messages/:id`, `POST /tasks/:id/hand-off` (`dispatch.handToAgent`), and `POST /tasks/:id/retry` (dispatch the task's request again, or its scan).
  `ReviewQueue.verifications` lists requests in `needs_verification` with the message and its `requestedFields`, and `failedTasks` lists final failures from the last 30 days whose request, if any, is still open.
- The scheduler enqueues work through the `dispatch` helpers (`enqueueInboxPoll`, `enqueueCanary`, `enqueueScan`) and sends follow-ups through `requests.requeue` with kind `follow_up`.

### E. agent-api

- Worker API in 4.4 with the worker token, claiming only browser kinds (default `WORKER_DEFAULT_KINDS`, claimer kind `builtin`, or `model` when the worker says so) and returning `ClaimedTask`, through `claimTask`.
  `POST /worker/tasks/:id/release` hands a task back without costing an attempt, and complete, block, and fail take `usage`.
- MCP server at `/mcp` using `@modelcontextprotocol/sdk` streamable HTTP, with tools `list_tasks`, `claim_task`, `heartbeat_task`, `complete_task`, `block_task`, `fail_task`, `release_task`, `get_target`, `get_recipe`, and `propose_recipe`.
  Tool inputs and outputs are the shared schemas; `claim_task` returns the `ClaimedTask` with instructions, takes `AGENT_DEFAULT_KINDS` unless told otherwise, and records claimer kind `mcp`.
  `claim_task({ taskId })` calls `claimTask` with the id, so a queued task is leased as it is and a blocked one is handed to an agent and leased in the same call; this is how an MCP client picks up a blocked task, as the Milestone 3 deliverable says.
- Recipes module: sync bundled recipes from `packages/recipes` and `KICKROCKS_EXTRA_RECIPES` at startup, list proposed recipes, approve or reject them, and update health from canary results.
  The sync runs from the startup seam in 4.3 after targets are synced, and reports a recipe that `recipeTargetProblems` (`core/recipe-catalog.ts`) flags, such as an unknown `brokerId` or a page on another site, instead of skipping it silently.
- `docs/agents.md`: how to connect Claude Code (`claude mcp add --transport http ...`) or any MCP client, what an agent task looks like, and the rules agents must follow.

### F. worker

- `apps/worker`: config from env, typed client for the worker API, claim loop with heartbeats, graceful shutdown, and one task at a time.
- Playwright with a persistent profile, using installed Chrome when present and bundled Chromium otherwise, headed under Xvfb inside Docker.
- Human-paced input: per-key typing delay and small random pauses.
- `packages/recipes/src/runner`: executes recipe steps against a page, resolves selectors (role and label, then test id, then CSS, then text), fills fields, extracts candidates, detects CAPTCHAs (reCAPTCHA, hCaptcha, Turnstile, and Cloudflare or "verify you are human" interstitials) and blocks with a screenshot, and returns typed results or a typed failure.
  It implements every step in `packages/recipes/recipes/README.md`: `optional` steps are skipped when their target does not show up within a short timeout, `wait_for` honors `state`, `frame` scopes a step to an iframe, `select_record` matches items by `normalizeRecordUrl` and ends the run as `not_found` when results exist but none matches (and fails it as a recipe failure when the page has no results at all), `outcome_when` ends a run with the first matching outcome, and a canary runs its `canary.steps` before it checks selectors.
  A `goto` to `{{record_url}}` is rendered and then checked before navigation: `https`, and a host equal to the target's domain or one of its subdomains (use `isOnDomain`); anything else fails the run as a `recipe` failure.
  A failed run carries a `kind` (`recipe`, `site`, `network`, or `internal`) and the failing `step`.
  A `recipe` failure is always `retryable: false`; the server counts only those against recipe health and hands the task to an agent.
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

### Development stack and suite

`docker-compose.dev.yml` runs the server, the worker, GreenMail, a fixture broker site, and an `edge` forwarder.
Every container but `edge` is on an internal network with no route out, so the stack cannot reach a real mail server or a real broker site.
`e2e/` holds the suite (`pnpm e2e`), the fixture site (`e2e/fixtures/site`), and the test-only targets and recipes (`e2e/fixtures/targets.json`, `e2e/fixtures/recipes`).
The suite checks that no container can open a connection to the internet.
