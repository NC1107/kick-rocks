import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { dkimVerify } from "mailauth";
import { z } from "zod";

export type DnsResolver = (domain: string, rrtype: string) => Promise<string[][] | string[]>;

export interface DkimVerifierOptions {
  /** Replaceable so a test can serve keys without a network. */
  resolver?: DnsResolver;
  /** Key records served before DNS, keyed by `selector._domainkey.domain`. Test use only. */
  testKeys?: Readonly<Record<string, string>>;
  /** The longest one message may take to verify, DNS included. */
  timeoutMs?: number;
}

/** Checks the DKIM signatures of a raw message. */
export interface DkimVerifier {
  /**
   * The signing domains of every signature that verified over the whole body. Empty when nothing
   * verified or when verification could not finish, so a failure never vouches for anyone.
   */
  verifiedDomains(source: Buffer): Promise<string[]>;
}

const DNS_TIMEOUT_MS = 3_000;
const VERIFY_TIMEOUT_MS = 10_000;
const KEY_TTL_MS = 5 * 60_000;
const MISSING_TTL_MS = 60_000;
const CACHE_ENTRIES = 256;
const MISSING_CODES = new Set(["ENOTFOUND", "ENODATA"]);

/** A DNS answer that is worth keeping: a found record for a while, a missing one briefly. */
function cachingResolver(resolve: DnsResolver, now: () => number): DnsResolver {
  const cache = new Map<
    string,
    { expires: number; records: string[][] | string[] } | { expires: number; error: unknown }
  >();
  return async (domain, rrtype) => {
    const key = `${rrtype}:${domain.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) {
      if ("error" in hit) throw hit.error;
      return hit.records;
    }
    cache.delete(key);
    const remember = (
      entry:
        | { expires: number; records: string[][] | string[] }
        | { expires: number; error: unknown },
    ) => {
      if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(key, entry);
    };
    try {
      const records = await resolve(domain, rrtype);
      remember({ expires: now() + KEY_TTL_MS, records });
      return records;
    } catch (error) {
      if (MISSING_CODES.has((error as { code?: string }).code ?? "")) {
        remember({ expires: now() + MISSING_TTL_MS, error });
      }
      throw error;
    }
  };
}

function systemResolver(): DnsResolver {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  return (domain, rrtype) => resolver.resolve(domain, rrtype) as Promise<string[][] | string[]>;
}

function withTestKeys(
  resolve: DnsResolver,
  testKeys: Readonly<Record<string, string>>,
): DnsResolver {
  const keys = new Map(
    Object.entries(testKeys).map(([name, record]) => [name.toLowerCase(), record]),
  );
  return async (domain, rrtype) => {
    const record = rrtype.toUpperCase() === "TXT" ? keys.get(domain.toLowerCase()) : undefined;
    return record === undefined ? resolve(domain, rrtype) : [[record]];
  };
}

export function createDkimVerifier({
  resolver = systemResolver(),
  testKeys = {},
  timeoutMs = VERIFY_TIMEOUT_MS,
}: DkimVerifierOptions = {}): DkimVerifier {
  const resolve = cachingResolver(withTestKeys(resolver, testKeys), Date.now);

  async function verify(source: Buffer): Promise<string[]> {
    const { results } = await dkimVerify(source, { resolver: resolve });
    const domains = results
      .filter(
        (result) =>
          result.status.result === "pass" &&
          // An l= tag lets anyone append text the signature never saw.
          !result.status.underSized &&
          result.signingDomain,
      )
      .map((result) => (result.signingDomain ?? "").toLowerCase());
    return [...new Set(domains)];
  }

  return {
    async verifiedDomains(source) {
      let timer: NodeJS.Timeout | undefined;
      const giveUp = new Promise<string[]>((done) => {
        timer = setTimeout(() => done([]), timeoutMs);
      });
      try {
        return await Promise.race([verify(source).catch(() => []), giveUp]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

const TestKeys = z.record(z.string().min(1), z.string().min(1));

/** Reads the key records a development stack serves in place of DNS. */
export function loadDkimTestKeys(path: string): Record<string, string> {
  return TestKeys.parse(JSON.parse(readFileSync(path, "utf8")));
}
