import { z } from "zod";
import { WebUrl } from "./url.js";

/**
 * What a site did that says "slow down". The first three are read off the main document's HTTP
 * status, the others off the page itself.
 */
export const PushbackKind = z.enum([
  "rate_limited",
  "forbidden",
  "unavailable",
  "challenge",
  "captcha",
  "access_denied",
]);
export type PushbackKind = z.infer<typeof PushbackKind>;

/** The longest a site's own Retry-After is believed, so a hostile value cannot park a domain for good. */
export const MAX_RETRY_AFTER_SECONDS = 7 * 24 * 60 * 60;

export const Pushback = z.object({
  kind: PushbackKind,
  /** The HTTP status of the main document, when the signal came from one. */
  status: z.number().int().min(100).max(599).optional(),
  /** The site's Retry-After, already turned into seconds from now. */
  retryAfterSeconds: z.number().int().nonnegative().max(MAX_RETRY_AFTER_SECONDS).optional(),
});
export type Pushback = z.infer<typeof Pushback>;

/** What a run noticed about the site that the server needs to pace the next visit. */
export const SiteObservation = z.object({
  pushback: Pushback.optional(),
  /** The Crawl-delay the site's robots.txt sets for everyone, in seconds. */
  crawlDelaySeconds: z.number().min(0).max(3600).optional(),
});
export type SiteObservation = z.infer<typeof SiteObservation>;

const minutes = z.number().int().min(0).max(1440);
const hourOfDay = z.number().int().min(0).max(23);
/** Whether the runtime knows this IANA zone, such as `America/Los_Angeles`. */
export function isValidTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const TimeZoneName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Use a time zone such as America/Los_Angeles" });

const reuseHours = z
  .number()
  .int()
  .min(0)
  .max(24 * 14);

/** How carefully the browser tasks treat the sites they visit. The defaults are justified in docs/scanning.md. */
export const ScanningSettings = z.object({
  /** The least time between two task starts on one site, before jitter. */
  minGapMinutes: minutes.default(20),
  /** Extra random wait on top of the gap, as a percentage of it. */
  gapJitterPercent: z.number().int().min(0).max(200).default(50),
  /** Task starts one site may get in a rolling day. */
  dailyCapPerSite: z.number().int().min(1).max(100).default(6),
  /** Task starts across all sites in a rolling hour. */
  hourlyCapTotal: z.number().int().min(1).max(500).default(12),
  /** Task starts across all sites in a rolling day, so the hourly pace cannot run around the clock. */
  dailyCapTotal: z.number().int().min(1).max(2000).default(60),
  /**
   * The time zone quiet hours are read in. Null means the zone the server process runs in, which
   * is UTC in a container unless TZ is set.
   */
  timeZone: TimeZoneName.nullable().default(null),
  /** The hour of the day, in the time zone above, from which no browser task starts. */
  quietStartHour: hourOfDay.default(23),
  /** The hour of the day, in the time zone above, at which browser tasks may start again. Equal to the start means no quiet hours. */
  quietEndHour: hourOfDay.default(7),
  /** How long a finished search for the same person on the same site is reused. Zero turns reuse off. */
  reuseHours: reuseHours.default(24),
  /** The first cooldown after a site pushes back. It doubles with each repeat. */
  backoffBaseHours: z.number().int().min(1).max(168).default(6),
  backoffMaxHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),
  /** Pushbacks in a row after which the site is paused until a single probe works. */
  breakerThreshold: z.number().int().min(2).max(10).default(3),
});
export type ScanningSettings = z.infer<typeof ScanningSettings>;

export const ScanningPatch = z.object({
  minGapMinutes: minutes.optional(),
  gapJitterPercent: z.number().int().min(0).max(200).optional(),
  dailyCapPerSite: z.number().int().min(1).max(100).optional(),
  hourlyCapTotal: z.number().int().min(1).max(500).optional(),
  dailyCapTotal: ScanningSettings.shape.dailyCapTotal.optional(),
  timeZone: TimeZoneName.nullable().optional(),
  quietStartHour: ScanningSettings.shape.quietStartHour.optional(),
  quietEndHour: ScanningSettings.shape.quietEndHour.optional(),
  reuseHours: reuseHours.optional(),
  backoffBaseHours: ScanningSettings.shape.backoffBaseHours.optional(),
  backoffMaxHours: ScanningSettings.shape.backoffMaxHours.optional(),
  breakerThreshold: ScanningSettings.shape.breakerThreshold.optional(),
});
export type ScanningPatch = z.infer<typeof ScanningPatch>;

/** An http proxy the person runs, such as a gluetun container. Credentials are not accepted in the address. */
export const ProxyUrl = WebUrl.refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && url.username === "" && url.password === "";
    } catch {
      return false;
    }
  },
  { message: "Use an http:// address without a user name or password" },
);

const SiteDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, "Use a domain such as spokeo.com");

export const EgressSettings = z.object({
  proxyUrl: ProxyUrl.nullable().default(null),
  /** The sites that use the proxy. Empty means every site once a proxy is set. */
  domains: z.array(SiteDomain).max(100).default([]),
});
export type EgressSettings = z.infer<typeof EgressSettings>;

export const EgressPatch = z.object({
  proxyUrl: ProxyUrl.nullable().optional(),
  domains: z.array(SiteDomain).max(100).optional(),
});
export type EgressPatch = z.infer<typeof EgressPatch>;

/** Why a queued task is waiting, when the reason is that Kick Rocks is being polite to a site. */
export const WaitReason = z.enum([
  "site_busy",
  "site_gap",
  "site_daily_cap",
  "hourly_cap",
  "daily_cap",
  "quiet_hours",
  "site_cooldown",
  "site_breaker",
]);
export type WaitReason = z.infer<typeof WaitReason>;

/** Why a task is waiting, in words that finish "Waiting because ...". */
export const WAIT_REASON_TEXT: Record<WaitReason, string> = {
  site_busy: "another task is already running on that site",
  site_gap: "visits to that site are spaced out",
  site_daily_cap: "that site has had its visits for the day",
  hourly_cap: "the hourly limit across all sites is used up",
  daily_cap: "the daily limit across all sites is used up",
  quiet_hours: "browser tasks do not start during quiet hours",
  site_cooldown: "that site asked to be left alone for a while",
  site_breaker: "that site is paused after repeated pushback",
};

export const TaskWaiting = z.object({
  reason: WaitReason,
  domain: z.string(),
  until: z.iso.datetime(),
});
export type TaskWaiting = z.infer<typeof TaskWaiting>;

export const BreakerState = z.enum(["closed", "open", "half_open"]);
export type BreakerState = z.infer<typeof BreakerState>;

/** What Kick Rocks knows about how a site has been treated. The key is the site's owner domain. */
export const SiteStatus = z.object({
  domain: z.string(),
  visitsToday: z.number().int().nonnegative(),
  dailyCap: z.number().int().positive(),
  lastVisitAt: z.iso.datetime().nullable(),
  lastPushbackAt: z.iso.datetime().nullable(),
  lastPushbackKind: PushbackKind.nullable(),
  consecutivePushback: z.number().int().nonnegative(),
  coolingDownUntil: z.iso.datetime().nullable(),
  breaker: BreakerState,
  nextStartAfter: z.iso.datetime().nullable(),
  crawlDelaySeconds: z.number().nullable(),
});
export type SiteStatus = z.infer<typeof SiteStatus>;

export const SitesStatus = z.object({
  items: z.array(SiteStatus),
  visitsLastHour: z.number().int().nonnegative(),
  hourlyCap: z.number().int().positive(),
});
export type SitesStatus = z.infer<typeof SitesStatus>;

/** The route a target's detail page asks for. Null when nothing has visited the site yet. */
export const TargetSite = z.object({ site: SiteStatus.nullable() });
export type TargetSite = z.infer<typeof TargetSite>;

/** Whether a site is being left alone right now, which is what a person wants to know at a glance. */
export function isCoolingDown(site: Pick<SiteStatus, "coolingDownUntil" | "breaker">): boolean {
  return site.coolingDownUntil !== null || site.breaker !== "closed";
}

/** Whether an hour of the day falls in the quiet window, which may run past midnight. */
export function isQuietHour(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/** The clock time in a zone, or in the process's own zone when none is named. */
export function clockIn(
  date: Date,
  timeZone: string | null,
): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(timeZone ? { timeZone } : {}),
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return { hour: part("hour"), minute: part("minute"), second: part("second") };
}

/** The next moment the clock in a zone reads the given whole hour. */
export function nextHourIn(date: Date, hour: number, timeZone: string | null): Date {
  const clock = clockIn(date, timeZone);
  const nowSeconds = clock.hour * 3600 + clock.minute * 60 + clock.second;
  let wait = hour * 3600 - nowSeconds;
  if (wait <= 0) wait += 24 * 3600;
  return new Date(date.getTime() - date.getMilliseconds() + wait * 1000);
}

/** Pushback the site's own status line says, with no need to read the page. */
export function pushbackKindForStatus(status: number): PushbackKind | null {
  if (status === 429) return "rate_limited";
  if (status === 403) return "forbidden";
  if (status === 503) return "unavailable";
  return null;
}

/**
 * Pushback in the answer to a background request (XHR or fetch). A 403 there is often a harmless
 * auth check, so only a rate limit, an outage, or a bot-management challenge counts.
 */
export function backgroundPushbackKind(status: number, challenged: boolean): PushbackKind | null {
  if (challenged) return "challenge";
  return status === 429 || status === 503 ? pushbackKindForStatus(status) : null;
}

/**
 * Reads a Retry-After header, which is either a number of seconds or an HTTP date, as seconds from
 * now. Anything unreadable or in the past is ignored, and a huge value is cut to the longest one
 * believed.
 */
export function parseRetryAfter(value: string | null | undefined, now: Date): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const seconds = /^\d+$/.test(text) ? Number(text) : (Date.parse(text) - now.getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

/** Suffixes under which a registrable domain has three labels, such as `example.co.uk`. */
const COMPOUND_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "com.au",
  "co.nz",
  "co.za",
  "com.br",
  "co.jp",
  "co.in",
]);

/** `www.spokeo.com` and `api.spokeo.com` are both `spokeo.com`. */
export function registrableDomain(host: string): string {
  const labels = host
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter((label) => label !== "");
  if (labels.length <= 2) return labels.join(".");
  const tail = labels.slice(-2).join(".");
  return labels.slice(COMPOUND_SUFFIXES.has(tail) ? -3 : -2).join(".");
}

/**
 * The key politeness is counted under. Sister domains that share an operator share a key, which
 * the broker dataset names in `ownerGroup`. Without one, a broker whose confirmation mail comes
 * from another registrable domain (one on `peopleconnect.us` runs on that platform) takes that
 * domain, and otherwise the key is the domain itself.
 */
export function siteOwnerKey(
  domain: string,
  replyDomains: readonly string[] = [],
  ownerGroup?: string,
): string {
  if (ownerGroup) return ownerGroup;
  const own = registrableDomain(domain);
  for (const reply of replyDomains) {
    const sister = registrableDomain(reply);
    if (sister !== own) return sister;
  }
  return own;
}

/** A queued task that shows why it has not started, for the review page. */
export const WaitingTask = z.object({
  taskId: z.string(),
  kind: z.string(),
  targetId: z.string().nullable(),
  targetName: z.string().nullable(),
  waiting: TaskWaiting,
});
export type WaitingTask = z.infer<typeof WaitingTask>;
