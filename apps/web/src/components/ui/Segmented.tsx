import { type ReactNode, useId } from "react";
import { cn } from "../../lib/cn.js";

export interface SegmentedOption<V extends string | number> {
  value: V;
  label: ReactNode;
}

export interface SegmentedProps<V extends string | number> {
  legend: string;
  options: readonly SegmentedOption<V>[];
  value: V | null;
  onValueChange: (value: V) => void;
  disabled?: boolean;
  className?: string;
}

/** A few short choices side by side, such as card sizes. Native radios underneath, so arrows and screen readers work. */
export function Segmented<V extends string | number>({
  legend,
  options,
  value,
  onValueChange,
  disabled,
  className,
}: SegmentedProps<V>) {
  const name = useId();
  return (
    <fieldset
      disabled={disabled}
      className={cn("m-0 min-w-0 border-0 p-0 disabled:opacity-60", className)}
    >
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex max-w-full divide-x divide-line-strong overflow-hidden rounded-sm border border-line-strong">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative flex h-control-sm min-w-11 cursor-pointer items-center justify-center px-3 font-mono text-meta tabular-nums transition-colors duration-100 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-focus",
              value === option.value
                ? "bg-accent-soft font-medium text-accent-text"
                : "text-ink-2 hover:bg-hover",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onValueChange(option.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
