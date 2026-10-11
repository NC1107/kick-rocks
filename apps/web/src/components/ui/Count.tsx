import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import { type EntityRef, resolveEntity } from "./EntityLink.js";
import { type FromState, useCurrentPage } from "./PageBack.js";

type CountTone = "plain" | "attention" | "danger";

const TONE: Record<CountTone, string> = {
  plain: "text-ink",
  attention: "text-attention-text",
  danger: "text-danger-text",
};

export interface CountProps {
  value: number;
  tone?: CountTone;
  /** What is counted, for screen readers: "requests". Read after the number. Leave it out when the text beside the number already says it. */
  label?: string;
  className?: string;
}

/** A number that stands for how many of something, in mono with equal-width digits. */
export function Count({ value, tone = "plain", label, className }: CountProps) {
  return (
    <span className={cn("font-mono tabular-nums", TONE[tone], className)}>
      {value}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}

export interface CountLinkProps {
  value: number;
  /** The filtered list this count is the size of. */
  to: EntityRef | string;
  label: string;
  tone?: CountTone;
  /** "label-first" reads "Requests 2", "count-first" reads "2 requests". */
  order?: "label-first" | "count-first";
  className?: string;
}

/** A count that opens the list it counts, so a number is never a dead end. */
export function CountLink({
  value,
  to,
  label,
  tone = "plain",
  order = "label-first",
  className,
}: CountLinkProps) {
  const from = useCurrentPage();
  const href = typeof to === "string" ? to : resolveEntity(to, undefined).href;
  const state: FromState = { from };
  const number = <span className={cn("font-mono tabular-nums", TONE[tone])}>{value}</span>;
  const text = <span className="text-ink-2">{label}</span>;
  const content = (
    <>
      {order === "label-first" ? text : number} {order === "label-first" ? number : text}
    </>
  );
  const classes = cn(
    "inline-flex items-baseline gap-1.5 rounded-xs text-meta transition-colors duration-100 hover:underline focus-visible:-outline-offset-2 pointer-coarse:min-h-11 pointer-coarse:items-center",
    className,
  );
  return href ? (
    <Link to={href} state={state} className={classes}>
      {content}
    </Link>
  ) : (
    <span className={classes}>{content}</span>
  );
}
