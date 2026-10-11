import type { Dashboard, DashboardEvent, RequestStatus, ScanHoldReason } from "@kickrocks/shared";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { HoldReason } from "../../components/holds/HoldReason.js";
import {
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
import { describeEvent } from "../../lib/events.js";
import { formatCount } from "../../lib/format.js";
import { paths } from "../../lib/paths.js";
import { EventRow } from "../requests/EventRow.js";
import { eventShape } from "../requests/event-shape.js";

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

interface AttentionRow {
  count: number;
  title: string;
  to: string;
  /** Failures take the danger color; everything else that waits on the person takes attention. */
  failed?: true;
}

/** The places beside the Needs you queue that hold something, shown only when they do. */
export function attentionRows(attention: Dashboard["attention"]): AttentionRow[] {
  return [
    {
      count: attention.unreviewedMessages,
      title: "Mail to sort",
      to: paths.reviewSection("mail"),
    },
    {
      count: attention.failedTasks,
      title: "Problems",
      to: paths.reviewSection("problems"),
      failed: true as const,
    },
    {
      count: attention.agentTasks,
      title: "Waiting on agents",
      to: paths.reviewSection("agents"),
    },
  ].filter((row) => row.count > 0);
}

/** Whether anything on the dashboard's Needs you card has something to say. */
export function hasAttention(attention: Dashboard["attention"]): boolean {
  const { needsYou } = attention;
  return needsYou.active > 0 || needsYou.snoozed > 0 || attentionRows(attention).length > 0;
}

function breakdown({ quick, few, longer }: Dashboard["attention"]["needsYou"]): string {
  return [
    quick > 0 ? `${quick} quick` : null,
    few > 0 ? `${few} few min` : null,
    longer > 0 ? `${longer} longer` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function AttentionSection({ attention }: { attention: Dashboard["attention"] }) {
  const { needsYou } = attention;
  const rows = attentionRows(attention);
  return (
    <Section label="Needs you" count={formatCount(needsYou.active)}>
      <RowGroup>
        {needsYou.active === 0 ? (
          <Row title="Nothing needs you." />
        ) : (
          <Row
            title={`${needsYou.active} to do · about ${needsYou.minutes} min`}
            description={<span className="font-mono">{breakdown(needsYou)}</span>}
            trailing={
              <LinkButton to={paths.review()} variant="primary" size="sm">
                Start
              </LinkButton>
            }
          />
        )}
        {rows.map((row) => (
          <Row
            key={row.title}
            to={row.to}
            title={row.title}
            trailing={
              <>
                <Count
                  value={row.count}
                  tone={row.failed ? "danger" : "attention"}
                  className="text-ui font-medium"
                />
                <ChevronRight aria-hidden="true" className="size-4 text-ink-3" />
              </>
            }
          />
        ))}
      </RowGroup>
      {needsYou.snoozed > 0 ? (
        <p className="mt-2 text-meta">
          <TextLink to={paths.reviewSnoozed()}>{needsYou.snoozed} snoozed</TextLink>
        </p>
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
          to={paths.reviewSection("scans")}
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
