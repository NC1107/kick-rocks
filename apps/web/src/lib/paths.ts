import type { TaskSummary } from "@kickrocks/shared";

const part = encodeURIComponent;

export type ReviewKey =
  | "scans"
  | `${"blocked" | "failed" | "agent"}:${string}`
  | `${"match" | "details" | "mail"}:${string}`;

export interface RequestFilters {
  status?: string | undefined;
  targetId?: string | undefined;
  profileId?: string | undefined;
  campaignId?: string | undefined;
}

export const SETTINGS_SECTIONS = [
  "schedule",
  "site-checks",
  "scan-pace",
  "sites",
  "worker",
  "language-model",
  "jurisdictions",
  "retention",
  "password",
  "reset",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export type SettingsPage = "recipes" | "agents" | "notifications";

type TaskRefLike = Pick<TaskSummary, "id" | "kind" | "status" | "requestId">;

/** Where each kind of thing lives, so no page builds an address by hand. */
export const paths = {
  profile: (id: string) => `/profiles/${part(id)}`,
  mailbox: (profileId: string) => `/profiles/${part(profileId)}/mailbox`,
  target: (id: string) => `/targets/${part(id)}`,
  request: (id: string) => `/requests/${part(id)}`,
  requests: (filters: RequestFilters = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) query.set(key, value);
    }
    const text = query.toString();
    return text ? `/requests?${text}` : "/requests";
  },
  review: (key?: ReviewKey) => (key ? `/review?item=${part(key)}` : "/review"),
  reviewTab: (tab: string) => `/review?tab=${part(tab)}`,
  campaign: (id: string) => `/requests?campaignId=${part(id)}`,
  settings: (section?: SettingsSection | SettingsPage) => {
    if (!section) return "/settings";
    return section === "recipes" || section === "agents" || section === "notifications"
      ? `/settings/${section}`
      : `/settings#${section}`;
  },
} as const;

/**
 * Where a task can be looked at. A task that stopped or failed has a place in Review; any other
 * task is part of its request, so it opens there. Null for a task that is neither.
 */
export function taskPath(task: TaskRefLike): string | null {
  if (task.status === "blocked") return paths.review(`blocked:${task.id}`);
  if (task.status === "failed") return paths.review(`failed:${task.id}`);
  if (task.status === "queued" && task.kind === "agent") return paths.review(`agent:${task.id}`);
  return task.requestId ? paths.request(task.requestId) : null;
}
