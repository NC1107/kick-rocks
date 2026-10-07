import {
  campaigns,
  identities,
  mailboxes,
  matches,
  messages,
  outgoingMail,
  profiles,
  recipes,
  requestEvents,
  requests,
  scans,
  sessions,
  settings,
  targets,
  taskArtifacts,
  tasks,
} from "@kickrocks/db";
import {
  API_ROUTES,
  type ClaimedTask,
  PROFILE_EXPORT_FORMAT,
  PROFILE_EXPORT_VERSION,
  RESET_CONFIRMATION,
  SETTING_SCHEMAS,
  SettingKey,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newId } from "../../core/ids.js";
import {
  createTestContext,
  DAY,
  jordanIdentities,
  seedCampaign,
  seedMailbox,
  seedMatch,
  seedMessage,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";
import { compactDatabase } from "./compact.js";
import { applyRetention } from "./retention.js";

vi.mock("./compact.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compact.js")>();
  return { compactDatabase: vi.fn(actual.compactDatabase) };
});

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
  vi.restoreAllMocks();
});

const count = (
  table: Parameters<TestContext["services"]["db"]["select"]>[0] extends never
    ? never
    : // biome-ignore lint/suspicious/noExplicitAny: any table counts the same way
      any,
) => ctx.services.db.select().from(table).all().length;

const freePages = (): number =>
  ctx.services.db.$client.pragma("freelist_count", { simple: true }) as number;

const BIG_SCREENSHOT = {
  mime: "image/png" as const,
  data: Buffer.concat([Buffer.from("PLAINTEXT-MARKER"), Buffer.alloc(256 * 1024, 7)]),
};

/** A profile with a row in every table that holds something about a person. */
function seedFullProfile(name = "Jordan Example") {
  const profile = seedProfile(ctx, { displayName: name });
  const mailbox = seedMailbox(ctx, profile.id);
  const target = seedTarget(ctx, { category: "people-search" });
  const campaign = seedCampaign(ctx, profile.id);
  const request = seedRequest(ctx, {
    profileId: profile.id,
    targetId: target.id,
    campaignId: campaign.id,
    mailboxId: mailbox.id,
    status: "awaiting_reply",
    sentAt: ctx.services.clock.now().toISOString(),
  });
  ctx.services.requests.addEvent(request.id, {
    type: "note",
    actor: "user",
    payload: { text: "Called the broker" },
  });
  const message = seedMessage(ctx, {
    mailboxId: mailbox.id,
    requestId: request.id,
    classification: "auto_ack",
    confidence: 0.9,
    reviewed: true,
    subject: "Re: your request",
    snippet: "SNIPPET-SECRET",
    text: "BODY-SECRET",
    rationale: "RATIONALE-SECRET",
    links: ["https://broker.test/confirm?token=LINK-SECRET"],
  });
  const scanTask = seedTask(ctx, {
    kind: "scan",
    status: "done",
    profileId: profile.id,
    targetId: target.id,
    payload: { profileId: profile.id, targetId: target.id, recipeId: null, variant: null },
    screenshot: BIG_SCREENSHOT,
  });
  const scan = seedScan(ctx, {
    profileId: profile.id,
    targetId: target.id,
    taskId: scanTask.id,
    finishedAt: ctx.services.clock.now().toISOString(),
    candidates: [{ recordUrl: "https://records.test/p/1", name: "Jordan Example", locations: [] }],
  });
  const match = seedMatch(ctx, {
    scanId: scan.id,
    profileId: profile.id,
    targetId: target.id,
    requestId: request.id,
    decision: "mine",
  });
  const formTask = seedTask(ctx, {
    kind: "form",
    status: "blocked",
    requestId: request.id,
    targetId: target.id,
    payload: { requestId: request.id, targetId: target.id, recipeId: null, recordUrl: null },
    screenshot: BIG_SCREENSHOT,
  });
  const pollTask = seedTask(ctx, {
    kind: "inbox_poll",
    payload: { mailboxId: mailbox.id },
  });
  ctx.services.db
    .insert(outgoingMail)
    .values({
      id: newId(),
      mailboxId: mailbox.id,
      requestId: request.id,
      kind: "initial",
      messageId: "<out-1@mail.test>",
      sentAt: ctx.services.clock.now().toISOString(),
    })
    .run();
  return { profile, mailbox, target, request, message, scan, match, scanTask, formTask, pollTask };
}

const rowsFor = (profileId: string) => {
  const { db } = ctx.services;
  const mailboxIds = db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.profileId, profileId))
    .all()
    .map((row) => row.id);
  return {
    profiles: db.select().from(profiles).where(eq(profiles.id, profileId)).all().length,
    identities: db.select().from(identities).where(eq(identities.profileId, profileId)).all()
      .length,
    mailboxes: mailboxIds.length,
    requests: db.select().from(requests).where(eq(requests.profileId, profileId)).all().length,
    scans: db.select().from(scans).where(eq(scans.profileId, profileId)).all().length,
    matches: db.select().from(matches).where(eq(matches.profileId, profileId)).all().length,
    campaigns: db.select().from(campaigns).where(eq(campaigns.profileId, profileId)).all().length,
    messages: db
      .select()
      .from(messages)
      .all()
      .filter((m) => mailboxIds.includes(m.mailboxId)).length,
  };
};

describe("export", () => {
  it("returns the profile, its requests with timelines, message metadata, scans, and matches", async () => {
    const seeded = seedFullProfile();
    const result = await ctx.call(API_ROUTES.profilesExport, {
      params: { id: seeded.profile.id },
    });
    if (!result.ok) throw new Error(`export answered ${result.status}`);
    const file = result.body;

    expect(file).toMatchObject({
      format: PROFILE_EXPORT_FORMAT,
      version: PROFILE_EXPORT_VERSION,
      profile: { id: seeded.profile.id, displayName: "Jordan Example" },
    });
    expect(file.identities.length).toBe(jordanIdentities().length);
    expect(file.mailbox).toMatchObject({ address: seeded.mailbox.address });
    expect(file.requests).toHaveLength(1);
    expect(file.requests[0]).toMatchObject({
      id: seeded.request.id,
      reference: seeded.request.reference,
      target: { id: seeded.target.id, name: seeded.target.name },
    });
    expect(file.requests[0]?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["created", "note"]),
    );
    expect(file.messages).toEqual([
      expect.objectContaining({
        id: seeded.message.id,
        requestId: seeded.request.id,
        classification: "auto_ack",
        subject: "Re: your request",
      }),
    ]);
    expect(file.scans).toEqual([
      expect.objectContaining({
        id: seeded.scan.id,
        targetName: seeded.target.name,
        candidates: [expect.objectContaining({ name: "Jordan Example" })],
      }),
    ]);
    expect(file.matches).toEqual([
      expect.objectContaining({ id: seeded.match.id, decision: "mine" }),
    ]);
  });

  it("never carries the mailbox password or the body of a message", async () => {
    const seeded = seedFullProfile();
    const result = await ctx.inject({ url: `/api/profiles/${seeded.profile.id}/export` });
    expect(result.statusCode).toBe(200);
    const raw = result.body;
    const secret = ctx.services.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, seeded.mailbox.id))
      .get()?.secret;
    expect(secret).toBeTruthy();
    expect(raw).not.toContain(secret as string);
    for (const hidden of ["BODY-SECRET", "SNIPPET-SECRET", "RATIONALE-SECRET", "LINK-SECRET"]) {
      expect(raw, hidden).not.toContain(hidden);
    }
    expect(raw).not.toMatch(/"secret"|"password"/i);
  });

  it("is a download named for the profile, and is not cached", async () => {
    const seeded = seedFullProfile("Riley O'Sample Jr.");
    const result = await ctx.inject({ url: `/api/profiles/${seeded.profile.id}/export` });
    expect(result.headers["content-disposition"]).toMatch(
      /^attachment; filename="kickrocks-riley-o-sample-jr-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.headers["content-type"]).toContain("application/json");
  });

  it("leaves out another profile's data", async () => {
    const mine = seedFullProfile("Jordan Example");
    const other = seedFullProfile("Riley Sample");
    const result = await ctx.call(API_ROUTES.profilesExport, { params: { id: mine.profile.id } });
    const file = result.ok ? result.body : null;
    expect(file?.requests.map((r) => r.id)).toEqual([mine.request.id]);
    expect(file?.messages.map((m) => m.id)).toEqual([mine.message.id]);
    expect(file?.scans.map((s) => s.id)).toEqual([mine.scan.id]);
    expect(file?.matches.map((m) => m.id)).toEqual([mine.match.id]);
    expect(JSON.stringify(file)).not.toContain(other.profile.id);
  });

  it("exports a profile with nothing attached", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.profilesExport, { params: { id: profile.id } });
    expect(result.ok && result.body).toMatchObject({
      mailbox: null,
      requests: [],
      messages: [],
      scans: [],
      matches: [],
    });
  });

  it("answers 404 for an unknown profile and 401 to an anonymous caller", async () => {
    expect((await ctx.call(API_ROUTES.profilesExport, { params: { id: "nope" } })).status).toBe(
      404,
    );
    const profile = seedProfile(ctx);
    ctx.auth.deny();
    expect((await ctx.call(API_ROUTES.profilesExport, { params: { id: profile.id } })).status).toBe(
      401,
    );
  });
});

describe("delete profile", () => {
  it("removes every row about the profile and leaves another profile whole", async () => {
    const gone = seedFullProfile("Jordan Example");
    const kept = seedFullProfile("Riley Sample");
    const keptBefore = rowsFor(kept.profile.id);
    const keptTasksBefore = count(tasks);
    const goneTasks = 3;

    const result = await ctx.call(API_ROUTES.profilesDelete, { params: { id: gone.profile.id } });
    expect(result.ok && result.body).toEqual({ ok: true });

    expect(rowsFor(gone.profile.id)).toEqual({
      profiles: 0,
      identities: 0,
      mailboxes: 0,
      requests: 0,
      scans: 0,
      matches: 0,
      campaigns: 0,
      messages: 0,
    });
    expect(rowsFor(kept.profile.id)).toEqual(keptBefore);
    expect(count(tasks)).toBe(keptTasksBefore - goneTasks);
    expect(count(outgoingMail)).toBe(1);
    expect(
      ctx.services.db
        .select()
        .from(requestEvents)
        .where(eq(requestEvents.requestId, gone.request.id))
        .all(),
    ).toHaveLength(0);
    expect(count(taskArtifacts)).toBe(2);
    expect(ctx.services.taskQueue.get(kept.formTask.id)).not.toBeNull();
  });

  it("deletes the polls of its mailbox even when the task names no profile", async () => {
    const seeded = seedFullProfile();
    expect(seeded.pollTask.profileId).toBeNull();
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: seeded.profile.id } });
    expect(ctx.services.taskQueue.get(seeded.pollTask.id)).toBeNull();
  });

  it("keeps the broker dataset and the recipes, which are not about the person", async () => {
    const seeded = seedFullProfile();
    seedRecipe(ctx, seeded.target.id, { purpose: "scan" });
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: seeded.profile.id } });
    expect(ctx.services.targets.get(seeded.target.id)).toBeTruthy();
    expect(count(recipes)).toBe(1);
  });

  it("cancels live tasks before deleting them, as the person", async () => {
    const seeded = seedFullProfile();
    const queued = seedTask(ctx, {
      kind: "form",
      requestId: seeded.request.id,
      targetId: seeded.target.id,
      payload: {
        requestId: seeded.request.id,
        targetId: seeded.target.id,
        recipeId: null,
        recordUrl: null,
      },
    });
    const cancel = vi.spyOn(ctx.services.taskQueue, "cancel");
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: seeded.profile.id } });
    const cancelled = cancel.mock.calls.map(([id, actor]) => [id, actor]);
    expect(cancelled).toEqual(
      expect.arrayContaining([
        [queued.id, "user"],
        [seeded.formTask.id, "user"],
        [seeded.pollTask.id, "user"],
      ]),
    );
    // Finished tasks are deleted without being cancelled.
    expect(cancelled.map(([id]) => id)).not.toContain(seeded.scanTask.id);
  });

  it("changes nothing when part of the deletion fails", async () => {
    const seeded = seedFullProfile();
    vi.spyOn(ctx.services.taskQueue, "cancel").mockImplementation(() => {
      throw new Error("boom");
    });
    const result = await ctx.call(API_ROUTES.profilesDelete, { params: { id: seeded.profile.id } });
    expect(result.status).toBe(500);
    expect(rowsFor(seeded.profile.id)).toMatchObject({ profiles: 1, requests: 1, messages: 1 });
    expect(ctx.services.taskQueue.get(seeded.formTask.id)?.status).toBe("blocked");
  });

  it("compacts the file so freed pages no longer hold the deleted bytes", async () => {
    const seeded = seedFullProfile();
    // Control: a plain delete leaves the pages on the free list.
    ctx.services.db.delete(taskArtifacts).where(eq(taskArtifacts.taskId, seeded.scanTask.id)).run();
    expect(freePages()).toBeGreaterThan(0);

    await ctx.call(API_ROUTES.profilesDelete, { params: { id: seeded.profile.id } });
    expect(freePages()).toBe(0);
  });

  it("answers 404 for an unknown profile without touching anything", async () => {
    const seeded = seedFullProfile();
    const result = await ctx.call(API_ROUTES.profilesDelete, { params: { id: "nope" } });
    expect(result.status).toBe(404);
    expect(rowsFor(seeded.profile.id).profiles).toBe(1);
  });
});

describe("delete profile while a worker holds a lease", () => {
  function leasedScan() {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx, { category: "people-search" });
    seedRecipe(ctx, target.id, { purpose: "scan" });
    ctx.services.dispatch.enqueueScan(profile.id, target.id);
    return { profile, target };
  }

  async function claim() {
    const result = await ctx.call(API_ROUTES.workerClaim, { body: { workerId: "worker-1" } });
    if (!result.ok || !result.body.task) throw new Error("nothing to claim");
    return result.body.task as ClaimedTask;
  }

  it("leaves the worker nothing to complete, so no scan or match is written for the deleted profile", async () => {
    const { profile } = leasedScan();
    const task = await claim();
    expect(ctx.services.taskQueue.getOrThrow(task.id).status).toBe("leased");
    expect(count(scans)).toBe(1);

    await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } });

    const complete = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: {
        workerId: "worker-1",
        result: {
          candidates: [
            { recordUrl: "https://records.test/p/9", name: "Jordan Example", locations: [] },
          ],
        },
      },
    });
    expect(complete.status).toBe(404);
    expect(count(scans)).toBe(0);
    expect(count(matches)).toBe(0);
    expect(count(tasks)).toBe(0);
  });

  it("answers the worker's heartbeat, block, and release the same way", async () => {
    const { profile } = leasedScan();
    const task = await claim();
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } });

    const heartbeat = await ctx.call(API_ROUTES.workerTaskHeartbeat, {
      params: { id: task.id },
      body: { workerId: "worker-1" },
    });
    const block = await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: task.id },
      body: { workerId: "worker-1", reason: "captcha", detail: "x" },
    });
    expect([heartbeat.status, block.status]).toEqual([404, 404]);
  });

  it("cancels the leased task through the queue before it is removed", async () => {
    const { profile } = leasedScan();
    const task = await claim();
    const order: string[] = [];
    const cancel = ctx.services.taskQueue.cancel.bind(ctx.services.taskQueue);
    vi.spyOn(ctx.services.taskQueue, "cancel").mockImplementation((id, actor) => {
      const before = ctx.services.taskQueue.get(id)?.status;
      order.push(`cancel:${before}`);
      return cancel(id, actor);
    });
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } });
    expect(order).toEqual(["cancel:leased"]);
    expect(ctx.services.taskQueue.get(task.id)).toBeNull();
  });

  it("does not bring the task back when its lease would have expired", async () => {
    const { profile } = leasedScan();
    const task = await claim();
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } });
    ctx.clock.advance(DAY);
    expect(ctx.services.taskQueue.reapExpiredLeases()).toEqual([]);
    expect(ctx.services.taskQueue.get(task.id)).toBeNull();
  });

  it("leaves a lease on another profile's task alone", async () => {
    const other = leasedScan();
    const task = await claim();
    const doomed = seedProfile(ctx, { displayName: "Riley Sample" });
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: doomed.id } });
    const complete = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: task.id },
      body: { workerId: "worker-1", result: { candidates: [] } },
    });
    expect(complete.ok).toBe(true);
    expect(rowsFor(other.profile.id).scans).toBe(1);
  });
});

describe("reset instance", () => {
  const confirmed = { confirm: RESET_CONFIRMATION } as const;

  it("refuses without the typed confirmation and changes nothing", async () => {
    const seeded = seedFullProfile();
    for (const body of [
      {},
      { confirm: "" },
      { confirm: "reset" },
      { confirm: "Delete Everything" },
    ]) {
      const result = await ctx.call(API_ROUTES.settingsReset, { body: body as never });
      expect(result.status, JSON.stringify(body)).toBe(400);
    }
    expect(rowsFor(seeded.profile.id).profiles).toBe(1);
  });

  it("requires a session and the CSRF header", async () => {
    seedFullProfile();
    const noCsrf = await ctx.inject({
      method: "POST",
      url: "/api/settings/reset",
      payload: confirmed,
      csrf: false,
    });
    expect(noCsrf.statusCode).toBe(403);
    ctx.auth.deny();
    expect((await ctx.call(API_ROUTES.settingsReset, { body: confirmed })).status).toBe(401);
    expect(count(profiles)).toBe(1);
  });

  it("deletes every profile and everything about them", async () => {
    seedFullProfile("Jordan Example");
    seedFullProfile("Riley Sample");

    const result = await ctx.call(API_ROUTES.settingsReset, { body: confirmed });
    expect(result.ok && result.body).toEqual({ ok: true });

    for (const table of [
      profiles,
      identities,
      mailboxes,
      requests,
      requestEvents,
      campaigns,
      messages,
      outgoingMail,
      scans,
      matches,
      tasks,
      taskArtifacts,
    ]) {
      expect(count(table)).toBe(0);
    }
  });

  it("cancels leased work first, so a worker cannot complete it afterwards", async () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx, { category: "people-search" });
    seedRecipe(ctx, target.id, { purpose: "scan" });
    ctx.services.dispatch.enqueueScan(profile.id, target.id);
    const claimed = await ctx.call(API_ROUTES.workerClaim, { body: { workerId: "worker-1" } });
    const taskId = claimed.ok ? (claimed.body.task?.id as string) : "";
    expect(ctx.services.taskQueue.getOrThrow(taskId).status).toBe("leased");

    await ctx.call(API_ROUTES.settingsReset, { body: confirmed });

    const complete = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: taskId },
      body: { workerId: "worker-1", result: { candidates: [] } },
    });
    expect(complete.status).toBe(404);
    expect(count(scans)).toBe(0);
  });

  it("forgets the instance settings but keeps the password, datasets, recipes, and sign-in", async () => {
    const seeded = seedFullProfile();
    seedRecipe(ctx, seeded.target.id, { purpose: "scan" });
    const canary = seedTask(ctx, { kind: "canary", payload: { recipeId: "r.scan.v1" } });
    const { settings: store, db, clock } = ctx.services;
    store.set("auth.passwordHash", "hash-of-the-password");
    store.set("schedule", { ...store.get("schedule"), pollMinutes: 5 });
    store.set("llm", { baseUrl: "http://localhost:11434/v1", model: "m", apiKey: "k" });
    store.set("mcp.enabled", true);
    store.set("siteChecks.enabled", true);
    store.set("mcp.tokenHash", "token-hash");
    store.set("retention", { messageDays: 10, screenshotDays: 5 });
    db.insert(sessions)
      .values({
        id: "session-1",
        createdAt: clock.now().toISOString(),
        lastSeenAt: clock.now().toISOString(),
        expiresAt: new Date(clock.now().getTime() + DAY).toISOString(),
        userAgent: null,
      })
      .run();

    await ctx.call(API_ROUTES.settingsReset, { body: confirmed });

    expect(store.get("schedule").pollMinutes).toBe(15);
    expect(store.get("llm")).toBeNull();
    expect(store.get("mcp.enabled")).toBe(false);
    expect(store.get("siteChecks.enabled")).toBe(false);
    expect(store.get("mcp.tokenHash")).toBeNull();
    expect(store.get("retention")).toEqual({ messageDays: null, screenshotDays: 30 });
    expect(store.get("auth.passwordHash")).toBe("hash-of-the-password");
    expect(
      db
        .select()
        .from(settings)
        .all()
        .map((row) => row.key),
    ).toEqual(["auth.passwordHash"]);
    expect(count(sessions)).toBe(1);
    expect(count(targets)).toBeGreaterThan(0);
    expect(count(recipes)).toBe(1);
    expect(ctx.services.taskQueue.get(canary.id)).not.toBeNull();
  });

  it("resets every setting except the password hash", async () => {
    const { settings: store, db } = ctx.services;
    store.set("auth.passwordHash", "hash-of-the-password");
    store.set("mcp.enabled", true);
    store.set("siteChecks.enabled", true);
    store.set("mcp.tokenHash", "token-hash");
    store.set("llm", { baseUrl: "http://localhost:11434/v1", model: "m", apiKey: "k" });
    store.set("schedule", { ...store.get("schedule"), pollMinutes: 5 });
    store.set("retention", { messageDays: 10, screenshotDays: 5 });
    store.set("notifications", {
      ...store.get("notifications"),
      ntfy: { serverUrl: "https://ntfy.example.test", topic: "topic", token: "tk_secret" },
      telegram: { botToken: "123456:abcdefghijklmnopqrstuvwxyz", chatId: "1234" },
      digest: { frequency: "daily", hourUtc: 9, weekday: 1 },
    });
    store.set("notifications.state", {
      ...store.get("notifications.state"),
      digestLastSentAt: "2026-01-01T00:00:00.000Z",
    });
    store.set("agent.takeUnreviewed", true);
    for (const key of ["worker.status.builtin", "worker.status.model"] as const) {
      store.set(key, {
        workerId: "w",
        version: null,
        lastSeenAt: ctx.clock.now().toISOString(),
        busy: false,
        currentTaskId: null,
      });
    }
    const before = Object.fromEntries(SettingKey.options.map((key) => [key, store.get(key)]));

    await ctx.call(API_ROUTES.settingsReset, { body: confirmed });

    for (const key of SettingKey.options) {
      if (key === "auth.passwordHash") {
        expect(store.get(key)).toBe("hash-of-the-password");
        continue;
      }
      expect(store.get(key), key).toEqual(SETTING_SCHEMAS[key].parse(undefined));
      expect(store.get(key), key).not.toEqual(before[key]);
    }
    expect(
      db
        .select()
        .from(settings)
        .all()
        .map((row) => row.key),
    ).toEqual(["auth.passwordHash"]);
  });

  it("compacts the file", async () => {
    seedFullProfile();
    await ctx.call(API_ROUTES.settingsReset, { body: confirmed });
    expect(freePages()).toBe(0);
  });

  it("works on an instance with nothing in it", async () => {
    const result = await ctx.call(API_ROUTES.settingsReset, { body: confirmed });
    expect(result.ok).toBe(true);
  });
});

describe("retention", () => {
  const setRetention = (value: { messageDays: number | null; screenshotDays: number | null }) =>
    ctx.services.settings.set("retention", value);

  function seedOldMessage(overrides: Parameters<typeof seedMessage>[1], ageDays: number) {
    return seedMessage(ctx, {
      ...overrides,
      receivedAt: new Date(ctx.clock.now().getTime() - ageDays * DAY).toISOString(),
      snippet: "snippet",
      text: "body",
      rationale: "why",
      links: ["https://broker.test/confirm"],
    });
  }

  it("reads as 30 days for screenshots and forever for messages until changed", async () => {
    const result = await ctx.call(API_ROUTES.settingsGet);
    expect(result.ok && result.body.retention).toEqual({ messageDays: null, screenshotDays: 30 });
  });

  it("saves through the settings route, one field at a time", async () => {
    await ctx.call(API_ROUTES.settingsPatch, { body: { retention: { messageDays: 90 } } });
    const result = await ctx.call(API_ROUTES.settingsPatch, {
      body: { retention: { screenshotDays: null } },
    });
    expect(result.ok && result.body.retention).toEqual({ messageDays: 90, screenshotDays: null });
  });

  it("rejects a window that is not a whole number of days", async () => {
    for (const bad of [0, -3, 1.5, 4000]) {
      const result = await ctx.call(API_ROUTES.settingsPatch, {
        body: { retention: { messageDays: bad } },
      });
      expect(result.status, String(bad)).toBe(400);
    }
  });

  it("deletes screenshots of finished tasks older than the window and keeps the rest", () => {
    const old = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "a" },
      status: "failed",
      screenshot: true,
    });
    ctx.clock.advance(10 * DAY);
    const recent = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "b" },
      status: "failed",
      screenshot: true,
    });
    const live = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "c" },
      status: "blocked",
      screenshot: true,
    });
    setRetention({ messageDays: null, screenshotDays: 7 });
    ctx.clock.advance(DAY);

    expect(applyRetention(ctx.services)).toEqual({ screenshots: 1, messages: 0 });
    expect(ctx.services.taskQueue.screenshot(old.id)).toBeNull();
    expect(ctx.services.taskQueue.screenshot(recent.id)).not.toBeNull();
    expect(ctx.services.taskQueue.screenshot(live.id)).not.toBeNull();
  });

  it("applies a shorter window the moment it is saved", async () => {
    const old = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "a" },
      status: "failed",
      screenshot: true,
    });
    ctx.clock.advance(10 * DAY);
    expect(ctx.services.taskQueue.screenshot(old.id)).not.toBeNull();

    await ctx.call(API_ROUTES.settingsPatch, { body: { retention: { screenshotDays: 7 } } });
    expect(ctx.services.taskQueue.screenshot(old.id)).toBeNull();
  });

  it("keeps screenshots forever when the window is null", () => {
    const old = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "a" },
      status: "failed",
      screenshot: true,
    });
    setRetention({ messageDays: null, screenshotDays: null });
    ctx.clock.advance(400 * DAY);
    expect(applyRetention(ctx.services)).toEqual({ screenshots: 0, messages: 0 });
    expect(ctx.services.taskQueue.screenshot(old.id)).not.toBeNull();
  });

  it("blanks the text of old reviewed messages and keeps what the request's history needs", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const old = seedOldMessage(
      { mailboxId: mailbox.id, reviewed: true, classification: "completed", confidence: 0.8 },
      40,
    );
    setRetention({ messageDays: 30, screenshotDays: 30 });

    expect(applyRetention(ctx.services)).toEqual({ screenshots: 0, messages: 1 });

    const row = ctx.services.db.select().from(messages).where(eq(messages.id, old.id)).get();
    expect(row).toMatchObject({
      text: null,
      snippet: null,
      rationale: null,
      links: [],
      subject: old.subject,
      fromAddress: old.fromAddress,
      classification: "completed",
      confidence: 0.8,
      reviewed: true,
      imapUid: old.imapUid,
    });
  });

  it("keeps recent messages and messages still waiting for a person to look at them", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const recent = seedOldMessage({ mailboxId: mailbox.id, reviewed: true }, 5);
    const waiting = seedOldMessage({ mailboxId: mailbox.id, reviewed: false }, 400);
    setRetention({ messageDays: 30, screenshotDays: 30 });

    expect(applyRetention(ctx.services).messages).toBe(0);
    for (const id of [recent.id, waiting.id]) {
      const row = ctx.services.db.select().from(messages).where(eq(messages.id, id)).get();
      expect(row?.text, id).toBe("body");
    }
  });

  it("keeps the text of a reviewed message whose request still needs verification", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const target = seedTarget(ctx, { category: "people-search" });
    const waiting = seedRequest(ctx, {
      profileId: profile.id,
      targetId: target.id,
      status: "needs_verification",
    });
    const kept = seedOldMessage(
      { mailboxId: mailbox.id, requestId: waiting.id, reviewed: true },
      40,
    );
    const textOf = () =>
      ctx.services.db.select().from(messages).where(eq(messages.id, kept.id)).get()?.text;
    setRetention({ messageDays: 30, screenshotDays: 30 });

    expect(applyRetention(ctx.services).messages).toBe(0);
    expect(textOf()).toBe("body");

    ctx.services.db
      .update(requests)
      .set({ status: "confirmed" })
      .where(eq(requests.id, waiting.id))
      .run();
    expect(applyRetention(ctx.services).messages).toBe(1);
    expect(textOf()).toBeNull();
  });

  it("does not count a message it already blanked", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    seedOldMessage({ mailboxId: mailbox.id, reviewed: true }, 40);
    setRetention({ messageDays: 30, screenshotDays: 30 });
    expect(applyRetention(ctx.services).messages).toBe(1);
    expect(applyRetention(ctx.services).messages).toBe(0);
  });

  it("compacts the file when it removed something", () => {
    seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "a" },
      status: "failed",
      screenshot: BIG_SCREENSHOT,
    });
    ctx.clock.advance(31 * DAY);
    expect(applyRetention(ctx.services).screenshots).toBe(1);
    expect(freePages()).toBe(0);
    expect(count(taskArtifacts)).toBe(0);
  });

  it("does not compact on the scheduled path when the purge freed almost nothing", () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    seedOldMessage({ mailboxId: mailbox.id, reviewed: true }, 40);
    setRetention({ messageDays: 30, screenshotDays: 30 });
    vi.mocked(compactDatabase).mockClear();

    expect(applyRetention(ctx.services, { compact: "when-worthwhile" }).messages).toBe(1);
    expect(compactDatabase).not.toHaveBeenCalled();
  });

  it("compacts on the scheduled path when the purge freed a meaningful share of the file", () => {
    seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "a" },
      status: "failed",
      screenshot: BIG_SCREENSHOT,
    });
    ctx.clock.advance(31 * DAY);
    vi.mocked(compactDatabase).mockClear();

    expect(applyRetention(ctx.services, { compact: "when-worthwhile" }).screenshots).toBe(1);
    expect(compactDatabase).toHaveBeenCalledTimes(1);
  });

  it("is what the scheduler runs, with the person's windows", async () => {
    const { createScheduler } = await import("../../scheduler/scheduler.js");
    const old = seedTask(ctx, {
      kind: "canary",
      payload: { recipeId: "a" },
      status: "failed",
      screenshot: true,
    });
    setRetention({ messageDays: null, screenshotDays: 3 });
    ctx.clock.advance(4 * DAY);
    const scheduler = createScheduler(ctx.services, {
      runners: { runDue: async () => ({ polled: 0, sent: 0 }) } as never,
      housekeepingMs: 0,
      retentionMs: 0,
    });
    await scheduler.tick();
    await scheduler.stop();
    expect(ctx.services.taskQueue.screenshot(old.id)).toBeNull();
  });
});
