import { describe, expect, it } from "vitest";
import { BODY, KEY_RECORD, servingKeysFor, signed, unsigned } from "../test-utils/dkim.js";
import { createDkimVerifier, type DnsResolver } from "./dkim.js";

const verify = (
  message: string,
  resolver: DnsResolver = servingKeysFor("acme.test", "evil.test"),
) => createDkimVerifier({ resolver, timeoutMs: 500 }).verifiedDomains(Buffer.from(message));

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
    expect(await verifier.verifiedDomains(Buffer.from(await signed(unsigned())))).toEqual([]);
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
    expect(await verifier.verifiedDomains(Buffer.from(message))).toEqual(["acme.test"]);
  });

  it("asks DNS once for a key it saw a moment ago", async () => {
    let lookups = 0;
    const counting: DnsResolver = (name, rrtype) => {
      lookups += 1;
      return servingKeysFor("acme.test")(name, rrtype);
    };
    const verifier = createDkimVerifier({ resolver: counting });
    const message = Buffer.from(await signed(unsigned()));
    await verifier.verifiedDomains(message);
    await verifier.verifiedDomains(message);
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
    expect(await verifier.verifiedDomains(message)).toEqual([]);
    expect(await verifier.verifiedDomains(message)).toEqual(["acme.test"]);
  });
});
