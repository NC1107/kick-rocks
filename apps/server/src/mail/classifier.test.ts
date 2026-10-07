import { outgoingMessageId, type ProfileField, type ReplyClassification } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { noDkim, signedAs } from "../test-utils/dkim.js";
import { createReplyClassifier } from "./classifier.js";
import type { ClassifierRequest, InboxMessage } from "./types.js";

const classifier = createReplyClassifier({ settings: { get: () => null as never } });

function request(overrides: Partial<ClassifierRequest> = {}): ClassifierRequest {
  return {
    id: "req-1",
    reference: "KR-7K3M9Q",
    outgoingMessageId: outgoingMessageId("req-1", "example.com"),
    status: "awaiting_reply",
    channel: "email",
    targetId: "acme",
    targetName: "Acme Data",
    targetDomain: "acme.test",
    recordUrl: null,
    awaitingConfirmation: null,
    ...overrides,
  };
}

/** A reply the broker signed, covering the In-Reply-To, References, and Subject it carries, unless a test says otherwise. */
function message(overrides: Partial<InboxMessage> = {}): InboxMessage {
  const base: InboxMessage = {
    uid: 1,
    messageId: "<reply-1@acme.test>",
    inReplyTo: outgoingMessageId("req-1", "example.com"),
    references: [],
    from: { name: "Acme Privacy", address: "privacy@acme.test" },
    to: ["jordan@example.com"],
    subject: "Re: Opt-out request KR-7K3M9Q",
    date: new Date("2026-10-01T12:00:00Z"),
    text: "",
    html: null,
    isBounce: false,
    autoSubmitted: false,
    headers: {},
    verifyDkim: noDkim,
    ...overrides,
  };
  if (overrides.verifyDkim) return base;
  return {
    ...base,
    verifyDkim: signedAs("acme.test", {
      inReplyTo: base.inReplyTo ? [base.inReplyTo] : [],
      references: base.references,
      subject: [base.subject],
    }),
  };
}

const ORIGINAL = [
  "On Mon, Sep 28, 2026 at 9:00 AM Jordan Example <jordan@example.com> wrote:",
  "> I am requesting that you delete my data and opt me out of the sale of my personal information.",
  "> Reference: KR-7K3M9Q",
].join("\n");

async function classify(
  text: string,
  overrides: Partial<InboxMessage> = {},
  requests: ClassifierRequest[] = [request()],
) {
  return classifier.classify(message({ text, ...overrides }), { requests });
}

describe("correlation", () => {
  it("matches the Message-ID a reply answers", async () => {
    const result = await classify("Your data has been deleted.");
    expect(result).toMatchObject({ requestId: "req-1", correlation: "message_id" });
  });

  it("matches a Message-ID in References when In-Reply-To is missing, using the newest first", async () => {
    const result = await classify("Your data has been deleted.", {
      inReplyTo: null,
      references: ["<unrelated@mail.test>", outgoingMessageId("req-1", "example.com", 2)],
    });
    expect(result).toMatchObject({ requestId: "req-1", correlation: "message_id" });
  });

  it("matches the stored Message-ID of a request even when it is not in our format", async () => {
    const result = await classify(
      "Your data has been deleted.",
      { inReplyTo: "<custom-id@host.test>" },
      [request({ outgoingMessageId: "custom-id@host.test" })],
    );
    expect(result).toMatchObject({ requestId: "req-1", correlation: "message_id" });
  });

  it("finds our Message-ID inside a bounce report that does not carry it in a header", async () => {
    const result = await classify(
      `Delivery to privacy@acme.test failed.\nOriginal-Message-ID: ${outgoingMessageId("req-1", "example.com", 1)}`,
      {
        inReplyTo: null,
        isBounce: true,
        from: { name: null, address: "mailer-daemon@example.com" },
      },
    );
    expect(result).toMatchObject({
      requestId: "req-1",
      correlation: "message_id",
      classification: "bounce",
    });
  });

  it("falls back to the KR reference in the subject", async () => {
    const result = await classify("Your data has been deleted.", { inReplyTo: null });
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
  });

  it("reads a reference that was retyped with look-alike characters", async () => {
    const result = await classify("Your data has been deleted.", {
      inReplyTo: null,
      subject: "Re: request kr-7k3m9q",
    });
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
  });

  it("falls back to a reference quoted in the body", async () => {
    const result = await classify(`Your data has been deleted.\n\n${ORIGINAL}`, {
      inReplyTo: null,
      subject: "Your privacy request",
    });
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
  });

  it("does not guess when the subject names two requests", async () => {
    const result = await classify(
      "Your data has been deleted.",
      {
        inReplyTo: null,
        subject: "Re: KR-7K3M9Q and KR-2B4C6D",
        from: { name: null, address: "x@other.test" },
      },
      [request(), request({ id: "req-2", reference: "KR-2B4C6D", outgoingMessageId: null })],
    );
    expect(result.requestId).toBeNull();
  });

  it("keeps a sender-domain match for a person even when the broker signed it", async () => {
    const result = await classify("Your data has been deleted.", {
      inReplyTo: null,
      subject: "Your privacy request",
      from: { name: null, address: "ticket@help.acme.test" },
      verifyDkim: signedAs("help.acme.test", { subject: ["Your privacy request"] }),
    });
    expect(result).toMatchObject({
      requestId: "req-1",
      correlation: "sender_domain",
      classification: "completed",
    });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("keeps a sender-domain match with no authentication for a person to review", async () => {
    const result = await classify("We have completed your request.", {
      inReplyTo: null,
      messageId: "<attacker@evil.test>",
      subject: "Your privacy request",
      from: { name: null, address: "privacy@acme.test" },
      verifyDkim: noDkim,
    });
    expect(result).toMatchObject({ requestId: "req-1", correlation: "sender_domain" });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("not signed by the broker");
  });

  it.each([
    ["a signature from another domain", ["evil.test"]],
    ["a signature from a lookalike domain", ["notacme.test"]],
    ["no verified signature", []],
  ])("does not trust %s", async (_name, signers) => {
    const result = await classify("We have completed your request.", {
      verifyDkim: async () =>
        signers.map((domain) => ({
          domain,
          inReplyTo: [outgoingMessageId("req-1", "example.com")],
          references: [],
          subject: ["Re: Opt-out request KR-7K3M9Q"],
        })),
    });
    expect(result).toMatchObject({ requestId: "req-1", correlation: "message_id" });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("not signed by the broker");
  });

  it.each([
    ["the target's own domain", "acme.test"],
    ["a subdomain of it", "mail.acme.test"],
  ])("trusts a signature from %s that quotes the request", async (_name, signer) => {
    const result = await classify("We have completed your request.", {
      verifyDkim: signedAs(signer, { inReplyTo: [outgoingMessageId("req-1", "example.com")] }),
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("does not match a lookalike domain", async () => {
    const result = await classify("Your data has been deleted.", {
      inReplyTo: null,
      subject: "Your privacy request",
      from: { name: null, address: "privacy@notacme.test" },
    });
    expect(result.requestId).toBeNull();
  });

  it("leaves the request open when the sender matches several requests and none is clearly the one", async () => {
    const result = await classify(
      "Your data has been deleted.",
      { inReplyTo: null, subject: "Your privacy request" },
      [request(), request({ id: "req-2", reference: "KR-2B4C6D", outgoingMessageId: null })],
    );
    expect(result.requestId).toBeNull();
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("picks the single request still waiting for a reply among several to one sender", async () => {
    const result = await classify(
      "Your data has been deleted.",
      { inReplyTo: null, subject: "Your privacy request" },
      [
        request({ status: "confirmed" }),
        request({ id: "req-2", reference: "KR-2B4C6D", outgoingMessageId: null }),
      ],
    );
    expect(result).toMatchObject({ requestId: "req-2", correlation: "sender_domain" });
  });

  it("calls mail that matches nothing and says nothing about a request unrelated", async () => {
    const result = await classify("Our spring sale starts today.", {
      inReplyTo: null,
      subject: "Spring sale",
      from: { name: null, address: "news@shop.test" },
    });
    expect(result).toMatchObject({
      requestId: null,
      correlation: null,
      classification: "unrelated",
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps a decision that matches no request below the review threshold", async () => {
    const result = await classify("Your data has been deleted.", {
      inReplyTo: null,
      subject: "Your privacy request",
      from: { name: null, address: "privacy@somewhere-else.test" },
    });
    expect(result).toMatchObject({ requestId: null, classification: "completed" });
    expect(result.confidence).toBeLessThan(0.6);
  });
});

describe("classes", () => {
  const cases: Array<[ReplyClassification, string]> = [
    [
      "completed",
      "Hello,\n\nYour request has been processed and your personal information has been deleted from our systems.",
    ],
    [
      "completed",
      "We have removed your information from our database. No further action is needed.",
    ],
    ["completed", "You have been successfully opted out of the sale of your data."],
    ["no_record", "We could not find any record matching the information you provided."],
    ["no_record", "We do not have any personal information about you in our systems."],
    ["no_record", "No matching records were found for jordan@example.com."],
    [
      "rejected",
      "We are unable to process your request because you are not a California resident.",
    ],
    ["rejected", "Your request has been denied."],
    [
      "needs_form",
      "We do not accept requests by email. Please use our online privacy form at https://acme.test/privacy.",
    ],
    ["needs_form", "Privacy requests must be submitted through our web portal."],
    [
      "verification_required",
      "To process your request we need to verify your identity. Please send a copy of your driver's license.",
    ],
    [
      "verification_required",
      "We need additional information to locate your record. Please provide your full name and date of birth.",
    ],
    [
      "auto_ack",
      "Thank you for contacting Acme Data. We have received your request and will respond within 10 business days.",
    ],
    ["auto_ack", "Your ticket number is 48213."],
  ];

  it.each(cases)("recognizes %s", async (expected, text) => {
    const result = await classify(text);
    expect(result.classification).toBe(expected);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.requestId).toBe("req-1");
  });

  it("does not read a negated completion as a completion", async () => {
    const result = await classify(
      "Your information has not been deleted because we could not verify your identity.",
    );
    expect(result.classification).toBe("verification_required");
  });

  it("does not read a promise or a condition as a completion", async () => {
    const promise = await classify("Your data will be deleted within 30 days.");
    expect(promise.classification).not.toBe("completed");
    const condition = await classify("Once your request has been processed we will write again.");
    expect(condition.classification).not.toBe("completed");
  });

  it("ignores the request we sent when a reply quotes it", async () => {
    const result = await classify(`Thanks, a specialist will look at this.\n\n${ORIGINAL}`);
    expect(result.classification).not.toBe("completed");
    expect(result.classification).not.toBe("rejected");
    const reply = await classify(
      `We will get back to you.\n\n> Please delete my data. Your data has been deleted?\n> ${ORIGINAL}`,
    );
    expect(reply.classification).toBe("auto_ack");
  });

  it("recognizes an Outlook style quoted header block as the end of the reply", async () => {
    const result = await classify(
      [
        "Thank you for contacting us. We have received your request.",
        "",
        "From: Jordan Example <jordan@example.com>",
        "Sent: Monday, September 28, 2026 9:00 AM",
        "To: privacy@acme.test",
        "Subject: Opt-out request",
        "",
        "Please delete my data and confirm that it has been deleted.",
      ].join("\n"),
    );
    expect(result.classification).toBe("auto_ack");
  });

  it("calls an out-of-office reply an acknowledgement even when it mentions the request", async () => {
    const result = await classify(
      "I am out of the office until Monday and will process your request on my return.",
      {
        subject: "Automatic reply: Opt-out request KR-7K3M9Q",
      },
    );
    expect(result).toMatchObject({ classification: "auto_ack", requestId: "req-1" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("calls mail from a machine with no decision in it an acknowledgement", async () => {
    const result = await classify("This is your confirmation of receipt.", { autoSubmitted: true });
    expect(result).toMatchObject({ classification: "auto_ack", confidence: 0.7 });
  });

  it("lets a decision in an automated message outrank the automatic header", async () => {
    const result = await classify("Your data has been deleted.", { autoSubmitted: true });
    expect(result.classification).toBe("completed");
  });

  it("recognizes a delivery status report as a bounce with high confidence", async () => {
    const result = await classify("The address could not be found.", {
      isBounce: true,
      from: { name: null, address: "mailer-daemon@example.com" },
      subject: "Delivery Status Notification (Failure)",
    });
    expect(result).toMatchObject({ classification: "bounce", requestId: "req-1" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("recognizes a bounce that only a mailer daemon's subject gives away", async () => {
    const result = await classify("550 5.1.1 User unknown", {
      from: { name: "Mail Delivery Subsystem", address: "mailer-daemon@googlemail.com" },
      subject: "Undelivered Mail Returned to Sender",
    });
    expect(result.classification).toBe("bounce");
  });

  it("does not treat a delay notice as a failure", async () => {
    const result = await classify(
      "Delivery has been delayed. We will continue to try for 2 days.",
      {
        isBounce: true,
        from: { name: null, address: "mailer-daemon@example.com" },
        subject: "Delivery Status Notification (Delay)",
      },
    );
    expect(result.classification).toBe("auto_ack");
  });

  it("lowers the confidence when other wording points to a different answer", async () => {
    const mixed = await classify(
      "We could not find any record of you, but your other data has been deleted.",
    );
    const clean = await classify("We could not find any record of you.");
    expect(mixed.confidence).toBeLessThan(clean.confidence);
    expect(mixed.rationale).toMatch(/other wording points elsewhere/);
  });

  it("sends a matched reply with no recognizable wording to review", async () => {
    const result = await classify("Hmm, interesting. Let me think about it.");
    expect(result).toMatchObject({ classification: "unknown", requestId: "req-1" });
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("explains how the request was matched", async () => {
    expect((await classify("Your data has been deleted.")).rationale).toMatch(/Message-ID/);
    expect((await classify("Your data has been deleted.", { inReplyTo: null })).rationale).toMatch(
      /reference/,
    );
  });
});

describe("requested fields", () => {
  async function fieldsFor(text: string): Promise<ProfileField[]> {
    const result = await classify(text);
    expect(result.classification).toBe("verification_required");
    return [...result.requestedFields].sort();
  }

  it("lists the identifiers a broker asks for, by field name", async () => {
    expect(
      await fieldsFor(
        "To verify your identity please provide your full name, date of birth, and street address.",
      ),
    ).toEqual(["date_of_birth", "full_name", "street"]);
  });

  it("reads a bulleted list that follows the request", async () => {
    expect(
      await fieldsFor(
        "We need to verify your identity before we can proceed. Please provide the following:\n\n- Phone number\n- City and state\n- ZIP code\n- Year of birth",
      ),
    ).toEqual(["birth_year", "phone", "state", "city", "zip"].sort());
  });

  it("does not read the word email in a request to reply as a request for the address", async () => {
    expect(
      await fieldsFor(
        "We must verify your identity. Reply to this email with a copy of your photo ID and your phone number.",
      ),
    ).toEqual(["phone"]);
  });

  it("reads your email address as the email field", async () => {
    expect(
      await fieldsFor(
        "To verify your identity, please confirm your email address and your date of birth.",
      ),
    ).toEqual(["date_of_birth", "email"]);
  });

  it("does not list a field the broker merely mentions", async () => {
    expect(
      await fieldsFor(
        "We already have your date of birth on file.\n\nTo verify your identity please send a copy of your passport.",
      ),
    ).toEqual([]);
  });

  it("asks for the listing when the broker wants a link to the record", async () => {
    expect(
      await fieldsFor(
        "We need more information to verify your identity. Please send the URL of your listing.",
      ),
    ).toEqual(["record_url"]);
  });

  it("returns no fields for any other class", async () => {
    const result = await classify(
      "Your data has been deleted. Please provide feedback with your name.",
    );
    expect(result.requestedFields).toEqual([]);
  });
});

describe("links", () => {
  const confirmHtml = (href: string, label = "Confirm my opt-out") =>
    `<p>To complete your opt-out request, please confirm your email address.</p><p><a href="${href}">${label}</a></p>`;

  it("returns the confirmation link when it is on the target's domain", async () => {
    const result = await classify("", {
      html: confirmHtml("https://www.acme.test/optout/confirm?token=abc123"),
      text: "To complete your opt-out request, please confirm your email address.",
    });
    expect(result).toMatchObject({
      classification: "confirmation_link",
      links: ["https://www.acme.test/optout/confirm?token=abc123"],
      requestId: "req-1",
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("reads a link written out in the text of the message", async () => {
    const result = await classify(
      "Please confirm your opt-out request by visiting https://acme.test/confirm/xyz.\n\nThank you.",
    );
    expect(result).toMatchObject({
      classification: "confirmation_link",
      links: ["https://acme.test/confirm/xyz"],
    });
  });

  it("drops links on other domains and never offers them", async () => {
    const result = await classify("", {
      html:
        confirmHtml("https://tracker.mailer.test/c/abc") +
        '<a href="https://acme.test.evil.test/confirm">Confirm</a><a href="https://acme.test/optout/confirm?t=1">Confirm here</a>',
      text: "To complete your opt-out request, please confirm your email address.",
    });
    expect(result.links).toEqual(["https://acme.test/optout/confirm?t=1"]);
  });

  it("does not call a message a confirmation when none of its links is on the target's domain", async () => {
    const result = await classify("", {
      html: confirmHtml("https://tracker.mailer.test/c/abc"),
      text: "To complete your opt-out request, please confirm your email address.",
    });
    expect(result.classification).not.toBe("confirmation_link");
    expect(result.links).toEqual([]);
  });

  it("ignores links in a quoted part of the message and boilerplate links", async () => {
    const result = await classify("", {
      html: '<p>We received it.</p><blockquote><a href="https://acme.test/old/confirm">old</a></blockquote><a href="https://acme.test/privacy">Privacy Policy</a><img src="https://acme.test/logo.png"><a href="https://acme.test/logo.png">logo</a>',
      text: "We received it.",
    });
    expect(result.links).toEqual([]);
  });

  it("puts the link that looks like a confirmation first", async () => {
    const result = await classify("", {
      html:
        confirmHtml("https://acme.test/optout/confirm?t=1") +
        '<a href="https://acme.test/faq">Read our FAQ</a>',
      text: "To complete your opt-out request, please confirm your email address.",
    });
    expect(result.links[0]).toBe("https://acme.test/optout/confirm?t=1");
  });

  it("ignores javascript and mailto links", async () => {
    const result = await classify("", {
      html: '<a href="javascript:alert(1)">Confirm</a><a href="mailto:privacy@acme.test">Confirm</a>',
      text: "Please confirm your email address.",
    });
    expect(result.links).toEqual([]);
  });
});

describe("a confirmation email after a form submission", () => {
  const waiting = (overrides: Partial<ClassifierRequest> = {}) =>
    request({
      id: "form-1",
      reference: "KR-F0RM01",
      outgoingMessageId: null,
      channel: "form",
      targetDomain: "intelius.test",
      awaitingConfirmation: {
        fromDomains: ["peopleconnect.test"],
        linkTextPattern: null,
        since: "2026-10-01T10:00:00.000Z",
      },
      ...overrides,
    });

  const confirmation = (overrides: Partial<InboxMessage> = {}): Partial<InboxMessage> => ({
    inReplyTo: null,
    messageId: "<c1@peopleconnect.test>",
    subject: "Confirm your request",
    from: { name: null, address: "no-reply@peopleconnect.test" },
    html: '<p>Click the link below to confirm your opt-out.</p><a href="https://suppression.peopleconnect.test/confirm?id=9">Confirm</a>',
    text: "Click the link below to confirm your opt-out.",
    verifyDkim: signedAs("peopleconnect.test"),
    ...overrides,
  });

  it("belongs to the request waiting for a sister site, with the contract's confidence", async () => {
    const result = await classify("", confirmation(), [waiting()]);
    expect(result).toMatchObject({
      requestId: "form-1",
      correlation: "sender_domain",
      classification: "confirmation_link",
      links: ["https://suppression.peopleconnect.test/confirm?id=9"],
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("sends the confirmation itself to review when no signature of the sender verified", async () => {
    const result = await classify("", confirmation({ verifyDkim: noDkim }), [waiting()]);
    expect(result).toMatchObject({ requestId: "form-1", classification: "confirmation_link" });
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("sends completion wording from an unauthenticated sender to review, link or not", async () => {
    const result = await classify(
      "",
      confirmation({
        subject: "Your removal is complete",
        text: "Your record has been removed from our site and your data has been deleted. Click the link below to confirm your opt-out.",
        html: '<p>Your record has been removed from our site and your data has been deleted.</p><p>Click the link below to confirm your opt-out.</p><a href="https://suppression.peopleconnect.test/confirm?id=9">Confirm</a>',
        verifyDkim: noDkim,
      }),
      [waiting()],
    );
    expect(result).toMatchObject({ requestId: "form-1", classification: "completed" });
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("keeps completion wording for review when the sender's signature does not quote the request", async () => {
    const result = await classify(
      "",
      confirmation({
        subject: "Your removal is complete",
        text: "Your record has been removed from our site and your data has been deleted. Click the link below to confirm your opt-out.",
        html: '<p>Your record has been removed from our site and your data has been deleted.</p><p>Click the link below to confirm your opt-out.</p><a href="https://suppression.peopleconnect.test/confirm?id=9">Confirm</a>',
      }),
      [waiting()],
    );
    expect(result.classification).toBe("completed");
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("lets the same completion wording act once the signature quotes the request", async () => {
    const subject = "Your removal is complete KR-F0RM01";
    const result = await classify(
      "",
      confirmation({
        subject,
        text: "Your record has been removed from our site and your data has been deleted.",
        html: null,
        verifyDkim: signedAs("peopleconnect.test", { subject: [subject] }),
      }),
      [waiting()],
    );
    expect(result).toMatchObject({ classification: "completed", correlation: "reference" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("goes to the oldest waiting request for that sender", async () => {
    const older = waiting({
      id: "form-old",
      awaitingConfirmation: {
        fromDomains: ["peopleconnect.test"],
        linkTextPattern: null,
        since: "2026-09-30T08:00:00.000Z",
      },
    });
    const result = await classify("", confirmation(), [waiting(), older]);
    expect(result.requestId).toBe("form-old");
  });

  it("goes to the request for the record the message names", async () => {
    const forRecord = waiting({
      id: "form-record",
      recordUrl: "https://www.intelius.test/people/jordan-example",
      awaitingConfirmation: {
        fromDomains: ["peopleconnect.test"],
        linkTextPattern: null,
        since: "2026-10-02T10:00:00.000Z",
      },
    });
    const result = await classify(
      "",
      confirmation({
        text: "Confirm the removal of https://intelius.test/people/jordan-example by clicking the link below to confirm.",
      }),
      [waiting(), forRecord],
    );
    expect(result.requestId).toBe("form-record");
  });

  it("is followed on the sender's domain as well as the target's own", async () => {
    const result = await classify(
      "",
      confirmation({
        html: '<p>Click the link below to confirm your opt-out.</p><a href="https://www.intelius.test/confirm?id=1">Confirm</a><a href="https://unrelated.test/confirm">Confirm</a>',
      }),
      [waiting()],
    );
    expect(result.links).toEqual(["https://www.intelius.test/confirm?id=1"]);
  });

  it("uses the recipe's link text when the wording is not one the rules know", async () => {
    const result = await classify(
      "",
      confirmation({
        subject: "One more step",
        html: '<p>One more step.</p><a href="https://peopleconnect.test/x?id=2">Finish removal</a>',
        text: "One more step.",
      }),
      [
        waiting({
          awaitingConfirmation: {
            fromDomains: ["peopleconnect.test"],
            linkTextPattern: "finish removal",
            since: "2026-10-01T10:00:00.000Z",
          },
        }),
      ],
    );
    expect(result).toMatchObject({ classification: "confirmation_link", requestId: "form-1" });
  });

  it("ignores a link text pattern that is not a valid expression", async () => {
    const result = await classify(
      "",
      confirmation({
        subject: "One more step",
        html: '<p>One more step.</p><a href="https://peopleconnect.test/x?id=2">Finish</a>',
        text: "One more step.",
      }),
      [
        waiting({
          awaitingConfirmation: {
            fromDomains: ["peopleconnect.test"],
            linkTextPattern: "(unclosed",
            since: "2026-10-01T10:00:00.000Z",
          },
        }),
      ],
    );
    expect(result.classification).not.toBe("confirmation_link");
  });

  it("is not matched when the sender is not one the request expects", async () => {
    const result = await classify(
      "",
      confirmation({ from: { name: null, address: "no-reply@stranger.test" } }),
      [waiting()],
    );
    expect(result.requestId).toBeNull();
    expect(result.classification).not.toBe("confirmation_link");
  });

  it("is not matched when no request is waiting for a confirmation", async () => {
    const result = await classify("", confirmation(), [waiting({ awaitingConfirmation: null })]);
    expect(result.requestId).toBeNull();
  });

  it("falls back to the plain domain match for mail from the target that is not a confirmation", async () => {
    const result = await classify(
      "We could not find any record of you.",
      {
        inReplyTo: null,
        subject: "Your request",
        from: { name: null, address: "privacy@intelius.test" },
        verifyDkim: signedAs("intelius.test"),
      },
      [waiting()],
    );
    expect(result).toMatchObject({
      requestId: "form-1",
      correlation: "sender_domain",
      classification: "no_record",
    });
  });

  it("prefers a Message-ID or reference match over the sender rule", async () => {
    const result = await classify("", confirmation({ subject: "Re: your request KR-7K3M9Q" }), [
      waiting(),
      request(),
    ]);
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
  });
});

describe("hostile input", () => {
  it("classifies a huge message with pathological wording quickly", async () => {
    const text = `${"we have not been able to verify the ".repeat(6000)}please provide ${"your ".repeat(20000)}`;
    const started = Date.now();
    await classify(text);
    await classify("a ".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does not throw on a message with nothing in it", async () => {
    const result = await classifier.classify(
      message({ subject: "", text: "", from: { name: null, address: "" } }),
      { requests: [request()] },
    );
    expect(result.classification).toBeDefined();
  });
});
