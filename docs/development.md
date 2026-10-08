# Development

This page is for people changing kick rocks.
[DESIGN.md](DESIGN.md) has the reasoning behind the big decisions, and [DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) has the rules for the web UI.
Running it as a user is in [self-hosting.md](self-hosting.md).

## Prerequisites

- node 22 and pnpm 10 (the version is pinned in `package.json`).
- docker, for `pnpm e2e` and for the greenmail mail server some tests use.
- chrome or a playwright chromium, for the recipe runner tests and the screens step of the e2e suite.
  `pnpm --filter @kickrocks/recipes exec playwright install chromium` installs one.

```sh
pnpm install
pnpm data:build
pnpm build
pnpm dev
```

`pnpm data:build` has to run before anything that loads the broker dataset, because `packages/brokers/data/generated/` is not committed.
`pnpm build` is needed once because every workspace package is consumed through its `dist` output, so the server can't import a package that hasn't been built.
`pnpm dev` does not rebuild `packages/*` when you edit them, so run `pnpm build` again after a change there.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | The server on 8420 and the web app on 5173, which proxies `/api` to the server. |
| `pnpm dev:worker` | The browser worker with a headed chrome. Set `KICKROCKS_WORKER_TOKEN` first, and give the server the same value. |
| `pnpm --filter @kickrocks/web dev:mock` | The web app alone, with `/api` answered by the in-memory mock in `apps/web/mock`. Starts signed in, and the mock password is `kickrocks-mock`. |
| `pnpm test` | Every package's vitest suite. |
| `pnpm lint` | `biome check .` for formatting and lint rules. `pnpm lint:fix` applies the safe fixes. |
| `pnpm typecheck` | `tsc` in every package. |
| `pnpm build` | Builds every package and app. |
| `pnpm data:build` | Builds the shared package, then the broker dataset. See [The dataset](#the-dataset). |
| `pnpm e2e` | The full flow against a local docker stack. See [End-to-end tests](#end-to-end-tests). |

CI runs lint, `data:build`, typecheck, test, and build, in that order, with greenmail as a service and chromium installed.
It also builds all three docker images, so a missing package in a Dockerfile fails before it reaches an install.
Run the same five commands before you commit.

The server reads its settings from the environment, not from `.env`.
The settings that only matter outside docker are in [self-hosting.md](self-hosting.md#settings).

### What the tests cover

- Unit and module tests sit next to the code as `*.test.ts` (and `*.test.tsx` for the web app, which runs in jsdom with testing library).
- Server tests build the whole app in a few lines through the harness in `apps/server/src/test-utils/`, over a temporary encrypted database, a fake clock, fake mail, and a fake legal package.
  Its README lists the factories.
- Tests that need greenmail or chromium skip themselves when the service is missing, and fail when `KICKROCKS_REQUIRE_INTEGRATION=1` is set, which CI does.
  Locally, start greenmail the way `.github/workflows/ci.yml` does.
  The tests look for it at localhost on ports 3025 and 3143, and `GREENMAIL_HOST`, `GREENMAIL_SMTP_PORT`, and `GREENMAIL_IMAP_PORT` override that.
- `packages/recipes/test` runs the recipe runner against local fixture pages in real chromium.
- A test over every bundled recipe checks that its broker exists in the generated dataset and that its pages are on that broker's domain.
- `apps/web/design` holds tests that keep the design tokens and the toast copy in line with the design language.

### End-to-end tests

`pnpm e2e` starts the stack in `docker-compose.dev.yml`, runs the suite in `e2e/` against it, and stops the stack again.
It builds the server and worker images on the first run, which takes a few minutes.
It uses ports 8520 (web and API), 3525 (smtp), 3643 (imap), and 8530 (fixture site), so stop anything on those first.

The stack has the real server and worker, a greenmail mail server, and a fixture site that imitates a people-search site, with test-only targets and recipes from `e2e/fixtures`.
Nothing in it can reach the internet or a real mail server.
Its containers sit on an internal docker network, and mail to any address stays inside greenmail.
The suite drives the HTTP api and an mcp client the way the web app and an agent do.
One step also opens every screen in chrome, at desktop and phone width in light and dark, and fails on sideways scrolling, console errors, or failed requests.

The journey covers setup and login, a profile, the mailbox, a campaign with sends, a broker reply of every class, polling by hand and by the scheduler, a verification reply, a scan and a confirmed match, a removal by the worker with an emailed confirmation, a captcha that blocks and is resumed from the review queue, and an agent task claimed and completed over mcp.

- `KICKROCKS_E2E_KEEP=1 pnpm e2e` leaves the stack running, so you can open http://127.0.0.1:8520 and look around with the password `correct horse battery staple`.
- `KICKROCKS_E2E_NO_BUILD=1 pnpm e2e` reuses the images from the last run.
- The stack sets `KICKROCKS_SEND_GAP_MS=0`, `KICKROCKS_PLAINTEXT_MAIL_HOSTS=greenmail`, `NODE_ENV=development`, and `KICKROCKS_DKIM_TEST_KEYS=/dkim/keys.json`, which a real install must not.
- The stack has no internet, so `pnpm e2e` writes a throwaway dkim key pair to `e2e/.dkim` before the stack starts.
  The server reads the public key from that file instead of DNS, and the suite signs its broker replies with the private key.
  Starting the stack by hand with `docker compose -f docker-compose.dev.yml up` needs that folder, so run `pnpm e2e` once first.

## Repository layout

The repo is a pnpm workspace of `apps/*`, `packages/*`, and `e2e`.

| Path | Owns |
|---|---|
| `apps/server` | The fastify api, scheduler, mail handling, task queue, worker api, and mcp server. The only code that touches the database. |
| `apps/web` | The react ui (react 19, react-router, tanstack query, tailwind v4). The server serves its build in production. |
| `apps/worker` | The browser worker. Claims scan, form, confirm, and canary tasks, runs recipes in chrome, never touches the database. |
| `apps/agent-worker` | The optional model-driven worker for tasks no recipe covers. See [agents.md](agents.md). |
| `packages/shared` | The zod schemas and types every other part agrees on: api routes, tasks, requests, recipes, settings, mcp tools. |
| `packages/db` | The drizzle schema, migrations, and the sqlcipher-encrypted connection. |
| `packages/brokers` | Builds the broker and company datasets from the upstream sources. |
| `packages/legal` | State privacy law data, legal basis selection, identifier minimization, and the request email templates. |
| `packages/recipes` | The recipe files, the loader, and the runner that executes them. |
| `e2e` | The docker stack and the end-to-end suite. |

Validate every external input (http bodies, query strings, imap data, worker results, dataset files) with a zod schema from `@kickrocks/shared` where one exists.
A change to a schema there is a contract change, so check every consumer.

## Architecture

Three processes share one data contract.
The server owns all state in an sqlcipher-encrypted sqlite file.
Workers never touch the database: they lease tasks from the server over http, do the work, and post results back.
That boundary is what lets an mcp client act as a worker too.

```
apps/web  <--http-->  apps/server  <--worker api / mcp-->  apps/worker, apps/agent-worker, mcp clients
                          |
                  encrypted sqlite (data volume)
```

### Server structure

- `services.ts` builds one `AppServices` object: config, db, clock, logger, task queue, requests, targets, dispatch, composer, mail quota, settings, mail, legal, and auth.
  Feature code receives it as an argument and never builds its own, which is also what lets tests swap the clock and the mail.
- Every folder in `src/modules/<name>` exports a fastify plugin registered under `/api`.
  Routes are registered with `registerRoute` from `core/http.ts`, which takes the route from `API_ROUTES` in `packages/shared`, validates params, query, and body, and tells the guard who may call it.
- Startup order in `buildApp`: sync the datasets into `targets`, register every module, run the steps modules registered with `onReady` in order, then start the scheduler.
  A module that stores rows pointing at targets does it in a startup step, never when its plugin registers.
  A step that throws stops the server from starting.
- The guard in `core/guard.ts` is the one place that decides who may call what, from the route table.
  A `session` route needs the `kr_session` cookie, a `worker` route needs the worker bearer token, `/mcp` needs the mcp bearer token, and an `/api` route nobody declared needs a session.
  Every state-changing call under `/api` also needs the `X-Kick-Rocks: 1` header, which a cross-site form can't send, and bearer-token calls are exempt.
- Responses carry `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and a content security policy of `default-src 'self'`.
  Fonts are vendored for that reason.
- The server checks the `Host` header against loopback, ip addresses, the public url, and `KICKROCKS_ALLOWED_HOSTS`.
- Tokens are compared in constant time and stored as sha256 hashes where they are shown once.
- Sessions are a random 32 byte token in an HttpOnly, SameSite=Strict cookie, stored hashed, with a sliding 30 day expiry.
  Passwords use argon2id, and sign-in is throttled per address.

### The task queue

All browser and agent work flows through one queue in `core/task-queue.ts`.
The built-in worker, the agent worker, and an mcp client all claim tasks the same way.

- Task kinds are `email_send` and `inbox_poll`, which run inside the server, and `scan`, `form`, `confirm`, `canary`, and `agent`, which need a browser.
  A blocked task is the human queue.
- Payloads hold ids only.
  Personal data is resolved at claim time, so it never sits in a stored payload, and the claimer gets only the fields the recipe declares or the identifiers minimization allows.
- A claim is atomic and takes the highest priority, then the oldest.
  It leases the task for a limited time, and the claimer extends the lease with heartbeats.
  An expired lease is recovered on the next claim, so the queue is correct even with the scheduler off.
- `complete`, `block`, and `fail` are still accepted from a worker that holds an expired lease until someone else claims the task, because finished work is better kept than redone.
- A failure is retried with exponential backoff until `maxAttempts`, except a `recipe` failure, which is final because the same script would fail the same way.
  The server counts only recipe failures against a recipe's health and hands that task to an agent.
- Each live piece of work has a `dedupeKey`, so two modules asking for the same work get one task.
- Task handlers in `core/task-handlers.ts` run synchronously inside the transaction that changed the task.
  The task change and everything a handler writes commit or roll back together, so a crash can't leave a scan without its matches.
  Work that can't be undone, such as sending mail, is queued as a task and done by a runner.
- `core/task-audit.ts` puts what happens to a task on its request's timeline, so modules apply consequences and don't write those events themselves.
- `core/dispatch.ts` is the one place that decides what a request or scan turns into: an `email_send` task, a `form` task with the newest working recipe, or an `agent` task when there is none.

### Requests

A request is one ask to one target, and it moves through a state machine defined in `packages/shared/src/requests.ts`.

```
draft -> queued -> sent -> awaiting_reply -> confirmed | rejected | no_record
                                          -> needs_verification -> queued
                                          -> bounced -> queued (channel switch)
                                          -> no_response -> follow_up_due -> queued
cancelled from any non-terminal status
```

- `canTransition(from, to, { actor })` is the rule, and only a person may force a status.
  A reply or a form result is applied to whatever status the request is in when it arrives, and one the machine won't apply is recorded without changing the status.
- Every status change is a `request_events` row, validated against a per-type payload schema, and the web timeline renders them.
- `requests.open` creates a request and queues it in one step, and `requests.requeue` sends it back through the queue for a resend, a follow-up, a verification reply, or a channel switch.
  Campaigns, match decisions, relisting, and the follow-up scheduler all go through these.
- The campaign preview and the email runner both call `composer.requestEmail`, so the preview is the mail that goes out.
- Every request has a reference `KR-XXXXXX`, six Crockford base32 characters, which goes in the subject.
- The legal basis is stored on the request, so a follow-up cites the statute the first email cited even after a newer law takes effect.

### Mail

- Sending is nodemailer over the person's own smtp account, plain text, with our `Message-ID`, the reference in the subject, and no tracking.
  Each mailbox has a daily cap and a jittered gap between sends, both read from the `outgoing_mail` table.
- Receiving is imapflow, fetching from the last uid in the reply folder and handling uidvalidity resets.
  The first poll starts from the mailbox's creation time or its oldest outstanding send, never the whole folder.
- A reply is matched to a request by `In-Reply-To` or `References`, then by the `KR-` reference, then by sender domain with lower confidence.
  The address it was sent to is never a trust input.
- The server verifies dkim itself on the raw message and ignores every `Authentication-Results` header, because a provider can echo text a sender wrote into it.
  A reply changes a request only when a signature that covers the whole body verifies, its domain shares an organizational domain with the target (or a sister domain in `reply-domains.yaml`), and the same signature ties the reply to this request through a signed `In-Reply-To`, `References`, or `Subject`, or a body that holds the reference.
  Anything else is capped below 0.6 confidence and waits in review with the reason "not signed by the broker" or "does not quote this request".
  A confirmation link needs only the first test, and the link follower stays on the broker's own domain.
  If dns can't be reached, the message goes to review and the poll carries on.
- The link follower re-validates every redirect hop against the allowed domains, refuses private and loopback addresses, and caps size and time.

### Data model

`packages/db/src/schema.ts` is the source of truth.
The tables: `profiles`, `identities`, `mailboxes`, `targets` (brokers and companies together), `recipes`, `campaigns`, `requests`, `request_events`, `outgoing_mail`, `messages`, `scans`, `matches`, `tasks`, `task_artifacts`, `sessions`, and `settings`.

- Task payloads and results are stored as validated json.
- Screenshots live in `task_artifacts`, so they are encrypted at rest.
- Targets that vanish from a dataset are marked `retired`, not deleted, so old requests keep their detail pages.
- The server applies migrations when it starts.
  Generate a new one with `pnpm --filter @kickrocks/db db:generate` and commit it, and never edit one that has shipped.

### Recipes

A recipe is a json file named `<brokerId>.<purpose>.v<version>.json` in `packages/recipes/recipes`.
The format is in `packages/recipes/recipes/README.md` and the schema is `Recipe` in `packages/shared/src/recipe.ts`.

- The runner resolves selectors by role and label first, then test id, then css, then text.
- It detects captchas and bot walls and blocks the task with a screenshot.
  It never solves them.
- Every recipe has a canary that loads the page and checks the key selectors without submitting.
- A bundled recipe that was never seen through to a real removal starts switched off until a person approves it in Settings.
- A bundled recipe's `email_confirmation` sender must be in its broker's own organizational domain or in the broker's `replyDomains`, and `pnpm data:build` fails when it isn't.

### Web app

- Tokens, scale, and component rules are in [DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md), and `apps/web/src/index.css` holds the values.
- `src/api/` is a typed client built from `packages/shared/src/api.ts`, so the web app and the server agree by construction.
  It sends the `X-Kick-Rocks` header and redirects to sign-in on a 401.
- Each page lives where its url says, under `src/pages`, and exports a component named `Component` so the router can lazy-load it.
- `apps/web/README.md` covers the mock api, the `/dev/ui` style guide, and how to add a page.

## The dataset

`pnpm data:build` runs `packages/brokers/src/build.ts` and writes `packages/brokers/data/generated/brokers.json`.
The company list is committed as `companies.json` and is not generated.

1. The sources are read from `packages/brokers/data/upstream`, each pinned by a `*.source.json` file with a commit or retrieval date and a hash.
   The build fails when a pinned file doesn't match its hash.
2. Importers in `src/import` turn each source into broker records: the people-search section of BADBOOL, the eraser list, the california registry csv (found by header text, with the metrics year taken from the file), and the hand-written `curated-brokers.yaml`.
3. `excluded.yaml` drops sites one list removed but another still carries, and `corrections.yaml` replaces fields on imported records.
   Each correction names the pages it was read from and the day it was checked, and the build fails when a correction matches no record or changes none.
4. `mergeBrokers` merges by domain in the order BADBOOL, eraser, california registry, curated.
   An earlier source wins a conflict and a later one fills empty fields.
5. Broker ids are permanent.
   `ids.json` maps every domain to its id and is committed, the merge keeps an id pinned whichever source wins, and the build appends the id of any new domain, so commit the file whenever it changes.
6. `reply-domains.yaml` adds the sister domains a broker's confirmation mail may come from, and the build checks bundled recipes against it.
7. The output carries `license: CC-BY-NC-SA-4.0` and the BADBOOL attribution, and the build validates it against the shared schema.

To update a pinned source, replace the file, update the commit or date and the hash in its `*.source.json`, rebuild, and review the diff.
To add a state registry, write an importer next to `src/import/ca-registry.ts`, pin its file, and put it after the california registry in `build.ts`.
[packages/brokers/data/NOTICE.md](../packages/brokers/data/NOTICE.md) has the licenses and why other states aren't imported.

## Conventions

- typescript strict, esm, node 22.
- Comments explain why, never how.
  If code needs a comment to explain how it works, refactor it.
- Don't use the em dash anywhere: code, comments, docs, ui copy, test names.
- ui copy is plain and short, with no exclamation marks and no emoji.
- Long markdown puts each sentence on its own line.
- Never submit a form on a real broker or company site from a test or a script.
  Loading public pages is fine, and so is searching a people-search site for a generic name such as "John Smith".
- Never send mail to a real address from a test.
  Mail tests use greenmail, which accepts every domain and never relays.
- Never put real personal data in code, tests, fixtures, or screenshots.
  Use names like "Jordan Example" and domains under `example.com`, `example.org`, or `.test`.
- Never solve or bypass a captcha, and don't add solving services or stealth plugins.
  Detect the challenge and block the task for a person.
- Don't edit generated files by hand.
