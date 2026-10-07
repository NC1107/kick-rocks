import {
  API_ROUTES,
  type BlockedTaskItem,
  type FormOutcome,
  type Match,
  type ReviewMessage,
  type ReviewQueue,
  type TaskSummary,
  type VerificationItem,
} from "@kickrocks/shared";
import { describeFailure, type FailureGroup } from "../../lib/failures.js";

export const REVIEW_TABS = [
  "blocked",
  "matches",
  "verifications",
  "mail",
  "failed",
  "agents",
  "scans",
] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export function parseTab(value: string | null): ReviewTab | null {
  return REVIEW_TABS.find((tab) => tab === value) ?? null;
}

/** Tabs that hold something for the person, in the order they are worth looking at. */
const WORTH_OPENING: readonly Exclude<ReviewTab, "scans">[] = [
  "blocked",
  "matches",
  "verifications",
  "mail",
  "failed",
  "agents",
];

export function tabCounts(queue: ReviewQueue): Record<Exclude<ReviewTab, "scans">, number> {
  return {
    blocked: queue.blockedTasks.length,
    matches: queue.matches.length,
    verifications: queue.verifications.length,
    mail: queue.messages.length,
    failed: queue.failedTasks.length,
    agents: queue.agentTasks.length,
  };
}

/** The tab to open when the address names none: the first one with something waiting. */
export function firstBusyTab(queue: ReviewQueue): ReviewTab {
  const counts = tabCounts(queue);
  return WORTH_OPENING.find((tab) => counts[tab] > 0) ?? "blocked";
}

/** Routes whose answers change when a task, match, or message is dealt with. */
export const REVIEW_INVALIDATES = [
  API_ROUTES.reviewQueue,
  API_ROUTES.requestsList,
  API_ROUTES.requestsGet,
  API_ROUTES.dashboardGet,
  API_ROUTES.scansList,
] as const;

/** Task kinds an agent can take over, which is every kind that drives a website. */
export function canHandOff(task: Pick<TaskSummary, "kind">): boolean {
  return task.kind === "scan" || task.kind === "form" || task.kind === "agent";
}

/** A person can report how a removal ended only for tasks that belong to a request. */
export function canReportOutcome(task: Pick<TaskSummary, "kind" | "requestId">): boolean {
  return (task.kind === "form" || task.kind === "agent") && task.requestId !== null;
}

export const OUTCOME_CHOICES: readonly { value: FormOutcome; label: string; hint: string }[] = [
  { value: "submitted", label: "I submitted the form", hint: "The target now has to answer." },
  {
    value: "awaiting_email_confirmation",
    label: "It is waiting for a confirmation email",
    hint: "Kick Rocks follows the link when it arrives.",
  },
  { value: "not_found", label: "The site had no record of me", hint: "This closes the request." },
  {
    value: "already_removed",
    label: "The record was already gone",
    hint: "This closes the request.",
  },
];

/**
 * Breaks instructions into steps: one per line when the text has lines, otherwise one per
 * sentence, with any "1." numbering removed so the list supplies its own.
 */
export function instructionSteps(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, "").trim())
    .filter(Boolean);
  const steps = lines.length > 1 ? lines : (lines[0] ?? "").split(/(?<=[.!?])\s+/);
  return steps.map((step) => step.trim()).filter(Boolean);
}

export type ReviewKind = Exclude<ReviewTab, "scans">;

/** Section labels in the list, in the order the sections appear. */
export const KIND_LABELS: Record<ReviewKind, string> = {
  blocked: "Blocked",
  matches: "Records",
  verifications: "Details asked",
  mail: "Unsorted mail",
  failed: "Failed",
  agents: "Waiting for an agent",
};

export const SCANS_KEY = "scans";

export type QueueEntry =
  | { kind: "blocked" | "failed" | "agents"; key: string; item: BlockedTaskItem }
  | { kind: "matches"; key: string; match: Match }
  | { kind: "verifications"; key: string; item: VerificationItem }
  | { kind: "mail"; key: string; message: ReviewMessage };

/** Failed tasks sorted by cause, biggest group first, so one fix or one click covers many. */
export function sortFailures(items: readonly BlockedTaskItem[]): BlockedTaskItem[] {
  const groups = new Map<FailureGroup, BlockedTaskItem[]>();
  for (const item of items) {
    const { group } = describeFailure(item.task);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return [...groups]
    .sort(([a, aItems], [b, bItems]) => bItems.length - aItems.length || a.localeCompare(b))
    .flatMap(([, grouped]) => grouped);
}

/** Every waiting item as one flat list, grouped by kind in the order of KIND_LABELS. */
export function buildEntries(queue: ReviewQueue): QueueEntry[] {
  return [
    ...queue.blockedTasks.map(
      (item): QueueEntry => ({
        kind: "blocked",
        key: `blocked:${item.task.id}`,
        item,
      }),
    ),
    ...queue.matches.map(
      (match): QueueEntry => ({
        kind: "matches",
        key: `match:${match.id}`,
        match,
      }),
    ),
    ...queue.verifications.map(
      (item): QueueEntry => ({
        kind: "verifications",
        key: `details:${item.request.id}`,
        item,
      }),
    ),
    ...queue.messages.map(
      (message): QueueEntry => ({
        kind: "mail",
        key: `mail:${message.id}`,
        message,
      }),
    ),
    ...sortFailures(queue.failedTasks).map(
      (item): QueueEntry => ({
        kind: "failed",
        key: `failed:${item.task.id}`,
        item,
      }),
    ),
    ...queue.agentTasks.map(
      (item): QueueEntry => ({
        kind: "agents",
        key: `agent:${item.task.id}`,
        item,
      }),
    ),
  ];
}

/**
 * The entry the address points at: a named item, else the first of a named group, else the first
 * of all. When the named item is gone, the one that now sits at its old position, so deciding an
 * item moves on to the next.
 */
export function pickEntry(
  entries: readonly QueueEntry[],
  { item, tab, lastIndex }: { item: string | null; tab: string | null; lastIndex: number },
): QueueEntry | null {
  if (item) {
    const named = entries.find((entry) => entry.key === item);
    if (named) return named;
  } else if (tab) {
    const first = entries.find((entry) => entry.kind === tab);
    if (first) return first;
  }
  return entries[Math.min(Math.max(lastIndex, 0), entries.length - 1)] ?? null;
}

const AGE_STEPS = [
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
] as const;

/** "5m", "2h", "3d": how long an item has waited, short enough for the end of a list row. */
export function ageLabel(iso: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(iso).getTime());
  for (const [unit, size] of AGE_STEPS) {
    if (elapsed >= size) return `${Math.floor(elapsed / size)}${unit}`;
  }
  return "now";
}
