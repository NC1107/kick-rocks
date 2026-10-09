import { mailboxes, matches, recipes, tasks } from "@kickrocks/db";
import { NotificationSettings } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  HOUR,
  MINUTE,
  seedMailbox,
  seedMatch,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";
import { createNotificationChannels } from "./channels.js";
import { type FakePushServer, startFakePushServer } from "./fake-push-server.js";
import { pushNewAttention } from "./push.js";
import { readState } from "./state.js";

const BOT_TOKEN = "123456789:AAExampleTokenValue_abcdefghijklmnop";

let ctx: TestContext;
let ntfy: FakePushServer;
let telegram: FakePushServer;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ntfy = await startFakePushServer();
  telegram = await startFakePushServer();
  ctx = await createTestContext({
    overrides: {
      notificationChannels: createNotificationChannels({ telegramBaseUrl: telegram.url }),
    },
  });
  profileId = seedProfile(ctx, { displayName: "Jordan Example" }).id;
  targetId = seedTarget(ctx, { name: "Acme Data Brokers" }).id;
});

afterEach(async () => {
  await ctx.close();
  await ntfy.close();
  await telegram.close();
});

function configure(patch: Partial<NotificationSettings> = {}): void {
  ctx.services.settings.set(
    "notifications",
    NotificationSettings.parse({
      ntfy: { serverUrl: ntfy.url, topic: "kr_alerts", token: null },
      ...patch,
    }),
  );
}

const blockTask = () =>
  seedTask(ctx, {
    kind: "scan",
    payload: { profileId, targetId, recipeId: null, variant: null },
    status: "blocked",
    profileId,
    targetId,
    blockedReason: "captcha",
  });

const bodies = () => ntfy.requests.map((request) => request.body);

describe("when nothing is configured", () => {
  it("sends nothing and leaves the state alone", async () => {
    blockTask();
    expect(await pushNewAttention(ctx.services)).toBe("unconfigured");
    expect(ntfy.requests).toHaveLength(0);
    expect(readState(ctx.services).announced).toEqual({ ntfy: [], telegram: [] });
  });
});

describe("what triggers a push", () => {
  beforeEach(() => configure());

  it("stays quiet when nothing needs the person", async () => {
    expect(await pushNewAttention(ctx.services)).toBe("idle");
    expect(ntfy.requests).toHaveLength(0);
  });

  it("announces a blocked task with a count and a link to Review", async () => {
    blockTask();
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(1);
    expect(ntfy.requests[0]?.headers.title).toBe("Kick Rocks needs you");
    expect(ntfy.requests[0]?.headers.click).toBe("http://kickrocks.test/review");
    expect(bodies()[0]).toBe("1 task is blocked. Open http://kickrocks.test/review");
  });

  it("announces a request that waits for approval of identifiers", async () => {
    seedRequest(ctx, { profileId, targetId, status: "needs_verification" });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toContain("1 verification needs approval");
  });

  it("announces a listing that needs a decision, and not one already decided", async () => {
    const scan = seedScan(ctx, { profileId, targetId });
    seedMatch(ctx, { scanId: scan.id, profileId, targetId });
    seedMatch(ctx, { scanId: scan.id, profileId, targetId, decision: "mine" });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toContain("1 listing needs a decision");
  });

  it("announces a mailbox failure and links to that mailbox's page", async () => {
    const mailbox = seedMailbox(ctx, profileId, { lastError: "Login failed" });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toBe(
      `1 mailbox error. Open http://kickrocks.test/profiles/${mailbox.profileId}/mailbox`,
    );
  });

  it("announces a broken recipe, but not a broken one nobody uses any more", async () => {
    seedRecipe(ctx, targetId, { purpose: "scan", health: "broken", status: "active" });
    seedRecipe(ctx, targetId, { purpose: "remove", health: "broken", status: "rejected" });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toBe("1 recipe is broken. Open http://kickrocks.test/settings/recipes");
  });

  it("announces browser work that waits while no worker has reported for minutes", async () => {
    ctx.services.settings.set("worker.status.builtin", {
      workerId: "w1",
      version: null,
      lastSeenAt: new Date(ctx.services.clock.now().getTime() - 10 * MINUTE).toISOString(),
      busy: false,
      currentTaskId: null,
    });
    seedTask(ctx, {
      kind: "scan",
      payload: { profileId, targetId, recipeId: null, variant: null },
      profileId,
      targetId,
    });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toBe(
      "The worker is offline and browser work is waiting. Open http://kickrocks.test/settings/agents",
    );
  });

  it("announces a worker that has been silent for a day even when no browser work waits", async () => {
    ctx.services.settings.set("worker.status.builtin", {
      workerId: "w1",
      version: null,
      lastSeenAt: new Date(ctx.services.clock.now().getTime() - 25 * HOUR).toISOString(),
      busy: false,
      currentTaskId: null,
    });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toBe(
      "The worker has not reported for over a day. Open http://kickrocks.test/settings/agents",
    );
  });

  it("stays quiet about an idle worker that was seen within the day", async () => {
    ctx.services.settings.set("worker.status.builtin", {
      workerId: "w1",
      version: null,
      lastSeenAt: new Date(ctx.services.clock.now().getTime() - 3 * HOUR).toISOString(),
      busy: false,
      currentTaskId: null,
    });
    expect(await pushNewAttention(ctx.services)).toBe("idle");
  });

  it("stays quiet about the worker when it reported lately or nothing waits", async () => {
    ctx.services.settings.set("worker.status.builtin", {
      workerId: "w1",
      version: null,
      lastSeenAt: ctx.services.clock.now().toISOString(),
      busy: false,
      currentTaskId: null,
    });
    seedTask(ctx, {
      kind: "scan",
      payload: { profileId, targetId, recipeId: null, variant: null },
      profileId,
      targetId,
    });
    expect(await pushNewAttention(ctx.services)).toBe("idle");
  });

  it("groups everything new into one message", async () => {
    blockTask();
    blockTask();
    seedRequest(ctx, { profileId, targetId, status: "needs_verification" });
    seedMailbox(ctx, profileId, { lastError: "Login failed" });
    seedRecipe(ctx, targetId, { health: "broken" });

    await pushNewAttention(ctx.services);

    expect(ntfy.requests).toHaveLength(1);
    expect(bodies()[0]).toBe(
      "2 tasks are blocked, 1 verification needs approval, 1 mailbox error, 1 recipe is broken. Open http://kickrocks.test/review",
    );
  });

  it("carries no names, addresses, or reference codes", async () => {
    const request = seedRequest(ctx, { profileId, targetId, status: "needs_verification" });
    seedMailbox(ctx, profileId, { lastError: "Login failed for jordan@example.com" });
    blockTask();
    await pushNewAttention(ctx.services);

    const sent = JSON.stringify(ntfy.requests);
    for (const secret of [
      "Jordan",
      "Example",
      "Acme",
      "jordan@example.com",
      "Login failed",
      request.reference,
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("only mentions the items that are new", async () => {
    blockTask();
    await pushNewAttention(ctx.services);
    seedRecipe(ctx, targetId, { health: "broken" });
    ctx.clock.advance(MINUTE);
    await pushNewAttention(ctx.services);
    expect(bodies()[1]).toBe("1 recipe is broken. Open http://kickrocks.test/settings/recipes");
  });
});

describe("announcing once", () => {
  beforeEach(() => configure());

  it("does not repeat an item that is still open", async () => {
    blockTask();
    await pushNewAttention(ctx.services);
    ctx.clock.advance(HOUR);
    expect(await pushNewAttention(ctx.services)).toBe("idle");
    expect(ntfy.requests).toHaveLength(1);
  });

  it("announces the same kind of problem again after it was resolved", async () => {
    seedMailbox(ctx, profileId, { lastError: "Login failed" });
    await pushNewAttention(ctx.services);

    ctx.services.db.update(mailboxes).set({ lastError: null }).run();
    expect(await pushNewAttention(ctx.services)).toBe("idle");
    expect(readState(ctx.services).announced).toEqual({ ntfy: [], telegram: [] });

    ctx.services.db.update(mailboxes).set({ lastError: "Login failed again" }).run();
    ctx.clock.advance(2 * HOUR);
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(2);
  });

  it("forgets a task once it is no longer blocked", async () => {
    const task = blockTask();
    await pushNewAttention(ctx.services);
    ctx.services.db.update(tasks).set({ status: "cancelled" }).where(eq(tasks.id, task.id)).run();
    await pushNewAttention(ctx.services);
    expect(readState(ctx.services).announced).toEqual({ ntfy: [], telegram: [] });
  });

  it("does not announce a listing again after the person decided it", async () => {
    const scan = seedScan(ctx, { profileId, targetId });
    const match = seedMatch(ctx, { scanId: scan.id, profileId, targetId });
    await pushNewAttention(ctx.services);
    ctx.services.db.update(matches).set({ decision: "mine" }).where(eq(matches.id, match.id)).run();
    expect(await pushNewAttention(ctx.services)).toBe("idle");
    expect(ntfy.requests).toHaveLength(1);
  });
});

describe("choosing what to be told about", () => {
  it("skips a category the person switched off, and announces it when it is switched on", async () => {
    configure({ categories: ["match"] });
    blockTask();
    seedRecipe(ctx, targetId, { health: "broken" });
    expect(await pushNewAttention(ctx.services)).toBe("idle");
    expect(ntfy.requests).toHaveLength(0);

    configure({ categories: ["match", "recipe"] });
    await pushNewAttention(ctx.services);
    expect(bodies()[0]).toContain("1 recipe is broken");
    expect(bodies()[0]).not.toContain("blocked");
  });
});

describe("rate limit", () => {
  it("holds back pushes beyond the hourly limit and sends them when the hour allows", async () => {
    configure({ maxPerHour: 2 });
    blockTask();
    await pushNewAttention(ctx.services);
    blockTask();
    ctx.clock.advance(MINUTE);
    await pushNewAttention(ctx.services);
    blockTask();
    ctx.clock.advance(MINUTE);

    expect(await pushNewAttention(ctx.services)).toBe("limited");
    expect(ntfy.requests).toHaveLength(2);

    ctx.clock.advance(HOUR);
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(3);
    expect(bodies()[2]).toContain("1 task is blocked");
  });

  it("counts a push toward the limit once however many channels carry it", async () => {
    configure({
      maxPerHour: 1,
      telegram: { botToken: BOT_TOKEN, chatId: "42" },
    });
    blockTask();
    await pushNewAttention(ctx.services);
    expect(readState(ctx.services).sentAt).toHaveLength(1);
    blockTask();
    expect(await pushNewAttention(ctx.services)).toBe("limited");
  });
});

describe("telegram", () => {
  it("sends the same words to Telegram and ntfy", async () => {
    configure({ telegram: { botToken: BOT_TOKEN, chatId: "42" } });
    blockTask();
    await pushNewAttention(ctx.services);

    expect(ntfy.requests).toHaveLength(1);
    expect(telegram.requests).toHaveLength(1);
    const { text } = JSON.parse(telegram.requests[0]?.body ?? "{}") as { text: string };
    expect(text).toBe(`Kick Rocks needs you\n${bodies()[0]}`);
  });

  it("works with Telegram alone", async () => {
    ctx.services.settings.set(
      "notifications",
      NotificationSettings.parse({ telegram: { botToken: BOT_TOKEN, chatId: "42" } }),
    );
    blockTask();
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(0);
    expect(telegram.requests).toHaveLength(1);
  });
});

describe("delivery failures", () => {
  beforeEach(() => configure());

  it("does not mark items announced when the server refuses, and retries after a pause", async () => {
    ntfy.respondWith(500);
    blockTask();

    expect(await pushNewAttention(ctx.services)).toBe("failed");
    expect(readState(ctx.services)).toMatchObject({
      announced: { ntfy: [], telegram: [] },
      lastSentAt: null,
      lastError: "ntfy answered 500",
    });

    ctx.clock.advance(MINUTE);
    expect(await pushNewAttention(ctx.services)).toBe("waiting");
    expect(ntfy.requests).toHaveLength(1);

    ntfy.respondWith(200);
    ctx.clock.advance(5 * MINUTE);
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(readState(ctx.services)).toMatchObject({
      lastError: null,
      retryAfter: { ntfy: null, telegram: null },
    });
  });

  it("counts a failed attempt as no push, so an outage does not use up the hour", async () => {
    configure({ maxPerHour: 1 });
    ntfy.respondWith(500);
    blockTask();
    await pushNewAttention(ctx.services);
    expect(readState(ctx.services).sentAt).toEqual([]);
  });

  it("treats a push as delivered when one channel took it, and shows the other's error", async () => {
    configure({ telegram: { botToken: BOT_TOKEN, chatId: "42" } });
    telegram.respondWith(401, JSON.stringify({ description: "Unauthorized" }));
    blockTask();

    expect(await pushNewAttention(ctx.services)).toBe("sent");
    const state = readState(ctx.services);
    expect(state.announced.ntfy).toHaveLength(1);
    expect(state.announced.telegram).toEqual([]);
    expect(state.lastError).toBe("Telegram answered 401: Unauthorized");
    expect(state.lastError).not.toContain(BOT_TOKEN);
  });

  it("keeps a channel's refused items for it and sends them there alone once it recovers", async () => {
    configure({ telegram: { botToken: BOT_TOKEN, chatId: "42" } });
    telegram.respondWith(500);
    blockTask();

    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(1);
    expect(telegram.requests).toHaveLength(1);

    telegram.respondWith(200);
    ctx.clock.advance(MINUTE);
    expect(await pushNewAttention(ctx.services)).toBe("waiting");
    expect(telegram.requests).toHaveLength(1);

    ctx.clock.advance(5 * MINUTE);
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(1);
    expect(telegram.requests).toHaveLength(2);
    expect(readState(ctx.services)).toMatchObject({ lastError: null });

    ctx.clock.advance(5 * MINUTE);
    expect(await pushNewAttention(ctx.services)).toBe("idle");
  });

  it("never writes the bot token or the ntfy token to the log", async () => {
    const lines: string[] = [];
    const logger = ctx.services.logger;
    const original = logger.warn.bind(logger);
    logger.warn = ((...args: unknown[]) => {
      lines.push(JSON.stringify(args));
      return (original as (...a: unknown[]) => void)(...args);
    }) as typeof logger.warn;

    configure({
      ntfy: { serverUrl: ntfy.url, topic: "kr_alerts", token: "tk_secret" },
      telegram: { botToken: BOT_TOKEN, chatId: "42" },
    });
    ntfy.respondWith(500);
    telegram.respondWith(500);
    blockTask();
    await pushNewAttention(ctx.services);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("")).not.toContain("tk_secret");
    expect(lines.join("")).not.toContain(BOT_TOKEN);
  });
});

describe("an error that flaps", () => {
  const setMailboxError = (id: string, lastError: string | null) =>
    ctx.services.db.update(mailboxes).set({ lastError }).where(eq(mailboxes.id, id)).run();

  it("is announced once, not again each time it clears and comes back within the cooldown", async () => {
    configure();
    const mailbox = seedMailbox(ctx, profileId, { lastError: null });

    const outcomes: string[] = [];
    for (let poll = 0; poll < 4; poll += 1) {
      setMailboxError(mailbox.id, "Login failed");
      outcomes.push(await pushNewAttention(ctx.services));
      ctx.clock.advance(5 * MINUTE);
      setMailboxError(mailbox.id, null);
      outcomes.push(await pushNewAttention(ctx.services));
      ctx.clock.advance(5 * MINUTE);
    }
    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(1);
    expect(ntfy.requests).toHaveLength(1);
  });

  it("is announced again once the cooldown has passed", async () => {
    configure();
    const mailbox = seedMailbox(ctx, profileId, { lastError: "Login failed" });
    await pushNewAttention(ctx.services);
    setMailboxError(mailbox.id, null);
    await pushNewAttention(ctx.services);

    ctx.clock.advance(2 * HOUR);
    setMailboxError(mailbox.id, "Login failed");
    expect(await pushNewAttention(ctx.services)).toBe("sent");
    expect(ntfy.requests).toHaveLength(2);
  });
});

describe("a deleted recipe row", () => {
  it("is simply not open any more", async () => {
    configure();
    const recipe = seedRecipe(ctx, targetId, { health: "broken" });
    await pushNewAttention(ctx.services);
    ctx.services.db.delete(recipes).where(eq(recipes.id, recipe.id)).run();
    await pushNewAttention(ctx.services);
    expect(readState(ctx.services).announced).toEqual({ ntfy: [], telegram: [] });
  });
});
