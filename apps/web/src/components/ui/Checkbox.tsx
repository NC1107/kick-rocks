import { Check, Minus } from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../../lib/cn.js";

export interface CheckboxProps extends Omit<ComponentProps<"input">, "type"> {
  label?: ReactNode;
  description?: ReactNode;
  /** A select-all box when only some of its rows are selected. */
  indeterminate?: boolean;
}

export const BOX_CLASS =
  "peer size-4.5 shrink-0 cursor-pointer appearance-none border border-line-strong bg-field transition-colors duration-100 hover:border-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-sunken aria-invalid:border-danger";

/**
 * With no visible label, pass aria-label: a checkbox in a table row still needs a name.
 */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  className,
  ...rest
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const id = rest.id ?? generatedId;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const box = (
    <span className="relative mt-px inline-flex shrink-0">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          BOX_CLASS,
          "rounded-xs checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent",
        )}
        {...rest}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-accent-ink opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto size-3 text-accent-ink opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  );

  if (!(label || description)) return <span className={className}>{box}</span>;

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-60",
        className,
      )}
    >
      {box}
      <span className="flex flex-col">
        {label ? <span className="text-base text-ink">{label}</span> : null}
        {description ? <span className="text-sm text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
