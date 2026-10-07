import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { domainToASCII } from "node:url";
import { dkimVerify } from "mailauth";
import addressparser from "nodemailer/lib/addressparser/index.js";
import { z } from "zod";
import { alignsWithAny } from "./sender-auth.js";
import type { DkimScope } from "./types.js";

export type DnsResolver = (domain: string, rrtype: string) => Promise<string[][] | string[]>;

export interface DkimVerifierOptions {
  /** Replaceable so a test can serve keys without a network. */
  resolver?: DnsResolver;
  /** Key records served before DNS, keyed by `selector._domainkey.domain`. Test use only. */
  testKeys?: Readonly<Record<string, string>>;
  /** The longest one message may take to verify, DNS included. */
  timeoutMs?: number;
  /** The most verification time one poll run may spend across all of its messages. */
  runBudgetMs?: number;
}

/** Checks the DKIM signatures of a raw message. */
export interface DkimVerifier {
  /**
   * The signing domains of the signatures that verified over the whole body, belong to one of
   * `scope.domains`, and cover a To or Cc naming `scope.recipient`. Empty when nothing qualified
   * or when verification could not finish, so a failure never vouches for anyone.
   */
  verifiedDomains(source: Buffer, scope: DkimScope): Promise<string[]>;
  /** A verifier sharing this one's key cache that stops spending time once one poll run's budget is gone. */
  forRun(): DkimVerifier;
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

const MAX_SIGNATURES = 5;
const RUN_BUDGET_MS = 30_000;
const IGNORED_HEADERS = /^(arc-seal|arc-message-signature|arc-authentication-results)$/;

interface HeaderField {
  name: string;
  raw: string;
}

function splitHeaders(source: Buffer): {
  fields: HeaderField[];
  bodyStart: number;
} {
  const crlf = source.indexOf("\r\n\r\n");
  const lf = source.indexOf("\n\n");
  const bodyStart =
    crlf === -1 && lf === -1
      ? source.length
      : Math.min(crlf === -1 ? Infinity : crlf + 4, lf === -1 ? Infinity : lf + 2);
  const fields = source
    .subarray(0, bodyStart)
    .toString("latin1")
    .split(/(?<=\n)(?![ \t])/)
    .map((raw) => ({
      raw,
      name: raw
        .slice(0, Math.max(raw.indexOf(":"), 0))
        .trim()
        .toLowerCase(),
    }));
  return { fields, bodyStart };
}

function signingDomainTag(field: HeaderField): string {
  const value = field.raw.slice(field.raw.indexOf(":") + 1).replace(/\r?\n[ \t]/g, "");
  for (const tag of value.split(";")) {
    const at = tag.indexOf("=");
    if (at > 0 && tag.slice(0, at).trim().toLowerCase() === "d") {
      return tag
        .slice(at + 1)
        .trim()
        .toLowerCase();
    }
  }
  return "";
}

/** True when the message carries any DKIM signature, so one that carries none is never kept for later. */
export function hasDkimSignature(source: Buffer): boolean {
  return splitHeaders(source).fields.some((field) => field.name === "dkim-signature");
}

/**
 * The message cut down to the signatures worth checking: those whose d= could align with one of
 * the domains, at most `MAX_SIGNATURES` of them. Every other signature and every ARC header is
 * dropped so the verifier never hashes for them or looks up their keys.
 */
function reduceToRelevantSignatures(
  source: Buffer,
  domains: readonly string[],
): { source: Buffer; hasCc: boolean } | null {
  const { fields, bodyStart } = splitHeaders(source);
  let kept = 0;
  const headers = fields.filter((field) => {
    if (IGNORED_HEADERS.test(field.name)) return false;
    if (field.name !== "dkim-signature") return true;
    const domain = signingDomainTag(field);
    if (domain === "" || kept >= MAX_SIGNATURES || !alignsWithAny(domain, domains)) return false;
    kept += 1;
    return true;
  });
  if (kept === 0) return null;
  return {
    source: Buffer.concat([
      Buffer.from(headers.map((field) => field.raw).join(""), "latin1"),
      source.subarray(bodyStart),
    ]),
    hasCc: fields.some((field) => field.name === "cc"),
  };
}

const DOMAIN_CHARACTERS = /^[\p{L}\p{M}\p{N}.\-\u3002\uFF0E\uFF61]+$/u;
const IDNA_DOTS = /[.\u3002\uFF0E\uFF61]/;

/** Whether the text is a plain run of dot-separated labels, with nothing a URL host parser would act on. */
function isPlainDomain(domain: string): boolean {
  return (
    DOMAIN_CHARACTERS.test(domain) &&
    domain
      .split(IDNA_DOTS)
      .every((label) => label !== "" && !label.startsWith("-") && !label.endsWith("-"))
  );
}

const lowerAscii = (text: string) => text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());

/** The address with its domain as A-labels and its local part untouched, so only ASCII case folds. */
function comparableAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "";
  const rawDomain = address.slice(at + 1).trim();
  const domain = isPlainDomain(rawDomain) ? domainToASCII(rawDomain) : "";
  return domain === "" ? "" : `${lowerAscii(address.slice(0, at))}@${domain}`;
}

/** Read without decoding RFC 2047 encoded-words, which are not allowed inside an addr-spec. */
function addressesOfHeader(line: string): string[] {
  const value = line.slice(line.indexOf(":") + 1).replace(/\r?\n(?=[ \t])/g, "");
  return addressparser(value, { flatten: true }).flatMap((entry) =>
    entry.address ? [comparableAddress(entry.address)] : [],
  );
}

/**
 * Whether the signature itself covers the recipients and names this mailbox among them. A genuine
 * reply to someone else verifies just as well, so only a signed To or Cc that holds the mailbox
 * address ties the signature to this mail. The headers read are the instances the signature
 * hashed, which are the bottom-most of each name.
 */
function signedForRecipient(
  signedHeaders: readonly string[],
  recipient: string,
  hasCc: boolean,
): boolean {
  const first = (name: string) =>
    signedHeaders.find((line) => line.slice(0, line.indexOf(":")).trim().toLowerCase() === name);
  const to = first("to");
  const cc = first("cc");
  if (to === undefined || (hasCc && cc === undefined)) return false;
  const wanted = comparableAddress(recipient.trim());
  const signed = [to, ...(cc === undefined ? [] : [cc])].flatMap(addressesOfHeader);
  return wanted !== "" && signed.includes(wanted);
}

function timeoutError(): Error {
  return Object.assign(new Error("DNS lookup ran out of time"), {
    code: "ETIMEOUT",
  });
}

/** Answers every lookup from the underlying resolver until the deadline, and refuses every one after it. */
export function withDeadline(
  resolve: DnsResolver,
  deadline: number,
  now: () => number,
): DnsResolver {
  // A timer can fire a millisecond before the clock reaches the deadline, so the timer itself marks it passed.
  let expired = false;
  return (domain, rrtype) => {
    const left = deadline - now();
    if (expired || left <= 0) return Promise.reject(timeoutError());
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        expired = true;
        fail(timeoutError());
      }, left);
      resolve(domain, rrtype).then(
        (records) => {
          clearTimeout(timer);
          done(records);
        },
        (error: unknown) => {
          clearTimeout(timer);
          fail(error);
        },
      );
    });
  };
}

export function createDkimVerifier({
  resolver = systemResolver(),
  testKeys = {},
  timeoutMs = VERIFY_TIMEOUT_MS,
  runBudgetMs = RUN_BUDGET_MS,
}: DkimVerifierOptions = {}): DkimVerifier {
  const resolve = cachingResolver(withTestKeys(resolver, testKeys), Date.now);

  async function verify(source: Buffer, scope: DkimScope, deadline: number): Promise<string[]> {
    const relevant = reduceToRelevantSignatures(source, scope.domains);
    if (!relevant) return [];
    const { results } = await dkimVerify(relevant.source, {
      resolver: withDeadline(resolve, deadline, Date.now),
      rejectRsaSha1: true,
    });
    const domains: string[] = [];
    for (const result of results) {
      if (
        result.status.result === "pass" &&
        // An l= tag lets anyone append text the signature never saw.
        !result.status.underSized &&
        result.signingDomain &&
        alignsWithAny(result.signingDomain, scope.domains) &&
        signedForRecipient(result.signingHeaders?.headers ?? [], scope.recipient, relevant.hasCc)
      ) {
        domains.push(result.signingDomain.toLowerCase());
      }
    }
    return [...new Set(domains)];
  }

  function verifier(budget: { left: number } | null): DkimVerifier {
    return {
      async verifiedDomains(source, scope) {
        const allowed = Math.min(timeoutMs, budget?.left ?? timeoutMs);
        if (allowed <= 0) return [];
        const started = Date.now();
        let timer: NodeJS.Timeout | undefined;
        let gaveUp = false;
        const giveUp = new Promise<string[]>((done) => {
          timer = setTimeout(() => {
            gaveUp = true;
            done([]);
          }, allowed);
        });
        try {
          return await Promise.race([
            verify(source, scope, started + allowed).catch(() => []),
            giveUp,
          ]);
        } finally {
          clearTimeout(timer);
          if (budget) budget.left -= gaveUp ? allowed : Date.now() - started;
        }
      },
      forRun: () => verifier({ left: runBudgetMs }),
    };
  }

  return verifier(null);
}

const TestKeys = z.record(z.string().min(1), z.string().min(1));

/** Reads the key records a development stack serves in place of DNS. */
export function loadDkimTestKeys(path: string): Record<string, string> {
  return TestKeys.parse(JSON.parse(readFileSync(path, "utf8")));
}
