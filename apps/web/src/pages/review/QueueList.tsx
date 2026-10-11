import {
  type AgentsResponse,
  describeReasons,
  type MatchBand,
  type WaitingTask,
} from "@kickrocks/shared";
import { ScanSearch } from "lucide-react";
import type { ReactNode } from "react";
import { HoldReason } from "../../components/holds/HoldReason.js";
import {
  EmptyState,
  EntityLink,
  Kbd,
  Row,
  RowGroup,
  Section,
  StatusShapeGlyph,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { describeFailure } from "../../lib/failures.js";
import { BLOCKED_REASON_LABELS, PROFILE_FIELD_LABELS } from "../../lib/labels.js";
import { paths } from "../../lib/paths.js";
import type { StatusShape } from "../../lib/status.js";
import { useNow } from "../../lib/use-now.js";
import { assignmentLine } from "../assign/model.js";
import { BandTag } from "./MatchFit.js";
import { ageLabel, KIND_LABELS, type QueueEntry, type ReviewKind } from "./model.js";

interface RowView {
  title: ReactNode;
  reason: string;
  band?: MatchBand | undefined;
  at: string | null;
  shape: StatusShape;
  /** The request the item belongs to, which the row links to beside its select button. */
  request?: { id: string; reference: string } | undefined;
}

function requestOf(id: string | null, reference: string | null): RowView["request"] {
  return id && reference ? { id, reference } : undefined;
}

/** Waiting on the person is a triangle, a failure a square, and waiting on an agent a ring. */
const KIND_SHAPE: Record<ReviewKind, StatusShape> = {
  blocked: "triangle",
  yours: "triangle",
  matches: "triangle",
  verifications: "triangle",
  mail: "triangle",
  failed: "square",
  agents: "ring",
};

function describe(entry: QueueEntry, agents: AgentsResponse | undefined, now: number): RowView {
  const shape = KIND_SHAPE[entry.kind];
  switch (entry.kind) {
    case "blocked": {
      const { task, requestReference } = entry.item;
      return {
        title: task.targetName ?? "Unknown target",
        reason: task.blockedReason
          ? BLOCKED_REASON_LABELS[task.blockedReason]
          : task.status === "leased"
            ? "Waiting for you"
            : "Needs you",
        at: task.updatedAt,
        shape,
        request: requestOf(task.requestId, requestReference),
      };
    }
    case "agents": {
      const { task, requestReference } = entry.item;
      return {
        title: task.targetName ?? "Unknown target",
        reason: assignmentLine(task.assignment, agents, now),
        at: task.updatedAt,
        shape,
        request: requestOf(task.requestId, requestReference),
      };
    }
    case "yours": {
      const { task, requestReference } = entry.item;
      return {
        title: task.targetName ?? "Unknown target",
        reason: "No agent will take it",
        at: task.updatedAt,
        shape,
        request: requestOf(task.requestId, requestReference),
      };
    }
    case "failed": {
      const { task, requestReference } = entry.item;
      return {
        title: task.targetName ?? "Unknown target",
        reason: describeFailure(task).label,
        at: task.updatedAt,
        shape,
        request: requestOf(task.requestId, requestReference),
      };
    }
    case "matches":
      return {
        title: entry.match.fields.name,
        reason: [
          `Found on ${entry.match.targetName}`,
          ...describeReasons(entry.match.assessment?.reasons ?? []),
        ].join(" · "),
        band: entry.match.assessment?.band,
        at: null,
        shape,
      };
    case "verifications": {
      const asked = entry.item.requestedFields
        .map((field) => PROFILE_FIELD_LABELS[field].toLowerCase())
        .join(", ");
      return {
        title: entry.item.request.target.name,
        reason: asked ? `Asked for ${asked}` : "Asked for more details",
        at: entry.item.message.receivedAt,
        shape,
        request: requestOf(entry.item.request.id, entry.item.request.reference),
      };
    }
    case "mail":
      return {
        title: entry.message.targetName ?? (
          <span className="font-mono text-meta">{entry.message.fromAddress}</span>
        ),
        reason: entry.message.subject,
        at: entry.message.receivedAt,
        shape,
        request: requestOf(entry.message.requestId, entry.message.requestReference),
      };
  }
}

function Age({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="font-mono text-caption text-ink-3 tabular-nums">
      {ageLabel(iso)}
    </time>
  );
}

function Entry({
  entry,
  selected,
  onSelect,
  agents,
}: {
  entry: QueueEntry;
  selected: boolean;
  onSelect: (key: string) => void;
  agents: AgentsResponse | undefined;
}) {
  const now = useNow();
  const view = describe(entry, agents, now);
  const { request } = view;
  return (
    <div data-entry={entry.key} className="relative">
      <Row
        selected={selected}
        onClick={() => onSelect(entry.key)}
        tabIndex={selected ? 0 : -1}
        leading={<StatusShapeGlyph shape={view.shape} />}
        title={view.title}
        description={view.reason}
        trailing={
          view.band ? (
            <BandTag band={view.band} />
          ) : !request && view.at ? (
            <Age iso={view.at} />
          ) : null
        }
        className={cn("py-1.5", request && "pr-20")}
      />
      {request ? (
        <>
          {view.at ? (
            <span className="pointer-events-none absolute top-1.5 right-3.5">
              <Age iso={view.at} />
            </span>
          ) : null}
          <EntityLink
            to={{ kind: "request", id: request.id, reference: request.reference }}
            variant="quiet"
            className="absolute right-0 bottom-0 inline-flex min-h-8 items-end px-3.5 pb-1 font-mono text-caption pointer-coarse:min-h-11"
          >
            {request.reference}
          </EntityLink>
        </>
      ) : null}
    </div>
  );
}

const KIND_ORDER = Object.keys(KIND_LABELS) as ReviewKind[];

/**
 * Queued tasks that are held back to keep a site from being flagged. Nothing here needs the
 * person, so the rows are plain and the group sits below everything that does.
 */
function WaitingGroup({ waiting, total }: { waiting: readonly WaitingTask[]; total: number }) {
  if (total === 0) return null;
  const hidden = total - waiting.length;
  return (
    <Section label="Waiting" count={total}>
      <RowGroup>
        {waiting.map((item) => (
          <Row
            key={item.taskId}
            leading={<StatusShapeGlyph shape="ring" />}
            title={
              item.targetId ? (
                <EntityLink
                  to={{
                    kind: "target",
                    id: item.targetId,
                    name: item.targetName ?? "Unknown target",
                  }}
                  variant="quiet"
                  className="text-ink"
                />
              ) : (
                (item.targetName ?? "Unknown target")
              )
            }
            description={<HoldReason hold={item.waiting} glyph={false} showSite={false} compact />}
            wrapDescription
            className="py-1.5"
          />
        ))}
        {hidden > 0 ? (
          <p className="px-3.5 py-2 font-mono text-caption text-ink-3">+{hidden} more</p>
        ) : null}
      </RowGroup>
    </Section>
  );
}

export interface QueueListProps {
  entries: readonly QueueEntry[];
  waiting: readonly WaitingTask[];
  waitingTotal: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Who is connected, to say whether the agent a task is assigned to is online. */
  agents?: AgentsResponse | undefined;
}

/**
 * Everything waiting on the person, grouped under a mono label per kind with its count, then the
 * tasks held back for a site, plus the scans entry at the bottom. The list is the whole queue, so nothing hides behind a tab.
 */
export function QueueList({
  entries,
  waiting,
  waitingTotal,
  selectedKey,
  onSelect,
  agents,
}: QueueListProps) {
  const sections: ReactNode[] = KIND_ORDER.flatMap((kind) => {
    const own = entries.filter((entry) => entry.kind === kind);
    if (own.length === 0) return [];
    return [
      <Section key={kind} label={KIND_LABELS[kind]} count={own.length}>
        <RowGroup>
          {own.map((entry) => (
            <Entry
              key={entry.key}
              entry={entry}
              selected={entry.key === selectedKey}
              onSelect={onSelect}
              agents={agents}
            />
          ))}
        </RowGroup>
      </Section>,
    ];
  });

  return (
    <nav aria-label="Review queue" className="flex min-w-0 flex-col gap-3">
      {entries.length === 0 ? <EmptyState title="Nothing needs you." /> : sections}
      <WaitingGroup waiting={waiting} total={waitingTotal} />
      <Section label="Scans">
        <RowGroup>
          <Row
            to={paths.listings()}
            icon={ScanSearch}
            title="Where you're listed"
            description="Scan a site, or see what it found"
          />
        </RowGroup>
      </Section>
      <p className="mt-1 hidden items-center gap-1.5 text-caption text-ink-3 lg:flex">
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        move
        <Kbd>Enter</Kbd>
        open
      </p>
    </nav>
  );
}
