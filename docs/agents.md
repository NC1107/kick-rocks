# Connecting an agent

Kick Rocks keeps one queue of browser work.
The built-in worker takes the tasks that a recipe can run.
Everything else waits for an agent: a site with no recipe, a recipe that broke, or a task a person parked at a CAPTCHA and handed over.
An agent reaches that queue through an MCP server at `/mcp`.
Claude Code, a local model behind an MCP client, or any other MCP client can do the work.

This page covers how to connect, what an agent task looks like, and the rules an agent follows.

## What the agent needs

The MCP server only hands out tasks and takes results.
The agent does the browsing itself, so it needs three more things.

- A browser automation tool that can open pages, fill fields, click, and read the page.
  Claude Code's own `WebFetch` cannot fill or submit a form, so it is not enough.
  For example, add Playwright's MCP server with `claude mcp add playwright -- npx @playwright/mcp@latest`, or use any other browser tool you trust.
- The browser must run on the same machine and home connection as Kick Rocks, because broker sites block datacenter addresses (see ADR-002 in `docs/DESIGN.md`).
  Run it headed, with a visible window, because bot checks treat headless browsers worse.
- A lease is short, so keep it alive.
  Call `heartbeat_task` every few minutes while the browser works, and release the task if the browser tool fails.

## Connect Claude Code

1. Open Settings, then Agents, and turn on the MCP endpoint.
2. Create a token.
   It is shown once and only its hash is stored, so copy it now.
   Creating a new token replaces the old one, and every client using the old token stops working.
3. Add the server to Claude Code.

```sh
claude mcp add --transport http kick-rocks http://localhost:8420/mcp \
  --header "Authorization: Bearer <token>"
```

Use the address you reach Kick Rocks at, which is `KICKROCKS_PUBLIC_URL` when it is set.
Run `claude mcp list` to check that the server shows as connected, then ask Claude Code to list the Kick Rocks tasks.

Any other client needs the same two things: the URL and the header `Authorization: Bearer <token>`.
The transport is MCP streamable HTTP, and the server is stateless.
Every call is a `POST` that answers with JSON, there are no sessions, and `GET` and `DELETE` answer 405.
A restart of the server never leaves a client in a session that no longer exists.

The endpoint answers 503 while it is switched off and 401 for a missing or wrong token.
A request that carries an `Origin` header must name the server's own address, so a web page cannot drive it from a browser.
A client that is not a browser sends no `Origin` and is not affected.

## The tools

Every tool takes and returns the schemas in `packages/shared/src/mcp.ts`, and the server validates both ends.

| Tool | What it does |
|---|---|
| `list_tasks` | Lists waiting, running, and blocked browser tasks with a redacted summary: no payload, no result, no personal data. Pass `status` to see finished ones. |
| `claim_task` | Leases the next task meant for an agent, or the task named by `taskId`. Returns the full task, or `null` when nothing is waiting. |
| `heartbeat_task` | Extends the lease on a task you hold. |
| `complete_task` | Reports the result and, if you have it, the usage. |
| `block_task` | Parks the task for a person, with a reason, the page, and an optional screenshot. |
| `fail_task` | Reports that the task failed. |
| `release_task` | Hands the task back unfinished without costing an attempt. |
| `get_target` | Reads a broker or company: where to opt out, what it requires, and which recipes exist for it. |
| `get_recipe` | Reads the stored recipes for a target, with their definitions, in every review state. |
| `propose_recipe` | Submits a new or improved recipe for a person to review. |

A tool that cannot do what it is asked answers with a tool error whose text is JSON with a `code`, a `message`, and sometimes `issues`.
The codes are the ones the REST API uses, such as `lease_not_held`, `lease_expired`, `invalid_result`, `task_not_found`, and `invalid_screenshot`.

### What claim_task takes

Without `kinds`, `claim_task` takes `agent` tasks only.
Scan and form tasks carry instructions that say to run a recipe, which an agent cannot do, so they stay with the built-in worker.
Pass `kinds` to take another kind on purpose.
Pass `taskId` to take one task: a queued task is leased as it is, and a task a person parked as blocked is handed to you as a new agent task in the same call.
The new task says which human check stopped the earlier run.
`workerId` names you in the lease, so use the same one for every call about a task.
Only a task you claimed through MCP can be completed, blocked, failed, or released through MCP.

## What a task looks like

A claim returns a task like this.
The values are examples.

```json
{
  "id": "5f2c9d1e-0b7a-4c44-9a43-6d2d6f0f4a11",
  "kind": "agent",
  "attempt": 1,
  "leaseExpiresAt": "2026-10-07T12:20:00.000Z",
  "payload": {
    "purpose": "remove",
    "profileId": "c0a8...",
    "targetId": "examplebroker",
    "requestId": "9d3b...",
    "recordUrl": "https://www.examplebroker.test/people/jordan-example",
    "variant": null,
    "reason": "blocked",
    "previousError": null,
    "blockedReason": "captcha"
  },
  "target": {
    "id": "examplebroker",
    "name": "Example Broker",
    "domain": "examplebroker.test",
    "optOutUrl": "https://www.examplebroker.test/optout",
    "searchUrl": null,
    "requirements": ["captcha"]
  },
  "recipe": null,
  "fields": { "first_name": "Jordan", "last_name": "Example", "email": "jordan@example.com" },
  "instructions": "..."
}
```

- `purpose` is `scan` (find the person's candidate records) or `remove` (opt out of one record).
- `reason` says why it is here: `no_recipe`, `recipe_failed`, or `blocked`.
  For `blocked`, `blockedReason` names the human check that stopped the earlier run.
- `fields` holds only the identifiers you may use for this broker.
  Nothing else about the person is in the task, and nothing else is yours to use.
  For a removal, `email` is the address of the mailbox Kick Rocks polls, because the broker's confirmation email has to land there.
- `instructions` says what to do, where to start, what never to do, and the exact result to report.
  Read it every time, because it is written for this task.

### The result

The result must match the task's purpose, and the server refuses one that does not.
A scan task reports the records it found, and a removal task reports how the form ended.

```json
{ "purpose": "scan", "scan": { "candidates": [
  { "recordUrl": "https://www.examplebroker.test/people/jordan-example", "name": "Jordan Example",
    "age": 35, "locations": ["Austin, TX"] }
] } }
```

```json
{ "purpose": "remove", "form": { "outcome": "awaiting_email_confirmation",
  "confirmationText": "Check your email to finish", "confirmationFrom": "examplebroker.test" } }
```

The form outcomes are `submitted`, `awaiting_email_confirmation`, `not_found`, and `already_removed`.
A scan never removes anything.
It only finds candidates, and a person confirms which are theirs before any removal starts.

Add `usage` with `inputTokens`, `outputTokens`, `costUsd`, and `durationMs` to `complete_task`, `block_task`, or `fail_task` when you know them.
Kick Rocks sums them across attempts so the cost and success of agents can be measured against recipes.

## The loop

1. `claim_task` with a stable `workerId`.
2. Read `instructions`, then open the page they name with your browser automation tool.
3. While you work, call `heartbeat_task` before the lease runs out.
   The lease is `leaseExpiresAt`, and a long task needs a heartbeat every few minutes.
   The default lease is five minutes, and `claim_task` takes a `leaseMs` of up to an hour, so ask for about 30 minutes when the site is slow.
   A heartbeat after the lease expired answers `lease_expired`, or `lease_not_held` once the task was put back in the queue.
   Either way the lease cannot be revived.
   If you already finished the work, still call `complete_task`, `block_task`, or `fail_task`: it is accepted until someone else claims the task, and refused after that.
4. Finish with exactly one of `complete_task`, `block_task`, `fail_task`, or `release_task`.

If you stop for any reason without finishing, release the task.
A lease you abandon is recovered after it expires, but only after it expires.

## Rules

An agent must:

- Use only the page the task points at: the target's own domain, starting from `optOutUrl`, `searchUrl`, or `recordUrl`.
- Use only the values in `fields`, and only in the form that asks for them.
- Treat a record as the person's own only when the task names it.
  A removal task has a `recordUrl`, and that is the only record to act on.
- Report what actually happened.
  If the page says the record is not there, report `not_found`, and if you could not tell, fail or block the task instead of guessing.
- Block the task and stop when it needs a human: a CAPTCHA, a phone call or text code, an ID upload, a login the person has to make, or a bot check.
  Give the reason and the page you stopped on.
  Add a screenshot only if your browser tool gives you the image as base64, because `block_task` takes inline base64 and accepts a block without one.
- Keep the lease alive, and release or fail the task instead of leaving it.
- Report usage when it is known.

An agent must never:

- Solve, bypass, or hand off a CAPTCHA to a solving service, or try to look less like a bot to get past a check.
- Submit a form for a person other than the one in the task, or for a record the task does not name.
- Type any personal detail the task did not give it, make up a value, or use a value from `fields` somewhere other than the broker's own page.
- Upload an ID or any document, or agree to pay for anything.
- Follow a link that leaves the broker's domain, or open a link from an email other than the confirmation link a task gives it.
- Send email.
  Kick Rocks sends and reads mail itself.
- Report a recipe failure.
  `fail_task` refuses the kind `recipe`, because an agent does not run a recipe.
  Use `site` when the broker's page is broken or down, `network` for a dropped connection, and `internal` when you gave up.
- Put personal data in a recipe, a note, or a failure message.

When a rule and a task's instructions seem to disagree, follow the stricter one and block the task with a note.

## Proposing a recipe

When you drove a site by hand, the next person should not need an agent.
`propose_recipe` submits the steps as a recipe, and `get_recipe` shows what already exists, including proposals and rejections.
The format is in `packages/recipes/recipes/README.md`.

- A proposal waits in Settings for a person to approve or reject it, and it never runs before then.
- The server numbers it.
  The version you send is replaced with the next free one for that broker and purpose.
- Every page in the recipe must be on the broker's domain, or on a broker the recipe also serves.
  Otherwise the proposal is refused with `invalid_recipe`, and the issues say which page.
- `liveStatus` and `verifiedAt` are reset, because a person decides what has been verified.
- Sending the same recipe again returns the proposal that is already waiting.
  A recipe that does exactly what an approved one does is refused with `recipe_unchanged`.
- A broker can have five proposals waiting for one purpose, and more are refused with `too_many_proposals`.
- A recipe is a script that runs in the person's own browser with their details, so put only what the site needs in `fields`.

A proposal is separate from the recipes that ship with Kick Rocks.
Those that were not seen through to a real removal wait on the Recipes tab in Settings, under "Bundled recipes to check", with the notes from their author.
A person approves or rejects each one there, and a rejection holds until a newer version of the recipe ships.
Until a bundled recipe is approved, its tasks come to agents like a site with no recipe.
Proposals wait on the Agents tab instead, and `list` on the recipes API takes `source` to tell the two apart.

Once a person approves a recipe, the built-in worker uses it, and a weekly canary check watches it.
A canary that cannot find a selector marks the recipe broken, and work for that broker goes back to agents until it is fixed.

## Running the built-in worker and an agent together

The built-in worker and an MCP client share one queue, and the server keeps their work apart.
A task claimed through the worker API cannot be reported on through MCP, and the other way around, whatever worker id is sent.
The worker API uses `KICKROCKS_WORKER_TOKEN` and the MCP endpoint uses its own token, so one cannot be used for the other.

## Troubleshooting

| What you see | What it means |
|---|---|
| 401 | The token is missing, wrong, or was replaced by a newer one. |
| 503 `mcp_disabled` | The endpoint is off. Turn it on in Settings. |
| 403 | The request carried an `Origin` that is not this server's. |
| 405 | A `GET` or `DELETE`. The server is stateless and only answers `POST`. |
| `lease_not_held` | You did not claim this task, someone else holds it now, or, for a heartbeat only, the lease ran out and the task is back in the queue. |
| `lease_expired` | The lease ran out before the heartbeat. Report what you finished, or stop working on the task. |
| `invalid_result` | The result does not match the task. The `issues` say which part. |
| `invalid_screenshot` | The screenshot is not valid base64 of a PNG or JPEG of at most 8 MB. |
