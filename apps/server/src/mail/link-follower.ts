import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isOnDomain } from "@kickrocks/shared";
import { analyzePage } from "./page-analysis.js";
import type { FollowResult, LinkFollower } from "./types.js";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface LinkFollowerOptions {
  /** Hosts that may be reached although they resolve to a private or loopback address. */
  allowedPrivateHosts: readonly string[];
  /** Replaceable so a test can name a host without a DNS record. */
  resolve?: HostResolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 512 * 1024,
  maxRedirects: 5,
};
const MAX_URL_LENGTH = 2048;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "Mozilla/5.0 (compatible; KickRocks/1.0; +self-hosted opt-out tool)";

const defaultResolver: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map(({ address, family }) => ({
    address,
    family,
  }));

/** Raised for a link the follower will not touch, with a sentence a person can read. */
class Refusal extends Error {
  override name = "Refusal";
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Expands an IPv6 address into its eight 16 bit groups, or null when it is malformed. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0] as string;
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const parts = ipv4Parts(tail[1] as string);
    if (!parts) return null;
    const [a, b, c, d] = parts as [number, number, number, number];
    text = text.replace(
      tail[1] as string,
      `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`,
    );
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const rest = halves[1] !== undefined && halves[1] !== "" ? (halves[1] as string).split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map(
    (group) => Number.parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/** Whether an address is somewhere a public web page never lives: loopback, private, link local, and the like. */
export function isPrivateAddress(address: string): boolean {
  const v4 = ipv4Parts(address);
  if (v4) return isPrivateIpv4(v4);
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const embedded = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  const unspecifiedOrLoopback = groups.slice(0, 7).every((g) => g === 0) && g7 <= 1;
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible, and NAT64 (64:ff9b::/96) carry an IPv4 address.
  const mapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff;
  const nat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (mapped || nat64) return isPrivateIpv4(embedded);
  // 6to4 (2002::/16) embeds the IPv4 address in the next two groups.
  if (g0 === 0x2002) return isPrivateIpv4([g1 >> 8, g1 & 255, g2 >> 8, g2 & 255]);
  return (
    unspecifiedOrLoopback ||
    (g0 & 0xfe00) === 0xfc00 ||
    (g0 & 0xffc0) === 0xfe80 ||
    (g0 & 0xff00) === 0xff00 ||
    (g0 === 0x2001 && g1 === 0x0db8)
  );
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

interface Page {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function decoderFor(encoding: string | undefined) {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return createGunzip();
    case "deflate":
      return createInflate();
    case "br":
      return createBrotliDecompress();
    default:
      return null;
  }
}

export function createLinkFollower({
  allowedPrivateHosts,
  resolve = defaultResolver,
  timeoutMs = DEFAULTS.timeoutMs,
  maxBytes = DEFAULTS.maxBytes,
  maxRedirects = DEFAULTS.maxRedirects,
}: LinkFollowerOptions): LinkFollower {
  const privateOk = new Set(allowedPrivateHosts.map((host) => host.toLowerCase()));

  function checkUrl(url: URL, allowedDomains: readonly string[]): void {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Refusal("Only web links are followed.");
    }
    if (url.username || url.password)
      throw new Refusal("Links that carry a login are not followed.");
    if (!allowedDomains.some((domain) => isOnDomain(url.href, domain))) {
      throw new Refusal(
        `${url.hostname} is not one of the sites this request may be confirmed on.`,
      );
    }
    const host = bareHost(url).toLowerCase();
    if (!privateOk.has(host) && url.port !== "" && url.port !== "80" && url.port !== "443") {
      throw new Refusal("Links on unusual ports are not followed.");
    }
    if (isIP(host) !== 0 && !privateOk.has(host) && isPrivateAddress(host)) {
      throw new Refusal("Links to private or local addresses are not followed.");
    }
  }

  /**
   * Resolves a name and refuses private answers inside the same lookup the socket connects with,
   * so a name that answers differently a moment later cannot slip past the check.
   */
  function pinnedLookup(host: string): http.RequestOptions["lookup"] {
    return (hostname, options, callback) => {
      resolve(hostname).then(
        (addresses) => {
          const usable = privateOk.has(host)
            ? addresses
            : addresses.filter(({ address }) => !isPrivateAddress(address));
          if (usable.length === 0 || usable.length !== addresses.length) {
            callback(
              new Refusal("That address is private or local, so it is not followed."),
              "",
              4,
            );
            return;
          }
          if ((options as { all?: boolean }).all) {
            (callback as unknown as (e: null, list: ResolvedAddress[]) => void)(null, usable);
          } else {
            callback(
              null,
              (usable[0] as ResolvedAddress).address,
              (usable[0] as ResolvedAddress).family,
            );
          }
        },
        (error: Error) => callback(error, "", 4),
      );
    };
  }

  function request(
    url: URL,
    cookie: string | null,
    signal: AbortSignal,
  ): Promise<Page & { redirect: string | null; setCookies: string[] }> {
    const secure = url.protocol === "https:";
    const host = bareHost(url).toLowerCase();
    return new Promise((resolvePage, reject) => {
      const req = (secure ? https : http).request(
        {
          method: "GET",
          host: bareHost(url),
          port: url.port || (secure ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          signal,
          lookup: pinnedLookup(host),
          ...(secure ? { servername: isIP(host) ? undefined : host } : {}),
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            "accept-encoding": "gzip, deflate, br",
            ...(cookie ? { cookie } : {}),
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const setCookies = (res.headers["set-cookie"] ?? []).map(
            (line) => line.split(";")[0] as string,
          );
          const location = res.headers.location;
          if (REDIRECT_STATUSES.has(status) && location) {
            res.destroy();
            resolvePage({ status, headers: res.headers, body: "", redirect: location, setCookies });
            return;
          }
          const decoder = decoderFor(res.headers["content-encoding"]);
          const source = decoder ? res.pipe(decoder) : res;
          const chunks: Buffer[] = [];
          let received = 0;
          const finish = () =>
            resolvePage({
              status,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
              redirect: null,
              setCookies,
            });
          source.on("data", (chunk: Buffer) => {
            received += chunk.length;
            chunks.push(chunk);
            if (received >= maxBytes) {
              res.destroy();
              source.destroy();
              finish();
            }
          });
          source.on("end", finish);
          source.on("error", reject);
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  async function run(url: string, allowedDomains: readonly string[]): Promise<FollowResult> {
    if (url.length > MAX_URL_LENGTH) throw new Refusal("The link is too long.");
    if (allowedDomains.length === 0) throw new Refusal("No site is allowed for this link.");
    let current: URL;
    try {
      current = new URL(url);
    } catch {
      throw new Refusal("The link is not a valid address.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const jar = new Map<string, Map<string, string>>();
    try {
      for (let hop = 0; hop <= maxRedirects; hop += 1) {
        checkUrl(current, allowedDomains);
        const cookies = jar.get(current.host);
        const page = await request(
          current,
          cookies ? [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") : null,
          controller.signal,
        );
        if (page.setCookies.length > 0) {
          const store = jar.get(current.host) ?? new Map<string, string>();
          for (const pair of page.setCookies) {
            const at = pair.indexOf("=");
            if (at > 0) store.set(pair.slice(0, at), pair.slice(at + 1));
          }
          jar.set(current.host, store);
        }

        if (page.redirect !== null) {
          try {
            current = new URL(page.redirect, current);
          } catch {
            throw new Refusal("The page redirected to an address that is not valid.");
          }
          continue;
        }
        return judge(current.href, page);
      }
      throw new Refusal("The link redirected too many times.");
    } finally {
      clearTimeout(timer);
    }
  }

  function judge(finalUrl: string, page: Page): FollowResult {
    const html = /text\/html|application\/xhtml\+xml/i.test(
      String(page.headers["content-type"] ?? ""),
    );
    const analysis = html ? analyzePage(page.body) : null;
    const challengeHeader =
      String(page.headers["cf-mitigated"] ?? "").toLowerCase() === "challenge";

    if (page.status >= 400) {
      const blocked =
        [403, 429, 503].includes(page.status) && (challengeHeader || analysis?.challenge === true);
      return {
        ok: false,
        finalUrl,
        status: page.status,
        needsBrowser: blocked,
        reason: blocked
          ? "The site wants proof that a person is visiting."
          : `The page answered with status ${page.status}.`,
      };
    }
    const reached = { ok: true, finalUrl, status: page.status, needsBrowser: false, reason: null };
    if (!analysis) return reached;
    if (analysis.challenge) {
      return { ...reached, needsBrowser: true, reason: "The page asks for a human check." };
    }
    if (analysis.invalidLink) {
      return {
        ...reached,
        ok: false,
        reason: "The page says the link has expired or is not valid.",
      };
    }
    if (analysis.needsButtonPress) {
      return {
        ...reached,
        needsBrowser: true,
        reason: "The page needs a button pressed to finish.",
      };
    }
    if (analysis.needsScript) {
      return {
        ...reached,
        needsBrowser: true,
        reason: "The page needs a browser to run its script.",
      };
    }
    return reached;
  }

  return {
    async follow(url, allowedDomains) {
      try {
        return await run(url, allowedDomains);
      } catch (error) {
        return failure(error);
      }
    },
  };
}

function failure(error: unknown): FollowResult {
  const fail = (reason: string): FollowResult => ({
    ok: false,
    finalUrl: null,
    status: null,
    needsBrowser: false,
    reason,
  });
  if (error instanceof Refusal) return fail(error.message);
  const record = (error ?? {}) as { name?: string; code?: string; cause?: unknown };
  if (record.name === "AbortError" || record.code === "ABORT_ERR") {
    return fail("The page took too long to answer.");
  }
  if (record.code === "ENOTFOUND" || record.code === "EAI_AGAIN") {
    return fail("The site's address could not be found.");
  }
  if (record.code === "ECONNREFUSED" || record.code === "ECONNRESET") {
    return fail("The site refused the connection.");
  }
  if (typeof record.code === "string" && /CERT|TLS|SSL/.test(record.code)) {
    return fail("The site's certificate could not be trusted.");
  }
  if (record.cause instanceof Refusal) return fail(record.cause.message);
  return fail("The link could not be followed.");
}
