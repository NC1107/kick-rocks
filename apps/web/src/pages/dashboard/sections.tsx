import { type Dashboard, listingRollup, type RequestStatus } from "@kickrocks/shared";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { needsYouTotal } from "../../api/index.js";
import {
  Button,
  Count,
  LinkButton,
  RelativeTime,
  Row,
  RowGroup,
  Section,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { formatCount, formatShortDate, pluralize } from "../../lib/format.js";
import { paths } from "../../lib/paths.js";

/** The three questions a person has about their removals, each answered by some request statuses. */
export const STATUS_GROUPS: readonly {
  id: string;
  title: string;
  /** The dot color: ink, positive, or attention, never the accent. */
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
    title: "Done",
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

export interface ChecklistStep {
  id: "password" | "profile" | "mailbox" | "scan";
  title: string;
  sentence: string;
  done: boolean;
  to?: string;
}

/**
 * Setup is derived from data the app already has. The password and the profile are done by the time
 * this page renders, since the session and the profile gate stand in front of it.
 */
export function checklistSteps(dashboard: Dashboard, profileId: string): ChecklistStep[] {
  return [
    {
      id: "password",
      title: "Password",
      sentence: "Protects this instance.",
      done: true,
    },
    {
      id: "profile",
      title: "Your profile",
      sentence: "Who to look for and remove.",
      done: true,
      to: "/profiles/new",
    },
    {
      id: "mailbox",
      title: "Mailbox",
      sentence: "Needed to email removals. Scans work without it.",
      done: dashboard.mailbox !== null,
      to: paths.mailbox(profileId),
    },
    {
      id: "scan",
      title: "First scan",
      sentence: "Find out where you're listed.",
      done: dashboard.listings.lastScanAt !== null,
    },
  ];
}

const CHEVRON = <ChevronRight aria-hidden="true" className="size-4 text-ink-3" />;

function StepMark({ done }: { done: boolean }) {
  return done ? (
    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-positive" />
  ) : (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full border-[1.5px] border-ink-3"
    />
  );
}

export function SetupChecklist({
  steps,
  onScan,
}: {
  steps: readonly ChecklistStep[];
  onScan: () => void;
}) {
  const done = steps.filter((step) => step.done).length;
  if (done === steps.length) return null;
  return (
    <Section label="Get set up" count={`${done} of ${steps.length}`}>
      <RowGroup>
        {steps.map((step) => {
          const base = {
            leading: <StepMark done={step.done} />,
            title: (
              <span className={cn(step.done && "text-ink-2")}>
                {step.title}
                <span className="sr-only">{step.done ? " (done)" : " (to do)"}</span>
              </span>
            ),
            description: step.sentence,
          };
          if (step.done) return <Row key={step.id} {...base} />;
          return step.to ? (
            <Row key={step.id} {...base} to={step.to} trailing={CHEVRON} />
          ) : (
            <Row key={step.id} {...base} onClick={onScan} trailing={CHEVRON} />
          );
        })}
      </RowGroup>
    </Section>
  );
}

export function Hero({
  listings,
  onScan,
}: {
  listings: Dashboard["listings"];
  onScan: () => void;
}) {
  const totals = listingRollup(listings.counts);
  const scanned = listings.lastScanAt !== null;

  let title: ReactNode;
  if (totals.listed > 0) {
    title = (
      <>
        Listed on <span className="font-mono tabular-nums">{totals.listed}</span>{" "}
        {totals.listed === 1 ? "site" : "sites"}
      </>
    );
  } else {
    title = scanned ? "Not listed anywhere we checked" : "Not scanned yet";
  }

  let action: ReactNode = null;
  if (totals.listed > 0) {
    action = (
      <LinkButton to="/findings" variant="primary" size="sm">
        Review findings
      </LinkButton>
    );
  } else if (scanned) {
    action = (
      <Button variant="primary" size="sm" onClick={onScan}>
        Scan again
      </Button>
    );
  }

  return (
    <Section label="Where you're listed">
      <RowGroup>
        <Row
          title={title}
          description={
            totals.listed > 0 ? (
              <span className="font-mono tabular-nums">
                {`${totals.toConfirm} to confirm \u00b7 ${totals.inProgress} in progress \u00b7 ${totals.gone} gone`}
              </span>
            ) : undefined
          }
          trailing={action}
        />
      </RowGroup>
      <p className="mt-2 font-mono text-caption text-ink-3">
        {listings.lastScanAt ? (
          <>
            Last scan <RelativeTime iso={listings.lastScanAt} />
          </>
        ) : (
          "Never scanned"
        )}
        {listings.nextRescanAt ? ` \u00b7 next ${formatShortDate(listings.nextRescanAt)}` : ""}
      </p>
    </Section>
  );
}

export function NeedsYouSection({ attention }: { attention: Dashboard["attention"] }) {
  const total = needsYouTotal(attention);
  if (total === 0) return <p className="mt-2.5 text-ui text-ink-3">Nothing needs you</p>;
  return (
    <Section label="Needs you" count={formatCount(total)}>
      <RowGroup>
        <Row
          title={`${pluralize(total, "thing")} to do · about ${attention.needsYou.minutes} min`}
          trailing={
            <LinkButton to={paths.review()} size="sm">
              Start
            </LinkButton>
          }
        />
      </RowGroup>
    </Section>
  );
}

/** A group opens its own status filter when one status holds all of it; the list filters by one status at a time. */
function groupLink(dashboard: Dashboard, statuses: readonly RequestStatus[]): string {
  const present = statuses.filter((status) => (dashboard.counts[status] ?? 0) > 0);
  const only = present.length === 1 ? present[0] : undefined;
  return paths.requests(only ? { status: only } : {});
}

export function RemovalsSection({ dashboard }: { dashboard: Dashboard }) {
  if (dashboard.total === 0) {
    return <p className="mt-2.5 text-ui text-ink-3">No removals yet</p>;
  }
  return (
    <section className="min-w-0">
      <div className="mt-2.5 mb-1.5 flex min-h-5 items-center">
        <h2 className="text-eyebrow font-semibold! text-ink-3">
          <Link
            to={paths.requests()}
            className="rounded-xs hover:text-ink-2 focus-visible:-outline-offset-2"
          >
            {`Removals · ${formatCount(dashboard.total)}`}
          </Link>
        </h2>
      </div>
      <RowGroup>
        {STATUS_GROUPS.map((group) => (
          <Row
            key={group.id}
            to={groupLink(dashboard, group.statuses)}
            leading={
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", group.fill)} />
            }
            title={group.title}
            trailing={
              <Count value={groupTotal(dashboard.counts, group.statuses)} className="text-ui" />
            }
          />
        ))}
      </RowGroup>
    </section>
  );
}
