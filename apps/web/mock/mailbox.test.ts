import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

describe("mailbox handlers", () => {
  it("connects, tests, and removes a mailbox", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
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
    const ok = await call({
      method: "POST",
      path: `/profiles/${riley.id}/mailbox/test`,
      body: connection,
    });
    expect(ok.json.smtp.ok).toBe(true);
    const bad = await call({
      method: "POST",
      path: `/profiles/${riley.id}/mailbox/test`,
      body: { ...connection, password: "wrong" },
    });
    expect(bad.json.smtp.ok).toBe(false);

    const saved = await call({
      method: "PUT",
      path: `/profiles/${riley.id}/mailbox`,
      body: { ...connection, dailyCap: 100 },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.replyFolder).toBe("INBOX");
    expect(saved.json).not.toHaveProperty("password");
    expect((await call({ path: `/profiles/${riley.id}` })).json.mailboxConnected).toBe(true);
    await call({ method: "DELETE", path: `/profiles/${riley.id}/mailbox` });
    expect((await call({ path: `/profiles/${riley.id}` })).json.mailboxConnected).toBe(false);
  });
});
