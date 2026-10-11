import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import { EntityLink, type EntityRef } from "./EntityLink.js";

export type CountTone = "plain" | "attention" | "danger";

const TONES: Record<CountTone, string> = {
  plain: "text-ink-2",
  attention: "text-attention-text",
  danger: "text-danger-text",
};

export interface CountProps {
  value: number;
  tone?: CountTone;
  /** What the number counts, for screen readers: "3 requests". */
  label: string;
  className?: string | undefined;
}

/** A number that counts something, in mono with fixed-width digits so a column of them lines up. */
export function Count({ value, tone = "plain", label, className }: CountProps) {
  return (
    <span className={cn("font-mono text-meta tabular-nums", TONES[tone], className)}>
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface CountLinkProps extends CountProps {
  to: EntityRef | string;
}

/** A count that opens the list it counts. */
export function CountLink({ value, to, label, tone = "plain", className }: CountLinkProps) {
  const classes = cn(
    "inline-flex min-h-6 items-center font-mono text-meta tabular-nums pointer-coarse:min-h-11",
    TONES[tone],
    className,
  );
  const text = (
    <>
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">{label}</span>
    </>
  );
  return typeof to === "string" ? (
    <Link to={to} className={cn(classes, "rounded-xs underline underline-offset-2")}>
      {text}
    </Link>
  ) : (
    <EntityLink to={to} variant="quiet" className={classes}>
      {text}
    </EntityLink>
  );
}
