import { cn } from "../../lib/cn.js";
import { Checkbox } from "./Checkbox.js";

/**
 * A row's checkbox inside a 44px touch target. It sits above the row's stretched link, so a tap
 * on the box toggles the row and never opens it.
 */
export function SelectBox({
  id,
  label,
  checked,
  disabled,
  indeterminate,
  onChange,
  className,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative z-10 flex min-h-11 min-w-11 cursor-pointer items-center justify-center pointer-fine:lg:min-h-0 pointer-fine:lg:min-w-0",
        className,
      )}
    >
      <Checkbox
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        indeterminate={indeterminate ?? false}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
