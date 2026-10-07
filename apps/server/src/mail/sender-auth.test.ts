import { outgoingMessageId } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { BODY, servingKeysFor, signed, unsigned } from "../test-utils/dkim.js";
import { createReplyClassifier } from "./classifier.js";
import { createDkimVerifier, type DnsResolver } from "./dkim.js";
import { parseInboxMessage } from "./parse.js";
import { type SenderTrust, senderTrust } from "./sender-auth.js";
import type { ClassifierRequest, InboxMessage } from "./types.js";

const TARGET = ["acme.test"];
const OUR_ID = outgoingMessageId("req-1", "example.com");
const classifier = createReplyClassifier({
  settings: { get: () => null as never },
});

const outstanding: ClassifierRequest = {
  id: "req-1",
  reference: "KR-7K3M9Q",
  outgoingMessageId: OUR_ID,
  status: "awaiting_reply",
  channel: "email",
  targetId: "acme",
  targetName: "Acme Data",
  targetDomain: "acme.test",
  replyDomains: ["acme.test"],
  curatedReplyDomains: [],
  replyAddresses: [],
  recordUrl: null,
  awaitingConfirmation: null,
};

async function receive(
  raw: string,
  resolver: DnsResolver = servingKeysFor("acme.test", "evil.test"),
) {
  return parseInboxMessage({
    uid: 1,
    source: Buffer.from(raw),
    dkim: createDkimVerifier({ resolver, timeoutMs: 500 }),
  });
}

async function trustOf(
  raw: string,
  resolver?: DnsResolver,
  domains = TARGET,
): Promise<SenderTrust> {
  return senderTrust(await receive(raw, resolver), outstanding, domains);
}

const classifyRaw = async (raw: string) =>
  classifier.classify(await receive(raw), { requests: [outstanding] });

const replyTo = (...headers: string[]) => unsigned(BODY, "privacy@acme.test", headers);

describe("senderTrust", () => {
  it("is signed for a valid signature from the target's own domain that quotes nothing", async () => {
    expect(await trustOf(await signed(unsigned()))).toBe("signed");
  });

  it("accepts a signature from a subdomain of the target, which shares its organization", async () => {
    const resolver = servingKeysFor("mail.acme.test");
    expect(await trustOf(await signed(unsigned(), { domain: "mail.acme.test" }), resolver)).toBe(
      "signed",
    );
  });

  it("accepts a signature from one of the target's other known domains", async () => {
    const resolver = servingKeysFor("sister.test");
    const raw = await signed(unsigned(), { domain: "sister.test" });
    expect(await trustOf(raw, resolver, ["acme.test", "sister.test"])).toBe("signed");
  });

  it("is unsigned for a valid signature from a domain that is not aligned with the target", async () => {
    expect(await trustOf(await signed(unsigned(), { domain: "evil.test" }))).toBe("unsigned");
  });

  it("is unsigned for a lookalike signing domain", async () => {
    const resolver = servingKeysFor("notacme.test");
    const raw = await signed(unsigned(), { domain: "notacme.test" });
    expect(await trustOf(raw, resolver)).toBe("unsigned");
  });

  it("is unsigned when the body changed after signing", async () => {
    const raw = (await signed(unsigned())).replace("completed", "ignored");
    expect(await trustOf(raw)).toBe("unsigned");
  });

  it("is unsigned for a message with no signature", async () => {
    expect(await trustOf(unsigned())).toBe("unsigned");
  });

  it("is unsigned when the signature covers only part of the body", async () => {
    const raw = await signed(unsigned(`${BODY}Click: http://evil.test/\r\n`), {
      maxBodyLength: BODY.length,
    });
    expect(await trustOf(raw)).toBe("unsigned");
  });

  it("is unsigned when DNS times out", async () => {
    const never: DnsResolver = () => new Promise(() => {});
    const message = await parseInboxMessage({
      uid: 1,
      source: Buffer.from(await signed(unsigned())),
      dkim: createDkimVerifier({ resolver: never, timeoutMs: 50 }),
    });
    expect(await senderTrust(message, outstanding, TARGET)).toBe("unsigned");
  });

  it("is unsigned when no verifier is given", async () => {
    const message = await parseInboxMessage({
      uid: 1,
      source: Buffer.from(await signed(unsigned())),
    });
    expect(await senderTrust(message, outstanding, TARGET)).toBe("unsigned");
  });
});

describe("a signed reply from the broker's domain", () => {
  it("applies when its signed In-Reply-To quotes this request's Message-ID", async () => {
    const result = await classifyRaw(await signed(replyTo(`In-Reply-To: ${OUR_ID}`)));
    expect(result).toMatchObject({ requestId: "req-1", classification: "completed" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("applies when its signed References hold another message of this request's sequence", async () => {
    const raw = replyTo(
      `References: <unrelated@x.test> ${outgoingMessageId("req-1", "example.com", 2)}`,
    );
    const result = await classifyRaw(await signed(raw));
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("applies when its signed Subject carries this request's reference", async () => {
    const raw = unsigned().replace(
      "Subject: Your privacy request",
      "Subject: Re: Your privacy request KR-7K3M9Q",
    );
    const result = await classifyRaw(await signed(raw));
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("applies when only its fully signed body carries this request's reference", async () => {
    const result = await classifyRaw(
      await signed(unsigned(`${BODY}\r\n> Reference: KR-7K3M9Q\r\n`)),
    );
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("applies even when it was addressed to someone else, as long as it quotes the request", async () => {
    const raw = replyTo(`In-Reply-To: ${OUR_ID}`).replace(
      "jordan@example.com",
      "casey@example.org",
    );
    const result = await classifyRaw(await signed(raw));
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("does not apply to this request when it quotes another request's reference", async () => {
    const raw = unsigned().replace(
      "Subject: Your privacy request",
      "Subject: Your privacy request KR-2B4C6D",
    );
    const result = await classifyRaw(await signed(raw));
    expect(result.correlation).toBe("sender_domain");
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("does not apply to this request when it answers another request's Message-ID", async () => {
    const other = outgoingMessageId("req-other", "example.org");
    const result = await classifyRaw(await signed(replyTo(`In-Reply-To: ${other}`)));
    expect(result.correlation).toBe("sender_domain");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("goes to review when it quotes nothing", async () => {
    const result = await classifyRaw(await signed(unsigned()));
    expect(result).toMatchObject({ requestId: "req-1", correlation: "sender_domain" });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("goes to review when its In-Reply-To is not among the headers the signature covers", async () => {
    const raw = await signed(replyTo(`In-Reply-To: ${OUR_ID}`), {
      headerList: ["from", "to", "subject", "date", "message-id"],
    });
    const result = await classifyRaw(raw);
    expect(result).toMatchObject({ requestId: "req-1", correlation: "message_id" });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("does not count a second, unsigned In-Reply-To above the signed one", async () => {
    const other = outgoingMessageId("req-other", "example.org");
    const signedMessage = await signed(replyTo(`In-Reply-To: ${other}`));
    const result = await classifyRaw(`In-Reply-To: ${OUR_ID}\r\n${signedMessage}`);
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("does not count a second, unsigned Subject above the signed one", async () => {
    const signedMessage = await signed(unsigned());
    const result = await classifyRaw(`Subject: Re: KR-7K3M9Q\r\n${signedMessage}`);
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("does not quote this request");
  });

  it("goes to review when the reference sits only in an unsigned trailer after a length-limited body", async () => {
    const message = await signed(unsigned(), { maxBodyLength: BODY.length });
    const result = await classifyRaw(`${message}Reference: KR-7K3M9Q\r\n`);
    expect(result).toMatchObject({ requestId: "req-1", correlation: "reference" });
    expect(result.confidence).toBeLessThan(0.6);
  });
});

describe("a reply that is not signed by the broker", () => {
  it.each([
    ["no signature", async () => replyTo(`In-Reply-To: ${OUR_ID}`)],
    [
      "a signature from another domain",
      async () => signed(replyTo(`In-Reply-To: ${OUR_ID}`), { domain: "evil.test" }),
    ],
  ])("goes to review with %s even when it quotes the request", async (_name, build) => {
    const result = await classifyRaw(await build());
    expect(result).toMatchObject({ requestId: "req-1", correlation: "message_id" });
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("not signed by the broker");
  });
});

describe("a confirmation link", () => {
  const CONFIRM = [
    "Please confirm your opt-out request.",
    "Click the link below to confirm: https://acme.test/optout/confirm?t=abc",
    "",
  ].join("\r\n");
  const unreferenced = () => unsigned(CONFIRM);

  it("is followed when the broker signed it, even though nothing quotes the request", async () => {
    const result = await classifyRaw(await signed(unreferenced()));
    expect(result).toMatchObject({
      requestId: "req-1",
      classification: "confirmation_link",
      links: ["https://acme.test/optout/confirm?t=abc"],
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("goes to review when the broker did not sign it", async () => {
    const result = await classifyRaw(unreferenced());
    expect(result.classification).toBe("confirmation_link");
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.rationale).toContain("not signed by the broker");
  });
});

describe("DKIM verification by the classifier", () => {
  async function callsFor(overrides: Partial<InboxMessage>): Promise<number> {
    let calls = 0;
    const message = await receive(await signed(unsigned()));
    await classifier.classify(
      {
        ...message,
        verifyDkim: async () => {
          calls += 1;
          return [];
        },
        ...overrides,
      },
      { requests: [outstanding] },
    );
    return calls;
  }

  it("is run once for a matched reply that would change the request", async () => {
    expect(await callsFor({ inReplyTo: OUR_ID })).toBe(1);
    expect(await callsFor({ inReplyTo: null })).toBe(1);
  });

  it("is not run for mail that changes nothing", async () => {
    expect(await callsFor({ text: "This is an automatic reply. We received your message." })).toBe(
      0,
    );
  });
});

describe("a reply that carries the Authentication-Results its provider would have written", () => {
  const FORGERIES: Array<[string, string]> = [
    [
      "a DKIM pass for the target under the provider's id",
      "mx.example.com; dkim=pass header.d=acme.test",
    ],
    ["a DKIM pass under a version-numbered id", "mx.example.com 1; dkim=pass header.d=acme.test"],
    ["a DMARC pass for the target", "mx.example.com; dmarc=pass header.from=acme.test"],
    ["a DKIM pass under a foreign id", "mail.evil.test; dkim=pass header.d=acme.test"],
    ["a DKIM pass under the provider's Google id", "mx.google.com; dkim=pass header.d=acme.test"],
    [
      "a pass hidden in a comment after a failure",
      "mx.example.com; dkim=fail header.d=evil.test (x; dkim=pass header.d=acme.test)",
    ],
    [
      "a pass hidden in a quoted property",
      'mx.example.com; dkim=fail header.i="@x; dkim=pass header.d=acme.test"',
    ],
    ["a pass in a folded continuation", "mx.example.com;\r\n dkim=pass\r\n header.d=acme.test"],
  ];

  function withHeader(header: string): string {
    return `Authentication-Results: ${header}\r\n${replyTo(`In-Reply-To: ${OUR_ID}`)}`;
  }

  it.each(FORGERIES)("is not vouched for by %s", async (_name, header) => {
    expect(await trustOf(withHeader(header))).toBe("unsigned");
  });

  it.each(FORGERIES)("goes to review with %s", async (_name, header) => {
    const result = await classifyRaw(withHeader(header));
    expect(result.requestId).toBe("req-1");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("is not vouched for when the same forgery sits beside a signature from another domain", async () => {
    const raw = await signed(withHeader(FORGERIES[0]?.[1] ?? ""), { domain: "evil.test" });
    expect(await trustOf(raw)).toBe("unsigned");
  });

  it("is still vouched for by a real signature, whatever the header says", async () => {
    const raw = await signed(withHeader("mx.example.com; dkim=fail header.d=acme.test"));
    expect(await trustOf(raw)).toBe("bound");
  });
});

describe("a company whose privacy mailbox is on a vendor domain", () => {
  const vendorRequest: ClassifierRequest = {
    ...outstanding,
    targetDomain: "acme.test",
    replyDomains: ["acme.test", "privacyvendor.test"],
    curatedReplyDomains: [],
    replyAddresses: [],
  };
  const vendorResolver = servingKeysFor("acme.test", "privacyvendor.test");
  const fromVendor = (...headers: string[]) =>
    unsigned(BODY, "privacy@privacyvendor.test", headers);
  const classifyVendor = async (raw: string, request = vendorRequest) =>
    classifier.classify(await receive(raw, vendorResolver), { requests: [request] });

  it("binds a signed reply from the vendor domain that quotes the request", async () => {
    const raw = await signed(fromVendor(`In-Reply-To: ${OUR_ID}`), {
      domain: "privacyvendor.test",
    });
    const result = await classifyVendor(raw);
    expect(result).toMatchObject({ requestId: "req-1", classification: "completed" });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("matches the vendor's reply by sender but still sends it to review when it quotes nothing", async () => {
    const raw = await signed(fromVendor(), { domain: "privacyvendor.test" });
    const result = await classifyVendor(raw);
    expect(result).toMatchObject({ requestId: "req-1", correlation: "sender_domain" });
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("does not trust a vendor signature when the dataset lists no vendor domain", async () => {
    const raw = await signed(fromVendor(`In-Reply-To: ${OUR_ID}`), {
      domain: "privacyvendor.test",
    });
    const result = await classifyVendor(raw, outstanding);
    expect(result.confidence).toBeLessThan(0.6);
  });
});
