import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { EntityLink, type EntityRef, resolveEntity } from "./EntityLink.js";

export interface EntityRowProps {
  to: EntityRef;
  title: ReactNode;
  /** One mono-friendly line under the title, such as a reference or an address. */
  meta?: ReactNode;
  /** A StatusMark, TaskStatusMark or a glyph at the leading edge. */
  mark?: ReactNode;
  /** A value or control at the trailing edge. It sits above the row's link, so it stays clickable. */
  trailing?: ReactNode;
  /** Button mode: the row selects instead of navigating, as in Review's queue. */
  onSelect?: (() => void) | undefined;
  selected?: boolean;
  className?: string;
}

const ROW_CLASS =
  "relative flex min-h-row w-full min-w-0 items-center gap-3 px-3.5 py-2 text-left transition-colors duration-100";

/**
 * One row for anything the app lists, so it reads the same in a table, a card and a queue: a mark,
 * a name that links, a meta line, and a trailing value. The whole row is the tap target.
 */
export function EntityRow({
  to,
  title,
  meta,
  mark,
  trailing,
  onSelect,
  selected = false,
  className,
}: EntityRowProps) {
  const interactive = onSelect !== undefined || resolveEntity(to, undefined).href !== null;
  const body = (
    <>
      {mark ? <span className="flex shrink-0 items-center">{mark}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        {onSelect ? (
          <span className="truncate text-ui font-medium text-ink">{title}</span>
        ) : (
          <EntityLink
            to={to}
            variant="row"
            className="block max-w-full truncate text-ui font-medium"
          >
            {title}
          </EntityLink>
        )}
        {meta ? <span className="truncate text-meta text-ink-3">{meta}</span> : null}
      </span>
      {trailing ? (
        <span className="relative z-10 flex shrink-0 items-center gap-2">{trailing}</span>
      ) : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
        className={cn(
          ROW_CLASS,
          "marked",
          "focus-visible:-outline-offset-2",
          selected ? "bg-accent-soft" : "hover:bg-hover",
          className,
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      data-selected={selected ? "true" : undefined}
      className={cn(
        ROW_CLASS,
        "marked",
        selected ? "bg-accent-soft" : interactive && "hover:bg-hover",
        className,
      )}
    >
      {body}
    </div>
  );
}
