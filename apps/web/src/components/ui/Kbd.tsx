import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.js";

/** A keycap for a shortcut hint. Put one per key, so "Ctrl K" is two of these. */
export function Kbd({ className, ...rest }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-xs border border-line-strong px-1 font-mono text-label font-medium text-ink-2",
        className,
      )}
      {...rest}
    />
  );
}
