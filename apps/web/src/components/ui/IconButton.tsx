import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.js";
import type { ButtonSize } from "./Button.js";
import { Spinner } from "./Spinner.js";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "aria-label"> {
  /** Names the button for screen readers and shows as its tooltip. An icon alone says nothing. */
  label: string;
  variant?: "ghost" | "secondary";
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANTS = {
  ghost: "text-ink-muted hover:bg-sunken hover:text-ink",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken",
} as const;

const SIZES: Record<ButtonSize, string> = {
  md: "size-(--kr-control-h)",
  sm: "size-[calc(var(--kr-control-h)-0.5rem)]",
};

export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4.5",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" label="" /> : children}
    </button>
  );
}
