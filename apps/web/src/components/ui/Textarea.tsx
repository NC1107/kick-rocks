import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.js";
import { useFieldControl } from "./Field.js";
import { CONTROL_CLASS } from "./Input.js";

export function Textarea({ className, rows = 4, ...rest }: ComponentProps<"textarea">) {
  const field = useFieldControl();
  return (
    <textarea
      {...field}
      rows={rows}
      className={cn(CONTROL_CLASS, "min-h-20 resize-y py-2", className)}
      {...rest}
    />
  );
}
