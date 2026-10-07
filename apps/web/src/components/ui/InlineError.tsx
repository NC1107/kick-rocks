import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

/** Why the thing next to it failed. A failure stays on what failed and never toasts. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("m-0 text-caption text-danger-text", className)}>
      {children}
    </p>
  );
}
