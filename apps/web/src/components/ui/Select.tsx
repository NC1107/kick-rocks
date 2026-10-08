import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.js";
import { useFieldControl } from "./Field.js";
import { CONTROL_CLASS, MONO_CLASS } from "./Input.js";

/** A native select, so the list, keyboard use, and phone pickers behave the way people expect. */
export function Select({
  className,
  mono,
  children,
  ...rest
}: ComponentProps<"select"> & { mono?: boolean }) {
  const field = useFieldControl();
  return (
    <div className={cn("relative", className)}>
      <select
        {...field}
        className={cn(
          CONTROL_CLASS,
          "h-control cursor-pointer appearance-none pr-9",
          mono && MONO_CLASS,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3"
      />
    </div>
  );
}
