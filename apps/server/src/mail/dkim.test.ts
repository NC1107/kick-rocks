import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BODY, KEY_RECORD, servingKeysFor, signed, unsigned } from "../test-utils/dkim.js";
import type { DkimVerifier } from "./dkim.js";
import { createDkimVerifier, type DnsResolver, withDeadline } from "./dkim.js";
import type { VerifiedSignature } from "./types.js";

const DOMAINS = ["acme.test", "evil.test"];

const signatures = (verifier: DkimVerifier, message: string | Buffer) =>
  verifier.verifiedSignatures(Buffer.from(message), DOMAINS);

const names = async (verifier: DkimVerifier, message: string | Buffer) =>
  (await signatures(verifier, message)).map((signature: VerifiedSignature) => signature.domain);

const verify = (
  message: string,
  resolver: DnsResolver = servingKeysFor("acme.test", "evil.test"),
) => names(createDkimVerifier({ resolver, timeoutMs: 500 }), message);

describe("verifiedSignatures", () => {
  it("names the signing domain of a valid signature", async () => {
    expect(await verify(await signed(unsigned()))).toEqual(["acme.test"]);
  });

  it("names every domain whose signature verifies", async () => {
    const twice = await signed(await signed(unsigned()), {
      domain: "evil.test",
    });
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
    expect(await names(verifier, await signed(unsigned()))).toEqual([]);
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
    expect(await names(verifier, message)).toEqual(["acme.test"]);
  });

  it("asks DNS once for a key it saw a moment ago", async () => {
    let lookups = 0;
    const counting: DnsResolver = (name, rrtype) => {
      lookups += 1;
      return servingKeysFor("acme.test")(name, rrtype);
    };
    const verifier = createDkimVerifier({ resolver: counting });
    const message = Buffer.from(await signed(unsigned()));
    await names(verifier, message);
    await names(verifier, message);
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
    expect(await names(verifier, message)).toEqual([]);
    expect(await names(verifier, message)).toEqual(["acme.test"]);
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

  describe("the headers a signature covers", () => {
    const ID = "<kr.req-1.0@example.com>";
    const withHeaders = (...lines: string[]) => unsigned(BODY, "privacy@acme.test", lines);
    const read = async (message: string) =>
      (await signatures(createDkimVerifier({ resolver: servingKeysFor("acme.test") }), message))[0];

    it("reports the signed In-Reply-To, References, and Subject", async () => {
      const message = await signed(
        withHeaders(`In-Reply-To: ${ID}`, `References: <a@x.test> ${ID}`),
      );
      expect(await read(message)).toEqual({
        domain: "acme.test",
        inReplyTo: [ID],
        references: [`<a@x.test> ${ID}`],
        subject: ["Your privacy request"],
      });
    });

    it("reports nothing for a header the signature does not list", async () => {
      const message = await signed(withHeaders(`In-Reply-To: ${ID}`), {
        headerList: ["from", "to", "subject", "date", "message-id"],
      });
      expect((await read(message))?.inReplyTo).toEqual([]);
    });

    it("reads the instance the signature covers, which is the bottom-most one", async () => {
      const message = await signed(unsigned());
      const forged = `Subject: forged KR-2B4C6D\r\nIn-Reply-To: <forged@x.test>\r\n${message}`;
      const signature = await read(forged);
      expect(signature?.subject).toEqual(["Your privacy request"]);
      expect(signature?.inReplyTo).toEqual([]);
    });

    it("removes folding and decodes nothing else", async () => {
      const message = await signed(
        withHeaders(
          "In-Reply-To: <a@x.test>\r\n <kr.req-1.0@example.com>",
          "References: =?utf-8?Q?<kr.x>?=",
        ),
      );
      const signature = await read(message);
      expect(signature?.inReplyTo).toEqual(["<a@x.test> <kr.req-1.0@example.com>"]);
      expect(signature?.references).toEqual(["=?utf-8?Q?<kr.x>?="]);
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
      expect(await names(verifier, noise + message)).toEqual([]);
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
      expect(await names(verifier, noise + message)).toEqual(["acme.test"]);
      expect(asked).toEqual(["kr._domainkey.acme.test"]);
    });

    it("checks at most five signatures", async () => {
      const subdomains = Array.from({ length: 8 }, (_, index) => `s${index}.acme.test`);
      const { asked, resolver } = counting(...subdomains);
      let message = unsigned();
      for (const domain of subdomains) message = await signed(message, { domain });
      const verifier = createDkimVerifier({ resolver, timeoutMs: 500 });
      const verified = await names(verifier, message);
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
      const message = await signed(await signed(unsigned()), {
        domain: "evil.test",
      });
      expect(await names(verifier, message)).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(lookups).toBe(1);
    });

    it("refuses a lookup once the timer has fired, even when the clock still reads before the deadline", async () => {
      let lookups = 0;
      const hanging: DnsResolver = () => {
        lookups += 1;
        return new Promise(() => {});
      };
      const lagging = withDeadline(hanging, 1_000, () => 999);
      await expect(lagging("a._domainkey.acme.test", "TXT")).rejects.toMatchObject({
        code: "ETIMEOUT",
      });
      await expect(lagging("b._domainkey.acme.test", "TXT")).rejects.toMatchObject({
        code: "ETIMEOUT",
      });
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
        timeoutMs: 20_000,
        runBudgetMs: 40,
      }).forRun();
      const message = Buffer.from(await signed(unsigned()));
      expect(await names(run, message)).toEqual([]);
      const spent = lookups;
      const started = Date.now();
      expect(await names(run, message)).toEqual([]);
      expect(lookups).toBe(spent);
      expect(Date.now() - started).toBeLessThan(10_000);
    });
  });
});
