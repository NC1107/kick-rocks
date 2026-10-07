import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface EmptyStateProps {
  /** Accepted for pages written before the redesign. An empty state draws no icon. */
  icon?: LucideIcon;
  /** The one plain sentence: "Nothing needs you." */
  title: string;
  /** A second, quieter line when the sentence alone would leave the person stuck. */
  description?: ReactNode;
  /** At most one text link or secondary button. */
  actions?: ReactNode;
  className?: string;
}

/**
 * What a list or page shows when there is nothing to show. It sits left-aligned where the content
 * would be, with no card, no centered icon, and no heading.
 */
export function EmptyState({ title, description, actions, className }: EmptyStateProps) {
  return (
    <div className={cn("py-3", className)}>
      <p className="text-ui text-ink-2">{title}</p>
      {description ? (
        <p className="mt-0.5 max-w-prose text-meta text-ink-3">{description}</p>
      ) : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
