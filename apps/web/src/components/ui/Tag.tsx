import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import type { Tone } from "../../lib/tone.js";

export interface TagProps {
  /** Neutral by default. The only toned tag is attention, for a requirement that needs the person. */
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/**
 * A short mono label for a fact about a row, outlined and never tinted. Where a fact is plain
 * text, print text instead; a tag earns its edge only when it must be picked out of a line.
 */
export function Tag({ tone = "neutral", children, className }: TagProps) {
  const neutral = tone === "neutral" || tone === "slate";
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex h-[1.125rem] shrink-0 items-center whitespace-nowrap rounded-xs border px-1.5 text-eyebrow",
        neutral ? "border-line text-ink-2" : "border-tone-line text-tone-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}
