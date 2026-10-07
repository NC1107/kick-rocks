import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { Skeleton } from "./Skeleton.js";

export interface TableProps extends ComponentProps<"table"> {
  /** Names the scrollable region, so keyboard and screen reader users can find and scroll it. */
  label: string;
}

/**
 * A table that scrolls sideways inside its own frame on a narrow screen, so the page itself never
 * does. Put the identifying column first and keep it short.
 */
export function Table({ label, className, children, ...rest }: TableProps) {
  return (
    <section
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must take focus so a keyboard can scroll it
      tabIndex={0}
      className="overflow-x-auto rounded-lg border border-line bg-surface"
    >
      <table className={cn("w-full border-collapse text-left text-base", className)} {...rest}>
        {children}
      </table>
    </section>
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

export interface TableCellProps extends Omit<ComponentProps<"td">, "align"> {
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
        <td key={column} className="px-3 py-3 first:pl-4 last:pr-4">
          {row === 0 && column === 0 ? <span className="sr-only">Loading</span> : null}
          <Skeleton className={cn("h-4", column === 0 ? "w-40" : "w-20")} />
        </td>
      ))}
    </tr>
  ));
}
