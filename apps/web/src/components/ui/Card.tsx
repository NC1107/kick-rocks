import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface CardProps extends ComponentProps<"section"> {
  /** Use "none" for a card whose content, such as a table, runs edge to edge. */
  padding?: "md" | "none";
}

/** A bounded group of related content. Structure comes from a hairline, never a shadow. */
export function Card({ padding = "md", className, ...rest }: CardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-line bg-surface",
        padding === "md" && "p-4 sm:p-5",
        className,
      )}
      {...rest}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** The heading level, so a card inside a page section keeps the outline in order. */
  as?: "h2" | "h3" | "h4";
  className?: string;
}

export function CardHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
}: CardHeaderProps) {
  return (
    <div
      className={cn("mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}
    >
      <div className="min-w-0">
        <Heading className="text-lg font-semibold text-ink">{title}</Heading>
        {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardFooter({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4",
        className,
      )}
      {...rest}
    />
  );
}
