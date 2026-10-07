import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { Skeleton } from "./Skeleton.js";

export interface TableProps extends ComponentProps<"table"> {
  /** Names the scrollable region, so keyboard and screen reader users can find and scroll it. */
  label: string;
  /**
   * A CSS max-height, such as "28rem". The frame then scrolls vertically too, which is what lets
   * the header stay put: a sticky header sticks to its nearest scrolling ancestor, and without a
   * height limit that ancestor is the horizontal frame, which never scrolls down.
   */
  maxHeight?: string;
}

/**
 * A table that scrolls sideways inside its own frame on a narrow screen, so the page itself never
 * does. Put the identifying column first and keep it short. An edge shade shows which side still
 * has columns, and the frame takes focus only while there is something to scroll.
 */
export function Table({ label, maxHeight, className, children, ...rest }: TableProps) {
  const frame = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const max = element.scrollWidth - element.clientWidth;
      const next = { start: element.scrollLeft > 1, end: element.scrollLeft < max - 1 };
      setOverflow((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, []);

  const scrollable = overflow.start || overflow.end;
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-surface">
      <section
        ref={frame}
        aria-label={label}
        tabIndex={scrollable ? 0 : undefined}
        style={maxHeight ? { maxHeight } : undefined}
        className={maxHeight ? "overflow-auto" : "overflow-x-auto"}
      >
        <table className={cn("w-full border-collapse text-left text-ui", className)} {...rest}>
          {children}
        </table>
      </section>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 bg-linear-to-r from-(--kr-shade) to-transparent transition-opacity",
          overflow.start ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-6 bg-linear-to-l from-(--kr-shade) to-transparent transition-opacity",
          overflow.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

export function TableHead({ className, ...rest }: ComponentProps<"thead">) {
  return <thead className={cn("[&_th]:border-b [&_th]:border-line", className)} {...rest} />;
}

export function TableBody({ className, ...rest }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...rest} />;
}

export interface TableRowProps extends ComponentProps<"tr"> {
  /** A selected row gets the accent wash and the left marker, never a focus-like outline. */
  selected?: boolean;
}

export function TableRow({ selected, className, ...rest }: TableRowProps) {
  return (
    <tr
      data-selected={selected ? "true" : undefined}
      className={cn(
        "group marked-row transition-colors duration-100",
        selected ? "bg-accent-soft" : "hover:bg-hover",
        className,
      )}
      {...rest}
    />
  );
}

/**
 * Actions that belong to one row, such as open, retry, or delete. They appear on hover or focus
 * so a resting table is quiet, and stay visible on a touch screen where there is no hover.
 */
export function TableRowActions({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-1 opacity-0 transition-opacity duration-100 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
        className,
      )}
      {...rest}
    />
  );
}

/** A name with its mono reference or domain underneath: the one place a row may run to 52px. */
export function TableIdentity({
  title,
  meta,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col py-1", className)}>
      <span className="truncate text-ui font-medium text-ink">{title}</span>
      {meta ? <span className="truncate font-mono text-caption text-ink-3">{meta}</span> : null}
    </div>
  );
}

/** The bar above a table: search, then filters, then a right-aligned mono count. */
export function TableToolbar({
  count,
  className,
  children,
}: {
  count?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("mb-2.5 flex flex-wrap items-center gap-2", className)}>
      {children}
      {count ? (
        <span className="ml-auto font-mono text-meta text-ink-3 tabular-nums">{count}</span>
      ) : null}
    </div>
  );
}

type SortDirection = "asc" | "desc";

export interface TableHeaderCellProps extends Omit<ComponentProps<"th">, "align"> {
  align?: "left" | "right";
  /** Makes the heading a button. Pass the current direction, or null when this column is not sorted. */
  sortDirection?: SortDirection | null;
  onSort?: () => void;
}

export function TableHeaderCell({
  align = "left",
  sortDirection,
  onSort,
  className,
  children,
  ...rest
}: TableHeaderCellProps) {
  const sortable = onSort !== undefined;
  const SortIcon =
    sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={
        sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : undefined
      }
      className={cn(
        "sticky top-0 z-10 h-8 whitespace-nowrap bg-surface px-3 text-eyebrow text-ink-3 first:pl-4 last:pr-4",
        align === "right" && "text-right",
        className,
      )}
      {...rest}
    >
      {sortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "-mx-1.5 inline-flex h-6 items-center gap-1 rounded-sm px-1.5 uppercase transition-colors duration-100 hover:bg-hover hover:text-ink-2",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <SortIcon
            aria-hidden="true"
            className={cn("size-3", sortDirection ? "text-ink" : "text-ink-3")}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends Omit<ComponentProps<"td">, "align"> {
  align?: "left" | "right";
  /** Lets a long value such as an address wrap instead of stretching the table. */
  wrap?: boolean;
  /** Mono, for references, domains, dates, and counts. Right-align numbers with align. */
  mono?: boolean;
}

export function TableCell({ align = "left", wrap, mono, className, ...rest }: TableCellProps) {
  return (
    <td
      className={cn(
        "h-row px-3 py-0 align-middle tabular-nums first:pl-4 last:pr-4",
        mono && "font-mono text-meta",
        align === "right" && "text-right",
        !wrap && "whitespace-nowrap",
        className,
      )}
      {...rest}
    />
  );
}

export interface TableSkeletonProps {
  columns: number;
  rows?: number;
}

/** Placeholder rows while a list loads. Render it inside TableBody. */
export function TableSkeletonRows({ columns, rows = 6 }: TableSkeletonProps): ReactNode {
  return Array.from({ length: rows }, (_, row) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
    <tr key={row}>
      {Array.from({ length: columns }, (_, column) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder cells have no identity
        <td key={column} className="h-row px-3 first:pl-4 last:pr-4">
          {row === 0 && column === 0 ? <span className="sr-only">Loading</span> : null}
          <Skeleton className={cn("h-3.5", column === 0 ? "w-40" : "w-20")} />
        </td>
      ))}
    </tr>
  ));
}
