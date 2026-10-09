import { Checkbox, TableCell } from "../../components/ui/index.js";

/** The checkbox cell of a target row, with a 44px touch target on phones. */
export function SelectCell({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <TableCell className="w-10 pr-0 max-sm:p-0">
      <label
        htmlFor={id}
        className="relative flex cursor-pointer items-center justify-center max-sm:min-h-11 max-sm:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <Checkbox
          id={id}
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </TableCell>
  );
}
