import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { useFieldControl } from "./Field.js";

export const CONTROL_CLASS =
  "w-full rounded-sm border border-line-strong bg-field px-3 text-ui text-ink transition-colors duration-100 placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-accent-fill disabled:cursor-not-allowed disabled:border-transparent disabled:bg-active disabled:text-ink-3 disabled:hover:border-transparent aria-invalid:border-danger aria-invalid:focus-visible:outline-danger [&[readonly]]:bg-hover";

/** Mono for values that are identifiers or numbers: emails, URLs, model names, counts. */
export const MONO_CLASS = "font-mono text-meta tabular-nums";

export interface InputProps extends ComponentProps<"input"> {
  /** An icon or short text inside the left edge, such as a search glass. */
  leading?: ReactNode;
  trailing?: ReactNode;
  mono?: boolean;
  /** A mono unit after the value, such as "d" or "min". */
  unit?: string;
}

export function Input({ leading, trailing, mono, unit, className, ...rest }: InputProps) {
  const field = useFieldControl();
  const input = (
    <input
      {...field}
      className={cn(
        CONTROL_CLASS,
        "h-control",
        mono && MONO_CLASS,
        leading ? "pl-9" : undefined,
        trailing ? "pr-9" : undefined,
        unit ? "pr-11" : undefined,
        !(leading || trailing || unit) ? className : undefined,
      )}
      {...rest}
    />
  );
  if (!(leading || trailing || unit)) return input;
  return (
    <div className={cn("relative", className)}>
      {leading ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-ink-3 [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {input}
      {unit ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-meta text-ink-3"
        >
          {unit}
        </span>
      ) : null}
      {trailing ? (
        <span className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-3 [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
