import type { RequestStatus, TaskSummary } from "@kickrocks/shared";

const part = encodeURIComponent;

/** The kinds of thing Review can open on its own, as the `item` it is told to select. */
export type ReviewKey =
  | "scans"
  | `${"blocked" | "failed" | "agent"}:${string}`
  | `match:${string}`
  | `details:${string}`
  | `mail:${string}`;

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

export type TaskRef = Pick<TaskSummary, "id" | "kind" | "status" | "requestId">;

/**
 * Where a task can be looked at. A task that stopped or failed has a place in Review; any other
 * task is part of its request, so it opens there. Null for a task that is neither.
 */
export function taskPath(task: TaskRef): string | null {
  if (task.status === "blocked") return `/review?item=${part(`blocked:${task.id}`)}`;
  if (task.status === "failed") return `/review?item=${part(`failed:${task.id}`)}`;
  if (task.status === "queued" && task.kind === "agent") {
    return `/review?item=${part(`agent:${task.id}`)}`;
  }
  return task.requestId ? `/requests/${part(task.requestId)}` : null;
}

/** Where each kind of thing lives, so no page builds an address by hand. */
export const paths = {
  profile: (id: string) => `/profiles/${part(id)}`,
  mailbox: (profileId: string) => `/profiles/${part(profileId)}/mailbox`,
  target: (id: string) => `/targets/${part(id)}`,
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
  review: (key?: ReviewKey) => (key ? `/review?item=${part(key)}` : "/review"),
  reviewTab: (tab: string) => `/review?tab=${part(tab)}`,
  /** There is no page for a campaign, so it is the list of its requests. */
  campaign: (id: string) => paths.requests({ campaignId: id }),
  settings: (section?: SettingsSection | SettingsPage) => {
    if (!section) return "/settings";
    return SETTINGS_PAGES.has(section) ? `/settings/${section}` : `/settings#${section}`;
  },
  /** The matching Review item, or else the request the task belongs to. */
  task: (task: TaskRef) => taskPath(task) ?? paths.review(),
} as const;
