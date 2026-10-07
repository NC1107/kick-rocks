import type { ReactNode } from "react";
import { StatusShapeGlyph } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import type { StatusShape } from "../../lib/status.js";

export interface EventRowProps {
  /** The mono label in the left gutter. Leave it out to continue the row above under one time. */
  time?: ReactNode;
  shape: StatusShape;
  children: ReactNode;
  className?: string;
}

/**
 * One line of a timeline: a time gutter, a shape sitting on a 1px rule, and the text. Render rows
 * in an `ol`; the rule joins neighbors and stops at the first and last shape.
 */
export function EventRow({ time, shape, children, className }: EventRowProps) {
  return (
    <li
      className={cn("group/event grid grid-cols-[5rem_0.625rem_minmax(0,1fr)] gap-x-3", className)}
    >
      <span className="py-1.5 text-right font-mono text-caption leading-5 whitespace-nowrap text-ink-3 tabular-nums">
        {time}
      </span>
      <span className="relative flex justify-center">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-line group-first/event:top-4 group-last/event:bottom-auto group-last/event:h-4"
        />
        <StatusShapeGlyph shape={shape} className="relative mt-[0.6875rem] bg-canvas" />
      </span>
      <div className="min-w-0 py-1.5">{children}</div>
    </li>
  );
}
