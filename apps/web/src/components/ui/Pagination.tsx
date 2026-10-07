import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatCount } from "../../lib/format.js";
import { Button } from "./Button.js";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** What the rows are, for the summary: "targets". */
  noun?: string;
}

/** Previous and next with a range summary. Pass the page, pageSize, and total from a list response. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = "results",
}: PaginationProps) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted"
    >
      <p>
        Showing {formatCount(from)} to {formatCount(to)} of {formatCount(total)} {noun}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft aria-hidden="true" className="size-3.5" />
          Previous
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          {page} of {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
    </nav>
  );
}
