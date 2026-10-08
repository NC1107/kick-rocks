import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.js";
import type { ButtonSize } from "./Button.js";
import { Spinner } from "./Spinner.js";
import { Tooltip } from "./Tooltip.js";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "aria-label"> {
  /** Names the button for screen readers and shows as its tooltip. An icon alone says nothing. */
  label: string;
  variant?: "ghost" | "secondary";
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANTS = {
  ghost: "text-ink-3 hover:bg-hover hover:text-ink-2",
  secondary: "border border-line-strong text-ink-2 hover:bg-hover hover:text-ink",
} as const;

const SIZES: Record<ButtonSize, string> = {
  sm: "size-(--kr-control-sm)",
  md: "size-(--kr-control-h)",
  lg: "size-(--kr-control-lg)",
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
    <Tooltip content={label}>
      <button
        type={type}
        aria-label={label}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-sm transition-[background-color,color,scale] duration-100 ease-out enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-active disabled:text-ink-3 disabled:hover:bg-active [&_svg]:size-4",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {loading ? <Spinner size="sm" label="" /> : children}
      </button>
    </Tooltip>
  );
}
