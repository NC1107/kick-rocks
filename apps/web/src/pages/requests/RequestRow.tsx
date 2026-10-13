import { isActiveStatus, type RequestListItem } from "@kickrocks/shared";
import { EntityLink, StatusShapeGlyph, Tooltip } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { formatShortDate } from "../../lib/format.js";
import { CHANNEL_LABELS } from "../../lib/labels.js";
import { REQUEST_STATUS_META, type StatusFamily } from "../../lib/status.js";
import { RIGHT_TOKENS } from "./format.js";
import { listShape } from "./grouping.js";

export const PHRASE_TONE: Record<StatusFamily, string> = {
  progress: "text-ink-2",
  resolved: "text-ink-2",
  closed: "text-ink-2",
  needs: "font-medium text-attention-text",
  failed: "font-medium text-danger-text",
};

/** "email · delete · due Nov 13", or "sent Oct 6" once nothing more is expected. */
export function metaLine(item: RequestListItem, profileName?: string): string {
  const waiting = item.dueAt && isActiveStatus(item.status);
  const date = waiting
    ? `${item.status === "follow_up_due" ? "follow-up due" : "due"} ${formatShortDate(item.dueAt as string)}`
    : item.sentAt
      ? `sent ${formatShortDate(item.sentAt)}`
      : null;
  const asked = item.rights.map((right) => RIGHT_TOKENS[right]).join(" + ");
  return [profileName, CHANNEL_LABELS[item.channel].toLowerCase(), asked, date]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(" · ");
}

/** One request: the company, one plain phrase for where it stands, and a mono line of channel and date. */
export function RequestRow({ item, profileName }: { item: RequestListItem; profileName?: string }) {
  const meta = REQUEST_STATUS_META[item.status];
  return (
    <li className="relative flex min-h-11 items-center gap-3 px-3.5 py-2 hover:bg-hover active:bg-hover">
      <StatusShapeGlyph shape={listShape(item.status)} />
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 sm:grid-cols-[minmax(0,16rem)_9rem_minmax(0,1fr)] sm:items-center">
        <EntityLink
          variant="row"
          to={{
            kind: "request",
            id: item.id,
            reference: item.reference,
            targetName: item.target.name,
          }}
          className="min-w-0 truncate text-ui font-semibold text-ink"
        >
          {item.target.name}
        </EntityLink>
        <div className="flex min-w-0 flex-col gap-0.5 sm:contents">
          <Tooltip content={meta.description}>
            <span className={cn("text-meta", PHRASE_TONE[meta.family])}>{meta.label}</span>
          </Tooltip>
          <span className="truncate font-mono text-caption text-ink-3 tabular-nums sm:text-right">
            {metaLine(item, profileName)}
          </span>
        </div>
      </div>
    </li>
  );
}
