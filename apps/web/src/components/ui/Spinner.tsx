import { cn } from "../../lib/cn.js";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Read out by screen readers. Pass an empty string when something nearby already says it. */
  label?: string;
  className?: string;
}

const SIZES = { sm: "size-3.5", md: "size-4.5", lg: "size-6" } as const;

export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} className={cn("inline-flex", className)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className={cn("animate-spin text-current", SIZES[size])}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
