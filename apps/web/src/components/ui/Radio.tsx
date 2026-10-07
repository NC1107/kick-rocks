import { type ReactNode, useId } from "react";
import { cn } from "../../lib/cn.js";
import { BOX_CLASS } from "./Checkbox.js";

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
  legend: ReactNode;
  hideLegend?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  name?: string;
  value: V | null;
  onValueChange: (value: V) => void;
  options: readonly RadioOption<V>[];
  /** Lay the options out in a row when there is room. */
  inline?: boolean;
  className?: string;
}

/** A single choice from a few options. Use a Select when there are more than about six. */
export function RadioGroup<V extends string>({
  legend,
  hideLegend,
  help,
  error,
  name,
  value,
  onValueChange,
  options,
  inline,
  className,
}: RadioGroupProps<V>) {
  const generated = useId();
  const groupName = name ?? generated;
  const helpId = `${generated}-help`;
  const errorId = `${generated}-error`;
  const describedBy = error ? errorId : help ? helpId : undefined;

  return (
    <fieldset
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      className={cn("m-0 flex min-w-0 flex-col gap-2 border-0 p-0", className)}
    >
      <legend className={cn("mb-1 p-0 text-sm font-medium text-ink", hideLegend && "sr-only")}>
        {legend}
      </legend>
      <div className={cn("flex gap-x-6 gap-y-2.5", inline ? "flex-wrap" : "flex-col")}>
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <span className="relative mt-px inline-flex shrink-0">
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                onChange={() => onValueChange(option.value)}
                className={cn(
                  BOX_CLASS,
                  "rounded-full checked:border-accent checked:bg-accent disabled:checked:border-ink-faint disabled:checked:bg-ink-faint",
                )}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 m-auto size-1.5 rounded-full bg-accent-ink opacity-0 peer-checked:opacity-100"
              />
            </span>
            <span className="flex flex-col">
              <span className="text-base text-ink">{option.label}</span>
              {option.description ? (
                <span className="text-sm text-ink-muted">{option.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-sm text-ink-muted">
          {help}
        </p>
      ) : null}
    </fieldset>
  );
}
