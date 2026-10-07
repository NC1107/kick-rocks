import { randomBytes } from "node:crypto";
import { outgoingMessageId } from "@kickrocks/shared";
import { createTransport } from "nodemailer";
import { expect, it } from "vitest";
import { KEY_RECORD, signed, unsigned } from "../test-utils/dkim.js";
import { describeIntegration } from "../test-utils/index.js";
import { createDkimVerifier } from "./dkim.js";
import { createInboxSource } from "./inbox.js";
import { createMailTransport, InvalidOutgoingMailError, MailSendError } from "./transport.js";
import type { InboxMessage, MailConnection } from "./types.js";

const host = process.env.GREENMAIL_HOST ?? "localhost";
const smtpPort = Number(process.env.GREENMAIL_SMTP_PORT ?? 3025);
const imapPort = Number(process.env.GREENMAIL_IMAP_PORT ?? 3143);

/** A mailbox nobody else uses, so tests in this file cannot see each other's mail. */
function freshMailbox(): MailConnection {
  const address = `jordan-${randomBytes(5).toString("hex")}@example.com`;
  return {
    address,
    username: address,
    password: "app-password-for-tests",
    smtpHost: host,
    smtpPort,
    smtpSecure: false,
    imapHost: host,
    imapPort,
  };
}

async function deliverRaw(to: string, raw: string): Promise<void> {
  const transporter = createTransport({ host, port: smtpPort, secure: false, ignoreTLS: true });
  await transporter.sendMail({
    envelope: { from: "sender@broker.test", to },
    raw,
  });
  transporter.close();
}

async function deliverPlain(to: string, subject: string, extra = ""): Promise<void> {
  await deliverRaw(
    to,
    [
      "From: Privacy Team <privacy@broker.test>",
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: <${randomBytes(6).toString("hex")}@broker.test>`,
      `Date: ${new Date().toUTCString()}`,
      "Content-Type: text/plain; charset=utf-8",
      extra,
      "",
      "Your request was received.",
    ]
      .filter((line, index) => line !== "" || index > 6)
      .join("\r\n"),
  );
}

async function fetchAll(connection: MailConnection, expected: number): Promise<InboxMessage[]> {
  const inbox = createInboxSource(connection);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await inbox.fetchSince("INBOX", null, null, { since: null, limit: 100 });
    if (result.messages.length >= expected) return result.messages;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Only fewer than ${expected} messages arrived`);
}

describeIntegration("greenmail", "mail over a real SMTP and IMAP server", () => {
  it("verifies working credentials and reports an unreachable server in plain words", async () => {
    const connection = freshMailbox();
    expect(await createMailTransport(connection).verify()).toEqual({ ok: true, error: null });

    const broken = await createMailTransport({ ...connection, smtpPort: 1 }).verify();
    expect(broken.ok).toBe(false);
    expect(broken.error).toMatch(/refused the connection/);
    expect(broken.error).not.toContain(connection.password);
  });

  it("sends plain text with our Message-ID, subject, and reply headers, and the inbox reads it back", async () => {
    const recipient = freshMailbox();
    const sender = freshMailbox();
    const messageId = outgoingMessageId("req-1", "example.com", 0);
    const original = outgoingMessageId("req-1", "example.com", 0);

    const sent = await createMailTransport(sender).send({
      from: { name: "Jordan Example", address: sender.address },
      to: recipient.address,
      subject: "Opt-out request KR-7K3M9Q",
      text: "Please remove my data.\nThank you.",
      messageId,
      inReplyTo: original,
      references: [original],
    });
    expect(sent).toMatchObject({ messageId, accepted: [recipient.address], rejected: [] });

    const [message] = await fetchAll(recipient, 1);
    expect(message).toMatchObject({
      messageId,
      inReplyTo: original,
      references: [original],
      subject: "Opt-out request KR-7K3M9Q",
      from: { name: "Jordan Example", address: sender.address },
      to: [recipient.address],
      isBounce: false,
      autoSubmitted: false,
      html: null,
    });
    expect(message?.text).toContain("Please remove my data.");
    expect(message?.headers["content-type"]).toContain("text/plain");
    expect(message?.headers["x-mailer"]).toBeUndefined();
  });

  it("refuses malformed outgoing mail before it reaches the network", async () => {
    const connection = freshMailbox();
    const transport = createMailTransport(connection);
    const mail = {
      from: { name: null, address: connection.address },
      to: "privacy@broker.test",
      subject: "Request",
      text: "Body",
      messageId: "<kr.req.0@example.com>",
    };
    await expect(
      transport.send({ ...mail, subject: "Hi\r\nBcc: other@example.org" }),
    ).rejects.toThrow(InvalidOutgoingMailError);
    await expect(transport.send({ ...mail, to: "not an address" })).rejects.toThrow(
      InvalidOutgoingMailError,
    );
    await expect(transport.send({ ...mail, messageId: "kr.req.0" })).rejects.toThrow(
      InvalidOutgoingMailError,
    );
  });

  it("reports a failed send without the app password", async () => {
    const connection = { ...freshMailbox(), smtpPort: 1 };
    const error = await createMailTransport(connection)
      .send({
        from: { name: null, address: connection.address },
        to: "privacy@broker.test",
        subject: "Request",
        text: "Body",
        messageId: "<kr.req.0@example.com>",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailSendError);
    expect((error as MailSendError).message).not.toContain(connection.password);
  });

  it("lists the folders of the mailbox with INBOX first", async () => {
    const connection = freshMailbox();
    await deliverPlain(connection.address, "Hello");
    const folders = await createInboxSource(connection).listFolders();
    expect(folders[0]).toMatchObject({ path: "INBOX", specialUse: "\\Inbox" });
  });

  it("returns oldest first, honors the limit, and reports hasMore and highestUid", async () => {
    const connection = freshMailbox();
    for (const subject of ["one", "two", "three"]) await deliverPlain(connection.address, subject);
    await fetchAll(connection, 3);
    const inbox = createInboxSource(connection);

    const first = await inbox.fetchSince("INBOX", null, null, { since: null, limit: 2 });
    expect(first.messages.map((m) => m.subject)).toEqual(["one", "two"]);
    expect(first.hasMore).toBe(true);
    expect(first.reset).toBe(false);
    expect(first.highestUid).toBe(3);

    const cursor = first.messages[1]?.uid ?? 0;
    const rest = await inbox.fetchSince("INBOX", cursor, first.uidValidity, {
      since: null,
      limit: 2,
    });
    expect(rest.messages.map((m) => m.subject)).toEqual(["three"]);
    expect(rest.hasMore).toBe(false);
    expect(rest.highestUid).toBe(3);

    const nothing = await inbox.fetchSince("INBOX", 3, first.uidValidity, {
      since: null,
      limit: 2,
    });
    expect(nothing.messages).toEqual([]);
    expect(nothing.hasMore).toBe(false);
    expect(nothing.highestUid).toBe(3);
  });

  it("skips mail older than since but still reports the folder's highest UID", async () => {
    const connection = freshMailbox();
    await deliverPlain(connection.address, "today");
    await fetchAll(connection, 1);
    const inbox = createInboxSource(connection);

    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const result = await inbox.fetchSince("INBOX", null, null, { since: tomorrow, limit: 10 });
    expect(result.messages).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.highestUid).toBe(1);
  });

  it("flags a changed UIDVALIDITY as a reset and reads from the start instead of the stale cursor", async () => {
    const connection = freshMailbox();
    await deliverPlain(connection.address, "kept");
    await fetchAll(connection, 1);
    const inbox = createInboxSource(connection);
    const current = (await inbox.fetchSince("INBOX", null, null, { since: null, limit: 10 }))
      .uidValidity;

    const result = await inbox.fetchSince("INBOX", 999, current + 7, { since: null, limit: 10 });
    expect(result.reset).toBe(true);
    expect(result.uidValidity).toBe(current);
    expect(result.messages.map((m) => m.subject)).toEqual(["kept"]);
  });

  it("detects a delivery status report and an automatic reply from their headers", async () => {
    const connection = freshMailbox();
    const boundary = "dsn-boundary";
    await deliverRaw(
      connection.address,
      [
        "From: Mail Delivery Subsystem <mailer-daemon@broker.test>",
        `To: ${connection.address}`,
        "Subject: Delivery Status Notification (Failure)",
        `Message-ID: <${randomBytes(6).toString("hex")}@broker.test>`,
        `Content-Type: multipart/report; report-type=delivery-status; boundary=${boundary}`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain",
        "",
        "Your message could not be delivered.",
        `--${boundary}`,
        "Content-Type: message/delivery-status",
        "",
        "Final-Recipient: rfc822; privacy@gone.test",
        "Action: failed",
        "Status: 5.1.1",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );
    await deliverPlain(
      connection.address,
      "Automatic reply: request",
      "Auto-Submitted: auto-replied",
    );

    const messages = await fetchAll(connection, 2);
    const bounce = messages.find((m) => m.subject.startsWith("Delivery Status"));
    const auto = messages.find((m) => m.subject.startsWith("Automatic reply"));
    expect(bounce?.isBounce).toBe(true);
    expect(auto?.autoSubmitted).toBe(true);
    expect(auto?.isBounce).toBe(false);
  });

  it("keeps the HTML body so links can be read from it", async () => {
    const connection = freshMailbox();
    await deliverRaw(
      connection.address,
      [
        "From: privacy@broker.test",
        `To: ${connection.address}`,
        "Subject: Please confirm",
        `Message-ID: <${randomBytes(6).toString("hex")}@broker.test>`,
        "Content-Type: text/html; charset=utf-8",
        "",
        '<p>Click <a href="https://broker.test/confirm?t=abc">to confirm</a>.</p>',
        "",
      ].join("\r\n"),
    );
    const [message] = await fetchAll(connection, 1);
    expect(message?.html).toContain('href="https://broker.test/confirm?t=abc"');
    expect(message?.text).toContain("to confirm");
  });

  it("verifies the DKIM signature of the raw source it fetched", async () => {
    const connection = freshMailbox();
    await deliverRaw(connection.address, await signed(unsigned(), { domain: "broker.test" }));
    await deliverRaw(connection.address, unsigned().replace("acme.test", "broker.test"));
    const dkim = createDkimVerifier({
      testKeys: { "kr._domainkey.broker.test": KEY_RECORD },
    });
    const inbox = createInboxSource(connection, { dkim });
    let messages: InboxMessage[] = [];
    for (let attempt = 0; attempt < 20 && messages.length < 2; attempt += 1) {
      const result = await inbox.fetchSince("INBOX", null, null, { since: null, limit: 100 });
      messages = result.messages;
      if (messages.length < 2) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(messages.map((message) => message.dkimDomains)).toEqual([["broker.test"], []]);
  });

  it("reports a missing folder in plain words", async () => {
    const connection = freshMailbox();
    await deliverPlain(connection.address, "Hello");
    await expect(
      createInboxSource(connection).fetchSince("No such folder", null, null, {
        since: null,
        limit: 5,
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it("reports an unreachable IMAP server without the password", async () => {
    const connection = { ...freshMailbox(), imapPort: 1 };
    const error = await createInboxSource(connection)
      .listFolders()
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toMatch(/refused the connection/);
    expect((error as Error).message).not.toContain(connection.password);
  });
});
