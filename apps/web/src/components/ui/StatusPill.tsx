import type { RequestStatus, TaskStatus } from "@kickrocks/shared";
import { cn } from "../../lib/cn.js";
import { REQUEST_STATUS_META, type StatusMeta, TASK_STATUS_META } from "../../lib/status.js";

interface PillProps {
  meta: StatusMeta;
  className?: string | undefined;
}

function Pill({ meta, className }: PillProps) {
  const Icon = meta.icon;
  return (
    <span
      data-tone={meta.tone}
      title={meta.description}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-tone-bg py-0 pr-2.5 pl-2 text-xs font-medium text-tone-ink",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {meta.label}
    </span>
  );
}

export interface StatusPillProps {
  status: RequestStatus;
  className?: string;
}

/** The state of a request. Every status has its own hue, icon, and words. */
export function StatusPill({ status, className }: StatusPillProps) {
  return <Pill meta={REQUEST_STATUS_META[status]} className={className} />;
}

interface TaskStatusPillProps {
  status: TaskStatus;
  className?: string;
}

export function TaskStatusPill({ status, className }: TaskStatusPillProps) {
  return <Pill meta={TASK_STATUS_META[status]} className={className} />;
}
