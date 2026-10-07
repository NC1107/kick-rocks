import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface MeterProps {
  value: number;
  max: number;
  /** Names the meter for screen readers, such as "Sent today". */
  label: string;
  /** The mono text to the right of the track, such as "1 of 150". */
  readout?: ReactNode;
  /** Fractions of the track that get a tick mark. */
  ticks?: readonly number[];
  /** The fraction at which the fill turns from accent to attention. */
  warnAt?: number;
  className?: string;
}

/**
 * A calibrated bar for a quantity with a limit: the daily send quota, scan progress, a reply
 * window. The fill is the accent until it passes the warning line, then it says so in attention.
 */
export function Meter({
  value,
  max,
  label,
  readout,
  ticks = [0.5, 0.8],
  warnAt = 0.8,
  className,
}: MeterProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const warn = ratio >= warnAt;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* biome-ignore lint/a11y/useSemanticElements: a native meter cannot be given ticks or this track shape */}
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-active"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-120 ease-linear",
            warn ? "bg-attention" : "bg-accent-fill",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
        {ticks.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-surface"
            style={{ left: `${tick * 100}%` }}
          />
        ))}
      </div>
      {readout ? (
        <span className="w-24 shrink-0 text-right font-mono text-meta text-ink-2 tabular-nums">
          {readout}
        </span>
      ) : null}
    </div>
  );
}
