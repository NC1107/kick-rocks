import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import { Icon } from "./Icon.js";

export interface CardProps extends ComponentProps<"section"> {
  /** Use "none" for a card whose content, such as a table, runs edge to edge. */
  padding?: "md" | "none";
}

/**
 * A bounded object: a dialog body or the login panel. Anything that is only a group of facts or
 * settings is a Section with a RowGroup instead. Structure comes from a hairline, never a shadow.
 */
export function Card({ padding = "md", className, ...rest }: CardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-md border border-line bg-surface",
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

/** The title block pages used inside a Card before Section. */
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
        {description ? <p className="mt-0.5 text-sm text-ink-2">{description}</p> : null}
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

export interface SectionProps {
  /** What the group holds, in sentence case. It is shown in uppercase mono. */
  label: string;
  /** Folded into the label: "Needs you . 11". */
  count?: number | string;
  actions?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
  children?: ReactNode;
}

/**
 * A mono label with the count folded in, then the group it names. The label sits 10px above the
 * previous section and 6px over its own rows, so a label always belongs to what follows it.
 */
export function Section({
  label,
  count,
  actions,
  as: Heading = "h2",
  className,
  children,
}: SectionProps) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mt-2.5 mb-1.5 flex min-h-5 items-center justify-between gap-3">
        <Heading className="text-eyebrow font-semibold! text-ink-3">
          {label}
          {count === undefined ? null : ` · ${count}`}
        </Heading>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One bordered box of rows divided by hairlines. The rows are the content, not a card's decoration. */
export function RowGroup({ className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "min-w-0 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
      {...rest}
    />
  );
}

interface RowBase {
  /** A 16px glyph in a 32px tile at the leading edge. */
  icon?: LucideIcon;
  /** A small mark in place of the icon tile, such as a status shape. */
  leading?: ReactNode;
  title: ReactNode;
  /** One line, 13px. Longer text belongs in a tooltip or a detail view. */
  description?: ReactNode;
  /** A value or control at the trailing edge. */
  trailing?: ReactNode;
  /** On a phone, drops the trailing value under the text so a wide one cannot squeeze the title. */
  trailingBelowOnPhone?: boolean;
  selected?: boolean;
  /** Lets a list of rows act as one tab stop: only the selected row stays at 0. */
  tabIndex?: number;
  className?: string;
}

export type RowProps = RowBase &
  (
    | { to?: undefined; onClick?: undefined }
    | { to: string; onClick?: undefined }
    | { to?: undefined; onClick: () => void }
  );

const ROW_CLASS =
  "marked flex min-h-row w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-100 focus-visible:-outline-offset-2";

/** A row in a RowGroup: optional icon tile, a title, a description, and a trailing value. */
export function Row({
  icon,
  leading,
  title,
  description,
  trailing,
  trailingBelowOnPhone,
  selected,
  to,
  onClick,
  tabIndex,
  className,
}: RowProps) {
  const interactive = to !== undefined || onClick !== undefined;
  const classes = cn(
    ROW_CLASS,
    selected ? "bg-accent-soft" : interactive && "hover:bg-hover",
    trailingBelowOnPhone && "max-sm:flex-wrap",
    className,
  );
  const content = (
    <>
      {leading ?? null}
      {icon ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-active">
          <Icon icon={icon} className="text-ink-2" />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-ink">{title}</span>
        {description ? <span className="truncate text-meta text-ink-3">{description}</span> : null}
      </span>
      {trailing ? (
        <span
          className={cn(
            "flex shrink-0 items-center gap-2",
            trailingBelowOnPhone && "max-sm:basis-full",
          )}
        >
          {trailing}
        </span>
      ) : null}
    </>
  );
  const state = {
    "data-selected": selected ? "true" : undefined,
    "aria-current": selected ? ("true" as const) : undefined,
  };
  if (to !== undefined) {
    return (
      <Link to={to} tabIndex={tabIndex} className={classes} {...state}>
        {content}
      </Link>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" onClick={onClick} tabIndex={tabIndex} className={classes} {...state}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} {...state}>
      {content}
    </div>
  );
}
