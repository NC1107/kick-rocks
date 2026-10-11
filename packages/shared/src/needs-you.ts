import { z } from "zod";
import { ProfileField } from "./identities.js";
import { Reference } from "./mail.js";
import type { BlockedReason } from "./outcomes.js";
import { BlockedTaskItem, VerificationItem } from "./review.js";
import { Match } from "./scans.js";
import type { TaskSummary } from "./tasks.js";
import { WebUrl } from "./url.js";

export const NeedsYouKind = z.enum([
  "hold",
  "approve",
  "check_sent",
  "captcha",
  "phone_code",
  "id",
  "email_link",
  "login",
  "bot",
  "by_hand",
  "record",
  "details",
]);
export type NeedsYouKind = z.infer<typeof NeedsYouKind>;

export const EffortBand = z.enum(["quick", "few", "longer"]);
export type EffortBand = z.infer<typeof EffortBand>;

/** How long each kind takes a person, so the queue can put the 10-second items first. */
export const NEEDS_YOU_EFFORT: Record<NeedsYouKind, { band: EffortBand; minutes: number }> = {
  hold: { band: "quick", minutes: 0.25 },
  record: { band: "quick", minutes: 0.25 },
  approve: { band: "quick", minutes: 0.5 },
  details: { band: "quick", minutes: 0.5 },
  email_link: { band: "few", minutes: 1 },
  check_sent: { band: "few", minutes: 2 },
  captcha: { band: "few", minutes: 2 },
  phone_code: { band: "few", minutes: 3 },
  bot: { band: "few", minutes: 3 },
  by_hand: { band: "longer", minutes: 5 },
  login: { band: "longer", minutes: 5 },
  id: { band: "longer", minutes: 5 },
};

const BAND_RANK: Record<EffortBand, number> = { quick: 0, few: 1, longer: 2 };

/** The details a person is likely to type into the page for each kind. */
export const NEEDS_YOU_CHIPS: Record<NeedsYouKind, readonly ProfileField[]> = {
  hold: [],
  approve: [],
  check_sent: [],
  captcha: ["full_name", "email"],
  phone_code: ["phone", "full_name"],
  id: ["full_name", "email"],
  email_link: ["email"],
  login: ["email", "full_name"],
  bot: ["full_name", "email"],
  by_hand: ["full_name", "email"],
  record: [],
  details: [],
};

const BLOCKED_KIND: Record<BlockedReason, NeedsYouKind> = {
  approval_needed: "approve",
  unapproved_submit: "check_sent",
  captcha: "captcha",
  phone_verification: "phone_code",
  id_upload: "id",
  email_verification: "email_link",
  login_required: "login",
  bot_detection: "bot",
  unknown: "by_hand",
};

/**
 * What a task asks of the person, or null when it asks nothing: a failed task is a problem, and
 * one waiting for an agent is the agent's to do. A leased task only reaches here with a live hold.
 */
export function kindOfTask(
  task: Pick<TaskSummary, "status" | "blockedReason" | "assignment">,
): NeedsYouKind | null {
  if (task.status === "leased") return "hold";
  if (task.status === "blocked") return BLOCKED_KIND[task.blockedReason ?? "unknown"];
  if (task.status === "queued" && task.assignment?.to.kind === "person") return "by_hand";
  return null;
}

export const NeedsYouSource = z.union([
  z.object({ task: BlockedTaskItem }),
  z.object({ match: Match }),
  z.object({ verification: VerificationItem }),
]);
export type NeedsYouSource = z.infer<typeof NeedsYouSource>;

export const NeedsYouItem = z.object({
  /** `task:<id>`, `match:<id>` or `details:<requestId>`. */
  key: z.string().min(1),
  kind: NeedsYouKind,
  /** Server rank, 0 first. */
  order: z.number().int().nonnegative(),
  effort: z.object({ band: EffortBand, minutes: z.number().positive() }),
  /** When it started needing the person. */
  since: z.iso.datetime(),
  /** Only a live hold runs out. */
  expiresAt: z.iso.datetime().nullable(),
  /** How many times the person said "Not yet". */
  tries: z.number().int().nonnegative(),
  lastTriedAt: z.iso.datetime().nullable(),
  /** The last "Open the page", so a return prompt survives a reload or another device. */
  openedAt: z.iso.datetime().nullable(),
  target: z.object({ id: z.string(), name: z.string() }).nullable(),
  requestReference: Reference.nullable(),
  url: WebUrl.nullable(),
  /** Which details to offer. Values come from the profile in the browser, never from here. */
  chips: z.array(ProfileField),
  source: NeedsYouSource,
});
export type NeedsYouItem = z.infer<typeof NeedsYouItem>;

export const NeedsYouSnoozed = z.object({
  key: z.string().min(1),
  kind: NeedsYouKind,
  title: z.string(),
  until: z.iso.datetime(),
});
export type NeedsYouSnoozed = z.infer<typeof NeedsYouSnoozed>;

const Count = z.number().int().nonnegative();

export const NeedsYouCounts = z.object({
  active: Count,
  snoozed: Count,
  /** Whole minutes, rounded up. */
  minutes: Count,
  quick: Count,
  few: Count,
  longer: Count,
});
export type NeedsYouCounts = z.infer<typeof NeedsYouCounts>;

export const NeedsYouQueue = z.object({
  items: z.array(NeedsYouItem),
  snoozed: z.array(NeedsYouSnoozed),
  counts: NeedsYouCounts,
});
export type NeedsYouQueue = z.infer<typeof NeedsYouQueue>;

/** The person-side state kept for one item. */
export const NeedsYouMark = z.object({
  key: z.string().min(1),
  snoozedUntil: z.iso.datetime().nullable(),
  openedAt: z.iso.datetime().nullable(),
  tries: Count,
  lastTriedAt: z.iso.datetime().nullable(),
});
export type NeedsYouMark = z.infer<typeof NeedsYouMark>;

export const NeedsYouRef = z.enum(["task", "match", "details"]);
export type NeedsYouRef = z.infer<typeof NeedsYouRef>;

export const NEEDS_YOU_MAX_SNOOZE_DAYS = 30;

export const NeedsYouParams = z.object({ kind: NeedsYouRef, id: z.string().min(1) });
export const NeedsYouSnoozeBody = z.object({ until: z.iso.datetime() });
export const NeedsYouNotYetBody = z.object({ note: z.string().trim().max(500).optional() });

/** The key an item goes by in the queue and in the address. */
export function needsYouKey(ref: NeedsYouRef, id: string): string {
  return `${ref}:${id}`;
}

/**
 * Holds first, soonest to run out first. Then the quick things before the slow ones, what the
 * person has not tried before what they marked "Not yet", the oldest first, and the key last so
 * the same input always gives the same order. Shared so the mock and the server cannot disagree.
 */
export function orderNeedsYou(items: readonly NeedsYouItem[], now: Date): NeedsYouItem[] {
  const at = now.getTime();
  const live = (item: NeedsYouItem) =>
    item.kind === "hold" && item.expiresAt !== null && new Date(item.expiresAt).getTime() > at;
  return [...items]
    .sort((a, b) => {
      const holdA = live(a);
      const holdB = live(b);
      if (holdA !== holdB) return holdA ? -1 : 1;
      if (holdA && holdB) {
        const byExpiry = (a.expiresAt as string).localeCompare(b.expiresAt as string);
        if (byExpiry !== 0) return byExpiry;
      }
      return (
        BAND_RANK[a.effort.band] - BAND_RANK[b.effort.band] ||
        a.tries - b.tries ||
        a.since.localeCompare(b.since) ||
        a.key.localeCompare(b.key)
      );
    })
    .map((item, order) => ({ ...item, order }));
}

/** The numbers the dashboard and the nav badge read, so neither can disagree with the queue. */
export function needsYouCounts(
  items: readonly Pick<NeedsYouItem, "effort">[],
  snoozed = 0,
): NeedsYouCounts {
  const minutes = items.reduce((sum, item) => sum + item.effort.minutes, 0);
  const inBand = (band: EffortBand) => items.filter((item) => item.effort.band === band).length;
  return {
    active: items.length,
    snoozed,
    minutes: Math.ceil(minutes),
    quick: inBand("quick"),
    few: inBand("few"),
    longer: inBand("longer"),
  };
}
