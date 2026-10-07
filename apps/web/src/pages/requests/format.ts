import type { RequestRight } from "@kickrocks/shared";

/** What a request asked for, as the mono tokens the ledger prints. */
export const RIGHT_TOKENS: Record<RequestRight, string> = {
  opt_out: "opt-out",
  delete: "delete",
};

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
