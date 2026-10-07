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

`createTestContext({ now?, env?, targetSources?, beforeReady? })` returns:

- `services`, the same `AppServices` object production builds, over a temporary SQLCipher database.
- `app`, the Fastify instance, already ready.
- `clock`, a `FakeClock` that only moves when you call `advance(ms)` or `set(date)`.
  `DAY`, `HOUR`, `MINUTE`, and `SECOND` are exported for the arithmetic.
- `mail`, the fake mail services described below.
- `legal`, a deterministic stand-in for `@kickrocks/legal`.
  California gets a statute, every other state gets the policy basis.
- `auth`, a `FakeAuth` that allows everything until you call `auth.deny()` or `auth.deny(403)`.
- `inject`, `injectWorker`, and `injectMcp`, which add the credentials each kind of caller needs.
  `inject` sends the `X-Kick-Rocks` header like the browser does.
- `call(route, { params, query, body })`, which calls a route from `API_ROUTES` with the right credentials and returns `{ ok, status, body }`.
  A successful body is parsed through the route's response schema, so a handler that breaks the contract fails your test.
  A failure returns the `{ error, message?, issues? }` body.
- `close()`, which stops the app and deletes the temporary directory.

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

`makeBroker`, `makeCompany`, and `makeRecipe` build valid records without touching the database, for tests of datasets and extra-target files.

## Rules

- Take the time from `ctx.clock`, never from the system, so a test is repeatable.
- Never use real people, real addresses, or real broker domains.
  Use Jordan Example, `example.com`, `example.org`, and `.test`.
- Never send mail or open a browser from a test.
  The fakes exist so you do not need to.
