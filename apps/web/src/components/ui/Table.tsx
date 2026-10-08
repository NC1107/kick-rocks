import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { Skeleton } from "./Skeleton.js";

export interface TableProps extends ComponentProps<"table"> {
  /** Names the scrollable region, so keyboard and screen reader users can find and scroll it. */
  label: string;
}

/**
 * A table that scrolls sideways inside its own frame on a narrow screen, so the page itself never
 * does. Put the identifying column first and keep it short. An edge shade shows which side still
 * has columns, and the frame takes focus only while there is something to scroll.
 */
export function Table({ label, className, children, ...rest }: TableProps) {
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
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface">
      <section
        ref={frame}
        aria-label={label}
        tabIndex={scrollable ? 0 : undefined}
        className="overflow-x-auto"
      >
        <table className={cn("w-full border-collapse text-left text-base", className)} {...rest}>
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
  return <thead className={cn("border-b border-line bg-sunken", className)} {...rest} />;
}

export function TableBody({ className, ...rest }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...rest} />;
}

export function TableRow({ className, ...rest }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-sunken/60", className)} {...rest} />;
}

type SortDirection = "asc" | "desc";

interface TableHeaderCellProps extends Omit<ComponentProps<"th">, "align"> {
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
        "h-9 whitespace-nowrap px-3 text-sm font-medium text-ink-muted first:pl-4 last:pr-4",
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
            "-mx-1.5 inline-flex h-7 items-center gap-1 rounded-sm px-1.5 hover:bg-line hover:text-ink",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <SortIcon
            aria-hidden="true"
            className={cn("size-3.5", sortDirection ? "text-ink" : "text-ink-faint")}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

interface TableCellProps extends Omit<ComponentProps<"td">, "align"> {
  align?: "left" | "right";
  /** Lets a long value such as an address wrap instead of stretching the table. */
  wrap?: boolean;
}

export function TableCell({ align = "left", wrap, className, ...rest }: TableCellProps) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle tabular-nums first:pl-4 last:pr-4",
        align === "right" && "text-right",
        !wrap && "whitespace-nowrap",
        className,
      )}
      {...rest}
    />
  );
}

interface TableSkeletonProps {
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
        <td key={column} className="px-3 py-3 first:pl-4 last:pr-4">
          {row === 0 && column === 0 ? <span className="sr-only">Loading</span> : null}
          <Skeleton className={cn("h-4", column === 0 ? "w-40" : "w-20")} />
        </td>
      ))}
    </tr>
  ));
}
