import type { NeedsYouQueue, ReviewQueue } from "@kickrocks/shared";
import { paths, type ReviewSection } from "../../lib/paths.js";

/** Where the old `?tab=` values lead now. The groups that became the focused queue lead to it. */
const TAB_DESTINATIONS: Record<string, string> = {
  blocked: paths.review(),
  yours: paths.review(),
  matches: paths.review(),
  verifications: paths.review(),
  mail: paths.reviewSection("mail"),
  failed: paths.reviewSection("problems"),
  agents: paths.reviewSection("agents"),
  scans: paths.reviewSection("scans"),
};

const OLD_TASK_KEY = /^(blocked|yours|agent):(.+)$/;

export interface QueuesForRedirect {
  needsYou: NeedsYouQueue;
  review: ReviewQueue;
}

const SECTION_OF_PREFIX: Record<string, ReviewSection> = {
  failed: "problems",
  mail: "mail",
};

/**
 * Whether an address saved before Review was split needs a different one now, and which. Null
 * means the address is current. "wait" means the answer depends on the queues, which are still
 * loading. Bookmarks and links in old toasts keep working through this.
 */
export function legacyDestination(
  search: string,
  queues: QueuesForRedirect | undefined,
): string | "wait" | null {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const item = params.get("item");

  if (item === "scans") return paths.reviewSection("scans");
  if (item !== null) {
    const prefix = item.split(":", 1)[0] ?? "";
    const id = item.slice(prefix.length + 1);
    const section = SECTION_OF_PREFIX[prefix];
    if (section === "problems") return paths.reviewSection("problems", `failed:${id}`);
    if (section === "mail") return paths.reviewSection("mail", `mail:${id}`);
    if (OLD_TASK_KEY.test(item)) {
      if (!queues) return "wait";
      if (queues.needsYou.items.some((entry) => entry.key === `task:${id}`)) {
        return paths.reviewItem(`task:${id}`);
      }
      if (queues.review.agentTasks.some((entry) => entry.task.id === id)) {
        return paths.reviewSection("agents", `agent:${id}`);
      }
      if (queues.review.failedTasks.some((entry) => entry.task.id === id)) {
        return paths.reviewSection("problems", `failed:${id}`);
      }
      return paths.review();
    }
    return null;
  }
  if (tab !== null) return TAB_DESTINATIONS[tab] ?? paths.review();
  return null;
}
