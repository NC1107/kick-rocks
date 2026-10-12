import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import {
  EntityLink,
  Field,
  type FieldProps,
  IconAction,
  InfoTip,
} from "../../components/ui/index.js";
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

/** A site's domain in mono, leading to its target page when the domain belongs to one. */
export function DomainLink({
  domain,
  targets,
}: {
  domain: string;
  targets: Readonly<Record<string, string>> | undefined;
}) {
  const id = targets?.[domain];
  return id ? (
    <EntityLink to={{ kind: "target", id, name: domain }} variant="quiet" className="font-mono" />
  ) : (
    <span className="font-mono">{domain}</span>
  );
}

/** Puts the form back to what is saved. An icon, because the footer shares its row with Save. */
export function ResetAction({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <IconAction label="Reset to saved" icon={RotateCcw} onClick={onClick} disabled={disabled} />
  );
}

/** A row that holds something other than a labelled control, such as a checkbox or a note. */
export function BodyRow({
  className,
  children,
  row,
}: {
  className?: string;
  children: ReactNode;
  row?: boolean;
}) {
  return (
    <div className={cn("px-3.5 py-2.5", className)} {...(row ? { "data-row": true } : {})}>
      {children}
    </div>
  );
}

/** The last row of a group: the buttons that save or undo the rows above it. */
export function GroupFooter({
  children,
  className,
  row,
}: {
  children: ReactNode;
  className?: string;
  row?: boolean;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-end gap-2 px-3.5 py-2.5", className)}
      {...(row ? { "data-row": true } : {})}
    >
      {children}
    </div>
  );
}

/**
 * One quiet line under a group, for what the rows alone do not say. The rest of the explanation
 * goes in `detail`, behind an info mark, so the line stays one sentence on screen.
 */
export function GroupNote({
  children,
  className,
  detail,
}: {
  children: ReactNode;
  className?: string;
  detail?: string;
}) {
  return (
    <p className={cn("mt-1.5 text-caption text-ink-3", className)}>
      {children}
      {detail ? <InfoTip text={detail} /> : null}
    </p>
  );
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
