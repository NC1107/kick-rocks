import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import { Skeleton } from "./Skeleton.js";

export interface TableProps extends ComponentProps<"table"> {
  /** Names the scrollable region, so keyboard and screen reader users can find and scroll it. */
  label: string;
  /**
   * A CSS max-height, such as "28rem". The frame then scrolls vertically too and the header sticks
   * inside it. Without one, the frame clips instead of scrolling while every column fits, so the
   * header sticks to the page; once columns overflow, the frame scrolls sideways and the header
   * stays with the table.
   */
  maxHeight?: string;
}

interface RovingValue {
  activeId: string | null;
  setActiveId: (id: string) => void;
}

// Only rows that can be selected take part; a plain table has no context and no tab stops.
const RovingContext = createContext<RovingValue | null>(null);

/**
 * A table that scrolls sideways inside its own frame on a narrow screen, so the page itself never
 * does. Put the identifying column first and keep it short. An edge shade shows which side still
 * has columns, and the frame takes focus only while there is something to scroll.
 */
export function Table({ label, maxHeight, className, children, ...rest }: TableProps) {
  const frame = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
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

  // One selectable row is the table's single tab stop: the selected row, else the first.
  useEffect(() => {
    const rows = Array.from(frame.current?.querySelectorAll<HTMLElement>("tr[data-row-id]") ?? []);
    if (rows.some((row) => row.dataset.rowId === activeId)) return;
    const fallback = rows.find((row) => row.getAttribute("aria-selected") === "true") ?? rows[0];
    setActiveId(fallback?.dataset.rowId ?? null);
  });

  const scrollable = overflow.start || overflow.end;
  return (
    <RovingContext value={{ activeId, setActiveId }}>
      <div className="relative overflow-clip rounded-md border border-line bg-surface">
        <section
          ref={frame}
          aria-label={label}
          tabIndex={scrollable ? 0 : undefined}
          style={
            {
              maxHeight,
              // Heading labels pin under the page's own bar unless the frame is itself the scroller.
              "--kr-th-top": maxHeight || scrollable ? "0px" : "var(--kr-bar-h)",
            } as CSSProperties
          }
          className={
            maxHeight ? "overflow-auto" : scrollable ? "overflow-x-auto" : "overflow-x-clip"
          }
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
    </RovingContext>
  );
}

export function TableHead({ className, ...rest }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("[&_th]:shadow-[inset_0_-1px_0_var(--color-line)]", className)}
      {...rest}
    />
  );
}

export function TableBody({ className, ...rest }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-line", className)} {...rest} />;
}

export interface TableRowProps extends ComponentProps<"tr"> {
  /** A selected row gets the accent wash and the left marker, never a focus-like outline. */
  selected?: boolean;
  /**
   * Makes the row selectable by pointer and keyboard: arrows move focus between rows, Enter or
   * Space selects. The table needs role="grid" for aria-selected to be valid on its rows.
   */
  onPick?: () => void;
}

const NESTED_CONTROL = "a, button, input, select, textarea, [role='menuitem']";

export function TableRow({
  selected,
  onPick,
  onClick,
  onKeyDown,
  onFocus,
  className,
  ...rest
}: TableRowProps) {
  const roving = useContext(RovingContext);
  const rowId = useId();
  const select = roving !== null ? onPick : undefined;

  const handleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    onClick?.(event);
    if (select && !(event.target as HTMLElement).closest(NESTED_CONTROL)) select();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    onKeyDown?.(event);
    if (!select || event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
      return;
    }
    const rows = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("tr[data-row-id]") ?? [],
    );
    const at = rows.indexOf(event.currentTarget);
    const target =
      event.key === "ArrowDown"
        ? rows[at + 1]
        : event.key === "ArrowUp"
          ? rows[at - 1]
          : event.key === "Home"
            ? rows[0]
            : event.key === "End"
              ? rows[rows.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <tr
      data-selected={selected ? "true" : undefined}
      {...(select && roving
        ? {
            "data-row-id": rowId,
            "aria-selected": selected === true,
            tabIndex: roving.activeId === rowId ? 0 : -1,
          }
        : {})}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={(event) => {
        onFocus?.(event);
        if (select && roving && event.target === event.currentTarget) roving.setActiveId(rowId);
      }}
      className={cn(
        "group marked-row transition-colors duration-100",
        // The table frame clips an outside ring, so a focused row draws it inside its own edge.
        select && "cursor-pointer focus-visible:-outline-offset-2",
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
  to,
  badge,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  /** Makes the name a link. It stays ink and is underlined only on hover or focus. */
  to?: string;
  /** A tag after the name, such as Retired. */
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col py-1", className)}>
      <span className="flex min-w-0 items-center gap-2 text-ui font-medium text-ink">
        {to ? (
          // The link truncates itself so its focus ring is not clipped by a truncating parent.
          <Link
            to={to}
            className="min-w-0 max-w-full truncate rounded-xs hover:underline focus-visible:underline"
          >
            {title}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{title}</span>
        )}
        {badge}
      </span>
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
        "sticky top-(--kr-th-top) z-10 h-8 whitespace-nowrap bg-surface px-3 text-eyebrow text-ink-3 first:pl-4 last:pr-4",
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
  /** Mono, for references and domains. Dates and numbers should use kind, which also aligns them. */
  mono?: boolean;
  /** A date or a number: mono, tabular, and right-aligned, so columns of them line up. */
  kind?: "numeric" | "date";
}

export function TableCell({ align, wrap, mono, kind, className, ...rest }: TableCellProps) {
  const right = (align ?? (kind ? "right" : "left")) === "right";
  return (
    <td
      className={cn(
        "h-row px-3 py-0 align-middle tabular-nums first:pl-4 last:pr-4",
        (mono || kind) && "font-mono text-meta",
        right && "text-right",
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
