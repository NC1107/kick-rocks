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
  /**
   * "row" puts the label and its help on the left and the control on the right, for a settings
   * list. It stacks on a phone, where there is no room for two columns.
   */
  layout?: "stack" | "row";
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
  layout = "stack",
  className,
  children,
}: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const hasError = Boolean(error);
  const describedBy = hasError ? errorId : help ? helpId : undefined;

  const labelNode = (
    <label
      htmlFor={id}
      className={cn(
        "flex items-baseline gap-2 text-caption font-medium text-ink-2",
        layout === "row" && "text-ui text-ink",
        hideLabel && "sr-only",
      )}
    >
      {label}
      {optional ? <span className="text-caption font-normal text-ink-3">Optional</span> : null}
    </label>
  );
  const message = hasError ? (
    <p id={errorId} role="alert" className="text-caption text-danger-text">
      {error}
    </p>
  ) : help ? (
    <p id={helpId} className="text-caption text-ink-3">
      {help}
    </p>
  ) : null;

  if (layout === "row") {
    return (
      <FieldContext value={{ id, describedBy, invalid: hasError }}>
        <div
          className={cn(
            "grid min-w-0 items-center gap-x-6 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_14rem]",
            className,
          )}
        >
          <div className="min-w-0">
            {labelNode}
            {help && !hasError ? message : null}
          </div>
          <div className="min-w-0">{children}</div>
          {hasError ? <div className="sm:col-start-2">{message}</div> : null}
        </div>
      </FieldContext>
    );
  }

  return (
    <FieldContext value={{ id, describedBy, invalid: hasError }}>
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        {labelNode}
        {children}
        {message}
      </div>
    </FieldContext>
  );
}
