import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BODY, KEY_RECORD, servingKeysFor, signed, unsigned } from "../test-utils/dkim.js";
import { createDkimVerifier, type DnsResolver } from "./dkim.js";
import type { DkimScope } from "./types.js";

const SCOPE: DkimScope = { domains: ["acme.test", "evil.test"], recipient: "jordan@example.com" };

const verify = (
  message: string,
  resolver: DnsResolver = servingKeysFor("acme.test", "evil.test"),
) => createDkimVerifier({ resolver, timeoutMs: 500 }).verifiedDomains(Buffer.from(message), SCOPE);

describe("verifiedDomains", () => {
  it("names the signing domain of a valid signature", async () => {
    expect(await verify(await signed(unsigned()))).toEqual(["acme.test"]);
  });

  it("names every domain whose signature verifies", async () => {
    const twice = await signed(await signed(unsigned()), { domain: "evil.test" });
    expect((await verify(twice)).sort()).toEqual(["acme.test", "evil.test"]);
  });

  it("names nothing for a message with no signature", async () => {
    expect(await verify(unsigned())).toEqual([]);
  });

  it("names nothing when the body changed after signing", async () => {
    const message = await signed(unsigned());
    expect(await verify(message.replace("completed", "ignored"))).toEqual([]);
  });

  it("names nothing when a signed header changed after signing", async () => {
    const message = await signed(unsigned());
    expect(await verify(message.replace("Subject: Your", "Subject: Re: Your"))).toEqual([]);
  });

  it("names nothing when a length limit leaves part of the body unsigned", async () => {
    const message = await signed(unsigned(`${BODY}Click here: http://evil.test/\r\n`), {
      maxBodyLength: BODY.length,
    });
    expect(await verify(message)).toEqual([]);
  });

  it("names nothing when text was appended under a length limit", async () => {
    const message = await signed(unsigned(), { maxBodyLength: BODY.length });
    expect(await verify(`${message}Click here: http://evil.test/\r\n`)).toEqual([]);
  });

  it("accepts a length limit that covers the whole body", async () => {
    const message = await signed(unsigned(), { maxBodyLength: BODY.length });
    expect(await verify(message)).toEqual(["acme.test"]);
  });

  it("names nothing when the key record cannot be found", async () => {
    expect(await verify(await signed(unsigned()), servingKeysFor())).toEqual([]);
  });

  it("names nothing when DNS answers with an error", async () => {
    const failing: DnsResolver = async () => {
      throw Object.assign(new Error("timed out"), { code: "ETIMEOUT" });
    };
    expect(await verify(await signed(unsigned()), failing)).toEqual([]);
  });

  it("names nothing, without waiting forever, when DNS never answers", async () => {
    const hanging: DnsResolver = () => new Promise(() => {});
    const started = Date.now();
    const verifier = createDkimVerifier({ resolver: hanging, timeoutMs: 50 });
    expect(await verifier.verifiedDomains(Buffer.from(await signed(unsigned())), SCOPE)).toEqual(
      [],
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("names nothing for input that is not a message", async () => {
    expect(await verify("\u0000\u0001 not mail")).toEqual([]);
  });

  it("serves keys from the test key list before asking DNS", async () => {
    const verifier = createDkimVerifier({
      resolver: servingKeysFor(),
      testKeys: { "kr._domainkey.acme.test": KEY_RECORD },
    });
    const message = await signed(unsigned());
    expect(await verifier.verifiedDomains(Buffer.from(message), SCOPE)).toEqual(["acme.test"]);
  });

  it("asks DNS once for a key it saw a moment ago", async () => {
    let lookups = 0;
    const counting: DnsResolver = (name, rrtype) => {
      lookups += 1;
      return servingKeysFor("acme.test")(name, rrtype);
    };
    const verifier = createDkimVerifier({ resolver: counting });
    const message = Buffer.from(await signed(unsigned()));
    await verifier.verifiedDomains(message, SCOPE);
    await verifier.verifiedDomains(message, SCOPE);
    expect(lookups).toBe(1);
  });

  it("asks DNS again after a lookup that timed out", async () => {
    let lookups = 0;
    const flaky: DnsResolver = async (name, rrtype) => {
      lookups += 1;
      if (lookups === 1) throw Object.assign(new Error("timed out"), { code: "ETIMEOUT" });
      return servingKeysFor("acme.test")(name, rrtype);
    };
    const verifier = createDkimVerifier({ resolver: flaky });
    const message = Buffer.from(await signed(unsigned()));
    expect(await verifier.verifiedDomains(message, SCOPE)).toEqual([]);
    expect(await verifier.verifiedDomains(message, SCOPE)).toEqual(["acme.test"]);
  });

  it("refuses an rsa-sha1 signature without looking up its key", async () => {
    // This platform's OpenSSL cannot make rsa-sha1 signatures, so the header is written by hand
    // with a correct body hash; only the key lookup tells a refusal from a failed check.
    const bodyHash = createHash("sha1").update(BODY).digest("base64");
    const header = `DKIM-Signature: v=1; a=rsa-sha1; c=relaxed/relaxed; d=acme.test; s=kr; h=from:to:subject; bh=${bodyHash}; b=AAAA\r\n`;
    const asked: string[] = [];
    const resolver: DnsResolver = (name, rrtype) => {
      asked.push(name);
      return servingKeysFor("acme.test")(name, rrtype);
    };
    expect(await verify(header + unsigned(), resolver)).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("names nothing when the signature does not cover the recipients", async () => {
    const message = await signed(unsigned(), { headerList: ["from", "subject", "date"] });
    expect(await verify(message)).toEqual([]);
  });

  it("names nothing when the signed To is someone else", async () => {
    const message = await signed(unsigned().replace("jordan@example.com", "casey@example.org"));
    expect(await verify(message)).toEqual([]);
  });

  it("accepts a mailbox that is only on the signed Cc", async () => {
    const message = await signed(
      unsigned().replace(
        "To: jordan@example.com",
        "To: casey@example.org\r\nCc: jordan@example.com",
      ),
    );
    expect(await verify(message)).toEqual(["acme.test"]);
  });

  it("names nothing when a Cc is present and the signature leaves it out", async () => {
    const message = await signed(
      unsigned().replace(
        "To: jordan@example.com",
        "To: jordan@example.com\r\nCc: casey@example.org",
      ),
      { headerList: ["from", "to", "subject", "date", "message-id"] },
    );
    expect(await verify(message)).toEqual([]);
  });

  it("reads the To the signature covers, which is the bottom-most one", async () => {
    const message = await signed(unsigned().replace("jordan@example.com", "casey@example.org"));
    expect(await verify(`To: jordan@example.com\r\n${message}`)).toEqual([]);
  });

  describe("with non-ASCII recipients", () => {
    const withTo = (to: string) => unsigned().replace("To: jordan@example.com", `To: ${to}`);
    const verifyFor = (message: string, recipient: string) =>
      createDkimVerifier({ resolver: servingKeysFor("acme.test"), timeoutMs: 500 }).verifiedDomains(
        Buffer.from(message, "utf8"),
        { ...SCOPE, recipient },
      );

    it("names nothing when the signed To is a UTF-8 lookalike of the mailbox", async () => {
      const message = await signed(withTo("jordan@exa\u016Dple.com"));
      expect(await verifyFor(message, "jordan@example.com")).toEqual([]);
    });

    it("names nothing when the signed To is the punycode form of a lookalike", async () => {
      const message = await signed(withTo("jordan@xn--exaple-rmb.com"));
      expect(await verifyFor(message, "jordan@example.com")).toEqual([]);
    });

    it("names nothing when only the local part differs by a non-ASCII letter", async () => {
      const message = await signed(withTo("j\u00D6rdan@example.com"));
      expect(await verifyFor(message, "j\u00F6rdan@example.com")).toEqual([]);
    });

    it("accepts a UTF-8 address that equals the mailbox", async () => {
      const message = await signed(withTo("jordan@exa\u016Dple.com"));
      expect(await verifyFor(message, "jordan@exa\u016Dple.com")).toEqual(["acme.test"]);
    });

    it("accepts the punycode form of the mailbox domain", async () => {
      const message = await signed(withTo("jordan@xn--exaple-rmb.com"));
      expect(await verifyFor(message, "jordan@exa\u016Dple.com")).toEqual(["acme.test"]);
    });
  });

  describe("with signatures nobody here asked about", () => {
    function counting(...domains: string[]) {
      const asked: string[] = [];
      const resolver: DnsResolver = (name, rrtype) => {
        asked.push(name);
        return servingKeysFor(...domains)(name, rrtype);
      };
      return { asked, resolver };
    }

    it("makes no DNS lookup for signatures whose domain cannot align", async () => {
      const { asked, resolver } = counting("acme.test");
      const noise = Array.from(
        { length: 40 },
        (_, index) =>
          `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=noise${index}.test; s=kr; h=from:to; bh=AAAA; b=AAAA\r\n`,
      ).join("");
      const verifier = createDkimVerifier({ resolver, timeoutMs: 500 });
      const message = await signed(unsigned(), { domain: "other.test" });
      expect(await verifier.verifiedDomains(Buffer.from(noise + message), SCOPE)).toEqual([]);
      expect(asked).toEqual([]);
    });

    it("still verifies the one signature that aligns among many that do not", async () => {
      const { asked, resolver } = counting("acme.test");
      const noise = Array.from(
        { length: 40 },
        (_, index) =>
          `DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=noise${index}.test; s=kr; h=from:to; bh=AAAA; b=AAAA\r\n`,
      ).join("");
      const verifier = createDkimVerifier({ resolver, timeoutMs: 500 });
      const message = await signed(unsigned());
      expect(await verifier.verifiedDomains(Buffer.from(noise + message), SCOPE)).toEqual([
        "acme.test",
      ]);
      expect(asked).toEqual(["kr._domainkey.acme.test"]);
    });

    it("checks at most five signatures", async () => {
      const subdomains = Array.from({ length: 8 }, (_, index) => `s${index}.acme.test`);
      const { asked, resolver } = counting(...subdomains);
      let message = unsigned();
      for (const domain of subdomains) message = await signed(message, { domain });
      const verifier = createDkimVerifier({ resolver, timeoutMs: 500 });
      const verified = await verifier.verifiedDomains(Buffer.from(message), SCOPE);
      expect(asked).toHaveLength(5);
      expect(verified).toHaveLength(5);
    });
  });

  describe("when DNS never answers", () => {
    it("starts no lookup after the deadline, even when a slow lookup finishes late", async () => {
      let lookups = 0;
      const slow: DnsResolver = () => {
        lookups += 1;
        return new Promise((_, fail) =>
          setTimeout(() => fail(Object.assign(new Error("late"), { code: "ETIMEOUT" })), 120),
        );
      };
      const verifier = createDkimVerifier({ resolver: slow, timeoutMs: 40 });
      const message = await signed(await signed(unsigned()), { domain: "evil.test" });
      expect(await verifier.verifiedDomains(Buffer.from(message), SCOPE)).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(lookups).toBe(1);
    });

    it("stops spending time on a poll run once its budget is gone", async () => {
      let lookups = 0;
      const hanging: DnsResolver = () => {
        lookups += 1;
        return new Promise(() => {});
      };
      const run = createDkimVerifier({
        resolver: hanging,
        timeoutMs: 500,
        runBudgetMs: 40,
      }).forRun();
      const message = Buffer.from(await signed(unsigned()));
      expect(await run.verifiedDomains(message, SCOPE)).toEqual([]);
      const spent = lookups;
      const started = Date.now();
      expect(await run.verifiedDomains(message, SCOPE)).toEqual([]);
      expect(lookups).toBe(spent);
      expect(Date.now() - started).toBeLessThan(30);
    });
  });
});
