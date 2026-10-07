import { CircleAlert } from "lucide-react";
import { createContext, type ReactNode, useContext, useId } from "react";
import { cn } from "../../lib/cn.js";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Props a form control inherits from the Field around it: its id, its help, and its error. */
export function useFieldControl(): {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
} {
  const field = useContext(FieldContext);
  if (!field) return {};
  return {
    id: field.id,
    ...(field.describedBy ? { "aria-describedby": field.describedBy } : {}),
    ...(field.invalid ? { "aria-invalid": true as const } : {}),
  };
}

export interface FieldProps {
  label: ReactNode;
  /** Guidance shown under the control. */
  help?: ReactNode;
  /** Shown instead of the help when set, and marks the control invalid. */
  error?: ReactNode;
  /** Marks a field the person can skip. Required is the default, so it carries no mark. */
  optional?: boolean;
  /** Hides the label visually while keeping it for screen readers, such as a search box. */
  hideLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Wraps one control with its label, help text, and error. The control picks up its id and
 * aria-describedby from here, so a label click focuses it and a screen reader reads the help.
 */
export function Field({
  label,
  help,
  error,
  optional,
  hideLabel,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const hasError = Boolean(error);
  const describedBy = hasError ? errorId : help ? helpId : undefined;

  return (
    <FieldContext value={{ id, describedBy, invalid: hasError }}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <label
          htmlFor={id}
          className={cn(
            "flex items-baseline gap-2 text-sm font-medium text-ink",
            hideLabel && "sr-only",
          )}
        >
          {label}
          {optional ? <span className="text-xs font-normal text-ink-faint">Optional</span> : null}
        </label>
        {children}
        {hasError ? (
          <p id={errorId} className="flex items-start gap-1.5 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : help ? (
          <p id={helpId} className="text-sm text-ink-muted">
            {help}
          </p>
        ) : null}
      </div>
    </FieldContext>
  );
}
