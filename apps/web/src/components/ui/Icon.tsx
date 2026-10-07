import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn.js";

/** 14 only inline in text, 16 in rows, buttons and nav, 20 in the header bar and empty states. */
export const ICON_SIZES = { inline: 14, row: 16, bar: 20 } as const;
export type IconSize = keyof typeof ICON_SIZES;

export interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** Set only when the glyph carries meaning on its own. Otherwise it is hidden from screen readers. */
  label?: string;
  className?: string;
}

/**
 * Fixes the size set and the 1.5 stroke in one place, and mutes the glyph to ink-3. The accent
 * belongs only to the active nav item, which passes its own color.
 */
export function Icon({ icon: Glyph, size = "row", label, className }: IconProps) {
  const px = ICON_SIZES[size];
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={1.5}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      className={cn("shrink-0 text-ink-3", className)}
    />
  );
}
