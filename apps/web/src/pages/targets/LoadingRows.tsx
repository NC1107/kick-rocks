import { Skeleton } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";

interface LoadingColumn {
  /** Classes on the cell, so a column hidden on a phone is hidden while loading too. */
  className?: string;
  /** Width of the placeholder bar. */
  bar?: string;
}

/** Placeholder rows that follow the real table's visible columns. Render inside TableBody. */
export function LoadingRows({
  columns,
  rows = 8,
}: {
  columns: readonly LoadingColumn[];
  rows?: number;
}) {
  return Array.from({ length: rows }, (_, row) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
    <tr key={row}>
      {columns.map((column, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder cells have no identity
        <td key={index} className={cn("h-13 px-3 first:pl-4 last:pr-4", column.className)}>
          {row === 0 && index === 0 ? <span className="sr-only">Loading</span> : null}
          <Skeleton className={cn("h-3.5", column.bar ?? "w-16")} />
        </td>
      ))}
    </tr>
  ));
}
