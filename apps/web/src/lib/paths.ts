import type { RequestStatus, TaskSummary } from "@kickrocks/shared";

const part = encodeURIComponent;

/** What the focused Needs you queue can open, as the `item` it is told to select. */
export type ReviewItemKey = `task:${string}` | `match:${string}` | `details:${string}`;

/** The review pages that list a kind of thing by itself, beside the Needs you queue. */
export type ReviewSection = "mail" | "agents" | "problems";

/** The item an open row of a review section is named by. */
export type ReviewSectionKey = `${"mail" | "failed" | "agent"}:${string}`;

export interface RequestsFilters {
  status?: RequestStatus | undefined;
  targetId?: string | undefined;
  profileId?: string | undefined;
  campaignId?: string | undefined;
}

/** The anchored sections on the main settings page. */
export const SETTINGS_SECTIONS = [
  "schedule",
  "site-checks",
  "scan-pace",
  "sites",
  "worker",
  "reply-model",
  "language-model",
  "mail-intake",
  "jurisdictions",
  "retention",
  "password",
  "reset",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Settings pages of their own. */
export type SettingsPage = "recipes" | "agents" | "notifications";

const SETTINGS_PAGES: ReadonlySet<SettingsPage | SettingsSection> = new Set([
  "recipes",
  "agents",
  "notifications",
]);

export type TaskRef = Pick<TaskSummary, "id" | "kind" | "status" | "requestId"> &
  Partial<Pick<TaskSummary, "assignment">>;

/**
 * Where a task can be looked at. A task that stopped or failed has a place in Review; any other
 * task is part of its request, so it opens there. Null for a task that is neither.
 */
export function taskPath(task: TaskRef): string | null {
  if (task.status === "blocked") return paths.reviewItem(`task:${task.id}`);
  if (task.status === "failed") return paths.reviewSection("problems", `failed:${task.id}`);
  if (task.status === "queued" && task.kind === "agent") {
    return task.assignment?.to.kind === "person"
      ? paths.reviewItem(`task:${task.id}`)
      : paths.reviewSection("agents", `agent:${task.id}`);
  }
  return task.requestId ? `/requests/${part(task.requestId)}` : null;
}

/** Where each kind of thing lives, so no page builds an address by hand. */
export const paths = {
  profile: (id: string) => `/profiles/${part(id)}`,
  mailbox: (profileId: string) => `/profiles/${part(profileId)}/mailbox`,
  target: (id: string) => `/targets/${part(id)}`,
  findings: (show?: string) => (show ? `/findings?show=${part(show)}` : "/findings"),
  /** The old listings address, which redirects to the findings page. */
  listings: (show?: string) =>
    show ? `/targets/listings?show=${part(show)}` : "/targets/listings",
  targetRemove: (id: string) => `/targets/${part(id)}/remove`,
  request: (id: string) => `/requests/${part(id)}`,
  requests: (filters: RequestsFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.targetId) query.set("targetId", filters.targetId);
    if (filters.profileId) query.set("profileId", filters.profileId);
    if (filters.campaignId) query.set("campaignId", filters.campaignId);
    const text = query.toString();
    return text ? `/requests?${text}` : "/requests";
  },
  review: () => "/review",
  reviewSnoozed: () => "/review?show=snoozed",
  reviewItem: (key: ReviewItemKey) => `/review?item=${part(key)}`,
  reviewSection: (section: ReviewSection, key?: ReviewSectionKey) =>
    key ? `/review/${section}?item=${part(key)}` : `/review/${section}`,
  /** There is no page for a campaign, so it is the list of its requests. */
  campaign: (id: string) => paths.requests({ campaignId: id }),
  settings: (section?: SettingsSection | SettingsPage) => {
    if (!section) return "/settings";
    return SETTINGS_PAGES.has(section) ? `/settings/${section}` : `/settings#${section}`;
  },
  /** The matching Review item, or else the request the task belongs to. */
  task: (task: TaskRef) => taskPath(task) ?? paths.review(),
} as const;
