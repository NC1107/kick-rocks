import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface DetailRow {
  label: string;
  value: string;
  /** Printed in the attention color, for what the person should notice. */
  attention?: boolean;
}

/** Fewer rows than this are short enough to show without a tap. */
const OPEN_BELOW_ROWS = 4;

/**
 * The technical facts behind an item: where a request goes, the fields in it, ids. Open when there
 * are only a few, and closed when there are enough to push the action out of view.
 */
export function Details({ rows, children }: { rows: readonly DetailRow[]; children?: ReactNode }) {
  return (
    <details open={rows.length > 0 && rows.length < OPEN_BELOW_ROWS} className="group min-w-0">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-xs text-meta font-medium text-ink-3 marker:hidden hover:text-ink-2 pointer-coarse:min-h-11">
        <span
          aria-hidden="true"
          className="font-mono text-ink-3 transition-transform duration-100 group-open:rotate-90"
        >
          {">"}
        </span>
        Details
      </summary>
      <div className="mt-2 flex min-w-0 flex-col gap-3">
        {rows.length > 0 ? (
          <dl className="m-0 divide-y divide-line border-y border-line">
            {rows.map((row, index) => (
              <div
                // The same name can repeat in one request.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are never reordered
                key={`${row.label}-${index}`}
                className="grid grid-cols-1 gap-x-3 gap-y-0.5 py-1.5 font-mono text-meta sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
              >
                <dt className="break-words text-ink-3">{row.label}</dt>
                <dd
                  className={cn(
                    "m-0 break-all",
                    row.attention ? "text-attention-text" : "text-ink",
                  )}
                >
                  {row.value || "(empty)"}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {children}
      </div>
    </details>
  );
}
