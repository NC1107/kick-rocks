import { describe, expect, it } from "vitest";
import { parseInboxMessage } from "./parse.js";

const parse = (lines: string[], internalDate?: Date) =>
  parseInboxMessage({ uid: 7, source: Buffer.from(lines.join("\r\n")), internalDate });

describe("parseInboxMessage", () => {
  it("keeps every Authentication-Results header in the order the message lists them", async () => {
    const message = await parse([
      "Authentication-Results: mx.google.com; dkim=pass header.d=real.test",
      "Received: from relay.evil.test by mx.google.com",
      "Authentication-Results: mx.google.com;",
      "  dkim=pass header.d=forged.test",
      "From: privacy@acme.test",
      "Subject: Hi",
      "",
      "Body",
    ]);
    expect(message.authenticationResults).toEqual([
      "mx.google.com; dkim=pass header.d=real.test",
      "mx.google.com; dkim=pass header.d=forged.test",
    ]);
  });

  it("maps the headers and body of a plain message", async () => {
    const message = await parse([
      "From: Acme Privacy <Privacy@Acme.test>",
      "To: Jordan Example <jordan@example.com>, other@example.com",
      "Subject: =?UTF-8?Q?Re=3A_Opt-out_request_KR-7K3M9Q?=",
      "Message-ID: <reply-1@acme.test>",
      "In-Reply-To: <kr.req-1.0@example.com>",
      "References: <kr.req-1.0@example.com> <other@acme.test>",
      "Date: Thu, 01 Oct 2026 12:00:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your data has been deleted.",
    ]);
    expect(message).toMatchObject({
      uid: 7,
      messageId: "<reply-1@acme.test>",
      inReplyTo: "<kr.req-1.0@example.com>",
      references: ["<kr.req-1.0@example.com>", "<other@acme.test>"],
      from: { name: "Acme Privacy", address: "privacy@acme.test" },
      to: ["jordan@example.com", "other@example.com"],
      subject: "Re: Opt-out request KR-7K3M9Q",
      html: null,
      isBounce: false,
      autoSubmitted: false,
    });
    expect(message.date?.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(message.text).toContain("Your data has been deleted.");
    expect(message.headers["message-id"]).toBe("<reply-1@acme.test>");
  });

  it("derives text from an HTML-only message and keeps the HTML", async () => {
    const message = await parse([
      "From: privacy@acme.test",
      "Subject: Confirm",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Please <a href="https://acme.test/confirm?t=1">confirm</a>.</p>',
    ]);
    expect(message.html).toContain("https://acme.test/confirm?t=1");
    expect(message.text).toContain("confirm");
  });

  it("joins repeated and folded headers", async () => {
    const message = await parse([
      "From: privacy@acme.test",
      "Received: from a.test",
      "Received: from b.test",
      "X-Long: first",
      "  second",
      "",
      "Body",
    ]);
    expect(message.headers.received).toBe("from a.test, from b.test");
    expect(message.headers["x-long"]).toBe("first second");
  });

  it("uses the server's arrival time when the Date header is missing or garbage", async () => {
    const arrival = new Date("2026-09-30T08:00:00Z");
    expect((await parse(["From: a@acme.test", "", "Body"], arrival)).date).toEqual(arrival);
    expect(
      (await parse(["From: a@acme.test", "Date: not a date", "", "Body"], arrival)).date,
    ).toEqual(arrival);
    expect((await parse(["From: a@acme.test", "", "Body"])).date).toBeNull();
  });

  describe("bounces", () => {
    it("recognizes a delivery status report", async () => {
      const message = await parse([
        "From: Mail Delivery Subsystem <mailer-daemon@example.com>",
        "Subject: Delivery Status Notification (Failure)",
        "Content-Type: multipart/report; report-type=delivery-status; boundary=b",
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Could not deliver.",
        "--b",
        "Content-Type: message/delivery-status",
        "",
        "Action: failed",
        "--b--",
      ]);
      expect(message.isBounce).toBe(true);
    });

    it.each(["mailer-daemon@example.com", "MAILER-DAEMON@example.com", "postmaster@example.com"])(
      "recognizes mail from %s",
      async (sender) => {
        expect((await parse([`From: ${sender}`, "Subject: Returned", "", "Body"])).isBounce).toBe(
          true,
        );
      },
    );

    it("recognizes the Gmail header for a failed recipient", async () => {
      const message = await parse([
        "From: someone@example.com",
        "X-Failed-Recipients: gone@acme.test",
        "",
        "Body",
      ]);
      expect(message.isBounce).toBe(true);
    });

    it("does not call ordinary mail a bounce", async () => {
      expect((await parse(["From: privacy@acme.test", "", "Body"])).isBounce).toBe(false);
    });
  });

  describe("auto-submitted", () => {
    it.each(["auto-replied", "auto-generated", "auto-notified"])("is set for %s", async (value) => {
      expect(
        (await parse(["From: a@acme.test", `Auto-Submitted: ${value}`, "", "Body"])).autoSubmitted,
      ).toBe(true);
    });

    it("is not set for no", async () => {
      expect(
        (await parse(["From: a@acme.test", "Auto-Submitted: no", "", "Body"])).autoSubmitted,
      ).toBe(false);
    });
  });

  it("returns what it can for a message that is not valid mail", async () => {
    const message = await parseInboxMessage({ uid: 3, source: Buffer.alloc(0) });
    expect(message).toMatchObject({ uid: 3, subject: "", text: "", references: [] });
  });

  it("bounds the text of a huge message", async () => {
    const message = await parse(["From: a@acme.test", "Subject: Big", "", "a".repeat(500_000)]);
    expect(message.text.length).toBeLessThanOrEqual(200_000);
  });
});
