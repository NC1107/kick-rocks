import { mailboxes } from "@kickrocks/db";
import { API_ROUTES, type MailboxInput } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMailServices } from "../../mail/index.js";
import type { MailConnection } from "../../mail/types.js";
import {
  createTestContext,
  describeIntegration,
  seedMailbox,
  seedProfile,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const NEW_MAILBOX = {
  provider: "fastmail",
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: "app-password-1",
  smtpHost: "smtp.example.test",
  smtpPort: 465,
  smtpSecure: true,
  imapHost: "imap.example.test",
  imapPort: 993,
  replyFolder: "INBOX",
  dailyCap: 100,
} satisfies MailboxInput;

const { password: _password, replyFolder: _folder, dailyCap: _cap, ...TEST_BODY } = NEW_MAILBOX;

/** A stored mailbox on the same account and servers as NEW_MAILBOX. */
const SAME_SERVERS = {
  username: NEW_MAILBOX.username,
  smtpHost: NEW_MAILBOX.smtpHost,
  smtpPort: NEW_MAILBOX.smtpPort,
  imapHost: NEW_MAILBOX.imapHost,
  imapPort: NEW_MAILBOX.imapPort,
};

function storedRow(profileId: string) {
  return ctx.services.db.select().from(mailboxes).where(eq(mailboxes.profileId, profileId)).get();
}

describe("GET /mail/providers", () => {
  it("lists the presets, including the one that is not supported", async () => {
    const result = await ctx.call(API_ROUTES.mailProviders);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.body.providers.map((provider) => provider.id);
    expect(ids).toContain("gmail");
    expect(ids).toContain("other");
    expect(result.body.providers.find((p) => p.id === "outlook")).toMatchObject({
      supported: false,
    });
  });

  it("turns an anonymous caller away", async () => {
    ctx.auth.deny();
    expect((await ctx.call(API_ROUTES.mailProviders)).status).toBe(401);
  });
});

describe("POST /profiles/:id/mailbox/test", () => {
  it("reports both connections and the folders IMAP lists", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, password: "typed-password" },
    });
    expect(result).toMatchObject({
      ok: true,
      body: {
        smtp: { ok: true, error: null },
        imap: {
          ok: true,
          error: null,
          folders: [{ path: "INBOX" }, { path: "Junk" }],
        },
      },
    });
  });

  it("reports an SMTP failure without hiding that IMAP works", async () => {
    const profile = seedProfile(ctx);
    ctx.mail.verifyResult = {
      ok: false,
      error: "The server rejected the username or app password.",
    };
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, password: "typed-password" },
    });
    expect(result).toMatchObject({
      ok: true,
      body: {
        smtp: { ok: false, error: "The server rejected the username or app password." },
        imap: { ok: true },
      },
    });
  });

  it("reports an IMAP failure without hiding that SMTP works", async () => {
    const profile = seedProfile(ctx);
    ctx.services.mail.inbox = () => ({
      listFolders: () => Promise.reject(new Error("Login failed")),
      fetchSince: () => Promise.reject(new Error("unused")),
    });
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, password: "typed-password" },
    });
    expect(result).toMatchObject({
      ok: true,
      body: { smtp: { ok: true }, imap: { ok: false, error: "Login failed", folders: [] } },
    });
  });

  it("tests with the stored password when none is typed, and with the typed one when it is", async () => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id, { secret: "stored-password", ...SAME_SERVERS });
    const used: string[] = [];
    const original = ctx.services.mail.transport;
    ctx.services.mail.transport = (connection: MailConnection) => {
      used.push(connection.password);
      return original(connection);
    };

    await ctx.call(API_ROUTES.mailboxTest, { params: { id: profile.id }, body: TEST_BODY });
    await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, password: "typed-password" },
    });
    expect(used).toEqual(["stored-password", "typed-password"]);
  });

  it.each([
    ["smtpHost", "smtp.other.test"],
    ["imapHost", "imap.other.test"],
    ["smtpPort", 587],
    ["imapPort", 143],
    ["username", "someone-else@example.com"],
  ])("never sends the stored password to a changed %s", async (field, value) => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id, { secret: "stored-password", ...SAME_SERVERS });
    const used: string[] = [];
    const original = ctx.services.mail.transport;
    ctx.services.mail.transport = (connection: MailConnection) => {
      used.push(connection.password);
      return original(connection);
    };

    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, [field]: value },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { error: "invalid_request", issues: [{ path: ["body", "password"] }] },
    });
    expect(used).toEqual([]);
  });

  it("asks for a password when none is typed and none is stored", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: TEST_BODY,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { error: "invalid_request", issues: [{ path: ["body", "password"] }] },
    });
  });

  it("refuses a provider that is not supported, with the reason", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, provider: "outlook", password: "x" },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { issues: [{ path: ["body", "provider"], message: expect.stringMatching(/OAuth/) }] },
    });
  });

  it("refuses a provider it does not know", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, provider: "nope", password: "x" },
    });
    expect(result.status).toBe(400);
  });

  it("validates the body", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, address: "not an email", smtpPort: 70000, password: "x" },
    });
    expect(result.status).toBe(400);
    if (result.ok) return;
    const paths = result.body.issues?.map((entry) => entry.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["body.address", "body.smtpPort"]));
  });

  it("answers 404 for a profile that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: "missing" },
      body: { ...TEST_BODY, password: "x" },
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("turns away a caller without a session or without the CSRF header", async () => {
    const profile = seedProfile(ctx);
    const url = `/api/profiles/${profile.id}/mailbox/test`;
    const payload = { ...TEST_BODY, password: "x" };
    expect((await ctx.inject({ method: "POST", url, payload, csrf: false })).statusCode).toBe(403);
    ctx.auth.deny();
    expect((await ctx.inject({ method: "POST", url, payload })).statusCode).toBe(401);
  });
});

describe("PUT /profiles/:id/mailbox", () => {
  it("creates the mailbox and never returns the password", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: NEW_MAILBOX,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      profileId: profile.id,
      provider: "fastmail",
      address: "jordan@example.com",
      replyFolder: "INBOX",
      dailyCap: 100,
      lastPolledAt: null,
      lastError: null,
    });
    expect(JSON.stringify(result.response.body)).not.toContain("app-password-1");
    expect(result.body).not.toHaveProperty("password");
    expect(result.body).not.toHaveProperty("secret");
    expect(storedRow(profile.id)?.secret).toBe("app-password-1");
  });

  it("defaults the reply folder to INBOX", async () => {
    const profile = seedProfile(ctx);
    const { replyFolder: _unused, ...withoutFolder } = NEW_MAILBOX;
    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: withoutFolder,
    });
    expect(result).toMatchObject({ ok: true, body: { replyFolder: "INBOX" } });
  });

  it("requires a password for a new mailbox", async () => {
    const profile = seedProfile(ctx);
    const { password: _unused, ...withoutPassword } = NEW_MAILBOX;
    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: withoutPassword,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { issues: [{ path: ["body", "password"] }] },
    });
    expect(storedRow(profile.id)).toBeUndefined();
  });

  it("does not carry the stored password over to a different server", async () => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id, { secret: "stored-password", ...SAME_SERVERS });
    const { password: _unused, ...withoutPassword } = NEW_MAILBOX;

    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...withoutPassword, smtpHost: "smtp.other.test", imapHost: "imap.other.test" },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: { issues: [{ path: ["body", "password"] }] },
    });
    expect(storedRow(profile.id)).toMatchObject({
      secret: "stored-password",
      smtpHost: NEW_MAILBOX.smtpHost,
    });
  });

  it("keeps the stored password when none is sent, and replaces it when one is", async () => {
    const profile = seedProfile(ctx);
    const created = seedMailbox(ctx, profile.id, { secret: "stored-password", ...SAME_SERVERS });
    const { password: _unused, ...withoutPassword } = NEW_MAILBOX;

    const kept = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...withoutPassword, dailyCap: 40 },
    });
    expect(kept).toMatchObject({ ok: true, body: { id: created.id, dailyCap: 40 } });
    expect(storedRow(profile.id)?.secret).toBe("stored-password");

    await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...NEW_MAILBOX, password: "rotated-password" },
    });
    expect(storedRow(profile.id)?.secret).toBe("rotated-password");
    expect(ctx.services.db.select().from(mailboxes).all()).toHaveLength(1);
  });

  it("keeps the poll cursor when only a setting that does not move it changes", async () => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id, {
      ...{
        provider: "fastmail",
        username: "jordan@example.com",
        imapHost: "imap.example.test",
        imapPort: 993,
      },
      uidValidity: 42,
      lastPollUid: 17,
      lastPolledAt: "2026-10-01T00:00:00.000Z",
      lastError: "Login failed",
    });
    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...NEW_MAILBOX, dailyCap: 60 },
    });
    expect(result).toMatchObject({
      ok: true,
      body: { lastPolledAt: "2026-10-01T00:00:00.000Z", lastError: null },
    });
    expect(storedRow(profile.id)).toMatchObject({ uidValidity: 42, lastPollUid: 17 });
  });

  it.each([
    ["the IMAP host", { imapHost: "imap.other.test" }],
    ["the username", { username: "other@example.com" }],
    ["the reply folder", { replyFolder: "Kick Rocks" }],
  ])("forgets the poll cursor when %s changes", async (_name, change) => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id, {
      username: "jordan@example.com",
      imapHost: "imap.example.test",
      imapPort: 993,
      replyFolder: "INBOX",
      uidValidity: 42,
      lastPollUid: 17,
      lastPolledAt: "2026-10-01T00:00:00.000Z",
    });
    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...NEW_MAILBOX, ...change },
    });
    expect(result).toMatchObject({ ok: true, body: { lastPolledAt: null } });
    expect(storedRow(profile.id)).toMatchObject({ uidValidity: null, lastPollUid: null });
  });

  it("refuses an unsupported provider and a daily cap outside the range", async () => {
    const profile = seedProfile(ctx);
    const unsupported = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...NEW_MAILBOX, provider: "outlook" },
    });
    expect(unsupported.status).toBe(400);
    const cap = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...NEW_MAILBOX, dailyCap: 0 },
    });
    expect(cap.status).toBe(400);
    expect(storedRow(profile.id)).toBeUndefined();
  });

  it("answers 404 for a profile that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: "missing" },
      body: NEW_MAILBOX,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });
});

describe("DELETE /profiles/:id/mailbox", () => {
  it("removes the mailbox and cancels the poll that was waiting for it", async () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const { task } = ctx.services.dispatch.enqueueInboxPoll(mailbox.id);

    const result = await ctx.call(API_ROUTES.mailboxDelete, { params: { id: profile.id } });
    expect(result).toMatchObject({ ok: true, body: { ok: true } });
    expect(storedRow(profile.id)).toBeUndefined();
    expect(ctx.services.taskQueue.get(task.id)?.status).toBe("cancelled");
  });

  it("answers 404 when there is no mailbox, and for a missing profile", async () => {
    const profile = seedProfile(ctx);
    expect(await ctx.call(API_ROUTES.mailboxDelete, { params: { id: profile.id } })).toMatchObject({
      ok: false,
      status: 404,
      body: { error: "mailbox_not_found" },
    });
    expect(await ctx.call(API_ROUTES.mailboxDelete, { params: { id: "missing" } })).toMatchObject({
      ok: false,
      status: 404,
      body: { error: "profile_not_found" },
    });
  });
});

describe("POST /profiles/:id/mailbox/poll", () => {
  it("queues one inbox poll and returns the same one while it waits", async () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id);
    const first = await ctx.call(API_ROUTES.mailboxPoll, { params: { id: profile.id } });
    expect(first).toMatchObject({
      ok: true,
      status: 200,
      body: { task: { kind: "inbox_poll", status: "queued", profileId: profile.id } },
    });
    const second = await ctx.call(API_ROUTES.mailboxPoll, { params: { id: profile.id } });
    if (!(first.ok && second.ok)) throw new Error("both polls should succeed");
    expect(second.body.task.id).toBe(first.body.task.id);
    expect(ctx.services.taskQueue.get(first.body.task.id)?.payload).toEqual({
      mailboxId: mailbox.id,
    });
  });

  it("asks for a mailbox first", async () => {
    const profile = seedProfile(ctx);
    expect(await ctx.call(API_ROUTES.mailboxPoll, { params: { id: profile.id } })).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "mailbox_required" },
    });
    expect((await ctx.call(API_ROUTES.mailboxPoll, { params: { id: "missing" } })).status).toBe(
      404,
    );
  });
});

describe("GET /profiles/:id/mailbox/folders", () => {
  it("lists the folders of the stored mailbox, using its stored password", async () => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id, { address: "jordan@example.com", secret: "stored-password" });
    ctx.mail.mailbox("jordan@example.com").folders = [
      { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
      { path: "Kick Rocks", name: "Kick Rocks", specialUse: null },
    ];
    const seen: string[] = [];
    const original = ctx.services.mail.inbox;
    ctx.services.mail.inbox = (connection) => {
      seen.push(connection.password);
      return original(connection);
    };

    const result = await ctx.call(API_ROUTES.mailboxFolders, { params: { id: profile.id } });
    expect(result).toMatchObject({
      ok: true,
      body: { folders: [{ path: "INBOX" }, { path: "Kick Rocks" }] },
    });
    expect(seen).toEqual(["stored-password"]);
  });

  it("asks for a mailbox first", async () => {
    const profile = seedProfile(ctx);
    expect(await ctx.call(API_ROUTES.mailboxFolders, { params: { id: profile.id } })).toMatchObject(
      {
        ok: false,
        status: 409,
      },
    );
  });

  it("reports an unreachable server as a bad gateway with the reason", async () => {
    const profile = seedProfile(ctx);
    seedMailbox(ctx, profile.id);
    ctx.services.mail.inbox = () => ({
      listFolders: () => Promise.reject(new Error("The server refused the connection.")),
      fetchSince: () => Promise.reject(new Error("unused")),
    });
    expect(await ctx.call(API_ROUTES.mailboxFolders, { params: { id: profile.id } })).toMatchObject(
      {
        ok: false,
        status: 502,
        body: { error: "mailbox_unreachable", message: "The server refused the connection." },
      },
    );
  });
});

describeIntegration("greenmail", "the mailbox routes against a real mail server", () => {
  const host = process.env.GREENMAIL_HOST ?? "localhost";
  const real = () => {
    Object.assign(
      ctx.services.mail,
      createMailServices(ctx.services.config, ctx.services.settings),
    );
  };
  const body = (address: string) => ({
    provider: "other",
    address,
    username: address,
    smtpHost: host,
    smtpPort: Number(process.env.GREENMAIL_SMTP_PORT ?? 3025),
    smtpSecure: false,
    imapHost: host,
    imapPort: Number(process.env.GREENMAIL_IMAP_PORT ?? 3143),
  });

  it("tests a connection, saves it, and lists folders with the stored password", async () => {
    real();
    const profile = seedProfile(ctx);
    const address = `jordan-${Date.now()}@example.com`;

    const tested = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...body(address), password: "app-password" },
    });
    expect(tested).toMatchObject({ ok: true, body: { smtp: { ok: true }, imap: { ok: true } } });

    await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...body(address), password: "app-password", replyFolder: "INBOX", dailyCap: 20 },
    });
    const folders = await ctx.call(API_ROUTES.mailboxFolders, { params: { id: profile.id } });
    expect(folders).toMatchObject({ ok: true, body: { folders: [{ path: "INBOX" }] } });

    const stored = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: body(address),
    });
    expect(stored).toMatchObject({ ok: true, body: { smtp: { ok: true }, imap: { ok: true } } });
  });

  it("reports a refused connection in plain words and never echoes the password", async () => {
    real();
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...body("jordan@example.com"), smtpPort: 1, imapPort: 1, password: "very-secret-pw" },
    });
    expect(result).toMatchObject({
      ok: true,
      body: {
        smtp: { ok: false, error: expect.stringMatching(/refused the connection/) },
        imap: { ok: false, error: expect.stringMatching(/refused the connection/) },
      },
    });
    if (result.ok) expect(JSON.stringify(result.response.body)).not.toContain("very-secret-pw");
  });
});

describe("the send pause", () => {
  function pausedMailbox() {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id, SAME_SERVERS);
    ctx.services.mailHolds.hold(mailbox.id);
    return { profile, mailbox };
  }

  const view = async (profileId: string) => {
    const result = await ctx.call(API_ROUTES.profilesGet, { params: { id: profileId } });
    return result.ok ? result.body.mailbox : null;
  };

  it("shows on the mailbox while it applies", async () => {
    const { profile, mailbox } = pausedMailbox();
    const until = ctx.services.mailHolds.until(mailbox.id);
    expect((await view(profile.id))?.sendPausedUntil).toBe(until?.toISOString());
  });

  it("stops showing once it ends", async () => {
    const { profile } = pausedMailbox();
    ctx.clock.advance(2 * 60 * 60 * 1000);
    expect((await view(profile.id))?.sendPausedUntil).toBeNull();
  });

  it("is cleared when a fixed mailbox is saved", async () => {
    const { profile, mailbox } = pausedMailbox();
    const saved = await ctx.call(API_ROUTES.mailboxSave, {
      params: { id: profile.id },
      body: { ...NEW_MAILBOX, password: "fixed-password" },
    });
    expect(saved).toMatchObject({ ok: true, body: { sendPausedUntil: null } });
    expect(ctx.services.mailHolds.until(mailbox.id)).toBeNull();
  });

  it("is cleared by a connection test that passes for the saved servers", async () => {
    const { profile, mailbox } = pausedMailbox();
    await ctx.call(API_ROUTES.mailboxTest, { params: { id: profile.id }, body: TEST_BODY });
    expect(ctx.services.mailHolds.until(mailbox.id)).toBeNull();
  });

  it("makes the sends it held due again when a passing connection test clears it", async () => {
    const { profile, mailbox } = pausedMailbox();
    const until = ctx.services.mailHolds.until(mailbox.id) ?? new Date();
    const { task } = ctx.services.taskQueue.enqueue({
      kind: "email_send",
      profileId: profile.id,
      payload: { requestId: "r1", kind: "initial", fields: [], inReplyTo: null },
      runAfter: until,
    });
    await ctx.call(API_ROUTES.mailboxTest, { params: { id: profile.id }, body: TEST_BODY });
    expect(ctx.services.taskQueue.getOrThrow(task.id).runAfter).toBe(ctx.clock.now().toISOString());
  });

  it("is kept by a connection test that fails", async () => {
    const { profile, mailbox } = pausedMailbox();
    ctx.mail.verifyResult = { ok: false, error: "The server rejected the app password." };
    await ctx.call(API_ROUTES.mailboxTest, { params: { id: profile.id }, body: TEST_BODY });
    expect(ctx.services.mailHolds.until(mailbox.id)).not.toBeNull();
  });

  it("is kept by a passing test of other servers, which says nothing about the saved ones", async () => {
    const { profile, mailbox } = pausedMailbox();
    await ctx.call(API_ROUTES.mailboxTest, {
      params: { id: profile.id },
      body: { ...TEST_BODY, smtpHost: "smtp.elsewhere.test", password: "typed-password" },
    });
    expect(ctx.services.mailHolds.until(mailbox.id)).not.toBeNull();
  });
});
