import {
  API_ROUTES,
  type FormOutcome,
  type ReviewQueue,
  type TaskSummary,
} from "@kickrocks/shared";

export const REVIEW_TABS = [
  "blocked",
  "matches",
  "verifications",
  "mail",
  "failed",
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
];

export function tabCounts(queue: ReviewQueue): Record<Exclude<ReviewTab, "scans">, number> {
  return {
    blocked: queue.blockedTasks.length,
    matches: queue.matches.length,
    verifications: queue.verifications.length,
    mail: queue.messages.length,
    failed: queue.failedTasks.length,
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
