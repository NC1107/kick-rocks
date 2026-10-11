import { outgoingMessageId } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { noDkim } from "../test-utils/dkim.js";
import {
  bodySearchTerms,
  couldBeAReply,
  type HeaderVerdict,
  type IntakeContext,
  type IntakeInput,
  intakeContext,
  type PersonSender,
  readPlanFor,
  triageBody,
  triageHeaders,
  unreadRule,
} from "./intake.js";
import type { ClassifierRequest, InboxMessage, MessageHeaders } from "./types.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const OUR_ID = outgoingMessageId("req-spokeo", "example.com");

function request(overrides: Partial<ClassifierRequest> = {}): ClassifierRequest {
  return {
    id: "req-spokeo",
    open: true,
    targetKind: "broker",
    contactAddress: "privacy@spokeo.com",
    sentAt: "2026-10-05T12:00:00.000Z",
    reference: "KR-7K3M9Q",
    outgoingMessageId: OUR_ID,
    status: "awaiting_reply",
    channel: "email",
    targetId: "spokeo",
    targetName: "Spokeo",
    targetDomain: "spokeo.com",
    replyDomains: ["spokeo.com"],
    curatedReplyDomains: [],
    replyAddresses: [],
    recordUrl: null,
    awaitingConfirmation: null,
    ...overrides,
  };
}

const AMAZON = request({
  id: "req-amazon",
  reference: "KR-4H7TQ2",
  outgoingMessageId: outgoingMessageId("req-amazon", "example.com"),
  targetKind: "company",
  targetId: "amazon",
  targetName: "Amazon",
  targetDomain: "amazon.com",
  replyDomains: ["amazon.com"],
  contactAddress: "privacy@amazon.com",
});

function context(
  requests: ClassifierRequest[] = [request(), AMAZON],
  extra: Partial<IntakeInput> = {},
): IntakeContext {
  return intakeContext({
    requests,
    verifiedAlias: null,
    companyMail: "privacy_only",
    personSenders: [],
    now: NOW,
    ...extra,
  });
}

function headers(overrides: Partial<MessageHeaders> & { extra?: Record<string, string> } = {}) {
  const { extra, ...rest } = overrides;
  return {
    uid: 1,
    messageId: "<m1@elsewhere.test>",
    inReplyTo: null,
    references: [],
    from: { name: null, address: "someone@elsewhere.test" },
    recipients: ["jordan@example.com"],
    subject: "Hello",
    date: NOW,
    isDeliveryReport: false,
    headers: { ...extra },
    ...rest,
  } satisfies MessageHeaders;
}

function fromSender(address: string, rest: Parameters<typeof headers>[0] = {}) {
  return headers({ from: { name: null, address }, ...rest });
}

function full(message: Partial<InboxMessage> = {}): InboxMessage {
  return {
    uid: 1,
    messageId: "<m1@elsewhere.test>",
    inReplyTo: null,
    references: [],
    from: { name: null, address: "someone@elsewhere.test" },
    to: ["jordan@example.com"],
    subject: "Hello",
    date: NOW,
    text: "",
    html: null,
    isBounce: false,
    autoSubmitted: false,
    headers: {},
    originalMessageIds: [],
    verifyDkim: noDkim,
    ...message,
  };
}

const verdictOf = (h: MessageHeaders, ctx = context()) => triageHeaders(h, ctx);
const admitted = (by: string): HeaderVerdict => ({ verdict: "admit", by }) as HeaderVerdict;
const needs = (...reasons: string[]): HeaderVerdict =>
  ({ verdict: "needs_body", reasons }) as HeaderVerdict;
const IGNORE: HeaderVerdict = { verdict: "ignore" };

const BULK = { "list-unsubscribe": "<mailto:unsub@x.test>" };

describe("R0 and R1: threads", () => {
  it.each<[string, MessageHeaders, HeaderVerdict]>([
    ["mail we sent ourselves", headers({ messageId: OUR_ID }), IGNORE],
    ["a reply to our Message-ID", headers({ inReplyTo: OUR_ID }), admitted("thread")],
    [
      "a reply whose References hold our id",
      headers({ references: ["<x@y.test>", OUR_ID] }),
      admitted("thread"),
    ],
    [
      "a reply to the stored id of a request",
      headers({ inReplyTo: "<custom@host.test>" }),
      admitted("thread"),
    ],
    [
      "a reply to someone else's mail",
      headers({ inReplyTo: "<other@elsewhere.test>" }),
      needs("unknown"),
    ],
    [
      "a reply to an id made for a request we do not have",
      headers({ inReplyTo: outgoingMessageId("someone-else", "example.com") }),
      needs("unknown"),
    ],
  ])("%s", (name, h, expected) => {
    const ctx = context([
      request({ outgoingMessageId: name.includes("stored") ? "<custom@host.test>" : OUR_ID }),
      AMAZON,
    ]);
    expect(verdictOf(h, ctx)).toEqual(expected);
  });
});

describe("R2: our reference in the subject", () => {
  it.each<[string, string, HeaderVerdict]>([
    ["the reference", "Re: Opt-out request KR-7K3M9Q", admitted("reference")],
    ["a reference spelled with look-alike letters", "Re: kr-7k3m9q", admitted("reference")],
    ["a reference with O, I and L for 0 and 1", "Re: KR-A0lB1C", admitted("reference")],
    ["a KR code that is not ours", "Re: KR-ZZZZZZ", needs("unknown")],
  ])("%s", (_name, subject, expected) => {
    const ctx = context([request(), request({ id: "req-b", reference: "KR-A01B1C" })]);
    expect(verdictOf(headers({ subject }), ctx)).toEqual(expected);
  });

  it("binds to a request that is already closed", () => {
    const ctx = context([request({ open: false, status: "confirmed" })]);
    expect(verdictOf(headers({ subject: "Re: KR-7K3M9Q" }), ctx)).toEqual(admitted("reference"));
  });
});

describe("R3: delivery reports", () => {
  const report = fromSender("mailer-daemon@mail.example.com", { isDeliveryReport: true });

  it("is read before it is decided", () => {
    expect(verdictOf(report)).toEqual(needs("delivery_report"));
  });

  it("admits a report whose original is only in the attached part", () => {
    const message = full({
      isBounce: true,
      from: report.from,
      originalMessageIds: [OUR_ID],
    });
    expect(triageBody(message, context())).toEqual({ verdict: "admit", by: "bounce" });
  });

  it("ignores a stray bounce that is about nothing of ours", () => {
    const message = full({
      isBounce: true,
      from: report.from,
      text: "Delivery to nobody@elsewhere.test failed",
      originalMessageIds: ["<unrelated@elsewhere.test>"],
    });
    expect(triageBody(message, context())).toEqual({ verdict: "ignore", rule: "bounce_not_ours" });
  });

  it("admits a report whose failed recipient is the contact of a recent email request", () => {
    const message = full({
      isBounce: true,
      from: report.from,
      text: "Final-Recipient: rfc822; privacy@spokeo.com\nAction: failed",
    });
    expect(triageBody(message, context())).toEqual({ verdict: "admit", by: "bounce" });
  });

  it("does not admit a failed recipient from a request sent long ago", () => {
    const message = full({
      isBounce: true,
      from: report.from,
      text: "Final-Recipient: rfc822; privacy@spokeo.com",
    });
    const old = context([request({ sentAt: "2026-08-01T00:00:00.000Z" })]);
    expect(triageBody(message, old)).toEqual({ verdict: "ignore", rule: "bounce_not_ours" });
  });
});

describe("R4: a confirmation a form is waiting for", () => {
  const waiting = request({
    id: "req-intelius",
    reference: "KR-3T9ZH7",
    outgoingMessageId: null,
    targetId: "intelius",
    targetName: "Intelius",
    targetDomain: "intelius.com",
    replyDomains: ["intelius.com"],
    channel: "form",
    awaitingConfirmation: {
      fromDomains: ["intelius.com"],
      linkTextPattern: null,
      since: "2026-10-07T10:00:00.000Z",
    },
  });
  const ctx = context([waiting]);
  const confirmation = fromSender("noreply@intelius.com", { extra: BULK });

  it("reads mail from the expected domain even when it carries bulk headers", () => {
    expect(verdictOf(confirmation, ctx)).toEqual(needs("awaiting"));
  });

  it("admits it when it asks to confirm and links to the broker", () => {
    const message = full({
      from: confirmation.from,
      headers: BULK,
      text: "Please confirm your opt-out request: https://intelius.com/optout/confirm?t=abc",
    });
    expect(triageBody(message, ctx)).toEqual({ verdict: "admit", by: "awaiting_confirmation" });
  });

  it("falls through to the sender rules when it is not a confirmation", () => {
    const message = full({
      from: confirmation.from,
      headers: BULK,
      text: "Save 20% on background reports this week.",
    });
    expect(triageBody(message, ctx)).toEqual({ verdict: "ignore", rule: "bulk_no_privacy" });
  });
});

describe("R5: the reply alias", () => {
  const ctx = context([request(), AMAZON], { verifiedAlias: "jordan+kickrocks@example.com" });

  it.each<[string, MessageHeaders, HeaderVerdict]>([
    [
      "to the alias",
      headers({ recipients: ["jordan+kickrocks@example.com"], subject: "Your Spokeo request" }),
      admitted("alias"),
    ],
    [
      "in Delivered-To or Cc",
      headers({
        recipients: ["jordan@example.com", "jordan+kickrocks@example.com"],
        subject: "Your Spokeo request",
      }),
      admitted("alias"),
    ],
    [
      "to the alias but bulk",
      headers({
        recipients: ["jordan+kickrocks@example.com"],
        subject: "Your Spokeo request",
        extra: BULK,
      }),
      needs("alias_bulk"),
    ],
    [
      "to the alias, naming no request in the headers",
      headers({ recipients: ["jordan+kickrocks@example.com"] }),
      needs("alias_unnamed"),
    ],
    ["to the plain address", headers(), needs("unknown")],
  ])("%s", (_name, h, expected) => {
    expect(verdictOf(h, ctx)).toEqual(expected);
  });

  it("ignores alias mail that is bulk and has no request wording", () => {
    const message = full({
      recipients: undefined,
      to: ["jordan+kickrocks@example.com"],
      subject: "Spokeo weekly",
      headers: BULK,
      text: "Big sale on shoes",
    } as Partial<InboxMessage>);
    expect(triageBody(message, ctx)).toEqual({ verdict: "ignore", rule: "bulk_no_privacy" });
  });

  it("admits alias mail that is bulk but is about an opt-out request", () => {
    const message = full({
      to: ["jordan+kickrocks@example.com"],
      subject: "Spokeo weekly",
      headers: BULK,
      text: "Your opt-out request has been processed.",
    });
    expect(triageBody(message, ctx)).toEqual({ verdict: "admit", by: "alias" });
  });

  it("does not use an alias that was never verified", () => {
    const unverified = context([request()], { verifiedAlias: null });
    expect(
      verdictOf(headers({ recipients: ["jordan+kickrocks@example.com"] }), unverified),
    ).toEqual(needs("unknown"));
  });
});

describe("R6 and R7: a broker the person has a request with", () => {
  it("admits plain mail from the broker", () => {
    expect(verdictOf(fromSender("support@spokeo.com"))).toEqual(admitted("target_sender"));
  });

  it("admits mail from a sister domain the target lists", () => {
    const ctx = context([request({ replyDomains: ["spokeo.com", "spokeo-support.com"] })]);
    expect(verdictOf(fromSender("help@spokeo-support.com"), ctx)).toEqual(
      admitted("target_sender"),
    );
  });

  it("reads broker bulk mail before deciding", () => {
    expect(verdictOf(fromSender("deals@spokeo.com", { extra: BULK }))).toEqual(
      needs("bulk_target"),
    );
  });

  it("treats a marketing subdomain of the broker as bulk", () => {
    expect(verdictOf(fromSender("hello@email.spokeo.com"))).toEqual(needs("bulk_target"));
  });

  it("ignores broker bulk unless it is about the request", () => {
    const bulk = { from: { name: null, address: "deals@spokeo.com" }, headers: BULK };
    expect(triageBody(full({ ...bulk, text: "Search anyone, 50% off" }), context())).toEqual({
      verdict: "ignore",
      rule: "bulk_no_privacy",
    });
    expect(
      triageBody(full({ ...bulk, text: "Your opt-out request was received." }), context()),
    ).toEqual({ verdict: "admit", by: "target_sender" });
  });

  it("ignores the same broker when its only request is already confirmed", () => {
    const ctx = context([request({ open: false, status: "confirmed" })]);
    expect(verdictOf(fromSender("support@spokeo.com"), ctx)).toEqual(needs("unknown"));
    expect(
      readPlanFor(fromSender("support@spokeo.com"), needs("unknown") as never, ctx),
    ).toMatchObject({
      read: "if_found",
    });
  });

  it("does not count Auto-Submitted against a message", () => {
    expect(
      verdictOf(fromSender("support@spokeo.com", { extra: { "auto-submitted": "auto-replied" } })),
    ).toEqual(admitted("target_sender"));
  });

  it("counts a ticket desk host named for the target as the target", () => {
    expect(verdictOf(fromSender("support@spokeo.zendesk.com"))).toEqual(admitted("target_sender"));
    expect(verdictOf(fromSender("support@otherco.zendesk.com"))).toEqual(needs("unknown"));
  });
});

describe("R8: a company the person has a request with", () => {
  const orderMail = fromSender("orders@amazon.com", { subject: "Your order has shipped" });

  it("reads order mail before deciding", () => {
    expect(verdictOf(orderMail)).toEqual(needs("company"));
  });

  it("ignores order and account mail, even a link to confirm a new address", () => {
    const message = full({
      from: orderMail.from,
      subject: "Confirm your new email address",
      text: "Please confirm your email address. Verify your identity to continue.",
    });
    expect(triageBody(message, context())).toEqual({
      verdict: "ignore",
      rule: "company_not_privacy",
    });
  });

  it("admits mail with privacy wording", () => {
    const message = full({
      from: orderMail.from,
      subject: "About your data",
      text: "We have started to delete your personal data as you asked.",
    });
    expect(triageBody(message, context())).toEqual({ verdict: "admit", by: "target_sender" });
  });

  it("admits mail from the exact privacy contact without reading it", () => {
    expect(verdictOf(fromSender("privacy@amazon.com"))).toEqual(admitted("target_sender"));
  });

  it("admits mail from a privacy-style mailbox", () => {
    expect(verdictOf(fromSender("dsar@amazon.com"))).toEqual(admitted("target_sender"));
    expect(verdictOf(fromSender("privacy-team@amazon.com"))).toEqual(admitted("target_sender"));
  });

  it("admits everything but bulk when the person chose all company mail", () => {
    const ctx = context([request(), AMAZON], { companyMail: "all" });
    expect(verdictOf(orderMail, ctx)).toEqual(admitted("target_sender"));
    expect(verdictOf(fromSender("deals@amazon.com", { extra: BULK }), ctx)).toEqual(
      needs("bulk_target"),
    );
  });

  it("never counts a public mail host as a company sender, except an exact reply address", () => {
    const gmail = request({
      id: "req-gmail",
      targetKind: "company",
      targetId: "someco",
      targetName: "Someco",
      targetDomain: "someco.com",
      replyDomains: ["gmail.com", "someco.com"],
      replyAddresses: ["someco.privacy@gmail.com"],
      contactAddress: "someco.privacy@gmail.com",
    });
    const ctx = context([gmail]);
    expect(verdictOf(fromSender("random.person@gmail.com"), ctx)).toEqual(needs("unknown"));
    expect(verdictOf(fromSender("someco.privacy@gmail.com"), ctx)).toEqual(
      admitted("target_sender"),
    );
  });
});

describe("R9: a stranger", () => {
  const stranger = { from: { name: null, address: "friend@elsewhere.test" } };

  it("waits for the server's search before reading anything", () => {
    const h = fromSender("friend@elsewhere.test");
    expect(readPlanFor(h, needs("unknown") as never, context())).toEqual({
      read: "if_found",
      scope: "named",
      terms: bodySearchTerms(context()),
    });
  });

  it("reads at once when the subject names an open target", () => {
    const h = fromSender("friend@elsewhere.test", { subject: "About Spokeo" });
    expect(readPlanFor(h, needs("unknown") as never, context())).toEqual({ read: "now" });
  });

  it("admits mail that names an open target with privacy wording", () => {
    const message = full({
      ...stranger,
      text: "I contacted Spokeo and asked them to remove my information from their listing.",
    });
    expect(triageBody(message, context())).toEqual({ verdict: "admit", by: "named_target" });
  });

  it("ignores mail that names the target without that wording", () => {
    const message = full({ ...stranger, text: "Remember to buy Spokeo gift cards for the party." });
    expect(triageBody(message, context())).toEqual({ verdict: "ignore", rule: "not_named" });
  });

  it("ignores mail that names a target with no open request", () => {
    const message = full({
      ...stranger,
      text: "Whitepages should delete my personal information.",
    });
    expect(triageBody(message, context())).toEqual({ verdict: "ignore", rule: "not_named" });
  });

  it("admits a body that carries our reference even when it is bulk", () => {
    const message = full({
      ...stranger,
      headers: BULK,
      text: "Receipt for case KR-7K3M9Q",
    });
    expect(triageBody(message, context())).toEqual({ verdict: "admit", by: "reference" });
  });

  it("ignores bulk mail from a stranger that holds no reference", () => {
    expect(verdictOf(fromSender("news@elsewhere.test", { extra: BULK }))).toEqual(
      needs("bulk_other"),
    );
    expect(
      triageBody(full({ ...stranger, headers: BULK, text: "KR-ZZZZZZ is not ours" }), context()),
    ).toEqual({ verdict: "ignore", rule: "stranger_bulk" });
  });
});

describe("senders the person asked to take in", () => {
  const people: PersonSender[] = [
    { targetId: "spokeo", kind: "domain", value: "reports.example.org" },
    { targetId: "amazon", kind: "address", value: "help@partner.test" },
  ];
  const ctx = context([request(), AMAZON], { personSenders: people });

  it("admits a listed domain and a listed address", () => {
    expect(verdictOf(fromSender("a@reports.example.org", { extra: BULK }), ctx)).toEqual(
      admitted("target_sender"),
    );
    expect(verdictOf(fromSender("help@partner.test"), ctx)).toEqual(admitted("target_sender"));
  });

  it("does not admit another address on the same host", () => {
    expect(verdictOf(fromSender("other@partner.test"), ctx)).toEqual(needs("unknown"));
  });
});

describe("bodySearchTerms", () => {
  it("holds the reference of every request in the window and each open target's name and domain once", () => {
    const terms = bodySearchTerms(context());
    expect(terms).toEqual(expect.arrayContaining(["Spokeo", "spokeo.com", "Amazon", "amazon.com"]));
    expect(terms.filter((term) => /^KR-[A-Z0-9]{6}$/.test(term))).toHaveLength(2);
    expect(terms).not.toContain("KR-");
  });

  it("keeps the reference of a closed request, whose late reply still binds", () => {
    expect(bodySearchTerms(context([request({ open: false })]))).toEqual([request().reference]);
  });
});

describe("what a server that matches whole words needs to be asked", () => {
  const terms = (plan: ReturnType<typeof readPlanFor>) =>
    plan.read === "if_found" ? plan.terms : [];
  const company = (subject: string) =>
    readPlanFor(fromSender("help@amazon.com", { subject }), needs("company") as never, context());

  it("spells out each form of the verbs the wording rules take a stem of", () => {
    expect(terms(company("Update"))).toEqual(
      expect.arrayContaining([
        "removed",
        "deleted",
        "erased",
        "suppressed",
        "records",
        "removing",
        "deletes",
      ]),
    );
  });

  it("holds no fragment that only a substring search would find", () => {
    for (const term of terms(company("Update"))) expect(term).not.toMatch(/^(remov|delet|KR-)$/);
  });

  it("judges a broker's bulk mail on privacy wording, and a company's on the narrower request wording", () => {
    const bulk = { extra: BULK };
    const broker = readPlanFor(
      fromSender("updates@spokeo.com", { subject: "Update", ...bulk }),
      needs("bulk_target") as never,
      context(),
    );
    const other = readPlanFor(
      fromSender("updates@amazon.com", { subject: "Update", ...bulk }),
      needs("bulk_target") as never,
      context(),
    );
    expect(broker).toMatchObject({ read: "if_found", scope: "privacy" });
    expect(terms(broker)).toContain("records");
    expect(other).toMatchObject({ read: "if_found", scope: "request" });
    expect(terms(other)).not.toContain("records");
  });

  it("admits a broker's bulk answer that says nothing was found or the listing was removed", () => {
    const bulk = { from: { name: null, address: "updates@spokeo.com" }, headers: BULK };
    for (const text of [
      "We found no records matching your information.",
      "Your listing has been removed.",
      "Your profile was suppressed.",
    ]) {
      expect(triageBody(full({ ...bulk, text }), context())).toEqual({
        verdict: "admit",
        by: "target_sender",
      });
    }
  });

  it("still ignores a company's bulk mail unless it is about the request", () => {
    const bulk = { from: { name: null, address: "deals@amazon.com" }, headers: BULK };
    expect(
      triageBody(full({ ...bulk, text: "Your listing has been removed." }), context()),
    ).toEqual({
      verdict: "ignore",
      rule: "bulk_no_privacy",
    });
  });
});

describe("why a message was passed over, and whether it could have been a reply", () => {
  const closed = context([request({ open: false, status: "confirmed" }), AMAZON]);

  it("blames a finished request, not a stranger, when its sender was passed over", () => {
    const h = fromSender("support@spokeo.com");
    expect(unreadRule(h, "unknown", closed)).toBe("finished_request");
    expect(unreadRule(h, "bulk_other", closed)).toBe("finished_request");
    expect(triageBody(full({ from: h.from, text: "Hello again" }), closed)).toEqual({
      verdict: "ignore",
      rule: "finished_request",
    });
  });

  it("names the rule for mail a server search found nothing in", () => {
    const h = fromSender("news@elsewhere.test");
    expect(unreadRule(h, "unknown", context())).toBe("not_named");
    expect(unreadRule(h, "bulk_other", context())).toBe("stranger_bulk");
    expect(unreadRule(h, "company", context())).toBe("company_not_privacy");
    expect(unreadRule(h, "bulk_target", context())).toBe("bulk_no_privacy");
    expect(unreadRule(h, "alias_bulk", context())).toBe("bulk_no_privacy");
  });

  it("gives no rule for mail we sent ourselves", () => {
    const own = full({ messageId: OUR_ID, subject: "Data deletion request" });
    expect(triageBody(own, context())).toEqual({ verdict: "ignore", rule: null });
  });

  it("counts mail from a sender of any request, a named company or privacy wording", () => {
    expect(couldBeAReply(fromSender("deals@spokeo.com"), null, closed)).toBe(true);
    expect(couldBeAReply(headers({ subject: "Your Amazon order" }), null, context())).toBe(true);
    expect(couldBeAReply(headers({ subject: "Please delete your data" }), null, context())).toBe(
      true,
    );
    expect(
      couldBeAReply(headers(), full({ text: "We removed your listing as asked." }), context()),
    ).toBe(true);
  });

  it("does not count mail that ties to nothing", () => {
    expect(couldBeAReply(headers({ subject: "Lunch on friday?" }), null, context())).toBe(false);
    expect(
      couldBeAReply(headers(), full({ text: "Weekly digest of cat pictures" }), context()),
    ).toBe(false);
  });
});

describe("the name gate", () => {
  const alias = "jordan+kickrocks@example.com";
  const gated = context([request(), AMAZON], { verifiedAlias: alias });
  const INTELIUS = request({
    id: "req-intelius",
    reference: "KR-3T9ZH7",
    outgoingMessageId: outgoingMessageId("req-intelius", "example.com"),
    targetId: "intelius",
    targetName: "Intelius",
    targetDomain: "intelius.com",
    replyDomains: ["intelius.com"],
    curatedReplyDomains: ["peopleconnect.us"],
    brands: ["peopleconnect.us"],
  });
  const vendor = { from: { name: "Privacy Operations", address: "team@privacyops.example" } };
  const done = "Your privacy request has been completed and your information has been removed.";

  it("keeps a reply that names the company only in its signature", () => {
    const message = full({ ...vendor, to: [alias], text: `${done}\n\n--\nSpokeo Privacy Team` });
    expect(triageBody(message, gated)).toEqual({ verdict: "admit", by: "alias" });
  });

  it("keeps a reply from a parent brand, as PeopleConnect writes for Intelius", () => {
    const message = full({ ...vendor, to: [alias], text: `${done}\n\nPeopleConnect Privacy` });
    const ctx = context([INTELIUS], { verifiedAlias: alias });
    expect(triageBody(message, ctx)).toEqual({ verdict: "admit", by: "alias" });
  });

  it("keeps a reply that names a curated alias of the target", () => {
    const truepeoplesearch = request({
      targetId: "truepeoplesearch",
      targetName: "TruePeopleSearch.com",
      targetDomain: "truepeoplesearch.com",
      replyDomains: ["truepeoplesearch.com"],
      brands: ["Free Data Services"],
    });
    const message = full({ ...vendor, to: [alias], text: `${done}\n\nFree Data Services, LLC` });
    expect(triageBody(message, context([truepeoplesearch], { verifiedAlias: alias }))).toEqual({
      verdict: "admit",
      by: "alias",
    });
  });

  it("keeps a reply whose sender name, not its text, names the company", () => {
    const h = headers({
      recipients: [alias],
      from: { name: "Spokeo Privacy", address: "team@privacyops.example" },
    });
    expect(verdictOf(h, gated)).toEqual(admitted("alias"));
  });

  it("does not take in a newsletter from the target's domain that names no request", () => {
    const newsletter = full({
      from: { name: "Spokeo", address: "news@mail.spokeo.com" },
      to: [alias],
      headers: BULK,
      text: "Ten places to find old friends this summer.",
    });
    expect(triageBody(newsletter, gated)).toEqual({ verdict: "ignore", rule: "bulk_no_privacy" });
  });

  it("does not take in mail to the alias that names no target, and says why", () => {
    const message = full({ ...vendor, to: [alias], text: done });
    expect(triageBody(message, gated)).toEqual({ verdict: "ignore", rule: "not_named" });
  });

  it("does not take in an unrelated mail that names no target", () => {
    const message = full({ text: "Lunch on friday? I know a place near the station." });
    expect(triageBody(message, gated)).toEqual({ verdict: "ignore", rule: "not_named" });
  });

  it("does not let a closed request tie mail that merely names it", () => {
    const finished = context([request({ open: false })], { verifiedAlias: alias });
    const message = full({ ...vendor, to: [alias], text: `${done}\n\nSpokeo Privacy Team` });
    expect(triageBody(message, finished)).toEqual({ verdict: "ignore", rule: "not_named" });
  });

  it("reads alias mail that names nothing in its headers only if a search finds a name in it", () => {
    const h = headers({ recipients: [alias], ...vendor });
    expect(readPlanFor(h, needs("alias_unnamed") as never, gated)).toEqual({
      read: "if_found",
      scope: "named",
      terms: bodySearchTerms(gated),
    });
  });

  it("always counts alias mail as one a person may want to take in", () => {
    expect(couldBeAReply(headers({ recipients: [alias] }), null, gated)).toBe(true);
    expect(unreadRule(headers({ recipients: [alias] }), "alias_unnamed", gated)).toBe("not_named");
  });

  it("keeps a reply signed with a name that has an apostrophe or an ampersand", () => {
    const macys = request({
      id: "req-macys",
      targetKind: "company",
      targetId: "macys",
      targetName: "Macy's",
      targetDomain: "macys.com",
      replyDomains: ["macys.com"],
    });
    const nobles = request({
      id: "req-bn",
      targetKind: "company",
      targetId: "bn",
      targetName: "Barnes & Noble",
      targetDomain: "barnesandnoble.com",
      replyDomains: ["barnesandnoble.com"],
    });
    const ctx = context([macys, nobles], { verifiedAlias: alias });
    for (const signature of ["Macy's Privacy", "Macy\u2019s Privacy", "Barnes and Noble Privacy"]) {
      const message = full({ ...vendor, to: [alias], text: `${done}\n\n${signature}` });
      expect(triageBody(message, ctx)).toEqual({ verdict: "admit", by: "alias" });
    }
  });

  it("does not take in unrelated mail that holds an everyday word of a target's domain", () => {
    const here = request({
      id: "req-here",
      targetKind: "company",
      targetId: "here",
      targetName: "HERE North America LLC",
      targetDomain: "here.com",
      replyDomains: ["here.com"],
    });
    const ctx = context([here], { verifiedAlias: alias });
    const message = full({
      ...vendor,
      to: [alias],
      text: "Click here to review your account.",
    });
    expect(triageBody(message, ctx)).toEqual({ verdict: "ignore", rule: "not_named" });
  });

  it("does not count a name inside a longer word", () => {
    const message = full({ ...vendor, to: [alias], text: `${done}\n\nSpokeoish Privacy Team` });
    expect(triageBody(message, gated)).toEqual({ verdict: "ignore", rule: "not_named" });
  });
});
