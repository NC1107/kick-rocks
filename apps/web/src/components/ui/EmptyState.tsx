import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** One or two buttons. The first is the way forward. */
  actions?: ReactNode;
  className?: string;
}

/** What a list or page shows when there is nothing to show: say why, then say what to do. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-line bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <Icon aria-hidden="true" className="mb-3 size-6 text-ink-faint" strokeWidth={1.5} />
      ) : null}
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-base text-ink-muted">{description}</p> : null}
      {actions ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
