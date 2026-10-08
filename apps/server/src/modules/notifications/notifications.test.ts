import { API_ROUTES, NotificationSettings } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunners } from "../../runners/index.js";
import { createScheduler } from "../../scheduler/index.js";
import {
  createTestContext,
  DAY,
  HOUR,
  seedMailbox,
  seedMessage,
  seedProfile,
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
let server: FakePushServer;

beforeEach(async () => {
  server = await startFakePushServer();
  ctx = await createTestContext({
    overrides: {
      notificationChannels: createNotificationChannels({ telegramBaseUrl: server.url }),
    },
  });
});

afterEach(async () => {
  await ctx.close();
  await server.close();
});

const get = () => ctx.call(API_ROUTES.notificationsGet);
const patch = (body: Record<string, unknown>) =>
  ctx.call(API_ROUTES.notificationsPatch, { body: body as never });

describe("access", () => {
  it("turns away an anonymous caller from every route", async () => {
    ctx.auth.deny();
    for (const route of [
      API_ROUTES.notificationsGet,
      API_ROUTES.notificationsPatch,
      API_ROUTES.notificationsTest,
      API_ROUTES.notificationsDigestSend,
    ]) {
      expect((await ctx.call(route, { body: {} as never })).status, route.path).toBe(401);
    }
  });
});

describe("GET /notifications", () => {
  it("reports nothing configured on a fresh instance", async () => {
    const result = await get();
    expect(result.ok && result.body).toMatchObject({
      ntfy: null,
      telegram: null,
      categories: ["blocked_task", "verification", "match", "mailbox", "recipe", "worker"],
      maxPerHour: 6,
      digest: { frequency: "off", hourUtc: 8, weekday: 1 },
      appUrl: "http://kickrocks.test",
      mailboxReady: false,
      status: { lastSentAt: null, lastError: null },
    });
  });

  it("never returns a token", async () => {
    await patch({
      ntfy: { serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" },
      telegram: { botToken: BOT_TOKEN, chatId: "42" },
    });
    const response = (await ctx.inject({ url: "/api/notifications" })).body;
    expect(response).not.toContain("tk_secret");
    expect(response).not.toContain(BOT_TOKEN);
    expect(JSON.parse(response)).toMatchObject({
      ntfy: { tokenSet: true },
      telegram: { botTokenSet: true, chatId: "42" },
    });
  });

  it("says whether a mailbox exists for the digest", async () => {
    seedMailbox(ctx, seedProfile(ctx).id);
    const result = await get();
    expect(result.ok && result.body.mailboxReady).toBe(true);
  });
});

describe("PATCH /notifications", () => {
  it("saves ntfy and Telegram and keeps the stored secrets when they are omitted", async () => {
    await patch({
      ntfy: { serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" },
      telegram: { botToken: BOT_TOKEN, chatId: "42" },
    });
    await patch({
      ntfy: { serverUrl: server.url, topic: "other_topic" },
      telegram: { chatId: "-100999" },
    });

    expect(ctx.services.settings.get("notifications")).toMatchObject({
      ntfy: { topic: "other_topic", token: "tk_secret" },
      telegram: { botToken: BOT_TOKEN, chatId: "-100999" },
    });
  });

  it("clears a saved ntfy token when null is sent", async () => {
    await patch({ ntfy: { serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" } });
    await patch({ ntfy: { serverUrl: server.url, topic: "kr_alerts", token: null } });
    expect(ctx.services.settings.get("notifications").ntfy?.token).toBeNull();
  });

  it("refuses to carry a saved ntfy token to a different server", async () => {
    await patch({ ntfy: { serverUrl: server.url, topic: "kr_alerts", token: "tk_secret" } });
    const result = await patch({
      ntfy: { serverUrl: "https://ntfy.example.org", topic: "kr_alerts" },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.body.issues).toEqual([
      { path: ["body", "ntfy", "token"], message: "The server changed, so enter the token again" },
    ]);
    expect(ctx.services.settings.get("notifications").ntfy?.serverUrl).toBe(server.url);
  });

  it("requires a bot token the first time Telegram is saved", async () => {
    const result = await patch({ telegram: { chatId: "42" } });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.body.issues?.[0]?.path).toEqual([
      "body",
      "telegram",
      "botToken",
    ]);
  });

  it.each([
    ["a topic with a slash", { ntfy: { serverUrl: "https://ntfy.sh", topic: "a/b" } }],
    ["a javascript server address", { ntfy: { serverUrl: "javascript:alert(1)", topic: "kr" } }],
    ["a malformed bot token", { telegram: { botToken: "nope", chatId: "42" } }],
    [
      "a chat that is neither an id nor a channel",
      { telegram: { botToken: BOT_TOKEN, chatId: "hello there" } },
    ],
    ["a limit of zero", { maxPerHour: 0 }],
    ["an hour of 24", { digest: { hourUtc: 24 } }],
    ["an unknown category", { categories: ["everything"] }],
  ])("rejects %s", async (_name, body) => {
    expect((await patch(body)).status).toBe(400);
  });

  it("removes a channel with null", async () => {
    await patch({ telegram: { botToken: BOT_TOKEN, chatId: "42" } });
    await patch({ telegram: null });
    const result = await get();
    expect(result.ok && result.body.telegram).toBeNull();
  });

  it("changes categories, the limit, and the digest schedule", async () => {
    const result = await patch({
      categories: ["match", "match", "recipe"],
      maxPerHour: 3,
      digest: { frequency: "weekly", weekday: 5 },
    });
    expect(result.ok && result.body).toMatchObject({
      categories: ["match", "recipe"],
      maxPerHour: 3,
      digest: { frequency: "weekly", hourUtc: 8, weekday: 5 },
    });
  });

  it("starts the first digest period at the moment it is switched on", async () => {
    await patch({ digest: { frequency: "daily" } });
    expect(readState(ctx.services).digestLastSentAt).toBe(ctx.clock.now().toISOString());

    ctx.clock.advance(HOUR);
    await patch({ digest: { hourUtc: 9 } });
    expect(readState(ctx.services).digestLastSentAt).not.toBe(ctx.clock.now().toISOString());
  });
});

describe("after a push failed", () => {
  async function failOnce(): Promise<void> {
    const profileId = seedProfile(ctx).id;
    const targetId = seedTarget(ctx).id;
    await patch({ ntfy: { serverUrl: server.url, topic: "kr_alerts" } });
    server.respondWith(500);
    seedTask(ctx, {
      kind: "scan",
      payload: { profileId, targetId, recipeId: null, variant: null },
      status: "blocked",
      profileId,
      targetId,
      blockedReason: "captcha",
    });
    await pushNewAttention(ctx.services);
    const view = await get();
    expect(view.ok && view.body.status.lastError).not.toBeNull();
  }

  it("clears the error and the pause when the channel is saved again", async () => {
    await failOnce();
    server.respondWith(200);
    await patch({ ntfy: { serverUrl: server.url, topic: "other_topic" } });

    const view = await get();
    expect(view.ok && view.body.status.lastError).toBeNull();
    expect(await pushNewAttention(ctx.services)).toBe("sent");
  });

  it("clears the error when the last channel is removed", async () => {
    await failOnce();
    await patch({ ntfy: null });
    const view = await get();
    expect(view.ok && view.body.status.lastError).toBeNull();
  });

  it("clears the error when a test message gets through", async () => {
    await failOnce();
    server.respondWith(200);
    await ctx.call(API_ROUTES.notificationsTest, { body: { channel: "ntfy" } });
    const view = await get();
    expect(view.ok && view.body.status.lastError).toBeNull();
    expect(readState(ctx.services).retryAfter.ntfy).toBeNull();
  });
});

describe("POST /notifications/test", () => {
  it("sends a test message through a saved channel", async () => {
    await patch({ ntfy: { serverUrl: server.url, topic: "kr_alerts" } });
    const result = await ctx.call(API_ROUTES.notificationsTest, { body: { channel: "ntfy" } });

    expect(result.ok && result.body).toEqual({ ok: true, error: null });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.headers.title).toBe("Kick Rocks test");
  });

  it("reports why Telegram refused, without the token", async () => {
    await patch({ telegram: { botToken: BOT_TOKEN, chatId: "42" } });
    server.respondWith(401, JSON.stringify({ description: "Unauthorized" }));
    const result = await ctx.call(API_ROUTES.notificationsTest, { body: { channel: "telegram" } });

    expect(result.ok && result.body).toEqual({
      ok: false,
      error: "Telegram answered 401: Unauthorized",
    });
  });

  it("asks for the channel to be saved first", async () => {
    const result = await ctx.call(API_ROUTES.notificationsTest, { body: { channel: "ntfy" } });
    expect(result.status).toBe(409);
    expect(result.ok ? null : result.body.error).toBe("channel_not_configured");
  });
});

describe("POST /notifications/digest/send", () => {
  it("sends the digest now from the person's mailbox", async () => {
    const profileId = seedProfile(ctx).id;
    const mailbox = seedMailbox(ctx, profileId);
    seedMessage(ctx, { mailboxId: mailbox.id });

    const result = await ctx.call(API_ROUTES.notificationsDigestSend);

    expect(result.ok && result.body).toEqual({ outcome: "sent", sent: 1, error: null });
    expect(ctx.mail.sent[0]?.mail.to).toBe(mailbox.address);
  });

  it("says when there is no mailbox", async () => {
    const result = await ctx.call(API_ROUTES.notificationsDigestSend);
    expect(result.ok && result.body.outcome).toBe("no_mailbox");
  });
});

describe("the scheduler", () => {
  it("pushes what became blocked and sends the digest on its pass", async () => {
    const profileId = seedProfile(ctx).id;
    const targetId = seedTarget(ctx).id;
    const mailbox = seedMailbox(ctx, profileId);
    seedMessage(ctx, { mailboxId: mailbox.id });
    ctx.services.settings.set(
      "notifications",
      NotificationSettings.parse({
        ntfy: { serverUrl: server.url, topic: "kr_alerts", token: null },
      }),
    );
    await patch({ digest: { frequency: "daily" } });
    seedTask(ctx, {
      kind: "scan",
      payload: { profileId, targetId, recipeId: null, variant: null },
      status: "blocked",
      profileId,
      targetId,
      blockedReason: "captcha",
    });
    const scheduler = createScheduler(ctx.services, {
      runners: createRunners(ctx.services, { random: () => 0 }),
      housekeepingMs: 0,
    });

    await scheduler.tick();
    expect(server.requests).toHaveLength(1);
    expect(ctx.mail.sent).toHaveLength(0);

    ctx.clock.advance(DAY);
    await scheduler.tick();
    expect(server.requests).toHaveLength(1);
    expect(ctx.mail.sent.map((sent) => sent.mail.to)).toEqual([mailbox.address]);
    await scheduler.stop();
  });

  it("keeps running the other jobs when the notification server is down", async () => {
    ctx.services.settings.set(
      "notifications",
      NotificationSettings.parse({
        ntfy: { serverUrl: "http://127.0.0.1:1", topic: "kr", token: null },
      }),
    );
    const profileId = seedProfile(ctx).id;
    const targetId = seedTarget(ctx).id;
    seedTask(ctx, {
      kind: "scan",
      payload: { profileId, targetId, recipeId: null, variant: null },
      status: "blocked",
      profileId,
      targetId,
    });
    const scheduler = createScheduler(ctx.services, {
      runners: createRunners(ctx.services, { random: () => 0 }),
      housekeepingMs: 0,
    });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(readState(ctx.services).lastError).toBe("Could not reach ntfy");
    await scheduler.stop();
  });
});
