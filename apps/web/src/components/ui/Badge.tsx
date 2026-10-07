import type { ReactNode } from "react";
import type { Tone } from "../../lib/tone.js";
import { Tag } from "./Tag.js";

export interface BadgeProps {
  tone?: Tone;
  /** Kept for pages written before the redesign. A tag has one look, so it changes nothing. */
  variant?: "soft" | "outline";
  children: ReactNode;
  className?: string;
}

/** The name pages used before Tag. It renders a Tag, so every badge is outlined and mono. */
export function Badge({ tone, children, className }: BadgeProps) {
  return (
    <Tag {...(tone ? { tone } : {})} {...(className ? { className } : {})}>
      {children}
    </Tag>
  );
}
