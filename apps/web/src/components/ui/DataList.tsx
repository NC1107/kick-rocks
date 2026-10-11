import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import { useWide } from "../../lib/use-wide.js";
import { Pagination, type PaginationProps } from "./Pagination.js";
import { SelectBox } from "./SelectBox.js";
import { Skeleton } from "./Skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableIdentity,
  TableRow,
  TableSkeletonRows,
} from "./Table.js";

export interface DataListColumn<T> {
  id: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  /** Classes for the heading and every cell, such as `hidden xl:table-cell` for a column that waits for room. */
  className?: string;
  align?: "left" | "right";
  /** A date or a number: mono and right-aligned. */
  kind?: "numeric" | "date";
  mono?: boolean;
  wrap?: boolean;
}

export interface DataListIdentity {
  title: ReactNode;
  /** The mono line under the name: a domain or a reference. */
  meta?: ReactNode;
  /** Makes the name a link that opens the whole row. */
  to?: string;
  badge?: ReactNode;
}

export interface DataListSelection<T> {
  /** Prefixes the checkbox ids, so two lists on a page never share one. */
  idPrefix: string;
  isChecked: (item: T) => boolean;
  isDisabled?: (item: T) => boolean;
  onToggle: (item: T, on: boolean) => void;
  /** The accessible name of a row's box, such as "Select Spokeo". */
  label: (item: T) => string;
  all?: {
    label: string;
    checked: boolean;
    indeterminate: boolean;
    disabled: boolean;
    onChange: (on: boolean) => void;
  };
}

export interface DataListProps<T> {
  /** Names the list for assistive technology. */
  label: string;
  items: readonly T[];
  getKey: (item: T) => string;
  identity: (item: T) => DataListIdentity;
  /** The columns after the name. A phone shows `tags` in their place. */
  columns: readonly DataListColumn<T>[];
  /** What a phone shows under the name: a few mono tags or marks, never more than a line or two. */
  tags?: (item: T) => ReactNode;
  /** Heading for the name column. */
  identityHeader: ReactNode;
  selection?: DataListSelection<T>;
  isSelected?: (item: T) => boolean;
  loading?: boolean;
  /** True while the list shows the previous page or filter. */
  busy?: boolean;
  /** The compact count that stands in for a pager when everything fits, such as "2 requests". */
  count?: string | undefined;
  pager?: PaginationProps | undefined;
  /** Keeps the column headings for assistive technology only, for a short picker that needs no header. */
  headless?: boolean;
  className?: string;
}

/**
 * The one list every page uses: stacked rows on a phone, a table on a wide screen, and a pager
 * only when there is more than one page. Pages describe a row once and the layout follows.
 */
export function DataList<T>({
  label,
  items,
  getKey,
  identity,
  identityHeader,
  columns,
  tags,
  selection,
  isSelected,
  loading,
  busy,
  count,
  pager,
  headless,
  className,
}: DataListProps<T>) {
  const wide = useWide();
  const selected = (item: T) => isSelected?.(item) ?? selection?.isChecked(item) ?? false;
  const disabled = (item: T) => selection?.isDisabled?.(item) ?? false;

  return (
    <div className={className}>
      {count ? (
        <p className="mb-1.5 font-mono text-eyebrow uppercase text-ink-3 tabular-nums">{count}</p>
      ) : null}
      {wide ? (
        <Table label={label} aria-busy={busy || undefined}>
          <TableHead className={headless ? "sr-only" : undefined}>
            <tr>
              {selection ? (
                <TableHeaderCell className="w-10 pr-0">
                  {selection.all ? (
                    <SelectBox
                      id={`${selection.idPrefix}-all`}
                      label={selection.all.label}
                      checked={selection.all.checked}
                      indeterminate={selection.all.indeterminate}
                      disabled={selection.all.disabled}
                      onChange={selection.all.onChange}
                    />
                  ) : (
                    <span className="sr-only">Select</span>
                  )}
                </TableHeaderCell>
              ) : null}
              <TableHeaderCell>{identityHeader}</TableHeaderCell>
              {columns.map((column) => (
                <TableHeaderCell
                  key={column.id}
                  align={column.align ?? (column.kind ? "right" : "left")}
                  className={column.className}
                >
                  {column.header}
                </TableHeaderCell>
              ))}
            </tr>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableSkeletonRows columns={columns.length + (selection ? 2 : 1)} rows={8} />
            ) : (
              items.map((item) => {
                const { title, meta, to, badge } = identity(item);
                return (
                  <TableRow key={getKey(item)} selected={selected(item)}>
                    {selection ? (
                      <TableCell className="w-10 pr-0">
                        <SelectBox
                          id={`${selection.idPrefix}-${getKey(item)}`}
                          label={selection.label(item)}
                          checked={selected(item)}
                          disabled={disabled(item)}
                          onChange={(on) => selection.onToggle(item, on)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="max-w-72 min-w-40">
                      <TableIdentity
                        title={title}
                        {...(meta ? { meta } : {})}
                        {...(to ? { to } : {})}
                        {...(badge ? { badge } : {})}
                      />
                    </TableCell>
                    {columns.map((column) => (
                      <TableCell
                        key={column.id}
                        {...(column.align ? { align: column.align } : {})}
                        {...(column.kind ? { kind: column.kind } : {})}
                        {...(column.mono ? { mono: true } : {})}
                        {...(column.wrap ? { wrap: true } : {})}
                        className={column.className}
                      >
                        {column.cell(item)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      ) : (
        <ul
          aria-label={label}
          aria-busy={busy || undefined}
          className="m-0 min-w-0 list-none divide-y divide-line overflow-hidden rounded-md border border-line bg-surface p-0"
        >
          {loading
            ? Array.from({ length: 6 }, (_, row) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
                <li key={row} className="flex min-h-15 flex-col justify-center gap-1.5 px-4 py-2.5">
                  {row === 0 ? <span className="sr-only">Loading</span> : null}
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </li>
              ))
            : items.map((item) => {
                const { title, meta, to, badge } = identity(item);
                const extras = tags?.(item);
                return (
                  <li
                    key={getKey(item)}
                    data-selected={selected(item) ? "true" : undefined}
                    className={cn(
                      "flex items-stretch",
                      selected(item) ? "bg-accent-soft" : "active:bg-hover",
                    )}
                  >
                    {selection ? (
                      <SelectBox
                        id={`${selection.idPrefix}-${getKey(item)}`}
                        label={selection.label(item)}
                        checked={selected(item)}
                        disabled={disabled(item)}
                        onChange={(on) => selection.onToggle(item, on)}
                        className="self-start"
                      />
                    ) : null}
                    <div
                      className={cn(
                        "relative flex min-w-0 flex-1 flex-col gap-1 py-2.5 pr-4",
                        selection ? "pl-1" : "pl-4",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-ui font-medium text-ink">
                        {to ? (
                          <Link
                            to={to}
                            className="min-w-0 max-w-full truncate rounded-xs after:absolute after:inset-0"
                          >
                            {title}
                          </Link>
                        ) : (
                          <span className="min-w-0 truncate">{title}</span>
                        )}
                        {badge}
                      </span>
                      {meta ? (
                        <span className="truncate font-mono text-caption text-ink-3">{meta}</span>
                      ) : null}
                      {extras ? (
                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-caption text-ink-2">
                          {extras}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
        </ul>
      )}
      {pager ? <Pagination {...pager} /> : null}
    </div>
  );
}
