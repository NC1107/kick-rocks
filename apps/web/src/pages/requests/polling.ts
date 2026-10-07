import type { Paged, RequestDetail, RequestListItem } from "@kickrocks/shared";

export const REFRESH_MS = 5_000;

const IN_FLIGHT = new Set<RequestListItem["status"]>(["queued", "sent"]);

/** Keeps the list current while a request on screen has not gone out, then stops asking. */
export function listRefreshInterval(page: Paged<RequestListItem> | undefined): number | false {
  return page?.items.some((item) => IN_FLIGHT.has(item.status)) ? REFRESH_MS : false;
}

/** Keeps a request current while it is queued or has a task that is waiting or running. */
export function detailRefreshInterval(request: RequestDetail | undefined): number | false {
  if (!request) return false;
  const moving =
    IN_FLIGHT.has(request.status) ||
    request.tasks.some((task) => task.status === "queued" || task.status === "leased");
  return moving ? REFRESH_MS : false;
}
