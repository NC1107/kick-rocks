import type { BreakerState, PushbackKind, SiteStatus } from "@kickrocks/shared";
import type { Tone } from "./tone.js";

export const PUSHBACK_LABELS: Record<PushbackKind, string> = {
  rate_limited: "Too many requests",
  forbidden: "Refused the browser",
  unavailable: "Unavailable",
  challenge: "Bot check",
  captcha: "CAPTCHA",
  access_denied: "Access denied",
};

export const BREAKER_LABELS: Record<BreakerState, string> = {
  closed: "Open for visits",
  open: "Paused",
  half_open: "Trying one visit",
};

export function siteTone(site: Pick<SiteStatus, "breaker" | "coolingDownUntil">): Tone {
  if (site.breaker === "open") return "danger";
  return site.breaker === "half_open" || site.coolingDownUntil !== null ? "attention" : "positive";
}

interface Noun {
  article: "a" | "an";
  singular: string;
  plural: string;
}

/** What each kind of pushback is called inside a sentence. */
const PUSHBACK_NOUNS: Record<PushbackKind, Noun> = {
  rate_limited: { article: "a", singular: "rate limit", plural: "rate limits" },
  forbidden: { article: "a", singular: "refusal", plural: "refusals" },
  unavailable: { article: "an", singular: "outage", plural: "outages" },
  challenge: { article: "a", singular: "bot check", plural: "bot checks" },
  captcha: { article: "a", singular: "CAPTCHA", plural: "CAPTCHAs" },
  access_denied: { article: "an", singular: "access denial", plural: "access denials" },
};

const UNKNOWN_NOUN: Noun = { article: "a", singular: "pushback", plural: "pushbacks" };

/** One line on what happened last and what happens next, for a site that is being left alone. */
export function describeCooldown(
  site: Pick<
    SiteStatus,
    "breaker" | "coolingDownUntil" | "lastPushbackKind" | "consecutivePushback"
  >,
): string {
  const noun = site.lastPushbackKind ? PUSHBACK_NOUNS[site.lastPushbackKind] : UNKNOWN_NOUN;
  if (site.breaker === "half_open") {
    return `Paused after repeated ${noun.plural}. The next visit is a single careful try.`;
  }
  if (site.breaker === "open") {
    const count = site.consecutivePushback;
    return `Paused after ${count} ${count === 1 ? noun.singular : noun.plural} in a row.`;
  }
  return `Left alone after ${noun.article} ${noun.singular}.`;
}

/** What to call a site right now: a closed breaker with a cooldown running is cooling down, not open. */
export function siteLabel(site: Pick<SiteStatus, "breaker" | "coolingDownUntil">): string {
  if (site.breaker === "closed" && site.coolingDownUntil !== null) return "Cooling down";
  return BREAKER_LABELS[site.breaker];
}
