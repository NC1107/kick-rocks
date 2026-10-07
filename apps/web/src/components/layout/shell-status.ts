import type { Dashboard, SettingsView } from "@kickrocks/shared";
import type { Family } from "../../lib/tone.js";
import { workerState } from "../../pages/settings/model.js";

export interface StatusChip {
  id: "worker" | "inbox" | "sends";
  tone: Family;
  /** The words before the value. */
  label: string;
  /** The part set in mono: a count or a time. */
  value?: string;
}

const SEVERITY: Record<Family, number> = { positive: 0, neutral: 1, attention: 2, danger: 3 };
const NEAR_LIMIT = 0.8;

export function workerChip(worker: SettingsView["worker"], now: number): StatusChip {
  const states = [worker.builtin, worker.model].map((status) =>
    workerState(status?.lastSeenAt ?? null, now),
  );
  if (!worker.enabled || states.every((state) => state === "never")) {
    return { id: "worker", tone: "neutral", label: "No worker" };
  }
  if (states.includes("online")) return { id: "worker", tone: "positive", label: "Worker online" };
  return { id: "worker", tone: "attention", label: "Worker offline" };
}

export function inboxChip(
  mailbox: Dashboard["mailbox"],
  formatAgo: (iso: string) => string,
): StatusChip {
  if (!mailbox) return { id: "inbox", tone: "neutral", label: "No mailbox" };
  if (mailbox.lastError) return { id: "inbox", tone: "attention", label: "Inbox unreachable" };
  if (!mailbox.lastPolledAt) return { id: "inbox", tone: "neutral", label: "Inbox not checked" };
  return {
    id: "inbox",
    tone: "positive",
    label: "Inbox",
    value: formatAgo(mailbox.lastPolledAt),
  };
}

export function sendsChip(sending: Dashboard["sending"]): StatusChip | null {
  if (!sending) return null;
  const used = sending.cap > 0 ? sending.sent / sending.cap : 1;
  return {
    id: "sends",
    tone: used >= NEAR_LIMIT ? "attention" : "neutral",
    label: "Sent",
    value: `${sending.sent}/${sending.cap} today`,
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
