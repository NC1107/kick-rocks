import type { ReactNode } from "react";
import { Field, type FieldProps } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";

/** The width settings pages hold to. The empty space on its right is accepted. */
export const SETTINGS_WIDTH = "max-w-[45rem]";

/** One form control as a row of a RowGroup: the label on the left and the control on the right. */
export function FieldRow(props: Omit<FieldProps, "layout">) {
  return (
    <div className="px-3.5 py-2.5">
      <Field layout="row" {...props} />
    </div>
  );
}

/** A row that holds something other than a labelled control, such as a checkbox or a note. */
export function BodyRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-3.5 py-2.5", className)}>{children}</div>;
}

/** The last row of a group: the buttons that save or undo the rows above it. */
export function GroupFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-2 px-3.5 py-2.5", className)}>
      {children}
    </div>
  );
}

/** One quiet line under a group, for what the rows alone do not say. */
export function GroupNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-1.5 text-caption text-ink-3", className)}>{children}</p>;
}

/** A mono value at the trailing edge of a display row. */
export function Value({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("font-mono text-meta tabular-nums text-ink-2", className)}>{children}</span>
  );
}

/** A fact about something: the label on the left, a mono value on the right that wraps on a phone. */
export function FactRow({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-h-row flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2">
      <span className="text-ui font-medium text-ink">{label}</span>
      <span
        className={cn(
          "min-w-0 break-words text-right text-meta text-ink-2 max-sm:text-left",
          mono && "font-mono tabular-nums",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/** A row that describes one action and holds its button, such as export or delete. */
export function ActionRow({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-row flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3.5 py-2.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-ui font-medium text-ink">{title}</p>
        <p className="text-meta text-ink-3">{description}</p>
      </div>
      {children}
    </div>
  );
}
