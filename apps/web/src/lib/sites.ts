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

/** One line on what happened last and what happens next, for a site that is being left alone. */
export function describeCooldown(
  site: Pick<
    SiteStatus,
    "breaker" | "coolingDownUntil" | "lastPushbackKind" | "consecutivePushback"
  >,
): string {
  const cause = site.lastPushbackKind
    ? PUSHBACK_LABELS[site.lastPushbackKind].toLowerCase()
    : "pushback";
  if (site.breaker === "half_open") {
    return `Paused after repeated ${cause}. The next visit is a single careful try.`;
  }
  if (site.breaker === "open")
    return `Paused after ${site.consecutivePushback} ${cause}s in a row.`;
  return `Left alone after ${cause}.`;
}

/** What to call a site right now: a closed breaker with a cooldown running is cooling down, not open. */
export function siteLabel(site: Pick<SiteStatus, "breaker" | "coolingDownUntil">): string {
  if (site.breaker === "closed" && site.coolingDownUntil !== null) return "Cooling down";
  return BREAKER_LABELS[site.breaker];
}
