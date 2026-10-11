import type { SnapshotControl } from "./snapshot.js";

export interface PagerControl {
  ref: string;
  name: string;
  /** Set for a link, which leads to another address. A button has none. */
  href?: string;
}

const ARROWS = /^[›»>→]+$/;
const PAGER_NAME =
  /^(?:\d{1,3}|next(?:\s+page)?|more(?:\s+results)?|(?:view|show|load|see)\s+(?:\d+\s+)?more(?:\s+\w+)?)$/i;

/** Whether a control reads like a way to more results: a page number, Next, or a More button. */
export function readsAsPagination(name: string): boolean {
  const text = name.replace(/\s+/g, " ").trim();
  if (text === "") return false;
  if (ARROWS.test(text)) return true;
  return PAGER_NAME.test(
    text
      .replace(/^page\s+/i, "")
      .replace(/\s*[›»>→]+$/, "")
      .trim(),
  );
}

/** The links and buttons of a page that lead to more results. */
export function paginationOf(controls: readonly SnapshotControl[]): PagerControl[] {
  return controls
    .filter((c) => (c.role === "link" || c.role === "button") && !c.disabled)
    .filter((c) => readsAsPagination(c.name))
    .map((c) => ({
      ref: c.ref,
      name: c.name.replace(/\s+/g, " ").trim(),
      ...(c.href ? { href: c.href } : {}),
    }));
}
