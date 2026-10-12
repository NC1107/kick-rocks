import type { AgentsResponse, WaitingTask } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { HoldReason, holdLinkLabel } from "../../components/holds/HoldReason.js";
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
import type { StatusShape } from "../../lib/status.js";
import { useNow } from "../../lib/use-now.js";
import { assignmentLine } from "../assign/model.js";
import { ageLabel, KIND_LABELS, type QueueEntry, type ReviewKind } from "./model.js";

interface RowView {
  title: ReactNode;
  reason: string;
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
  mail: "triangle",
  failed: "square",
  agents: "ring",
};

function describe(entry: QueueEntry, agents: AgentsResponse | undefined, now: number): RowView {
  const shape = KIND_SHAPE[entry.kind];
  switch (entry.kind) {
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
    case "failed": {
      const { task, requestReference } = entry.item;
      const failure = describeFailure(task);
      return {
        title: task.targetName ?? "Unknown target",
        // The generic label for a site problem says nothing the badge does not; the worker's own words name what failed.
        reason: failure.group === "site" && task.lastError ? failure.detail : failure.label,
        at: task.updatedAt,
        shape,
        request: requestOf(task.requestId, requestReference),
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
        trailing={!request && view.at ? <Age iso={view.at} /> : null}
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

/**
 * Queued tasks that are held back to keep a site from being flagged. Nothing here needs the
 * person, so the rows are plain and the group sits below everything that does.
 */
function WaitingGroup({ waiting, total }: { waiting: readonly WaitingTask[]; total: number }) {
  if (total === 0) return null;
  const hidden = total - waiting.length;
  const linked = new Set<string>();
  return (
    <Section label="Waiting" count={total}>
      <RowGroup>
        {waiting.map((item) => {
          const link = holdLinkLabel(item.waiting);
          const hideLink = link !== undefined && linked.has(link);
          if (link) linked.add(link);
          return (
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
              description={
                <HoldReason
                  hold={item.waiting}
                  glyph={false}
                  showSite={false}
                  compact
                  hideLink={hideLink}
                />
              }
              wrapDescription
              className="py-1.5"
            />
          );
        })}
        {hidden > 0 ? (
          <p className="px-3.5 py-2 font-mono text-caption text-ink-3">+{hidden} more</p>
        ) : null}
      </RowGroup>
    </Section>
  );
}

export interface QueueListProps {
  entries: readonly QueueEntry[];
  /** The kinds of row this page lists, in the order their groups appear. */
  kinds: readonly ReviewKind[];
  /** What the page says when it has no rows. */
  empty: string;
  waiting?: readonly WaitingTask[];
  waitingTotal?: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Who is connected, to say whether the agent a task is assigned to is online. */
  agents?: AgentsResponse | undefined;
  /** Above the rows, such as the check for new mail. */
  header?: ReactNode;
}

/**
 * The rows of one Review page, grouped under a mono label per kind with its count, then the tasks
 * held back for a site where that page has them.
 */
export function QueueList({
  entries,
  kinds,
  empty,
  waiting = [],
  waitingTotal = 0,
  selectedKey,
  onSelect,
  agents,
  header,
}: QueueListProps) {
  const sections: ReactNode[] = kinds.flatMap((kind) => {
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
    <nav aria-label="Review list" className="flex min-w-0 flex-col gap-3">
      {header}
      {sections.length === 0 ? waitingTotal === 0 ? <EmptyState title={empty} /> : null : sections}
      <WaitingGroup waiting={waiting} total={waitingTotal} />
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
