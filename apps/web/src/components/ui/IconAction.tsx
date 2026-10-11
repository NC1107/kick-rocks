import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import type { ButtonSize } from "./Button.js";
import { type EntityRef, entityPath } from "./EntityLink.js";
import { Spinner } from "./Spinner.js";
import { Tooltip } from "./Tooltip.js";

type Breakpoint = "sm" | "md" | "lg";

export interface IconActionProps {
  /** Names the action for screen readers and shows as its tooltip, so an icon alone is never mute. */
  label: string;
  icon: LucideIcon;
  onClick?: (() => void) | undefined;
  to?: string | EntityRef | undefined;
  variant?: "ghost" | "secondary" | "primary";
  size?: ButtonSize;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  /** A mono corner badge, such as a countdown or a count. */
  badge?: string | number | undefined;
  /** The text label shows beside the icon from this width up. Leave it out for icon only. */
  labelFrom?: Breakpoint | undefined;
  className?: string | undefined;
}

const VARIANTS = {
  ghost: "border-transparent text-ink-3 hover:bg-hover hover:text-ink-2",
  secondary: "border-line-strong text-ink-2 hover:bg-hover hover:text-ink",
  primary:
    "border-transparent bg-accent-fill font-semibold text-accent-on hover:bg-accent-fill-hover",
} as const;

const SIZES: Record<ButtonSize, string> = {
  sm: "h-(--kr-control-sm)",
  md: "h-(--kr-control-h)",
  lg: "h-(--kr-control-lg)",
};

const SQUARE: Record<ButtonSize, string> = {
  sm: "w-(--kr-control-sm)",
  md: "w-(--kr-control-h)",
  lg: "w-(--kr-control-lg)",
};

const WIDE_FROM: Record<Breakpoint, string> = {
  sm: "sm:w-auto sm:gap-2 sm:px-3",
  md: "md:w-auto md:gap-2 md:px-3",
  lg: "lg:w-auto lg:gap-2 lg:px-3",
};

const LABEL_FROM: Record<Breakpoint, string> = {
  sm: "max-sm:sr-only",
  md: "max-md:sr-only",
  lg: "max-lg:sr-only",
};

const BASE =
  "relative inline-flex shrink-0 select-none items-center justify-center rounded-sm border text-ui font-medium transition-[background-color,color,scale] duration-100 ease-out enabled:active:scale-[0.98] aria-disabled:cursor-not-allowed disabled:cursor-not-allowed disabled:border-transparent disabled:bg-active disabled:text-ink-3 aria-busy:cursor-progress [&_svg]:size-4";

/**
 * A button that is an icon until there is room for its word. It always carries a tooltip and an
 * accessible name, and with `to` it is a link.
 */
export function IconAction({
  label,
  icon: Glyph,
  onClick,
  to,
  variant = "secondary",
  size = "md",
  loading = false,
  disabled = false,
  badge,
  labelFrom,
  className,
}: IconActionProps) {
  const classes = cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    SQUARE[size],
    labelFrom && WIDE_FROM[labelFrom],
    className,
  );
  const inner = (
    <>
      {loading ? <Spinner size="sm" label="" /> : <Glyph aria-hidden="true" />}
      {labelFrom ? <span className={LABEL_FROM[labelFrom]}>{label}</span> : null}
      {badge !== undefined && badge !== "" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-1.5 -right-1.5 min-w-4 rounded-full border border-line bg-surface px-1 text-center font-mono text-caption leading-4 tabular-nums text-ink-2"
        >
          {badge}
        </span>
      ) : null}
    </>
  );
  const name = labelFrom ? undefined : label;
  const href = typeof to === "string" || to === undefined ? to : entityPath(to);
  return (
    <Tooltip content={label}>
      {href ? (
        <Link to={href} aria-label={name} className={classes}>
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={name}
          disabled={disabled || loading}
          aria-busy={loading || undefined}
          onClick={onClick}
          className={classes}
        >
          {inner}
        </button>
      )}
    </Tooltip>
  );
}
