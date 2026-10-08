# Connecting an agent

Kick Rocks keeps one queue of browser work.
The built-in worker takes the tasks that a recipe can run.
Everything else waits for an agent: a site with no recipe, a recipe that broke, or a task a person parked at a captcha and handed over.
An agent reaches that queue through an mcp server at `/mcp`.
Any mcp client can do the work, and so can the agent worker, which drives a model of your choice.

This page covers both ways to take agent tasks, what a task looks like, and the rules an agent follows.

Two rules hold for every agent, and the code enforces them for the agent worker.

- A model only sees placeholders.
  The agent worker masks every value the profile holds, so the model names a field and the program types the value.
  An mcp client has no masking step, so it is given only the fields the task allows for that one broker, and nothing else about the person.
- A removal form is never submitted twice.
  The moment a click may have submitted it, the task is marked, and from then on it can't be queued again by itself.

Both are explained in full under "Rules the code enforces" and "The loop" below.

## What the agent needs

The mcp server only hands out tasks and takes results.
The agent does the browsing itself, so it needs three more things.

- A browser automation tool that can open pages, fill fields, click, and read the page.
  A tool that only fetches a page can't fill or submit a form, so it is not enough.
  For example, playwright's mcp server (`npx @playwright/mcp@latest`) or any other browser tool you trust.
- The browser must run on the same machine and home connection as kick rocks, because broker sites block datacenter addresses (see ADR-002 in `docs/DESIGN.md`).
  Run it headed, with a visible window, because bot checks treat headless browsers worse.
- A lease is short, so keep it alive.
  Call `heartbeat_task` every few minutes while the browser works, and release the task if the browser tool fails.

## Connect a client

1. Open Settings, then Agents, and turn on "Allow agents to connect" under Agent access.
2. Create a token.
   It is shown once and only its hash is stored, so copy it now.
   Creating a new token replaces the old one, and every client using the old token stops working.
3. Give your client the endpoint and the token.

The endpoint is `/mcp` on the address you reach kick rocks at, which is `KICKROCKS_PUBLIC_URL` when it is set, such as `http://localhost:8420/mcp`.
Every request carries the header `Authorization: Bearer <token>`.
Most clients take a JSON config along these lines, though the key names differ a little between clients, so check yours.

```json
{
  "mcpServers": {
    "kickrocks": {
      "type": "http",
      "url": "http://localhost:8420/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Clients that add servers from a command line usually take the same three things: a name, the URL, and the header.
Once it connects, ask the client to list the kick rocks tasks.

The transport is mcp streamable HTTP, and the server is stateless.
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
| `heartbeat_task` | Extends the lease on a task you hold. For a removal, pass `mayHaveSubmitted: true` as soon as you click the submit button. |
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
Only a task you claimed through mcp can be completed, blocked, failed, or released through mcp.

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
    "rights": ["opt_out"],
    "reason": "blocked",
    "previousError": null,
    "blockedReason": "captcha"
  },
  "target": {
    "id": "examplebroker",
    "name": "Example Broker",
    "domain": "examplebroker.test",
    "optOutUrl": "https://www.examplebroker.test/optout",
    "privacyRightsUrl": null,
    "searchUrl": null,
    "requirements": ["captcha"]
  },
  "recipe": null,
  "fields": { "first_name": "Jordan", "last_name": "Example", "email": "jordan@example.com" },
  "instructions": "..."
}
```

- `purpose` is `scan` (find the person's candidate records) or `remove` (opt out of one record).
- `rights` says what a removal asks for: `opt_out` (stop selling or sharing the person's data), `delete` (delete it), or both.
  It is empty for a scan, and the instructions say the same in words.
  A deletion starts at the company's `privacyRightsUrl` when it has one, and at `optOutUrl` when it does not, because an opt-out page is usually a do-not-sell form and not a deletion form.
- `reason` says why it is here: `no_recipe`, `recipe_failed`, or `blocked`.
  For `blocked`, `blockedReason` names the human check that stopped the earlier run.
- `fields` holds only the identifiers you may use for this broker.
  Nothing else about the person is in the task, and nothing else is yours to use.
  For a removal, `email` is the address of the mailbox kick rocks polls, because the broker's confirmation email has to land there.
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
A removal at a site that offers to look up an earlier request looks it up first, and reports `already_removed` when the site says so, instead of sending a new request.
A scan reports every record that is consistent with all the identifiers in `fields`, and none that contradicts one, such as a different city or an age that does not fit the birth year.
A task carries only the identifiers the legal package releases for its target and purpose, so a removal at a blind-request target gets a name and an email, and the state only where the target keeps a record to match.
A dropdown that asks for a detail the task does not carry is refused, so the missing state is reported as blocked instead of guessed.
`confirmationFrom` is accepted only when it is the target's own organization (the same organizational domain as the target's domain, over the public suffix list) or a sister domain the dataset curates for that target in `replyDomains`.
Any other value is dropped, including another broker's domain and platforms such as paypal.com, and a shared mail host is never accepted.
A dropped sender means no confirmation email will be matched to the request, so name the sender only when the page names it.
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
   A heartbeat after the lease expired answers `lease_expired`, or `lease_not_held` once someone else claimed the task.
   Either way the lease cannot be revived.
   If you already finished the work, still call `complete_task`, `block_task`, or `fail_task`: it is accepted until someone else claims the task, and refused after that.
   This holds even when the expiry used up the last attempt and failed the task: your real outcome replaces that failure.
4. Finish with exactly one of `complete_task`, `block_task`, `fail_task`, or `release_task`.

If you stop for any reason without finishing, release the task.
A lease you abandon is recovered after it expires, but only after it expires.

A removal can submit its form before you know whether the site took it.
Call `heartbeat_task` with `mayHaveSubmitted: true` right after you click the submit button.
Kick Rocks then never queues that task again by itself.
If the lease runs out, you fail it as retryable, or you release it, the task is blocked for a person with reason `unknown`, because another run would submit the form twice.
You can still report what happened until the person puts the task back in the queue.

## Rules

An agent must:

- Use only the page the task points at: the target's own domain, starting from `optOutUrl`, `searchUrl`, or `recordUrl`.
- Use only the values in `fields`, and only in the form that asks for them.
- Treat a record as the person's own only when the task names it.
  A removal task has a `recordUrl`, and that is the only record to act on.
- Report what actually happened.
  If the page says the record is not there, report `not_found`, and if you could not tell, fail or block the task instead of guessing.
- Block the task and stop when it needs a human: a captcha, a phone call or text code, an ID upload, a login the person has to make, or a bot check.
  Give the reason and the page you stopped on.
  Add a screenshot only if your browser tool gives you the image as base64, because `block_task` takes inline base64 and accepts a block without one.
- Keep the lease alive, and release or fail the task instead of leaving it.
- Report usage when it is known.

An agent must never:

- Solve, bypass, or hand off a captcha to a solving service, or try to look less like a bot to get past a check.
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

A proposal is separate from the recipes that ship with kick rocks.
Those that were not seen through to a real removal wait on the Recipes tab in Settings, under "Bundled recipes to check", with the notes from their author.
A person approves or rejects each one there, and a rejection holds until a newer version of the recipe ships.
Until a bundled recipe is approved, its tasks come to agents like a site with no recipe, with one limit for an unattended model: see "Which sites the agent worker takes" below.
Proposals wait on the Agents tab instead, and `list` on the recipes API takes `source` to tell the two apart.

Once a person approves a recipe, the built-in worker uses it, and a weekly canary check watches it.
A canary that cannot find a selector marks the recipe broken, and work for that broker goes back to agents until it is fixed.

## Running a model as the agent

An mcp client is one way to take agent tasks.
The agent worker is another: a small program that claims the same tasks itself, drives its own chrome, and asks a model what to do next.
The model can be a local one through ollama or any openai-compatible endpoint, or a hosted one through the anthropic api.
Which local model to run for your GPU, what to expect from it, and the check it should pass before it runs unattended are in [agent-models.md](agent-models.md).
It lives in `apps/agent-worker` and talks to the server through the worker API, so it needs `KICKROCKS_WORKER_TOKEN` and not an mcp token.

It claims only `agent` tasks, and it says it is a model when it claims, so kick rocks counts its runs apart from recipe runs and from mcp clients.
It can run next to the built-in worker and next to an mcp client, because the server hands each task to one claimer.
It uses its own chrome profile, since two browsers cannot share one.

### Start it

With docker, set the provider and model in `.env` and add `agent` to `COMPOSE_PROFILES` there, next to `worker`.
A `--profile` flag on the command line replaces `COMPOSE_PROFILES`, so use the variable and not the flag, and later `docker compose up -d --build` updates keep the agent worker.
The settings are listed in `.env.example`.

For a local model through ollama, the provider is `ollama`.
It talks to ollama's native api, which is the one that sets the context window.
Ollama's own default is 4096 tokens, and a conversation longer than that is cut short at the front without any error, so the provider asks for 16384 on every request.
`KICKROCKS_AGENT_NUM_CTX` changes that, and 12000 is the least that holds the largest page snapshot plus the conversation around it.

```sh
# .env, a local model on the same machine
COMPOSE_PROFILES=worker,agent
KICKROCKS_AGENT_PROVIDER=ollama
KICKROCKS_AGENT_MODEL=<an ollama model that supports tool calling>
KICKROCKS_AGENT_BASE_URL=http://host.docker.internal:11434
```

Any other server that speaks the openai chat completions protocol uses the `openai` provider with its address, including ollama's own `/v1` endpoint.
That endpoint has no context setting, so with it the context is whatever ollama loaded the model with, and `OLLAMA_CONTEXT_LENGTH=16384` on the ollama server is how to raise it.

```sh
# .env, any openai-compatible server
KICKROCKS_AGENT_PROVIDER=openai
KICKROCKS_AGENT_MODEL=<model name>
KICKROCKS_AGENT_BASE_URL=http://host.docker.internal:8080/v1
```

For the anthropic api, set the provider to `anthropic` and give it a key.
The anthropic provider has a built-in default model, and `KICKROCKS_AGENT_MODEL` overrides it.

```sh
# .env, a hosted model
COMPOSE_PROFILES=worker,agent
KICKROCKS_AGENT_PROVIDER=anthropic
ANTHROPIC_API_KEY=<your key>
```

Then run `docker compose up -d --build`.

From a checkout, build once, then run it with the same variables exported.

```sh
pnpm build
KICKROCKS_WORKER_TOKEN=<token> KICKROCKS_AGENT_MODEL=<model> pnpm --filter @kickrocks/agent-worker start
```

### Which models send forms alone

The agent worker tells the server which model it drives, and the server decides whether that model may send a form without asking.
A model may only after it passes the benchmark's safety gate on this install, or after you allow it by hand in Settings, then Agents.
Any other model works under the outgoing gate: every request its browser makes is held until you decide, and the task waits in Review as "Waiting for you" while the run is paused.
You see the request, its fields with your own values in them, the page as it stood, and you send it or hold it back.
If you are not there, the request is cancelled after the hold time in Settings, and the task waits in Review as "Needs approval".
Approve for the next run lets the next run send each held request once, if the page asks for the same thing.
A scan sends nothing, so it never waits.
Every agent task shows "What left the browser", which comes from the server's own record.
An MCP client is not held by the safety gate.

What the gate does not hold, so you know what you are trusting:

- A search for a name, city, state, ZIP, year of birth or record link, sent as a GET or HEAD to the target's own sites, goes out without asking.
  It is listed under "What left the browser" as a lookup.
  Searches have to work for a removal to find the record, so this is on purpose.
  Before the run first types, even a POST that carries only such values goes out as a lookup.
- A page can scramble what the run typed with its own code (reversed, ROT13, a salted hash, or a character or two per keystroke) and put it in the address of a GET, an image or a stylesheet.
  The gate reads many encodings and the common hashes, but it cannot undo every transform a page invents, and a GET with no body and no value it recognizes is not held.
  Per-keystroke requests can give away about the first five characters of an email before the gate recognizes it.
- A 307 or 308 redirect of a request you released sends the same body again, and it may land on a different path of the target's own sites without asking you a second time.
  A redirect to another site is still refused.
- The Referer header of a request to the target is not read.

[agent-models.md](agent-models.md) says how to run the benchmark and what it checks.

### Settings

| Variable | Meaning |
|---|---|
| `KICKROCKS_AGENT_PROVIDER` | `ollama` for ollama's native api, `openai` for any openai-compatible endpoint (the default), or `anthropic`. |
| `KICKROCKS_AGENT_MODEL` | The model name. Required for `ollama` and `openai`, and it must support tool calling. Optional for `anthropic`. |
| `KICKROCKS_AGENT_BASE_URL` | The endpoint. Defaults to `http://localhost:11434` for `ollama`, `http://localhost:11434/v1` for `openai`, and `https://api.anthropic.com` for `anthropic`. An `ollama` address with a trailing `/v1` is accepted and the `/v1` is dropped. |
| `KICKROCKS_AGENT_API_KEY` | A key for the endpoint. ollama needs none. For `anthropic` it falls back to `ANTHROPIC_API_KEY`. |
| `KICKROCKS_AGENT_NUM_CTX` | The `ollama` provider's context window in tokens. Default 16384, minimum 2048. |
| `KICKROCKS_AGENT_THINKING` | `default` leaves a thinking model as it is. `off` asks it not to think, so its output cap goes to the answer: `ollama` sends `think: false`, and `openai` sends `reasoning_effort: none`, which ollama's endpoint takes and a hosted api may refuse. A model that cannot turn thinking off, such as gpt-oss, ignores it. |
| `KICKROCKS_AGENT_WORKER_ID` | Names this worker to the server. Defaults to the host name plus `-agent`. Compose passes it to the worker as `KICKROCKS_WORKER_ID`. |
| `KICKROCKS_AGENT_MAX_STEPS` | Tool calls one task may use. Default 40. |
| `KICKROCKS_AGENT_MAX_MINUTES` | Wall time one task may use. Default 10. |
| `KICKROCKS_AGENT_MAX_TOTAL_TOKENS` | Optional token budget for one task. |
| `KICKROCKS_AGENT_INPUT_USD_PER_MTOK`, `KICKROCKS_AGENT_OUTPUT_USD_PER_MTOK` | Prices per million tokens. A cost is reported only when both are set. |
| `KICKROCKS_AGENT_MAX_OUTPUT_TOKENS` | The most the model may write in one turn. Default 4096, because a thinking model spends much of a turn on thinking before it calls a tool, and one that runs out of tokens first answers with nothing. |
| `KICKROCKS_AGENT_TOKEN_PARAM` | What an openai-compatible endpoint calls that limit: `max_tokens` (the default) or `max_completion_tokens`. Reasoning models from openai need the second. With the default, a model that refuses `max_tokens` or a temperature of 0 gets one retry with `max_completion_tokens` and no temperature. |

The browser settings are the same as the built-in worker's: `KICKROCKS_WORKER_HEADLESS`, `KICKROCKS_WORKER_PACE`, `KICKROCKS_CHROME_EXECUTABLE`, and the rest of `apps/worker/README.md`, apart from the proxy, which the agent worker does not read.
In the compose service only `KICKROCKS_WORKER_PACE` can be changed from `.env`.
The image fixes the others: it runs a headed chrome on Xvfb with the sandbox off, because docker's default seccomp profile blocks chrome's sandbox.
Inside a container, `localhost` is the container, so ollama on the host is `host.docker.internal`, which the compose file maps for you.

### What the model can do

The model never gets a general browser tool.
It gets eight, and each one is checked in code before it touches the page.

| Tool | What it does |
|---|---|
| `navigate` | Opens a page on one of the target's domains. |
| `snapshot` | Reads the page again as a short list of headings, text, and controls with refs. A page longer than 12,000 characters is split into parts, and `part` reads the next one. |
| `click` | Clicks a control by ref. |
| `type` | Types one of the task's fields into a text control. The model names the field and the program supplies the value. |
| `select` | Picks a dropdown option, either the one that matches a task field or, for a dropdown that asks nothing about the person, one the snapshot shows. |
| `check` | Ticks or unticks a checkbox or radio button. |
| `wait` | Waits up to ten seconds and reads the page. |
| `report` | Finishes with `complete`, `blocked`, `failed`, or `release`. |

The model gets the task's `instructions` as its system prompt, with a short preface that maps `complete_task`, `block_task`, `fail_task`, and `release_task` onto `report`.

### Rules the code enforces

The prompt asks for the rules above.
The worker does not rely on the model to follow them.

- The page may only go to the target's domains and their subdomains, over https.
  That holds for a link, a script, and every hop of a redirect, and the model is told what was blocked.
  That also holds for a frame inside the page and a form aimed at a frame.
  A frame of another site runs in its own browser process, so each one is held at its start, given the same guard as the page, and only then let go.
  A frame that cannot be guarded is not let go.
  A new tab or window is refused whole, with every document it would load and every redirect it would follow, and the tab is closed.
  A page on a shared form platform (termly, trustarc, onetrust, google forms and the like) is allowed for its own path and what is under it, plus the query parameters that name the tenant, and never for the whole folder.
  A single-page portal that keeps the tenant in a route fragment (`#/ekata/request/...`) is allowed for the fragment up to the tenant's own segment, and a tracking fragment such as `xd_co_f=...` names nobody.
  A page that was let in may change its own address inside its origin, as a single-page portal does on every screen, without a new check.
  A new document is always checked against the full scope.
- `type` takes the name of a field in the task, and nothing else.
  A literal value in the call is ignored, and a field the task lacks is refused.
  Password, payment, read-only, and file controls cannot be used.
- A text field, textarea or dropdown is offered only if a person could use it: at least 4 by 4 pixels, not clipped away by a wrapper or a clip rule, within the page's width, and on top at its centre once scrolled into view.
  The same check runs again right before the program types or selects, so a control that is hidden after the snapshot is left alone.
  This catches the usual honeypot patterns.
  A control covered by a full-page overlay, such as a cookie banner with a backdrop or a notice, is left out too, and the snapshot starts with a line that says how many controls the overlay hides.
  The overlay is found once per snapshot, by testing a few points of the window and looking for a fixed or absolute layer that covers 90 percent of it, so a long page is not scrolled control by control.
  The overlay's own buttons are listed, so the model can dismiss it, and the controls behind it are offered again on the next snapshot.
- A long page is split into parts of about 12,000 characters, so a form after a lot of content is still reachable.
  The end of a snapshot says when there is another part, and `snapshot` with `part` reads it.
  Every part is masked the same way as the first.
  A control keeps its ref across parts and snapshots for as long as it stays on the page, and a ref is never given to another control, so a ref read in an earlier part still names the same control.
  A page of more than 3,000 items is cut off, and the last part says so.
- A dropdown that stands in for a detail of the person can only be answered with the task's field.
  A date of birth (its month, day and year dropdowns, found by their labels or by the shape of their choices), a state, a city and a ZIP code are the details checked.
  `select` with `option` is refused for such a dropdown.
  A date of birth split over month, day and year dropdowns is answered piece by piece: `select` with `date_of_birth` picks the month by its number or name, and the day or the year as numbers, and `birth_year` answers a year dropdown.
  The same check covers a choice made by `click` in a custom list (a listbox, a menu or `role="option"` items) and by `check` on a radio button: the click goes through only when the option shows the value of a field the task holds for that detail, and it is refused otherwise.
  The refusal points to the task's field when it has one.
  When the task has none, it says to stop and report what is missing if the control is required, and to leave the control unset if it is optional, so an invented date of birth or state cannot go through a dropdown that a text field would have refused.
  Field and control names written in camel case, such as `birthYear` or `zipCode`, are read word by word.
- Every answer the model reads is masked once, at the last step, so no path skips it.
  That covers the snapshot, dropdown options, dialog text and error messages.
  The model sees `{{first_name}}` where the page shows the person's first name, for each field of the task.
  The program hides every value the profile holds, not only the task's fields: all names and aliases (and each part of them), every email, phone, and address with its street, city and ZIP, and the date of birth and the year.
  A value that is not a field of the task reads `{{other_3}}` or similar, and the program puts it back in a scan result it reports.
  The server gives that list only to a model worker that claims as one, never to an mcp client.
  Phone numbers and dates of birth are also masked in the common US formats that an input mask produces.
  A value written in a way the program does not know, such as a nickname the page derived from the name, is not masked.
  A state's full name is masked as a whole word, so a page that prints `Texas` reads `{{state}}`, except as the end of another state's name (`West Virginia` stays as it is for a Virginian).
  Its postal code is masked only where it reads as a state: after a comma or a masked city, before a ZIP code, after the word `state` or an equals sign, and as a whole option of a list.
  A bare `OK`, `IN`, `OR` or `ME` elsewhere is an ordinary word and stays.
  In the path and query of an address the code is masked in any case, because a slug such as `austin-tx` or a query such as `?state=tx` writes it in lower case.
  A state list therefore shows the person's own state as `{{state}}`, which the model can pick without knowing which state it is.
  Other values of one or two characters are not masked.
- For a scan, the model reports each candidate with the masked text and link it read.
  The program matches each link to one the page really showed and fills the real values back into the text before the server stores it, and it rejects an address that no page showed.
  The task's instructions and the first message are masked the same way, so the model reads `{{record_url}}` where the server wrote the record address.
  `navigate` accepts `{{record_url}}` and a masked link from a snapshot, and opens the real address after checking it against the allowed domains.
  The mcp claim keeps the real record address in the instructions, because an mcp client has no masking step and must be able to open the page.
  The system prompt lists field names, and a value in the page, in a link, or in a field the program typed is replaced by `{{field_name}}` before the model reads it.
- A visible captcha or a whole-page bot check ends the run at once.
  The task is blocked with the reason, the page address, and a screenshot, and the model is not asked again.
  A bot check page that clears by itself gets a few seconds first.
  The page is checked before and after every `type`, `select`, `check` and click, and once more after the server has been told of the action and right before the browser acts, so a widget that renders a moment after an address is typed stops the run before a choice or a click can send the form.
- A `complete` result must match the shared schema for the task's own purpose.
  A scan candidate must be on the target's domains, and a removal reported as `submitted` or `awaiting_email_confirmation` needs at least one click.
  A result that fails these goes back to the model as an error.
  Text the model copies from the page into `confirmationText`, `notes`, or a failure message has the person's values masked.
- A removal run that has clicked, including a click that timed out, may already have submitted the form.
  Before the click, the worker tells the server through the task heartbeat that the form may be submitted, retries a failed beat a few times, and clicks only once the server has acknowledged it.
  When it cannot be acknowledged, nothing is clicked and the run is handed back.
  From then on a release or a failure that could be retried becomes a block for a person with reason `unknown`, the page address, and a screenshot, so the form is never submitted twice.
  If the worker is stopped while the page is stuck, the block is still what is reported.
  If it loses its connection or its lease instead, the server blocks the task when the lease runs out and does not queue it again.
- A task has a step budget, a time budget, and optionally a token budget.
  One that runs out is failed as `internal` and is not retried.
- A model that answers three times in a row without using a tool is failed.

What happens when the model cannot be used is not the task's fault.
An endpoint that is down or busy releases the task for a minute.
A wrong key, model name, or a model without tool support releases it for ten minutes, and the log says why.
Neither costs the task an attempt.

### What it reports

`complete`, `block_task`, and `fail_task` carry `usage` with input tokens, output tokens, and wall time, and a cost when prices are set.
The number of steps goes to the worker log, because the usage contract has no field for it.

### Which sites the agent worker takes

The agent worker claims the tasks no approved recipe covers, with two exceptions that keep an unattended model away from a site the person has not cleared.

- A site whose recipe you rejected is blocked for you when the agent worker claims it.
  Finish it by hand, or hand it to an agent yourself.
  A task you hand over stays in the queue for a connected agent, and the agent worker leaves it alone.
- A site whose bundled recipe is still waiting for your review stays in the queue, for a connected agent or for you.
  Turn on "Let the agent worker take unreviewed targets" under Workers in Settings to let the model take those too.
  The setting is off by default.

A connected mcp client is not held back by either rule, because you connected it on purpose.

### Workers in Settings

Settings shows a row for the recipe worker and one for the agent worker.
Each has its own state, so an agent worker that is down is never hidden by a recipe worker that is up.

### Browser data of deleted profiles

Each worker keeps one chrome profile per kick rocks profile, with its cookies, history and cached pages.
The server tells each worker which profiles still exist whenever it checks in, and between tasks the worker closes and deletes the browser data of any other.
Deleting a profile, or resetting the instance, therefore removes that data from both workers' volumes within a heartbeat or two of the worker being idle.
A worker that is stopped when you delete a profile does it the next time it starts and checks in.

### What a hosted model can and cannot see

The model sees the text of every page the worker shows it, and that text goes to whoever runs the model.

It cannot see:

- Any value the profile holds: names and aliases, emails, phone numbers, addresses, the date of birth and the birth year.
  Each is replaced by a placeholder, in the page text, in links, in dialog text and in error messages, in the spellings listed under the rules above.
- The person's values in what it writes: it types by field name, and the program supplies the value.
- Passwords, and anything in a field the program does not offer.

It can see:

- Everything else on the page, which on a people-search site is a lot: other people's names, ages, relatives, past addresses, phones and emails the profile does not hold, and the age the page shows, which gives away roughly when the person was born.
- A value written in a way the program does not recognise, and values of one or two characters.
- Which placeholders repeat, which tells it that two places on a page show the same hidden value.
- The target, the task's instructions, the names of the task's fields, and the model's own earlier answers.

Use a local model when even that is too much.

### Limits

- It reads the page's own document only.
  A form inside an iframe, such as a third-party form vendor, shows up as an embedded frame it cannot use, and the model should block the task.
- A small model may misread a page.
  Recipes remain the primary path, and an agent run is worth checking the first few times.
  [agent-models.md](agent-models.md) has the benchmark results and which tasks a local model handles.

## Running the built-in worker and an agent together

The built-in worker and an mcp client share one queue, and the server keeps their work apart.
A task claimed through the worker API cannot be reported on through mcp, and the other way around, whatever worker id is sent.
The worker API uses `KICKROCKS_WORKER_TOKEN` and the mcp endpoint uses its own token, so one cannot be used for the other.

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

## Pacing and pushback

The server gates every browser claim, for MCP clients as much as for workers.
A `claim_task` that finds only gated tasks returns no task, and a claim by id for a waiting task fails with `site_waiting` and says when to ask again.
Report what you see of the site: `complete_task`, `block_task`, and `fail_task` take an optional `site` with a `pushback` (kind, status, retryAfterSeconds).
A `block_task` for a CAPTCHA or bot check counts as pushback even without it.
A failure that carries pushback is not retried and not given to anyone else, so do not claim the task again before its cooldown ends.
The server records what you report even when your lease has run out, so a late report of a 429 still keeps the site quiet.
When a page answers 429, 403 or 503, stop and report; do not reload or try another page.
The task instructions say so too: stop at once, make no further request, and call `fail_task` with `retryable` true, kind `site`, and `site.pushback`.
A `fail_task` whose error text names 429, 403, 503 or "too many requests" and carries no `site` is read as pushback by the server, but pass `site` so the status and Retry-After are exact.
A scan that finds nobody should say `noResultsShown: true` in its result only when the site itself displayed a message that nothing matched; an empty result without it does not count as a clean visit.
A site the person routed through a proxy in Settings is never given to an MCP client, because your browser cannot take the route; a claim by id for one fails with `site_routed`.
The built-in model worker does this itself and ends the run at the first such answer.
See `docs/scanning.md`.
