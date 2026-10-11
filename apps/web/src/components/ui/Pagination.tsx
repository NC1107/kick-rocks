import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCount } from "../../lib/format.js";
import { IconButton } from "./IconButton.js";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** What the rows are, for the summary: "targets". */
  noun?: string;
}

/**
 * Previous and next with a range summary, shown only when there is more than one page. A list
 * that fits on one page carries its count in its label instead.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = "results",
}: PaginationProps) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="mt-2.5 flex flex-wrap items-center justify-between gap-3 font-mono text-meta text-ink-3"
    >
      <p className="tabular-nums">
        {formatCount(from)}-{formatCount(to)} of {formatCount(total)}
        <span className="sr-only"> {noun}</span>
      </p>
      <div className="flex items-center gap-1">
        <IconButton
          label="Previous page"
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <span className="min-w-14 text-center tabular-nums">
          {page} of {pages}
        </span>
        <IconButton
          label="Next page"
          size="sm"
          variant="secondary"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
    </nav>
  );
}
