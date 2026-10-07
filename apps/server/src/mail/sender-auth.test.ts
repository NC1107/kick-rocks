import { outgoingMessageId } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { servingKeysFor, signed, unsigned } from "../test-utils/dkim.js";
import { createReplyClassifier } from "./classifier.js";
import { createDkimVerifier, type DnsResolver } from "./dkim.js";
import { parseInboxMessage } from "./parse.js";
import { senderIsAuthenticated } from "./sender-auth.js";
import type { ClassifierRequest } from "./types.js";

const TARGET = ["acme.test"];
const classifier = createReplyClassifier({ settings: { get: () => null as never } });

const outstanding: ClassifierRequest = {
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

async function authenticated(raw: string, resolver?: DnsResolver, domains = TARGET) {
  return senderIsAuthenticated(await receive(raw, resolver), domains);
}

describe("senderIsAuthenticated", () => {
  it("accepts a valid signature from the target's own domain", async () => {
    expect(await authenticated(await signed(unsigned()))).toBe(true);
  });

  it("accepts a signature from a subdomain of the target, which shares its organization", async () => {
    const resolver = servingKeysFor("mail.acme.test");
    expect(
      await authenticated(await signed(unsigned(), { domain: "mail.acme.test" }), resolver),
    ).toBe(true);
  });

  it("accepts a signature from one of the target's other known domains", async () => {
    const resolver = servingKeysFor("sister.test");
    const raw = await signed(unsigned(), { domain: "sister.test" });
    expect(await authenticated(raw, resolver, ["acme.test", "sister.test"])).toBe(true);
  });

  it("rejects a valid signature from a domain that is not aligned with the target", async () => {
    const raw = await signed(unsigned(), { domain: "evil.test" });
    expect(await authenticated(raw)).toBe(false);
  });

  it("rejects a lookalike signing domain", async () => {
    const resolver = servingKeysFor("notacme.test");
    const raw = await signed(unsigned(), { domain: "notacme.test" });
    expect(await authenticated(raw, resolver)).toBe(false);
  });

  it("rejects a message whose body changed after signing", async () => {
    const raw = (await signed(unsigned())).replace("completed", "ignored");
    expect(await authenticated(raw)).toBe(false);
  });

  it("rejects a message with no signature", async () => {
    expect(await authenticated(unsigned())).toBe(false);
  });

  it("rejects a signature that covers only part of the body", async () => {
    const body = "We have completed your request.\r\n";
    const raw = await signed(unsigned(`${body}Click: http://evil.test/\r\n`), {
      maxBodyLength: body.length,
    });
    expect(await authenticated(raw)).toBe(false);
  });

  it("rejects everything when DNS times out", async () => {
    const never: DnsResolver = () => new Promise(() => {});
    const message = await parseInboxMessage({
      uid: 1,
      source: Buffer.from(await signed(unsigned())),
      dkim: createDkimVerifier({ resolver: never, timeoutMs: 50 }),
    });
    expect(senderIsAuthenticated(message, TARGET)).toBe(false);
  });

  it("rejects everything when no verifier is given", async () => {
    const message = await parseInboxMessage({
      uid: 1,
      source: Buffer.from(await signed(unsigned())),
    });
    expect(senderIsAuthenticated(message, TARGET)).toBe(false);
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
    return `Authentication-Results: ${header}\r\n${unsigned()}`;
  }

  it.each(FORGERIES)("is not vouched for by %s", async (_name, header) => {
    expect(await authenticated(withHeader(header))).toBe(false);
  });

  it.each(FORGERIES)("goes to review with %s", async (_name, header) => {
    const message = await receive(withHeader(header));
    const result = await classifier.classify(
      { ...message, inReplyTo: null, subject: "Your privacy request" },
      { requests: [outstanding] },
    );
    expect(result.requestId).toBe("req-1");
    expect(result.confidence).toBeLessThan(0.6);
  });

  it("is not vouched for when the same forgery sits beside a signature from another domain", async () => {
    const raw = await signed(withHeader(FORGERIES[0]?.[1] ?? ""), { domain: "evil.test" });
    expect(await authenticated(raw)).toBe(false);
  });

  it("is still vouched for by a real signature, whatever the header says", async () => {
    const raw = await signed(withHeader("mx.example.com; dkim=fail header.d=acme.test"));
    expect(await authenticated(raw)).toBe(true);
  });
});
