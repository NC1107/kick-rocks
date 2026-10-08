import { type ReactNode, useId } from "react";
import { cn } from "../../lib/cn.js";
import { BOX_CLASS } from "./Checkbox.js";

export interface RadioOption<V extends string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  /** A mono value at the trailing edge in the "rows" variant, such as a count. */
  meta?: ReactNode;
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
  /** Each option is a full-width selectable row in a bordered group, like a settings list. */
  rows?: boolean;
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
  rows,
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
      <legend
        className={cn("mb-1 p-0 text-caption font-medium text-ink-2", hideLegend && "sr-only")}
      >
        {legend}
      </legend>
      <div
        className={cn(
          rows
            ? "divide-y divide-line overflow-hidden rounded-md border border-line bg-surface"
            : cn("flex gap-x-6 gap-y-2.5", inline ? "flex-wrap" : "flex-col"),
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            data-selected={rows && value === option.value ? "true" : undefined}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 has-disabled:cursor-not-allowed has-disabled:opacity-60",
              rows &&
                cn(
                  "marked min-h-row items-center px-3.5 py-2 transition-colors duration-100",
                  value === option.value ? "bg-accent-soft" : "hover:bg-hover",
                ),
            )}
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
                  "rounded-full checked:border-accent-fill checked:bg-accent-fill disabled:checked:border-transparent disabled:checked:bg-ink-3",
                )}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 m-auto size-1.5 rounded-full bg-accent-on opacity-0 peer-checked:opacity-100"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-ui text-ink">{option.label}</span>
              {option.description ? (
                <span className="text-meta text-ink-3">{option.description}</span>
              ) : null}
            </span>
            {option.meta ? (
              <span className="shrink-0 font-mono text-meta text-ink-3 tabular-nums">
                {option.meta}
              </span>
            ) : null}
          </label>
        ))}
      </div>
      {error ? (
        <p id={errorId} className="text-caption text-danger-text">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-caption text-ink-3">
          {help}
        </p>
      ) : null}
    </fieldset>
  );
}
