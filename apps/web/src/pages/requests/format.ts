import type { RequestRight } from "@kickrocks/shared";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What a request asked for, as the mono tokens the ledger prints. */
export const RIGHT_TOKENS: Record<RequestRight, string> = {
  opt_out: "opt-out",
  delete: "delete",
};

/**
 * "7m ago", "2h ago", "yesterday", "in 12d", "next month": short enough for a ledger column,
 * with the exact time left to a tooltip.
 */
export function shortRelative(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "now";
  const future = diff > 0;
  const wrap = (amount: string) => (future ? `in ${amount}` : `${amount} ago`);

  if (abs < HOUR) return wrap(`${Math.round(abs / MINUTE)}m`);
  if (abs < DAY) return wrap(`${Math.round(abs / HOUR)}h`);
  const days = Math.round(abs / DAY);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 14) return wrap(`${days}d`);
  if (days < 60) {
    if (future && days >= 30) return "next month";
    return wrap(`${Math.round(days / 7)}w`);
  }
  const months = Math.round(days / 30);
  if (months < 12) return wrap(`${months}mo`);
  return wrap(`${Math.round(days / 365)}y`);
}

/** "09:02" for today and "Oct 6" for an earlier day, the labels in a timeline's time gutter. */
export function gutterTime(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  }
  const sameYear = at.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
}
