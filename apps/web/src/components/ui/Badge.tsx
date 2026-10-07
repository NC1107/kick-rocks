import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import type { Tone } from "../../lib/tone.js";

export interface BadgeProps {
  tone?: Tone;
  /** "outline" is quieter, for facts about a row rather than its state. */
  variant?: "soft" | "outline";
  children: ReactNode;
  className?: string;
}

/** A small label for a fact: a category, a requirement, a count. For request state use StatusPill. */
export function Badge({ tone = "neutral", variant = "soft", children, className }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 text-xs font-medium",
        variant === "soft" ? "bg-tone-bg text-tone-ink" : "border border-tone-line text-tone-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
