import {
  type Dashboard,
  type DashboardEvent,
  describeAgentTasks,
  type ListingStatus,
  type RequestStatus,
  type ScanHoldReason,
} from "@kickrocks/shared";
import { ScanSearch } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { HoldReason } from "../../components/holds/HoldReason.js";
import {
  Button,
  Callout,
  Count,
  EmptyState,
  EntityLink,
  LinkButton,
  Meter,
  MonoEmails,
  RelativeTime,
  Row,
  RowGroup,
  Section,
  StatusMark,
  TextLink,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { describeEvent } from "../../lib/events.js";
import { formatCount, formatShortDate } from "../../lib/format.js";
import { chipCount } from "../../lib/listings.js";
import { paths } from "../../lib/paths.js";
import { EventRow } from "../requests/EventRow.js";
import { eventShape } from "../requests/event-shape.js";
import { ScanDialog } from "../targets/listings/scanning.js";

/** The three questions a person has about their requests, each answered by some statuses. */
export const STATUS_GROUPS: readonly {
  id: string;
  title: string;
  /** The segment color in the stacked bar: ink, positive, or attention, never the accent. */
  fill: string;
  statuses: readonly RequestStatus[];
}[] = [
  {
    id: "active",
    title: "In progress",
    fill: "bg-ink-3",
    statuses: ["draft", "queued", "sent", "awaiting_reply", "follow_up_due"],
  },
  {
    id: "resolved",
    title: "Resolved",
    fill: "bg-positive",
    statuses: ["confirmed", "no_record", "cancelled"],
  },
  {
    id: "stuck",
    title: "Needs a look",
    fill: "bg-attention",
    statuses: ["needs_verification", "rejected", "bounced", "no_response"],
  },
];

export function groupTotal(
  counts: Partial<Record<RequestStatus, number>>,
  statuses: readonly RequestStatus[],
) {
  return statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

function StackedBar({ dashboard }: { dashboard: Dashboard }) {
  const totals = STATUS_GROUPS.map((group) => ({
    group,
    count: groupTotal(dashboard.counts, group.statuses),
  }));
  const description = totals
    .map(({ group, count }) => `${formatCount(count)} ${group.title.toLowerCase()}`)
    .join(", ");
  return (
    <div
      role="img"
      aria-label={description}
      className="flex h-1.5 gap-px overflow-hidden rounded-full bg-active"
    >
      {totals
        .filter(({ count }) => count > 0)
        .map(({ group, count }) => (
          <span key={group.id} className={group.fill} style={{ flexGrow: count, flexBasis: 0 }} />
        ))}
    </div>
  );
}

export function RequestsSection({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Section
      label="Requests"
      count={formatCount(dashboard.total)}
      actions={
        <TextLink
          to={paths.requests()}
          className="max-sm:inline-flex max-sm:min-h-11 max-sm:items-center pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          All requests
        </TextLink>
      }
    >
      <StackedBar dashboard={dashboard} />
      <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-3">
        {STATUS_GROUPS.map((group) => {
          const present = group.statuses.filter((status) => (dashboard.counts[status] ?? 0) > 0);
          return (
            <section key={group.id} aria-labelledby={`group-${group.id}`} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id={`group-${group.id}`} className="text-eyebrow text-ink-3">
                  {group.title}
                </h3>
                <p className="m-0 font-mono text-numeral text-ink tabular-nums">
                  {formatCount(groupTotal(dashboard.counts, group.statuses))}
                </p>
              </div>
              <ul className="m-0 mt-2 list-none divide-y divide-line border-t border-line p-0">
                {present.map((status) => (
                  <li key={status}>
                    <Link
                      to={paths.requests({ status })}
                      className="-mx-2 flex h-8 items-center justify-between gap-3 rounded-sm px-2 transition-colors duration-100 hover:bg-hover max-sm:h-auto max-sm:min-h-11 pointer-coarse:h-auto pointer-coarse:min-h-11"
                    >
                      <StatusMark status={status} />
                      <span className="font-mono text-meta text-ink-2 tabular-nums">
                        {formatCount(dashboard.counts[status] ?? 0)}
                      </span>
                    </Link>
                  </li>
                ))}
                {present.length === 0 ? (
                  <li className="flex h-8 items-center text-ink-3 max-sm:min-h-11 pointer-coarse:min-h-11">
                    -
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </Section>
  );
}

interface AttentionItem {
  count: number;
  /** The Review group that holds these, so the row opens the list they are in. */
  tab: string;
  title: string;
  detail: string;
  /** Failures take the danger color; everything else that waits on the person takes attention. */
  failed?: true;
  /** The detail answers who has the work, so a phone shows it where other details are dropped. */
  showDetailOnPhone?: boolean;
}

export function attentionItems(attention: Dashboard["attention"]): AttentionItem[] {
  return [
    {
      count: attention.blockedTasks,
      tab: "blocked",
      title: attention.blockedTasks === 1 ? "Blocked task" : "Blocked tasks",
      detail: "A target needs you to finish a step.",
    },
    {
      count: attention.pendingMatches,
      tab: "matches",
      title: attention.pendingMatches === 1 ? "Record to confirm" : "Records to confirm",
      detail: "Say whether a record the scan found is you.",
    },
    {
      count: attention.needsVerification,
      tab: "verifications",
      title: "Targets asking for details",
      detail: "Approve what to send in reply.",
    },
    {
      count: attention.unreviewedMessages,
      tab: "mail",
      title: attention.unreviewedMessages === 1 ? "Reply to sort" : "Replies to sort",
      detail: "Mail that could not be classified.",
    },
    {
      count: attention.agentTasks,
      tab: "agents",
      title:
        attention.agentTasks === 1 ? "Task waiting for an agent" : "Tasks waiting for an agent",
      detail:
        attention.assignedAgentTasks > 0
          ? describeAgentTasks(attention)
          : attention.agentTasks === 1
            ? "Connect an agent, or finish it by hand."
            : "Connect an agent, or finish them by hand.",
      showDetailOnPhone: attention.assignedAgentTasks > 0,
    },
    {
      count: attention.yourAgentTasks,
      tab: "yours",
      title: "Yours to do",
      detail: "You took these. No agent will.",
    },
    {
      count: attention.failedTasks,
      tab: "failed",
      title: attention.failedTasks === 1 ? "Failed task" : "Failed tasks",
      detail:
        attention.failedTasks === 1
          ? "Retry it, or finish it by hand."
          : "Retry them, or finish them by hand.",
      failed: true as const,
    },
  ].filter((item) => item.count > 0);
}

export function AttentionSection({ attention }: { attention: Dashboard["attention"] }) {
  const items = attentionItems(attention);
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <Section label="Needs you" count={formatCount(total)}>
      {items.length === 0 ? (
        <EmptyState title="Nothing needs you." className="py-1" />
      ) : (
        <RowGroup>
          {items.map((item) => (
            <Row
              key={item.title}
              to={paths.reviewTab(item.tab)}
              title={item.title}
              description={
                <span className={item.showDetailOnPhone ? undefined : "max-sm:hidden"}>
                  {item.detail}
                </span>
              }
              trailing={
                <Count
                  value={item.count}
                  tone={item.failed ? "danger" : "attention"}
                  label={item.title.toLowerCase()}
                  className="text-ui font-medium"
                />
              }
            />
          ))}
        </RowGroup>
      )}
    </Section>
  );
}

const LISTING_TILES: readonly {
  chip: string;
  label: string;
  statuses: readonly ListingStatus[];
  tone: "plain" | "attention";
}[] = [
  { chip: "needs_you", label: "To confirm", statuses: ["to_confirm"], tone: "attention" },
  { chip: "yours", label: "Being removed", statuses: ["yours", "relisted"], tone: "plain" },
  { chip: "removed", label: "Removed", statuses: ["removed"], tone: "plain" },
  {
    chip: "not_found",
    label: "Not found",
    statuses: ["not_found", "not_you", "unclear"],
    tone: "plain",
  },
  { chip: "waiting", label: "Waiting", statuses: ["waiting", "scanning"], tone: "plain" },
  { chip: "not_scanned", label: "Not scanned yet", statuses: ["not_scanned"], tone: "plain" },
];

/**
 * Where the person is listed, at a glance, and the one button that starts a scan of every site. A
 * scan needs no campaign, so this is the way in on a phone, where the header holds only the main
 * action.
 */
export function ListingsSection({
  listings,
  profileId,
}: {
  listings: Dashboard["listings"];
  profileId: string;
}) {
  const [scanning, setScanning] = useState(false);
  return (
    <Section
      label="Where you're listed"
      actions={
        <TextLink
          to={paths.listings()}
          className="max-sm:inline-flex max-sm:min-h-11 max-sm:items-center pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          All sites
        </TextLink>
      }
    >
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line">
        {LISTING_TILES.map((tile) => {
          const value = chipCount(listings.counts, tile.statuses);
          return (
            <Link
              key={tile.chip}
              to={paths.listings(tile.chip)}
              className="marked flex min-h-16 flex-col justify-between gap-1 bg-surface px-3 py-2 transition-colors duration-100 hover:bg-hover focus-visible:-outline-offset-2"
            >
              <span className="text-eyebrow text-ink-3">{tile.label}</span>
              <span
                className={cn(
                  "font-mono text-numeral tabular-nums",
                  value > 0 && tile.tone === "attention" ? "text-attention-text" : "text-ink",
                )}
              >
                {formatCount(value)}
              </span>
            </Link>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 font-mono text-caption text-ink-3">
          {listings.lastScanAt ? (
            <>
              Last scan <RelativeTime iso={listings.lastScanAt} />
            </>
          ) : (
            "Never scanned"
          )}
          {listings.nextRescanAt ? `, next rescan ${formatShortDate(listings.nextRescanAt)}` : ""}
        </p>
        <Button onClick={() => setScanning(true)}>
          <ScanSearch aria-hidden="true" />
          Scan all sites
        </Button>
      </div>
      {scanning ? (
        <ScanDialog
          open
          onClose={() => setScanning(false)}
          profileId={profileId}
          selection={{ preset: "people_search" }}
          title="Scan every people-search site?"
          description="Kick Rocks opens each site in the worker's browser, one after another, and searches for this person. Nothing is removed until you confirm a record. Paused and skipped sites are left out."
        />
      ) : null}
    </Section>
  );
}

/** Queued scans that something is holding back, with the reason, so a quiet worker is explained. */
export function ScansSection({
  scans,
  profileId,
}: {
  scans: Dashboard["scans"];
  profileId: string;
}) {
  const groups = Object.entries(scans.byReason).flatMap(([reason, group]) =>
    group ? [{ reason: reason as ScanHoldReason, group }] : [],
  );
  if (scans.held === 0) return null;
  return (
    <Section
      label="Scans held"
      count={formatCount(scans.held)}
      actions={
        <TextLink
          to={paths.listings()}
          className="max-sm:inline-flex max-sm:min-h-11 max-sm:items-center pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
        >
          All scans
        </TextLink>
      }
    >
      <RowGroup>
        {groups.map(({ reason, group }) => (
          <Row
            key={reason}
            title={
              <HoldReason
                hold={{
                  reason,
                  ...(group.until ? { until: group.until } : {}),
                  ...(group.serverClock ? { serverClock: true } : {}),
                }}
                profileId={profileId}
                compact
              />
            }
            wrapTitle
            trailing={
              group.count > 1 ? (
                <Count
                  value={group.count}
                  tone="attention"
                  label={group.count === 1 ? "scan" : "scans"}
                  className="text-ui font-medium"
                />
              ) : undefined
            }
          />
        ))}
      </RowGroup>
    </Section>
  );
}

export function SendingSection({ dashboard }: { dashboard: Dashboard }) {
  const { sending, mailbox } = dashboard;
  if (!(sending && mailbox)) return null;
  const full = sending.remaining === 0;
  return (
    <Section label="Sent in 24 hours">
      <div className="max-w-xl">
        <Meter
          label="Daily sending limit used"
          value={sending.sent}
          max={sending.cap}
          readout={`${formatCount(sending.sent)} of ${formatCount(sending.cap)}`}
        />
        <p className="mt-2 flex flex-wrap gap-x-5 gap-y-0.5 text-meta text-ink-3">
          <span className="font-mono tabular-nums">{formatCount(sending.remaining)} left</span>
          <EntityLink
            to={{ kind: "mailbox", profileId: dashboard.profileId, address: mailbox.address }}
            variant="quiet"
            className="break-all"
          />
          <span>
            {mailbox.lastPolledAt ? (
              <>
                Inbox checked <RelativeTime iso={mailbox.lastPolledAt} />
              </>
            ) : (
              "Inbox not checked yet"
            )}
          </span>
        </p>
        {full ? (
          <p className="mt-2 text-meta text-attention-text">
            At the limit. Requests wait until earlier ones are a day old.
          </p>
        ) : null}
      </div>
    </Section>
  );
}

export function MailboxNotices({
  dashboard,
  profileId,
  showMissing,
  checkReportsError = false,
}: {
  dashboard: Dashboard;
  profileId: string;
  showMissing: boolean;
  /** The result of a check run on this page already shows the mailbox error, so it is not shown twice. */
  checkReportsError?: boolean;
}) {
  const manage = paths.mailbox(profileId);
  if (!dashboard.mailbox) {
    if (!showMissing) return null;
    return (
      <Callout
        intent="warning"
        title="No mailbox connected"
        action={
          <LinkButton to={manage} size="sm">
            Connect a mailbox
          </LinkButton>
        }
      >
        Requests wait in the queue until one is connected.
      </Callout>
    );
  }
  if (!dashboard.mailbox.lastError || checkReportsError) return null;
  return (
    <Callout
      intent="danger"
      title="The mailbox is not working"
      action={
        <LinkButton to={manage} size="sm">
          Check mailbox
        </LinkButton>
      }
    >
      {dashboard.mailbox.lastError}
    </Callout>
  );
}

const ACTIVITY_REQUEST_LIMIT = 6;

type ActivityGroup = {
  /** The newest event of the request, which is the one described. */
  latest: DashboardEvent;
  count: number;
};

/** One entry per request over the whole list, so a busy request cannot repeat or hide the others. */
export function groupActivity(
  events: readonly DashboardEvent[],
  limit = ACTIVITY_REQUEST_LIMIT,
): ActivityGroup[] {
  const byRequest = new Map<string, ActivityGroup>();
  for (const event of events) {
    const group = byRequest.get(event.requestId);
    if (!group) {
      byRequest.set(event.requestId, { latest: event, count: event.eventCount ?? 1 });
      continue;
    }
    if (event.eventCount === undefined) group.count += 1;
    if (Date.parse(event.createdAt) > Date.parse(group.latest.createdAt)) {
      group.latest = event;
      if (event.eventCount !== undefined) group.count = event.eventCount;
    }
  }
  return [...byRequest.values()]
    .sort((a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt))
    .slice(0, limit);
}

export function ActivitySection({ events }: { events: readonly DashboardEvent[] }) {
  const groups = groupActivity(events);
  return (
    <Section label="Recent activity">
      {groups.length === 0 ? (
        <EmptyState title="Nothing has happened yet." className="py-1" />
      ) : (
        <ol className="m-0 list-none p-0">
          {groups.map(({ latest: event, count }) => (
            <EventRow
              key={event.id}
              className="relative"
              shape={eventShape(event)}
              time={<RelativeTime iso={event.createdAt} />}
            >
              <p className="text-ui text-ink">
                <MonoEmails text={describeEvent(event)} />
              </p>
              <p className="flex flex-wrap items-center gap-x-3 text-meta text-ink-3">
                <EntityLink
                  to={{ kind: "target", id: event.targetId, name: event.targetName }}
                  variant="quiet"
                  className="relative min-w-0 break-words"
                />
                <EntityLink
                  to={{
                    kind: "request",
                    id: event.requestId,
                    reference: event.requestReference,
                  }}
                  variant="row"
                />
                {count > 1 ? (
                  <span className="inline-flex items-baseline gap-1">
                    <Count value={count} label="events" />
                    <span aria-hidden="true" className="text-caption">
                      events
                    </span>
                  </span>
                ) : null}
              </p>
            </EventRow>
          ))}
        </ol>
      )}
    </Section>
  );
}
