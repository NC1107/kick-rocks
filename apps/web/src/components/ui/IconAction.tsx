import type { LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.js";
import type { ButtonSize } from "./Button.js";
import { type EntityRef, resolveEntity } from "./EntityLink.js";
import { IconButton, type IconButtonVariant, iconButtonClass } from "./IconButton.js";
import { type FromState, useCurrentPage } from "./PageBack.js";
import { Tooltip } from "./Tooltip.js";

export interface IconActionProps {
  /** Names the action for screen readers and shows as its tooltip. */
  label: string;
  icon: LucideIcon;
  onClick?: (() => void) | undefined;
  /** Makes the action a link. An entity reference also leaves the page as the way back. */
  to?: string | EntityRef | undefined;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** A mono corner badge, such as a countdown or a count. */
  badge?: string | number | undefined;
  /** The text label shows beside the icon from this width up. Leave it out for icon only. */
  labelFrom?: "sm" | "md" | "lg" | undefined;
}

const LABEL_FROM = {
  sm: { button: "sm:w-auto sm:gap-1.5 sm:px-2.5", text: "hidden sm:inline" },
  md: { button: "md:w-auto md:gap-1.5 md:px-2.5", text: "hidden md:inline" },
  lg: { button: "lg:w-auto lg:gap-1.5 lg:px-2.5", text: "hidden lg:inline" },
} as const;

/**
 * An action that is only a glyph on a phone, where text buttons crowd a header. It always carries
 * a tooltip and an accessible name, so the icon never has to explain itself.
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
}: IconActionProps) {
  const from = useCurrentPage();
  const spread = labelFrom ? LABEL_FROM[labelFrom] : null;
  const className = cn("relative", spread?.button, variant === "secondary" && "text-ink");
  const content = (
    <>
      <Glyph aria-hidden="true" />
      {spread ? <span className={cn("text-ui font-medium", spread.text)}>{label}</span> : null}
      {badge === undefined ? null : (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full border border-line bg-surface px-1 text-center font-mono text-caption/[0.875rem] tabular-nums text-ink-2"
        >
          {badge}
        </span>
      )}
    </>
  );

  if (to !== undefined && !disabled) {
    const href = typeof to === "string" ? to : resolveEntity(to, undefined).href;
    if (href) {
      const state: FromState = { from };
      return (
        <Tooltip content={label}>
          <Link
            to={href}
            state={state}
            aria-label={label}
            className={cn(iconButtonClass(variant, size), className)}
          >
            {content}
          </Link>
        </Tooltip>
      );
    }
  }

  return (
    <IconButton
      label={label}
      variant={variant}
      size={size}
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      className={className}
    >
      {content}
    </IconButton>
  );
}
