import { describe, expect, it } from "vitest";
import { FakeClock } from "./clock.js";
import { createFakeMail } from "./fake-mail.js";

const connection = {
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: "fake",
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpSecure: false,
  imapHost: "imap.example.test",
  imapPort: 993,
};

const outgoing = {
  from: { name: "Jordan Example", address: "jordan@example.com" },
  to: "privacy@broker.test",
  subject: "Opt-out KR-AAAAAA",
  text: "Please remove me.",
  messageId: "<kr.r1.0@example.com>",
};

function setup() {
  const clock = new FakeClock();
  return { clock, fake: createFakeMail(clock) };
}

describe("fake transport", () => {
  it("records what is sent, with the connection it used", async () => {
    const { fake } = setup();
    const result = await fake.services.transport(connection).send(outgoing);
    expect(result).toEqual({
      messageId: outgoing.messageId,
      accepted: ["privacy@broker.test"],
      rejected: [],
    });
    expect(fake.sent).toEqual([{ connection, mail: outgoing }]);
  });

  it("fails once when told to, then recovers, recording nothing for the failure", async () => {
    const { fake } = setup();
    fake.failNextSend(new Error("smtp 421"));
    const transport = fake.services.transport(connection);
    await expect(transport.send(outgoing)).rejects.toThrow("smtp 421");
    expect(fake.sent).toEqual([]);
    await expect(transport.send(outgoing)).resolves.toBeDefined();
    expect(fake.sent).toHaveLength(1);
  });

  it("verifies as healthy unless told otherwise", async () => {
    const { fake } = setup();
    expect(await fake.services.transport(connection).verify()).toEqual({ ok: true, error: null });
    fake.verifyResult = { ok: false, error: "Invalid login" };
    expect(await fake.services.transport(connection).verify()).toEqual({
      ok: false,
      error: "Invalid login",
    });
  });
});

describe("fake inbox", () => {
  it("serves delivered messages with defaults filled in", async () => {
    const { fake, clock } = setup();
    const delivered = fake
      .mailbox(connection.address)
      .deliver({ subject: "Re: Opt-out KR-AAAAAA", text: "Done." });
    expect(delivered).toMatchObject({
      uid: 1,
      messageId: "<fake-INBOX-1@mail.test>",
      to: [connection.address],
      from: { address: "privacy@broker.test" },
      isBounce: false,
      autoSubmitted: false,
      date: clock.now(),
    });
    const result = await fake.services.inbox(connection).fetchSince("INBOX", null, null);
    expect(result).toEqual({ uidValidity: 1, reset: false, messages: [delivered] });
  });

  it("numbers messages per folder and returns only those after a uid", async () => {
    const { fake } = setup();
    const box = fake.mailbox(connection.address);
    const first = box.deliver();
    const second = box.deliver();
    box.deliver({ folder: "Junk" });
    const inbox = fake.services.inbox(connection);
    expect((await inbox.fetchSince("INBOX", null, 1)).messages.map((m) => m.uid)).toEqual([1, 2]);
    expect((await inbox.fetchSince("INBOX", first.uid, 1)).messages).toEqual([second]);
    expect((await inbox.fetchSince("INBOX", second.uid, 1)).messages).toEqual([]);
    expect((await inbox.fetchSince("Junk", null, 1)).messages.map((m) => m.uid)).toEqual([1]);
    expect((await inbox.fetchSince("Missing", null, 1)).messages).toEqual([]);
  });

  it("keeps mailboxes apart by address", async () => {
    const { fake } = setup();
    fake.mailbox("a@example.com").deliver();
    const other = { ...connection, address: "b@example.com" };
    expect((await fake.services.inbox(other).fetchSince("INBOX", null, null)).messages).toEqual([]);
  });

  it("reports a UIDVALIDITY change as a reset and returns everything", async () => {
    const { fake } = setup();
    const box = fake.mailbox(connection.address);
    box.deliver();
    box.deliver();
    const inbox = fake.services.inbox(connection);
    box.resetUidValidity(9);
    box.deliver();
    const result = await inbox.fetchSince("INBOX", 2, 1);
    expect(result).toMatchObject({ uidValidity: 9, reset: true });
    expect(result.messages.map((m) => m.uid)).toEqual([1]);
  });

  it("lists its folders", async () => {
    const { fake } = setup();
    const folders = await fake.services.inbox(connection).listFolders();
    expect(folders.map((f) => f.path)).toEqual(["INBOX", "Junk"]);
    fake.mailbox(connection.address).folders = [
      { path: "Replies", name: "Replies", specialUse: null },
    ];
    expect((await fake.services.inbox(connection).listFolders()).map((f) => f.path)).toEqual([
      "Replies",
    ]);
  });
});

describe("programmable classifier", () => {
  const message = (subject: string) => fakeMessage(subject);
  function fakeMessage(subject: string) {
    const { fake } = setup();
    return fake.mailbox("a@example.com").deliver({ subject });
  }

  it("answers unknown with zero confidence until programmed", async () => {
    const { fake } = setup();
    const result = await fake.classifier.classify(message("hello"), { requests: [] });
    expect(result).toMatchObject({
      requestId: null,
      classification: "unknown",
      confidence: 0,
      links: [],
    });
  });

  it("answers by subject and records every call", async () => {
    const { fake } = setup();
    fake.classifier.when("KR-AAAAAA", {
      requestId: "r1",
      classification: "completed",
      confidence: 0.95,
      correlation: "reference",
    });
    fake.classifier.when(/bounce/i, { classification: "bounce", confidence: 0.99 });
    expect(
      await fake.classifier.classify(message("Re: KR-AAAAAA"), { requests: [] }),
    ).toMatchObject({ requestId: "r1", classification: "completed", confidence: 0.95 });
    expect(
      await fake.classifier.classify(message("Undeliverable: BOUNCE"), { requests: [] }),
    ).toMatchObject({ classification: "bounce" });
    expect(await fake.classifier.classify(message("other"), { requests: [] })).toMatchObject({
      classification: "unknown",
    });
    expect(fake.classifier.calls).toHaveLength(3);
  });

  it("tries the newest handler first and lets a handler pass", async () => {
    const { fake } = setup();
    fake.classifier.program(() => ({ classification: "rejected", confidence: 1 }));
    fake.classifier.program((m) =>
      m.subject === "special" ? { classification: "needs_form", confidence: 1 } : null,
    );
    expect(
      (await fake.classifier.classify(message("special"), { requests: [] })).classification,
    ).toBe("needs_form");
    expect(
      (await fake.classifier.classify(message("plain"), { requests: [] })).classification,
    ).toBe("rejected");
  });

  it("can see the context it was given and can be reset", async () => {
    const { fake } = setup();
    fake.classifier.program((_m, context) => ({
      requestId: context.requests[0]?.id ?? null,
      confidence: 1,
      classification: "completed",
    }));
    const request = {
      id: "r9",
      reference: "KR-ZZZZZZ",
      outgoingMessageId: null,
      status: "awaiting_reply" as const,
      targetId: "t",
      targetName: "T",
      targetDomain: "t.test",
    };
    expect((await fake.classifier.classify(message("x"), { requests: [request] })).requestId).toBe(
      "r9",
    );
    fake.classifier.reset();
    expect(
      (await fake.classifier.classify(message("x"), { requests: [request] })).classification,
    ).toBe("unknown");
    expect(fake.classifier.calls).toHaveLength(1);
  });
});

describe("programmable link follower", () => {
  it("follows successfully by default and records the call", async () => {
    const { fake } = setup();
    const result = await fake.linkFollower.follow("https://broker.test/confirm?t=1", [
      "broker.test",
    ]);
    expect(result).toEqual({
      ok: true,
      finalUrl: "https://broker.test/confirm?t=1",
      status: 200,
      needsBrowser: false,
      reason: null,
    });
    expect(fake.linkFollower.calls).toEqual([
      { url: "https://broker.test/confirm?t=1", allowedDomains: ["broker.test"] },
    ]);
  });

  it("answers as programmed, newest first, and can be reset", async () => {
    const { fake } = setup();
    fake.linkFollower.program((url) =>
      url.includes("js") ? { ok: false, needsBrowser: true, reason: "needs a button press" } : null,
    );
    fake.linkFollower.program((url) =>
      url.includes("blocked") ? { ok: false, status: 403, reason: "domain not allowed" } : null,
    );
    expect(await fake.linkFollower.follow("https://x.test/js", [])).toMatchObject({
      ok: false,
      needsBrowser: true,
    });
    expect(await fake.linkFollower.follow("https://x.test/blocked", [])).toMatchObject({
      ok: false,
      status: 403,
    });
    expect((await fake.linkFollower.follow("https://x.test/fine", [])).ok).toBe(true);
    fake.linkFollower.reset();
    expect((await fake.linkFollower.follow("https://x.test/js", [])).ok).toBe(true);
  });
});
