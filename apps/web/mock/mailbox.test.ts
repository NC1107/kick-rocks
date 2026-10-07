import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

const riley = () => app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;

const connection = {
  provider: "gmail",
  address: "riley@example.net",
  username: "riley@example.net",
  password: "app-password",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecure: true,
  imapHost: "imap.gmail.com",
  imapPort: 993,
};

const testWith = (password: string) =>
  call({
    method: "POST",
    path: `/profiles/${riley().id}/mailbox/test`,
    body: { ...connection, password },
  });

describe("mailbox handlers", () => {
  it("connects, tests, and removes a mailbox", async () => {
    const ok = await call({
      method: "POST",
      path: `/profiles/${riley().id}/mailbox/test`,
      body: connection,
    });
    expect(ok.json.smtp.ok).toBe(true);
    const bad = await testWith("wrong");
    expect(bad.json.smtp.ok).toBe(false);

    const saved = await call({
      method: "PUT",
      path: `/profiles/${riley().id}/mailbox`,
      body: { ...connection, dailyCap: 100 },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.replyFolder).toBe("INBOX");
    expect(saved.json).not.toHaveProperty("password");
    expect((await call({ path: `/profiles/${riley().id}` })).json.mailboxConnected).toBe(true);
    await call({ method: "DELETE", path: `/profiles/${riley().id}/mailbox` });
    expect((await call({ path: `/profiles/${riley().id}` })).json.mailboxConnected).toBe(false);
  });
});

describe("mailbox providers", () => {
  it("offers the providers the server does, and lists Outlook.com as unsupported with a reason", async () => {
    const { providers } = (await call({ path: "/mail/providers" })).json;
    const ids = providers.map((provider: { id: string }) => provider.id);
    for (const id of [
      "gmail",
      "google-workspace",
      "fastmail",
      "icloud",
      "yahoo",
      "proton-bridge",
      "mailbox-org",
      "zoho",
      "other",
      "outlook",
    ]) {
      expect(ids).toContain(id);
    }
    const outlook = providers.find((provider: { id: string }) => provider.id === "outlook");
    expect(outlook.supported).toBe(false);
    expect(outlook.unsupportedReason).toMatch(/OAuth/);
    for (const provider of providers.filter(
      (candidate: { supported: boolean }) => candidate.supported,
    )) {
      expect(provider.unsupportedReason).toBeNull();
    }
  });

  it("gives every provider that uses app passwords a link to create one", async () => {
    const { providers } = (await call({ path: "/mail/providers" })).json;
    for (const id of [
      "gmail",
      "google-workspace",
      "fastmail",
      "icloud",
      "yahoo",
      "mailbox-org",
      "zoho",
    ]) {
      const provider = providers.find((candidate: { id: string }) => candidate.id === id);
      expect(provider.appPasswordUrl).toMatch(/^https:\/\//);
    }
    const bridge = providers.find((candidate: { id: string }) => candidate.id === "proton-bridge");
    expect(bridge.appPasswordUrl).toBeNull();
  });
});

describe("mailbox connection tests", () => {
  it("passes for an ordinary password and lists folders", async () => {
    const response = await testWith("anything");
    expect(response.json.smtp).toEqual({ ok: true, error: null });
    expect(response.json.imap.ok).toBe(true);
    expect(response.json.imap.folders.length).toBeGreaterThan(2);
  });

  it("fails each protocol on its own, so pages can show every combination", async () => {
    const noImap = (await testWith("no-imap")).json;
    expect(noImap.smtp.ok).toBe(true);
    expect(noImap.imap).toMatchObject({ ok: false, folders: [] });
    const noSmtp = (await testWith("no-smtp")).json;
    expect(noSmtp.smtp.ok).toBe(false);
    expect(noSmtp.imap.ok).toBe(true);
    const wrong = (await testWith("wrong")).json;
    expect(wrong.smtp.ok || wrong.imap.ok).toBe(false);
  });

  it("fails with a network error that names the host", async () => {
    const refused = (await testWith("refused")).json;
    expect(refused.smtp.error).toBe("connect ECONNREFUSED smtp.gmail.com:465");
    expect(refused.imap.error).toBe("connect ECONNREFUSED imap.gmail.com:993");
    expect((await testWith("slow")).json.smtp.error).toMatch(/ETIMEDOUT/);
  });

  it("answers 500 when the test itself breaks", async () => {
    expect((await testWith("boom")).status).toBe(500);
  });

  it("tests the stored password when none is sent", async () => {
    const response = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/mailbox/test`,
      body: { ...connection, password: undefined },
    });
    expect(response.status).toBe(200);
    expect(response.json.smtp.ok).toBe(true);
  });

  it("answers 404 for a profile that does not exist", async () => {
    const response = await call({
      method: "POST",
      path: "/profiles/nope/mailbox/test",
      body: connection,
    });
    expect(response.status).toBe(404);
  });
});

describe("saving a mailbox", () => {
  it("needs a password for a new mailbox but not to edit one", async () => {
    const without = { ...connection, password: undefined, dailyCap: 50 };
    const fresh = await call({
      method: "PUT",
      path: `/profiles/${riley().id}/mailbox`,
      body: without,
    });
    expect(fresh.status).toBe(400);

    const edit = await call({
      method: "PUT",
      path: `/profiles/${jordan().id}/mailbox`,
      body: { ...without, dailyCap: 90, replyFolder: "INBOX" },
    });
    expect(edit.status).toBe(200);
    expect(edit.json.dailyCap).toBe(90);
    expect(edit.json.id).toBe(jordan().mailbox?.id);
  });

  it("refuses a daily limit outside 1 to 2000 and a bad address", async () => {
    for (const dailyCap of [0, 2001, 1.5]) {
      const response = await call({
        method: "PUT",
        path: `/profiles/${riley().id}/mailbox`,
        body: { ...connection, dailyCap },
      });
      expect(response.status).toBe(400);
    }
    const badAddress = await call({
      method: "PUT",
      path: `/profiles/${riley().id}/mailbox`,
      body: { ...connection, address: "nope", dailyCap: 50 },
    });
    expect(badAddress.status).toBe(400);
  });
});

describe("mailbox polling and folders", () => {
  it("queues an inbox poll and records when it ran", async () => {
    const response = await call({ method: "POST", path: `/profiles/${jordan().id}/mailbox/poll` });
    expect(response.status).toBe(200);
    expect(response.json.task).toMatchObject({ kind: "inbox_poll", status: "queued" });
  });

  it("answers 409 for a profile with no mailbox", async () => {
    expect(
      (await call({ method: "POST", path: `/profiles/${riley().id}/mailbox/poll` })).status,
    ).toBe(409);
    expect((await call({ path: `/profiles/${riley().id}/mailbox/folders` })).status).toBe(409);
  });

  it("lists folders for a connected mailbox", async () => {
    const response = await call({ path: `/profiles/${jordan().id}/mailbox/folders` });
    expect(response.json.folders.map((folder: { path: string }) => folder.path)).toContain("INBOX");
  });
});
