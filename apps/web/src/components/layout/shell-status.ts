import {
  type Dashboard,
  isCoolingDown,
  type SettingsView,
  type SiteStatus,
} from "@kickrocks/shared";
import { pluralize } from "../../lib/format.js";
import { paths } from "../../lib/paths.js";
import type { Family } from "../../lib/tone.js";
import { workerState } from "../../pages/settings/model.js";
import { fixableHeldScans } from "../holds/hold-text.js";

export interface StatusChip {
  id: "worker" | "inbox" | "sends" | "sites";
  tone: Family;
  /** The words before the value. */
  label: string;
  /** The part set in mono: a count or a time. */
  value?: string;
  /** The page that explains the chip and changes what it shows. */
  to: string;
}

const SEVERITY: Record<Family, number> = { positive: 0, neutral: 1, attention: 2, danger: 3 };
const NEAR_LIMIT = 0.8;

export function workerChip(
  worker: SettingsView["worker"],
  now: number,
  scans?: Pick<Dashboard["scans"], "byReason"> | null,
): StatusChip {
  const to = paths.settings("worker");
  const states = [worker.builtin, worker.model].map((status) =>
    workerState(status?.lastSeenAt ?? null, now),
  );
  if (!worker.enabled || states.every((state) => state === "never")) {
    return { id: "worker", tone: "neutral", label: "No worker", to };
  }
  if (states.includes("online")) {
    // Pacing holds clear by themselves, so only work that waits on the person turns the chip.
    const fixable = scans ? fixableHeldScans(scans) : 0;
    return fixable > 0
      ? { id: "worker", tone: "attention", label: "Worker idle", value: `${fixable} held`, to }
      : { id: "worker", tone: "positive", label: "Worker online", to };
  }
  return { id: "worker", tone: "attention", label: "Worker offline", to };
}

export function inboxChip(
  mailbox: Dashboard["mailbox"],
  formatAgo: (iso: string) => string,
  profileId: string,
): StatusChip {
  const to = paths.mailbox(profileId);
  if (!mailbox) return { id: "inbox", tone: "neutral", label: "No mailbox", to };
  if (mailbox.lastError) return { id: "inbox", tone: "attention", label: "Inbox unreachable", to };
  if (!mailbox.lastPolledAt)
    return { id: "inbox", tone: "neutral", label: "Inbox not checked", to };
  return {
    id: "inbox",
    tone: "positive",
    label: "Inbox",
    value: formatAgo(mailbox.lastPolledAt),
    to,
  };
}

export function sendsChip(sending: Dashboard["sending"], profileId: string): StatusChip | null {
  if (!sending) return null;
  const used = sending.cap > 0 ? sending.sent / sending.cap : 1;
  return {
    id: "sends",
    tone: used >= NEAR_LIMIT ? "attention" : "neutral",
    label: "Sent",
    value: `${sending.sent} of ${sending.cap} today`,
    to: paths.mailbox(profileId),
  };
}

/** Nothing while every site is open for visits, so the chip is a reason to look, not a fixture. */
export function sitesChip(
  sites: readonly Pick<SiteStatus, "coolingDownUntil" | "breaker">[],
): StatusChip | null {
  const cooling = sites.filter(isCoolingDown).length;
  if (cooling === 0) return null;
  return {
    id: "sites",
    tone: "attention",
    label: "Cooling down",
    value: pluralize(cooling, "site"),
    to: paths.settings("sites"),
  };
}

/**
 * The chip that most needs a look, for the phone top bar where there is room for one mark.
 * Nothing is returned while everything is fine, so the bar stays quiet until it has news.
 */
export function mostUrgent(chips: readonly StatusChip[]): StatusChip | undefined {
  const worst = chips.reduce<StatusChip | undefined>(
    (found, chip) => (!found || SEVERITY[chip.tone] > SEVERITY[found.tone] ? chip : found),
    undefined,
  );
  return worst && SEVERITY[worst.tone] >= SEVERITY.attention ? worst : undefined;
}

/** A release reads as "v0.3.1"; a commit hash from an untagged checkout is shown as it is, since a "v" would make it look like a release. */
export function versionLabel(version: string): string {
  return /^\d+\.\d+/.test(version) ? `v${version}` : version;
}
