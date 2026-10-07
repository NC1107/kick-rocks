import type { RequestStatus, TaskStatus } from "@kickrocks/shared";
import { cn } from "../../lib/cn.js";
import {
  REQUEST_STATUS_META,
  type StatusFamily,
  type StatusMeta,
  type StatusShape,
  TASK_STATUS_META,
} from "../../lib/status.js";
import { Tooltip } from "./Tooltip.js";

const WORD: Record<StatusFamily, string> = {
  progress: "text-ink-2",
  resolved: "text-ink-2",
  closed: "text-ink-2",
  needs: "text-attention-text",
  failed: "text-danger-text",
};

export interface ShapeProps {
  shape: StatusShape;
  /** Draws a ring in the accent, for a request that is out and being waited on. */
  accent?: boolean | undefined;
  className?: string;
}

/**
 * The 10px mark that carries a state without its color: a ring, disc, dash, triangle, or square.
 * A running task is a ring with a gap that turns, and holds still under reduced motion.
 */
export function StatusShapeGlyph({ shape, accent, className }: ShapeProps) {
  const ring = accent ? "stroke-accent-text" : "stroke-ink-3";
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {shape === "ring" ? (
        <circle cx="5" cy="5" r="3.9" fill="none" strokeWidth="1.3" className={ring} />
      ) : null}
      {shape === "dashed-ring" ? (
        <circle
          cx="5"
          cy="5"
          r="3.9"
          fill="none"
          strokeWidth="1.3"
          strokeDasharray="2.1 1.6"
          className={ring}
        />
      ) : null}
      {shape === "running" ? (
        <g className="origin-center animate-running" style={{ transformBox: "fill-box" }}>
          <circle
            cx="5"
            cy="5"
            r="3.9"
            fill="none"
            strokeWidth="1.3"
            strokeDasharray="17 7.5"
            strokeLinecap="round"
            className="stroke-ink-3"
          />
        </g>
      ) : null}
      {shape === "disc" ? <circle cx="5" cy="5" r="4.5" className="fill-positive" /> : null}
      {shape === "dash" ? (
        <rect x="1" y="4.25" width="8" height="1.5" rx="0.75" className="fill-ink-3" />
      ) : null}
      {shape === "triangle" ? (
        <path
          d="M5 0.9 9.3 8.6H0.7Z"
          strokeWidth="1"
          strokeLinejoin="round"
          className="fill-attention stroke-attention"
        />
      ) : null}
      {shape === "square" ? (
        <rect x="0.9" y="0.9" width="8.2" height="8.2" rx="1.2" className="fill-danger" />
      ) : null}
    </svg>
  );
}

function Mark({ meta, className }: { meta: StatusMeta; className?: string | undefined }) {
  return (
    <Tooltip content={meta.description} className={className}>
      <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-meta">
        <StatusShapeGlyph shape={meta.shape} accent={meta.accent} />
        <span
          className={cn(
            WORD[meta.family],
            meta.family === "needs" || meta.family === "failed" ? "font-medium" : "",
          )}
        >
          {meta.label}
        </span>
      </span>
    </Tooltip>
  );
}

export interface StatusMarkProps {
  status: RequestStatus;
  className?: string;
}

/** The state of a request: a shape and a plain word, with no pill behind it. */
export function StatusMark({ status, className }: StatusMarkProps) {
  return <Mark meta={REQUEST_STATUS_META[status]} className={className} />;
}

export interface TaskStatusMarkProps {
  status: TaskStatus;
  className?: string;
}

export function TaskStatusMark({ status, className }: TaskStatusMarkProps) {
  return <Mark meta={TASK_STATUS_META[status]} className={className} />;
}
