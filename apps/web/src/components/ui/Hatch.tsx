import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.js";

/**
 * Stands in for imagery that is missing, such as a screenshot that was not captured, so an empty
 * frame reads as deliberately empty rather than as a grey block that failed to load.
 */
export function Hatch({ className, style, children, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-sm border border-line text-meta text-ink-3",
        className,
      )}
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, color-mix(in srgb, var(--kr-ink-3) 8%, transparent) 0 1px, transparent 1px 7px)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
