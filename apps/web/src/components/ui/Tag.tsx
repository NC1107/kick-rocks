import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import type { Tone } from "../../lib/tone.js";

export interface TagProps {
  /** Neutral by default. The only toned tag is attention, for a requirement that needs the person. */
  tone?: Tone;
  children: ReactNode;
  /** A long label breaks onto more lines inside its edge instead of running past its container. */
  wrap?: boolean;
  className?: string;
}

/**
 * A short mono label for a fact about a row, outlined and never tinted. Where a fact is plain
 * text, print text instead; a tag earns its edge only when it must be picked out of a line.
 */
export function Tag({ tone = "neutral", children, wrap = false, className }: TagProps) {
  const neutral = tone === "neutral";
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center rounded-xs border px-1.5 text-eyebrow",
        wrap
          ? "min-h-[1.125rem] max-w-full whitespace-normal py-px text-left"
          : "h-[1.125rem] shrink-0 whitespace-nowrap",
        neutral ? "border-line text-ink-2" : "border-tone-line text-tone-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
