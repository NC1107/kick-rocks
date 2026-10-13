import type { Paged, RequestDetail, RequestListItem } from "@kickrocks/shared";

/** While a request is going out, so the move from queued to sent shows quickly. */
export const REFRESH_MS = 5_000;
/** While a request waits on someone else, when only a reply can change it. */
export const WAITING_REFRESH_MS = 15_000;

type Status = RequestListItem["status"];

const SETTLED = new Set<Status>(["confirmed", "no_record", "cancelled"]);
const GOING_OUT = new Set<Status>(["queued", "sent"]);

/** A reply can arrive for any request that is not settled, so none of them is left to a manual reload. */
function intervalFor(statuses: readonly Status[]): number | false {
  const open = statuses.filter((status) => !SETTLED.has(status));
  if (open.length === 0) return false;
  return open.some((status) => GOING_OUT.has(status)) ? REFRESH_MS : WAITING_REFRESH_MS;
}

/** Keeps the list current while any request on screen can still change. A hidden tab pauses it. */
export function listRefreshInterval(page: Paged<RequestListItem> | undefined): number | false {
  return page ? intervalFor(page.items.map((item) => item.status)) : false;
}

/** Keeps a request current until it is settled, and fast while a task for it is waiting or running. */
export function detailRefreshInterval(request: RequestDetail | undefined): number | false {
  if (!request) return false;
  const moving = request.tasks.some((task) => task.status === "queued" || task.status === "leased");
  return moving ? REFRESH_MS : intervalFor([request.status]);
}
