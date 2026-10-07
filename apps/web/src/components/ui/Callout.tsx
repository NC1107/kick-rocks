import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { INTENT_TONE, type Intent } from "../../lib/tone.js";

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

export interface CalloutProps {
  intent?: Intent;
  title?: string;
  children?: ReactNode;
  /** A button or link that resolves the notice, such as "Try again". */
  action?: ReactNode;
  className?: string;
}

/**
 * A notice that stays in the page, such as a failed load or a warning above a form. It is a 1px
 * edge in the tone on the surface, never a tinted fill, so a stack of them does not shout.
 */
export function Callout({ intent = "info", title, children, action, className }: CalloutProps) {
  const Icon = ICONS[intent];
  return (
    <div
      role={intent === "danger" || intent === "warning" ? "alert" : "status"}
      data-tone={INTENT_TONE[intent]}
      className={cn(
        "grid grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-2 rounded-md border bg-surface px-3.5 py-2.5 text-meta text-ink sm:grid-cols-[auto_1fr_auto]",
        intent === "info" ? "border-line-popover" : "border-tone-line",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.5}
        className={cn("mt-px size-4 shrink-0", intent === "info" ? "text-ink-3" : "text-tone-ink")}
      />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("text-ink-2", title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="col-start-2 sm:col-start-auto">{action}</div> : null}
    </div>
  );
}
