# Design: Kick Rocks

## Status: Accepted, in development

## Problem Statement

People have legal rights to stop companies selling their data and to have data brokers delete it, but exercising those rights means hundreds of emails, web forms, CAPTCHAs, and follow-ups that almost nobody completes.
Kick Rocks is a self-hosted tool that sends those requests from the user's own mailbox, drives broker opt-out forms with per-site recipes and an agent fallback, tracks every reply, and keeps doing it on a schedule.

## Context

Research gathered in October 2026 shapes this design.
Only 26 to 38 percent of California-registered brokers respond to opt-out or deletion requests, 37 to 39 percent illegally demand identity verification for opt-outs, 22 percent put a CAPTCHA in the flow, and 75 to 80 percent accept requests only through a web form.
California's DROP platform now handles registered brokers for California residents, so the gap is everyone else, plus people-search sites and ordinary companies.
Self-hosted mail servers cannot deliver reliably from residential IPs, so the tool sends from the user's existing mailbox instead.
Datacenter IPs trip bot management on people-search sites, so the browser runs on the user's home connection.

## Requirements

### Must Have

- Multiple profiles per instance, each with its own connected mailbox.
- Mailbox connection over SMTP and IMAP with an app password for Gmail, Fastmail, iCloud, Proton Bridge, and generic providers.
- Broker dataset covering marketing brokers, people-search sites, and background-check companies, imported from permissively licensed sources and extendable by users.
- Company dataset for "stop selling my data" requests to ordinary consumer companies.
- Request templates that cite the legal basis for the user's state, or a policy-based request where no statute applies.
- Bulk email sending with a per-mailbox daily cap, jittered pacing, and a request ID in every subject.
- IMAP monitoring that correlates replies to requests, classifies them, advances status, and queues ambiguous mail for review.
- Automatic following of email confirmation links, restricted to the broker's own domain.
- People-search scanning that finds candidate records and shows them to the user for confirmation before any removal.
- Deterministic per-broker recipes that drive opt-out forms in a real Chrome on the user's machine.
- CAPTCHA, phone, and ID demands detected and parked in a human review queue in the web UI.
- A task queue exposed over MCP so Claude Code, a local model, or any MCP client can claim open or blocked tasks and report results.
- Scheduler with defaults of 60 days for people-search re-scans, 90 days for other brokers, 45 days before retrying unanswered requests, and no re-sends after a confirmed removal unless a re-scan finds the person again.
- Personal data encrypted at rest.
- One Docker Compose file that brings up everything.

### Nice to Have

- API-key and local-model workers that consume the same task queue the MCP server exposes.
- Push notifications over ntfy or Telegram when a task blocks.
- Outlook.com support through OAuth.
- GDPR templates and EU broker data.
- Daily email digest of status changes.

### Out of Scope

- Acting as an authorized agent for other people. Every request is sent by the data subject from their own mailbox.
- Running or configuring a mail server.
- Solving CAPTCHAs automatically or evading bot detection beyond using a real browser on a residential connection.
- Claiming a residency or legal basis the user does not have.
- Hosted or multi-tenant SaaS operation.

### Assumptions

- Users can create an app password on their mail provider and have two-factor authentication enabled where that is required.
- The host machine has Docker and a residential internet connection.
- Users accept that some brokers will ignore requests regardless of what the tool does.

## Proposed Architecture

### Overview

A TypeScript monorepo with three runtime processes and a shared encrypted SQLite database.

```
+-------------+      +-----------------------------+      +-------------------+
|  apps/web   | <--> |  apps/server                | <--> |  apps/worker      |
|  React UI   | HTTP |  API, scheduler, mail,      | task |  Chrome + recipes |
|             |      |  task queue, MCP server     | queue|  + agent fallback |
+-------------+      +-------------+---------------+      +-------------------+
                                   |
                                   v
                          encrypted SQLite (data volume)
```

The server owns all state.
Workers never touch the database directly; they lease tasks from the server, do the work, and post results back.
That boundary is what lets an MCP client act as a worker too.

### Components

**apps/web**: React and Vite single-page app served by the server in production.
Screens are onboarding, profiles, mailbox connection, broker and company lists, request timeline, match confirmation queue, blocked-task queue, and settings.

**apps/server**: Node and Fastify.
Modules are `profiles`, `mail` (SMTP sending, IMAP polling, reply classification, confirmation links), `requests` (lifecycle and templates), `tasks` (queue with leases), `scheduler`, `recipes` (catalog and health), `mcp` (MCP server over streamable HTTP exposing the task queue), and `api` (REST for the web UI).

**apps/worker**: Node process that runs Chrome through Playwright on the host's network.
It claims `scan`, `form`, and `confirm` tasks, executes the matching recipe step by step, detects CAPTCHAs and verification walls, and either completes the task or marks it blocked with a screenshot and the reason.
When no recipe exists or a recipe fails, the worker re-queues the task as an `agent` task for an MCP client or model-backed worker to pick up.

**packages/db**: Drizzle schema and migrations over `better-sqlite3-multiple-ciphers` with SQLCipher encryption.

**packages/shared**: zod schemas and types shared by server, worker, web, and MCP clients, including the task and recipe formats.

**packages/brokers**: broker and company datasets as JSON, with import scripts for Eraser's MIT broker list and the California registry CSV.

**packages/recipes**: declarative recipes per broker plus the runner that executes them.

### Data Model

Tables, with the columns that matter for the design.

- `profiles`: id, display name, state, created at.
- `identities`: profile id, kind (name, alias, email, phone, address, dob), value, is primary, valid from, valid to.
- `mailboxes`: profile id, provider, smtp host and port, imap host and port, username, encrypted app password, reply folder or label, daily cap, last poll cursor.
- `brokers`: id, name, category, website, privacy email, opt-out url, contact method (email, form, both), region, requires id, notes, source, source license.
- `companies`: same shape as brokers with a `kind` of company; the company list is a separate table because its lifecycle and templates differ.
- `recipes`: broker id, version, steps as JSON, last health check, health status.
- `requests`: id, profile id, target type and id, right (opt out, delete), legal basis, channel (email, form), status, sent at, due at, follow up at, external reference.
- `request_events`: request id, type, payload, created at. This is the audit trail the timeline renders.
- `messages`: mailbox id, imap uid, request id if correlated, from, subject, classification, confidence, raw headers, created at.
- `scans`: profile id, broker id, started at, finished at, candidates as JSON.
- `matches`: scan id, record url, extracted fields, user decision, decided at.
- `tasks`: id, kind, payload, status, priority, lease owner, lease expires at, attempts, result, blocked reason, screenshot path, created at.

Request status is a small state machine.

```
draft -> queued -> sent -> awaiting_reply -> confirmed
                                          -> rejected
                                          -> needs_verification -> (human) -> sent
                                          -> no_record
                                          -> bounced -> (switch channel) -> queued
                                          -> no_response -> follow_up_due -> queued
```

### API Design

REST under `/api` for the web UI, JSON in and out, cookie session after password login.
The routes, with their request and response schemas, are defined in `packages/shared/src/api.ts`, which is the source of truth.
They cover profiles and their mailbox, the targets list (`/targets`, brokers and companies together, with filters), campaigns, requests (`/requests/:id`), matches, the review queue (`/review`), and settings.

MCP server at `/mcp`.
The tools are `list_tasks`, `claim_task`, `heartbeat_task`, `complete_task`, `block_task`, `fail_task`, `release_task`, `get_target`, `get_recipe`, and `propose_recipe`.
Their schemas are in `packages/shared/src/mcp.ts` and `docs/agents.md` explains how an agent uses them.

Task payloads carry only the identifiers the target needs.
A blind email task to a marketing broker carries name and email.
A people-search form task carries the fields the recipe declares.

### Recipe Format

A recipe is a JSON document with a version, the broker id, the entry URL, and an ordered list of steps.
Step kinds are `goto`, `fill`, `click`, `select`, `wait_for`, `extract`, `expect_text`, `captcha_checkpoint`, and `email_confirmation`.
Selectors are preferred in order of role and label, test id, then CSS.
Every recipe has a `canary` section that lets a health check load the entry page and verify the key selectors still exist without submitting anything.

## Alternatives Considered

### Option A: Fork Eraser (Go)

Eraser already has SMTP sending, IMAP classification, a heuristic form filler, CAPTCHA detection, and a confirmation-link clicker, all under MIT.
Forking would give a working baseline in days.
The costs are a Go codebase with chromedp instead of the Playwright and Stagehand ecosystem, a CLI-first design that fights the one-click UI goal, no multi-profile model, and no task queue to hang an MCP server on.

### Option B: Python with browser-use

Python has the strongest local-model tooling and browser-use is a mature agent loop.
The costs are a weaker story for the web UI, two languages once React is added, and an agent loop that owns planning when this design wants the queue to own it so that any client can be the agent.

### Option C: TypeScript monorepo (proposed)

Playwright and Stagehand are TypeScript-native, the UI and server share types, and one toolchain builds one Docker image.
The cost is writing mail handling and the form runner ourselves rather than inheriting them.

## Trade-off Matrix

| Criterion | TypeScript monorepo | Fork Eraser | Python |
|---|---|---|---|
| Time to first working send | Medium | Fast | Medium |
| Agent tooling fit | Strong | Weak | Strong |
| One-click web UI | Strong | Weak | Medium |
| Shared types across UI, server, worker | Yes | No | No |
| MCP task queue integration | Natural | Bolt-on | Natural |
| Local model options | Medium | Weak | Strong |
| Single toolchain and image | Yes | Yes | No |

## Architecture Decisions

### ADR-001: Bring your own mailbox instead of a mail server

Context: one shared sending domain would be flagged once many users send similar mail, and residential mail servers cannot deliver to Gmail or Microsoft.
Decision: each profile connects an existing mailbox over SMTP and IMAP with an app password; the tool never runs an MTA.
Consequences: deliverability inherits the provider's reputation, requests are unambiguously from the data subject, Outlook.com waits for OAuth, and the tool must respect provider daily caps.

### ADR-002: Browser runs on the user's machine

Context: people-search sites use bot management that fingerprints TLS and scores IP reputation; headless Playwright from a datacenter is blocked.
Decision: the worker runs real Chrome on the host, with a persistent profile, and the whole stack ships in one Compose file for a home machine.
Consequences: removals work far more often, the UI is reachable from other devices over an SSH tunnel, the user's own VPN, or a LAN binding the user opts into (it listens on loopback only by default, because the first-run setup page is open until a password is set), and cloud-only deployment is unsupported.

### ADR-003: Server-owned task queue with leases, exposed over MCP

Context: Nick wants Claude Code and local models to be able to take tasks, and the built-in worker should not be the only thing that can act.
Decision: all browser and agent work flows through a queue in the server; the built-in worker, an MCP client, or a future model-backed worker all claim tasks the same way.
Consequences: one integration surface, auditable hand-offs, and the ability to measure real cost and success per worker type instead of guessing.

### ADR-004: Deterministic recipes first, agent as fallback

Context: published reliability for agent-driven form filling is decent but not perfect, and the same forty sites account for most exposure.
Decision: hand-authored recipes handle known sites; when a recipe is missing or fails, the task becomes an agent task.
Consequences: predictable behaviour and cheap runs for the common path, with recipe health checks to catch form churn, and agents used where they add value.

### ADR-005: Humans handle CAPTCHAs and verification walls

Context: automated CAPTCHA solving is a legal gray zone and an arms race.
Decision: the worker detects CAPTCHAs, phone verification, and ID upload and parks the task with a screenshot; the user resumes it from the web UI.
Consequences: some tasks need a human minute, and the review queue is a first-class screen.

### ADR-006: Minimal identifiers for blind requests

Context: sending a full profile to brokers that may never have had the person creates new exposure.
Decision: blind emails to marketing brokers carry name and email only; more identifiers are released only when a broker asks, and only after the user approves.
Consequences: lower match rates at some brokers in exchange for less data handed out.

### ADR-007: Whole-database encryption with SQLCipher

Context: the database holds names, addresses, dates of birth, and mail credentials, and the host is a home machine.
Decision: SQLite is encrypted with SQLCipher through `better-sqlite3-multiple-ciphers`.
The key is derived once at install and stored in a key file in the data volume with owner-only permissions so the scheduler can run unattended.
A passphrase mode that wraps that key and requires unlocking after a restart is a possible future option and is not built.
Consequences: a stolen database file is useless without the key file; the key file and the database must be backed up together.

### ADR-008: Dataset licensing

Context: the best public lists carry different licenses.
Eraser's broker list is MIT, the California registry is a public record, and the Big Ass Data Broker Opt-Out List (BADBOOL) is CC BY-NC-SA 4.0.
Simple Opt Out has no license at all.
Decision: bundle Eraser, the California registry, and BADBOOL, and keep a source and license on every record.
BADBOOL is the most current curated source for people-search sites, and its noncommercial terms match this project's license.
Because of the ShareAlike clause, the generated dataset file is distributed under CC BY-NC-SA 4.0 with attribution to Yael Grauer, separately from the code.
Simple Opt Out stays a checklist of company names only; company contacts are taken from each company's own privacy pages.
Consequences: a NOTICE file and an in-app data sources page carry the attribution, and the dataset license differs from the code license.

### ADR-009: PolyForm Noncommercial 1.0.0

Context: Nick's standard license; the project may be used freely but not sold.
Decision: PolyForm Noncommercial 1.0.0 for the code and authored data.
Consequences: bundled third-party data must allow noncommercial redistribution, and the dataset file carries its own license per ADR-008.

### ADR-010: Playwright, with Stagehand evaluated for the agent fallback

Context: the deterministic path needs a stable driver; the agent path needs act, extract, and observe primitives.
Decision: Playwright drives recipes.
Stagehand is evaluated for the agent fallback behind the task queue once real tasks exist to test against.
Consequences: no premature dependency on an agent framework, and the agent surface can be swapped per worker.

## Implementation Plan

### Milestone 0: Scaffold

Monorepo, Docker Compose, CI with lint, typecheck, and tests, license, README, this document.

### Milestone 1: Email path end to end

Profiles and identities, mailbox connection and test, encrypted database, broker dataset import, state-aware templates, campaign creation, paced SMTP sending with a daily cap, IMAP polling with reply classification, confirmation-link following, request timeline, and dashboard.
Deliverable: a user connects Gmail, creates a profile, clicks once, and watches requests go out and replies come back.

### Milestone 2: People-search path

Scan recipes for the top people-search sites, match confirmation queue, removal recipes for those sites, CAPTCHA and verification detection with the blocked-task queue, recipe canary health checks.
Deliverable: a user confirms their records and the worker removes them where no CAPTCHA blocks, with the rest waiting in the queue.

### Milestone 3: Task queue over MCP and agent fallback

MCP server with claim, heartbeat, complete, and block, agent task kind, Claude Code client guide, measured cost and success per worker type, Stagehand evaluation.
Deliverable: Claude Code can pick up a blocked or unrecipe'd broker and drive it.

### Milestone 4: Schedule and companies

Scheduler with the agreed cadences, relisting detection, company dataset and templates, state law packs for all twenty states with statutes, install guide, image release.

### Critical path

Encrypted database and mailbox connection gate everything in Milestone 1.
The task queue is needed before any browser work, so it lands early in Milestone 2 even though MCP exposure waits for Milestone 3.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Provider flags bulk sending from an app password | Jittered pacing, daily cap below provider limits, plain-text mail, request ID instead of tracking links |
| Broker forms change and recipes break | Canary health checks, recipe versioning, agent fallback, `propose_recipe` over MCP |
| Bot management blocks even a real browser | Persistent Chrome profile, human-paced actions, residential IP, blocked-task queue as the backstop |
| Logs or screenshots leak personal data | Redaction in logs, screenshots stored in the encrypted volume, retention limits |
| Users misstate residency | Templates derive legal basis from the profile state only; no residency toggle |
| Blind requests create new exposure | ADR-006 minimal identifiers |
| Agent cost or reliability disappoints | Measured per worker type before any default; recipes remain the primary path |

## Open Questions

- Which people-search sites make the first recipe set? Proposal: start from the sites that appear in both Eraser's people-search category and the California registry, then add by user demand.
- Should the server expose the MCP endpoint only on localhost by default? Proposal: yes, with an opt-in bind address.
- How should recipe contributions be reviewed before they ship in the dataset?

## Success Metrics

Measured on real runs, not estimated.

- Share of requests with any response within 45 days, by broker category.
- Share of requests reaching `confirmed` or `no_record` within 60 days.
- Human minutes per profile per month, counted from blocked-task resolutions and match confirmations.
- Recipe canary pass rate per week.
- Agent task completion rate and token cost per completed task, per worker type.
