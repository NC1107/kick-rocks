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
  "peer size-4.5 shrink-0 cursor-pointer appearance-none border border-line-strong bg-field transition-colors duration-100 hover:border-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-active aria-invalid:border-danger";

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
          "rounded-xs checked:border-accent-fill checked:bg-accent-fill indeterminate:border-accent-fill indeterminate:bg-accent-fill disabled:checked:border-transparent disabled:checked:bg-ink-3 disabled:indeterminate:border-transparent disabled:indeterminate:bg-ink-3",
        )}
        {...rest}
      />
      <Check
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-3 stroke-[3] text-accent-on opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-0"
      />
      <Minus
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-3 stroke-[3] text-accent-on opacity-0 peer-indeterminate:opacity-100"
      />
    </span>
  );

  if (!(label || description)) return <span className={className}>{box}</span>;

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-60",
        description ? "max-sm:py-1.5" : "max-sm:min-h-11 max-sm:items-center",
        className,
      )}
    >
      {box}
      <span className="flex flex-col">
        {label ? <span className="text-ui text-ink">{label}</span> : null}
        {description ? <span className="text-meta text-ink-3">{description}</span> : null}
      </span>
    </label>
  );
}
