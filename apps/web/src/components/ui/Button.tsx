import type { ComponentProps, ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "../../lib/cn.js";
import { Spinner } from "./Spinner.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg";

// A disabled button is a flat neutral slab, not a faded copy of its variant, so a washed-out
// accent never reads as an available action.
const DISABLED =
  "[&:is(:disabled,[aria-disabled=true]):not([aria-busy=true])]:cursor-not-allowed [&:is(:disabled,[aria-disabled=true]):not([aria-busy=true])]:border-transparent [&:is(:disabled,[aria-disabled=true]):not([aria-busy=true])]:bg-active [&:is(:disabled,[aria-disabled=true]):not([aria-busy=true])]:text-ink-3 aria-busy:cursor-progress";

const BASE = `inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-medium transition-[background-color,color,scale] duration-100 ease-out enabled:active:scale-[0.98] [&_svg]:size-4 ${DISABLED}`;

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-accent-fill font-semibold text-accent-on hover:bg-accent-fill-hover",
  secondary: "border-line-strong text-ink hover:bg-hover",
  ghost: "border-transparent text-ink-2 hover:bg-hover hover:text-ink",
  danger: "border-danger text-danger-text hover:bg-[rgb(var(--kr-danger-rgb)/0.12)]",
  "danger-solid":
    "border-transparent bg-danger-solid font-semibold text-accent-on hover:bg-danger-solid-hover",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-control-sm px-2.5 text-meta",
  md: "h-control px-3.5 text-ui",
  lg: "h-control-lg px-4 text-ui",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return cn(BASE, VARIANTS[variant], SIZES[size]);
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks clicks while work is in flight. */
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClass(variant, size), className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" label="" /> : null}
      {children}
    </button>
  );
}

export interface LinkButtonProps extends Omit<LinkProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
}

/** A router link that looks like a button, for navigation that is the main action on a page. */
export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: LinkButtonProps) {
  return <Link className={cn(buttonClass(variant, size), className)} {...rest} />;
}
