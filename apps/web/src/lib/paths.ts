import type { TaskSummary } from "@kickrocks/shared";

const part = encodeURIComponent;

/** Where each kind of thing lives, so no page builds an address by hand. */
export const paths = {
  profile: (id: string) => `/profiles/${part(id)}`,
  mailbox: (profileId: string) => `/profiles/${part(profileId)}/mailbox`,
  target: (id: string) => `/targets/${part(id)}`,
  request: (id: string) => `/requests/${part(id)}`,
  review: (key?: string) => (key ? `/review?item=${part(key)}` : "/review"),
} as const;

/**
 * Where a task can be looked at. A task that stopped or failed has a place in Review; any other
 * task is part of its request, so it opens there. Null for a task that is neither.
 */
export function taskPath(
  task: Pick<TaskSummary, "id" | "kind" | "status" | "requestId">,
): string | null {
  if (task.status === "blocked") return paths.review(`blocked:${task.id}`);
  if (task.status === "failed") return paths.review(`failed:${task.id}`);
  if (task.status === "queued" && task.kind === "agent") return paths.review(`agent:${task.id}`);
  return task.requestId ? paths.request(task.requestId) : null;
}
