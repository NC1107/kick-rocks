# Test utilities

Every feature module tests against the same harness, so a test builds the whole server in a few lines.
Import everything from `../test-utils/index.js`, adjusting the path for your folder.
Nothing here is shipped: the folder is excluded from the build.

## The test context

```ts
import { API_ROUTES } from "@kickrocks/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestContext, seedProfile, type TestContext } from "../../test-utils/index.js";

let ctx: TestContext;
beforeEach(async () => { ctx = await createTestContext(); });
afterEach(async () => { await ctx.close(); });

it("lists profiles", async () => {
  seedProfile(ctx);
  const result = await ctx.call(API_ROUTES.profilesList);
  expect(result.ok).toBe(true);
});
```

`createTestContext({ now?, env?, targetSources?, beforeReady?, auth? })` returns:

- `services`, the same `AppServices` object production builds, over a temporary SQLCipher database.
- `app`, the Fastify instance, already ready.
- `clock`, a `FakeClock` that only moves when you call `advance(ms)` or `set(date)`.
  `DAY`, `HOUR`, `MINUTE`, and `SECOND` are exported for the arithmetic.
- `mail`, the fake mail services described below.
- `legal`, a deterministic stand-in for `@kickrocks/legal`.
  California gets a statute, every other state gets the policy basis.
- `auth`, a `FakeAuth` that allows everything until you call `auth.deny()` or `auth.deny(403)`.
  Pass `auth: "real"` to build the server with its own auth service instead (sessions, cookies, CSRF, throttling), which is what module A tests; `ctx.auth` then throws if you try to steer it, and you sign in through the auth routes.
- `inject`, `injectWorker`, and `injectMcp`, which add the credentials each kind of caller needs.
  `inject` sends the `X-Kick-Rocks` header like the browser does; pass `csrf: false` to leave it out and see the server turn the call away with a 403.
  Worker and MCP calls never send it.
- `call(route, { params, query, body })`, which calls a route from `API_ROUTES` with the right credentials and returns `{ ok, status, body }`.
  A successful body is parsed through the route's response schema, so a handler that breaks the contract fails your test, and so does a handler that answers 200 where the table says 201.
  A failure returns the `{ error, message?, issues? }` body.
- `close()`, which stops the app and deletes the temporary directory.

The guard is the real one: a route whose entry in `API_ROUTES` says `session` asks `ctx.auth`, a state-changing call needs the CSRF header, and a route registered with no declaration needs a session.
The scheduler is off, there are no targets until you seed some, and the worker API and MCP are enabled with known tokens (`workerToken`, `mcpToken`).
Each context has its own database, so tests do not share state.
Rows from `seedTarget` are not dataset records, so calling `services.targets.sync()` afterwards retires them.
To test a sync, pass `targetSources` to `createTestContext` instead.
A route or hook can only be added before the app is ready, so tests that need one pass `beforeReady`.

## Fake mail

`ctx.mail` implements `MailServices` and never leaves the process.

- `mail.sent` lists every message a transport was given, with the connection it used.
  `mail.failNextSend(error?)` makes the next send throw, and `mail.verifyResult` sets what `verify` answers.
- `mail.mailbox(address).deliver({ subject, text, from, inReplyTo, ... })` puts a message in the scripted inbox.
  Pass `folder` for something other than `INBOX`, and `mailbox.resetUidValidity()` to simulate a renumbered folder.
  `fetchSince(folder, afterUid, uidValidity, { since, limit })` honors both options, oldest first, and reports `hasMore` and `highestUid`.
- `mail.classifier.when(subjectOrRegex, result)` or `.program(handler)` decides what the classifier answers.
  The newest handler wins, and a handler returns `null` to pass.
  Unprogrammed mail classifies as `unknown` with confidence 0.
  `classifier.calls` records every message and context it saw.
- `mail.linkFollower.program(handler)` decides what following a link returns.
  The default is a successful follow.
  `linkFollower.calls` records each URL and the allowed domains.

## Factories

Each takes the context (or anything with `services`) first, and inserts directly into the database.

- `seedProfile(ctx, { displayName?, state?, identities? })` creates Jordan Example with one identity of each kind.
  Every value is fake and on a reserved domain.
- `seedIdentities(ctx, profileId, inputs?)` replaces a profile's identities.
- `seedMailbox(ctx, profileId, overrides?)` creates the profile's mailbox with fake credentials.
- `seedTarget(ctx, overrides?)` creates a broker, or a company when you pass `kind: "company"`.
  Ids and domains derive from each other, so two seeded targets never collide.
- `seedRecipe(ctx, targetId, { purpose?, version?, status?, health?, source?, definition? })` creates an active remove recipe by default.
- `seedRequest(ctx, { profileId, targetId, status?, channel?, ... })` creates a request and puts it in the status you ask for, skipping the state machine.
- `seedCampaign(ctx, profileId)` creates a campaign row to attach requests to.
- `seedMessage(ctx, { mailboxId, requestId?, classification?, requestedFields?, text?, reviewed?, ... })` stores a message, by default an unreviewed, unclassified one waiting in the review queue.
- `seedScan(ctx, { profileId, targetId, taskId?, candidates?, finishedAt?, error? })` and `seedMatch(ctx, { scanId, profileId, targetId, recordUrl?, decision?, requestId? })` store a scan and a record it found.
- `seedTask(ctx, { kind, payload, status?, screenshot?, blockedReason?, blockedUrl?, lastError?, failureKind?, result?, ... })` stores a task in the state a test needs (`queued`, `leased`, `blocked`, `done`, `failed`, or `cancelled`), with a screenshot artifact when asked.
  It inserts directly, so no handler runs and no event is written, and the payload is validated like the queue would.
- `leaseAs(ctx, taskId, workerId)` leases a queued task to a worker through the real queue, for a test that needs "a worker holds this".

`makeBroker`, `makeCompany`, and `makeRecipe` build valid records without touching the database, for tests of datasets and extra-target files.
`makeRecipe`'s `definition` is the recipe as an author writes it (`RecipeInput`), so a step does not have to spell out `optional: false`.

## Rules

- Take the time from `ctx.clock`, never from the system, so a test is repeatable.
- Never use real people, real addresses, or real broker domains.
  Use Jordan Example, `example.com`, `example.org`, and `.test`.
- Never send mail or open a browser from a test.
  The fakes exist so you do not need to.

## Handlers run inside the transaction

A task handler registered on `ctx.services.taskHandlers` is synchronous and runs inside the transaction that changed the task.
A test that wants to know a handler ran reads what it wrote after the queue call returns, and a test of a handler that throws checks that the task change was rolled back.
`ctx.services.taskQueue` is synchronous too, so there is nothing to `await`.

## Tests of a skeleton must outlive the module

A foundation test that checks a stub (a route answering 501, a service throwing `NotImplementedError`) fails the day the module lands, and the module's author may not edit it.
So a test of foundation code never asserts stub behavior.
To check that a route exists, use `ctx.app.hasRoute({ method, url })`; to check a stub answers 501, loop over `stubbedRoutes` from `core/http.ts`, which lists only the routes still stubbed.
To test the guard, register a probe route with `beforeReady` (for example `app.get("/api/__probe", ...)`) and assert only that the guard let the request through or turned it away (401, 403, or 503), never what a module answers.

## Integration tests

Some tests need a service that is not always there: GreenMail for mail, Chromium for the recipe runner.
They must skip on a machine without it, so `pnpm test` works on a laptop, and must never skip in CI, so a broken service cannot make them pass by not running.

- For GreenMail use `describeIntegration("greenmail", "name", () => { ... })` from `test-utils`.
  It skips when `GREENMAIL_HOST` is unset and fails when `KICKROCKS_REQUIRE_INTEGRATION=1` is set and it is.
- For Chromium (module F), use `describe.skipIf(!chromiumInstalled && process.env.KICKROCKS_REQUIRE_INTEGRATION !== "1")`, where `chromiumInstalled` is `existsSync(chromium.executablePath())` from `playwright`.
  With the variable set, the suite runs even without Chromium and fails when it cannot launch it.
- CI sets `KICKROCKS_REQUIRE_INTEGRATION=1`.
