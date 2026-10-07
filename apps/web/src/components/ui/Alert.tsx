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

export interface AlertProps {
  intent?: Intent;
  title?: string;
  children?: ReactNode;
  /** A button or link that resolves the notice, such as "Try again". */
  action?: ReactNode;
  className?: string;
}

/** A notice that stays in the page, such as a failed load or a warning above a form. */
export function Alert({ intent = "info", title, children, action, className }: AlertProps) {
  const Icon = ICONS[intent];
  return (
    <div
      role={intent === "danger" || intent === "warning" ? "alert" : "status"}
      data-tone={INTENT_TONE[intent]}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-tone-line bg-tone-bg p-3.5 text-tone-ink",
        className,
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0" />
      <div className="min-w-0 flex-1 text-base">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
