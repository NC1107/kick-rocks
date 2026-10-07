import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { useFieldControl } from "./Field.js";

export const CONTROL_CLASS =
  "w-full rounded-md border border-line-strong bg-field px-3 text-ink placeholder:text-ink-faint hover:border-ink-muted focus-visible:border-accent disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-faint disabled:hover:border-line-strong aria-invalid:border-danger aria-invalid:focus-visible:outline-danger [&[readonly]]:bg-sunken";

export interface InputProps extends ComponentProps<"input"> {
  /** An icon or short text inside the left edge, such as a search glass. */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Input({ leading, trailing, className, ...rest }: InputProps) {
  const field = useFieldControl();
  const input = (
    <input
      {...field}
      className={cn(
        CONTROL_CLASS,
        "h-control",
        leading ? "pl-9" : undefined,
        trailing ? "pr-9" : undefined,
        !(leading || trailing) ? className : undefined,
      )}
      {...rest}
    />
  );
  if (!(leading || trailing)) return input;
  return (
    <div className={cn("relative", className)}>
      {leading ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-ink-muted [&_svg]:size-4">
          {leading}
        </span>
      ) : null}
      {input}
      {trailing ? (
        <span className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-muted [&_svg]:size-4">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
