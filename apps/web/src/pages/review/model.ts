import {
  API_ROUTES,
  type BlockedTaskItem,
  type FormOutcome,
  type ReviewMessage,
  type ReviewQueue,
  type TaskSummary,
} from "@kickrocks/shared";
import { describeFailure, type FailureGroup } from "../../lib/failures.js";
import type { ReviewSection } from "../../lib/paths.js";

/** The pages of Review beside the focused Needs you queue. */
export const REVIEW_SECTIONS = ["mail", "agents", "problems", "scans"] as const;

/** Queued agent tasks the person took for themselves, which no agent will claim. */
export const isYours = (item: BlockedTaskItem): boolean =>
  item.task.assignment?.to.kind === "person";

/** How many items each Review page lists, for the number beside its tab. */
export function sectionCounts(queue: ReviewQueue): Record<Exclude<ReviewSection, "scans">, number> {
  return {
    mail: queue.messages.length,
    agents: queue.agentTasks.filter((item) => !isYours(item)).length,
    problems: queue.failedTasks.length,
  };
}

/** Routes whose answers change when a task, match, or message is dealt with. */
export const REVIEW_INVALIDATES = [
  API_ROUTES.reviewQueue,
  API_ROUTES.needsYouGet,
  API_ROUTES.requestsList,
  API_ROUTES.requestsGet,
  API_ROUTES.dashboardGet,
  API_ROUTES.scansList,
  API_ROUTES.agentsList,
] as const;

/** Task kinds an agent can take over, which is every kind that drives a website. */
export function canHandOff(task: Pick<TaskSummary, "kind">): boolean {
  return task.kind === "scan" || task.kind === "form" || task.kind === "agent";
}

/** A model stopped before sending a form because it has not passed the safety gate here. */
export function awaitsSubmitApproval(
  task: Pick<TaskSummary, "kind" | "status" | "blockedReason">,
): boolean {
  return (
    task.kind === "agent" && task.status === "blocked" && task.blockedReason === "approval_needed"
  );
}

/**
 * A model reported a sent form that no one approved. The form may be out, so the person checks the
 * site, and running the task again could send it twice.
 */
export function sentWithoutApproval(
  task: Pick<TaskSummary, "kind" | "status" | "blockedReason">,
): boolean {
  return (
    task.kind === "agent" && task.status === "blocked" && task.blockedReason === "unapproved_submit"
  );
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

/** What the list pages group their rows by. */
export type ReviewKind = "mail" | "failed" | "agents";

/** Group labels in the list, in the order the groups appear. */
export const KIND_LABELS: Record<ReviewKind, string> = {
  mail: "Unsorted mail",
  failed: "Problems",
  agents: "Waiting for an agent",
};

/** Which kinds of row each list page holds. */
export const SECTION_KINDS: Record<Exclude<ReviewSection, "scans">, readonly ReviewKind[]> = {
  mail: ["mail"],
  agents: ["agents"],
  problems: ["failed"],
};

export type QueueEntry =
  | { kind: "failed" | "agents"; key: string; item: BlockedTaskItem }
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

/** Every row the list pages show as one flat list, grouped by kind in the order of KIND_LABELS. */
export function buildEntries(queue: ReviewQueue): QueueEntry[] {
  return [
    ...queue.messages.map(
      (message): QueueEntry => ({ kind: "mail", key: `mail:${message.id}`, message }),
    ),
    ...sortFailures(queue.failedTasks).map(
      (item): QueueEntry => ({ kind: "failed", key: `failed:${item.task.id}`, item }),
    ),
    ...queue.agentTasks
      .filter((item) => !isYours(item))
      .map((item): QueueEntry => ({ kind: "agents", key: `agent:${item.task.id}`, item })),
  ];
}

/**
 * The entry the address points at: the named item, else the one now at its old position, so
 * dealing with an item moves on to the next.
 */
export function pickEntry(
  entries: readonly QueueEntry[],
  { item, lastIndex }: { item: string | null; lastIndex: number },
): QueueEntry | null {
  const named = item ? entries.find((entry) => entry.key === item) : undefined;
  if (named) return named;
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
