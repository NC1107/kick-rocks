import type { Dashboard, DashboardEvent, RequestStatus } from "@kickrocks/shared";
import { ChevronRight, CircleCheck } from "lucide-react";
import { Link } from "react-router";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  LinkButton,
  StatusPill,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { describeEvent } from "../../lib/events.js";
import { formatCount, formatRelative, pluralize } from "../../lib/format.js";

/** The three questions a person has about their requests, each answered by some statuses. */
export const STATUS_GROUPS: readonly {
  id: string;
  title: string;
  tone: "blue" | "green" | "amber";
  statuses: readonly RequestStatus[];
}[] = [
  {
    id: "active",
    title: "In progress",
    tone: "blue",
    statuses: ["draft", "queued", "sent", "awaiting_reply", "follow_up_due"],
  },
  {
    id: "resolved",
    title: "Resolved",
    tone: "green",
    statuses: ["confirmed", "no_record", "cancelled"],
  },
  {
    id: "stuck",
    title: "Needs a look",
    tone: "amber",
    statuses: ["needs_verification", "rejected", "bounced", "no_response"],
  },
];

export function groupTotal(
  counts: Partial<Record<RequestStatus, number>>,
  statuses: readonly RequestStatus[],
) {
  return statuses.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

export function StatusCard({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Card>
      <CardHeader
        title="Requests"
        description={`${pluralize(dashboard.total, "request")} in total.`}
      />
      <div className="grid gap-x-6 gap-y-6 sm:grid-cols-3">
        {STATUS_GROUPS.map((group) => {
          const present = group.statuses.filter((status) => (dashboard.counts[status] ?? 0) > 0);
          return (
            <section key={group.id} data-tone={group.tone} aria-labelledby={`group-${group.id}`}>
              <h3 id={`group-${group.id}`} className="text-sm font-normal text-ink-muted">
                {group.title}
              </h3>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                {formatCount(groupTotal(dashboard.counts, group.statuses))}
              </p>
              <span aria-hidden="true" className="mt-2 block h-1 w-8 rounded-full bg-tone-dot" />
              <ul className="m-0 mt-4 list-none divide-y divide-line border-t border-line p-0">
                {present.map((status) => (
                  <li key={status} className="flex items-center justify-between gap-3 py-2">
                    <Link
                      to={`/requests?status=${status}`}
                      className="rounded-full focus-visible:outline-2"
                    >
                      <StatusPill status={status} />
                    </Link>
                    <span className="text-base font-medium tabular-nums text-ink">
                      {formatCount(dashboard.counts[status] ?? 0)}
                    </span>
                  </li>
                ))}
                {present.length === 0 ? (
                  <li className="py-2 text-sm text-ink-faint">None</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}

interface AttentionItem {
  count: number;
  title: string;
  detail: string;
}

export function attentionItems(attention: Dashboard["attention"]): AttentionItem[] {
  return [
    {
      count: attention.blockedTasks,
      title: attention.blockedTasks === 1 ? "Blocked task" : "Blocked tasks",
      detail: "A site needs a person to finish a step.",
    },
    {
      count: attention.pendingMatches,
      title: attention.pendingMatches === 1 ? "Record to confirm" : "Records to confirm",
      detail: "Say whether a listing the scan found is you.",
    },
    {
      count: attention.needsVerification,
      title: "Brokers asking for details",
      detail: "Approve what to send in reply.",
    },
    {
      count: attention.unreviewedMessages,
      title: attention.unreviewedMessages === 1 ? "Reply to sort" : "Replies to sort",
      detail: "Mail Kick Rocks could not classify on its own.",
    },
    {
      count: attention.agentTasks,
      title:
        attention.agentTasks === 1 ? "Task waiting for an agent" : "Tasks waiting for an agent",
      detail: "Connect an agent, or finish them by hand.",
    },
    {
      count: attention.failedTasks,
      title: attention.failedTasks === 1 ? "Failed task" : "Failed tasks",
      detail: "Retry them, or finish them by hand.",
    },
  ].filter((item) => item.count > 0);
}

export function AttentionCard({ attention }: { attention: Dashboard["attention"] }) {
  const items = attentionItems(attention);
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader title="Needs you" />
        <p className="flex items-center gap-2 text-base text-ink-muted">
          <CircleCheck aria-hidden="true" className="size-4.5 shrink-0 text-ink-faint" />
          Nothing is waiting on you.
        </p>
      </Card>
    );
  }
  return (
    <Card padding="none">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHeader title="Needs you" className="mb-2" />
      </div>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {items.map((item) => (
          <li key={item.title}>
            <Link
              to="/review"
              className="flex items-center gap-3 px-4 py-3 hover:bg-sunken focus-visible:outline-offset-[-2px] sm:px-5"
            >
              <span
                data-tone="amber"
                className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-tone-bg px-2 text-sm font-semibold tabular-nums text-tone-ink"
              >
                {formatCount(item.count)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium text-ink">{item.title}</span>
                <span className="block text-sm text-ink-muted">{item.detail}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SendingCard({ dashboard }: { dashboard: Dashboard }) {
  const { sending, mailbox } = dashboard;
  if (!(sending && mailbox)) return null;
  const used = sending.cap > 0 ? Math.min(1, sending.sent / sending.cap) : 0;
  const full = sending.remaining === 0;
  return (
    <Card>
      <CardHeader title="Sending" description="Emails sent in the last 24 hours." />
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-semibold tabular-nums text-ink">
          {formatCount(sending.sent)}
          <span className="text-base font-normal text-ink-muted">
            {" "}
            of {formatCount(sending.cap)}
          </span>
        </p>
        <p className="text-sm text-ink-muted">{formatCount(sending.remaining)} left</p>
      </div>
      <div
        role="progressbar"
        aria-label="Daily sending limit used"
        aria-valuemin={0}
        aria-valuemax={sending.cap}
        aria-valuenow={sending.sent}
        data-tone={full ? "amber" : "blue"}
        className="mt-3 h-2 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-tone-dot" style={{ width: `${used * 100}%` }} />
      </div>
      {full ? (
        <p className="mt-3 text-sm text-ink-muted">
          At the limit. Requests wait until earlier ones are a day old.
        </p>
      ) : null}
      <p className="mt-4 border-t border-line pt-3 text-sm text-ink-muted">
        <span className="break-all">{mailbox.address}</span>
        <br />
        {mailbox.lastPolledAt
          ? `Inbox checked ${formatRelative(mailbox.lastPolledAt)}.`
          : "Inbox not checked yet."}
      </p>
    </Card>
  );
}

export function MailboxNotices({
  dashboard,
  profileId,
  showMissing,
}: {
  dashboard: Dashboard;
  profileId: string;
  showMissing: boolean;
}) {
  const manage = `/profiles/${profileId}/mailbox`;
  if (!dashboard.mailbox) {
    if (!showMissing) return null;
    return (
      <Alert
        intent="warning"
        title="No mailbox connected"
        action={
          <LinkButton to={manage} size="sm">
            Connect a mailbox
          </LinkButton>
        }
      >
        Requests need an email account to go out from. They wait in the queue until one is
        connected.
      </Alert>
    );
  }
  if (!dashboard.mailbox.lastError) return null;
  return (
    <Alert
      intent="danger"
      title="The mailbox is not working"
      action={
        <LinkButton to={manage} size="sm">
          Check mailbox
        </LinkButton>
      }
    >
      {dashboard.mailbox.lastError}
    </Alert>
  );
}

export function ActivityList({ events }: { events: readonly DashboardEvent[] }) {
  if (events.length === 0) {
    return <p className="text-base text-ink-muted">Nothing has happened yet.</p>;
  }
  return (
    <ul className="m-0 -mt-1 list-none divide-y divide-line p-0">
      {events.map((event) => (
        <li
          key={event.id}
          className={cn(
            "grid gap-0.5 py-3 first:pt-1 last:pb-0",
            "sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6",
          )}
        >
          <div className="min-w-0">
            <p className="text-base text-ink">{describeEvent(event)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
              <Link
                to={`/requests/${event.requestId}`}
                className="rounded-xs font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                {event.targetName}
              </Link>
              <Badge variant="outline">{event.requestReference}</Badge>
            </p>
          </div>
          <time
            dateTime={event.createdAt}
            className="text-sm text-ink-muted sm:pt-0.5 sm:text-right"
          >
            {formatRelative(event.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
