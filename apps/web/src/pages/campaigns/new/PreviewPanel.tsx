import type { CampaignPreview, RenderedEmail } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { Alert, RowGroup, Section, Skeleton } from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { formatCount, pluralize } from "../../../lib/format.js";
import { SKIP_REASON_LABELS } from "../../../lib/labels.js";
import { advisories, type ChannelCounts, groupSkipped } from "../channels.js";

export const CHANNEL_LABELS: Record<keyof ChannelCounts, string> = {
  email: "email",
  form: "web form",
  manual: "agent or you",
  scan: "scan first",
  skipped: "skipped",
};

const READOUT_ORDER: readonly (keyof ChannelCounts)[] = [
  "email",
  "form",
  "manual",
  "scan",
  "skipped",
];

/**
 * What a campaign would do, counted by the way each target is reached. It is on screen from the
 * start with zeros, so the person always sees where the numbers will appear.
 */
export function ChannelReadout({
  counts,
  loading,
}: {
  counts: ChannelCounts | null;
  loading?: boolean;
}) {
  return (
    <section aria-label="Counts by channel" aria-busy={loading || undefined}>
      <RowGroup>
        {READOUT_ORDER.map((channel) => {
          const value = counts?.[channel] ?? 0;
          return (
            <div
              key={channel}
              className="flex min-h-9 items-center justify-between gap-3 px-3.5 font-mono text-meta"
            >
              <span className="text-ink-2">{CHANNEL_LABELS[channel]}</span>
              {loading ? (
                <>
                  <span className="sr-only">Loading</span>
                  <Skeleton className="h-3.5 w-8" />
                </>
              ) : (
                <span className={cn("tabular-nums", value === 0 ? "text-ink-3" : "text-ink")}>
                  {formatCount(value)}
                </span>
              )}
            </div>
          );
        })}
      </RowGroup>
    </section>
  );
}

export interface FirstTarget {
  id: string;
  name: string;
  channel: keyof ChannelCounts;
}

const FIRST_TARGETS = 6;

/** The first targets a campaign would reach, so the counts above have names behind them. */
export function FirstTargets({ targets }: { targets: readonly FirstTarget[] }) {
  if (targets.length === 0) return null;
  const hidden = targets.length - FIRST_TARGETS;
  return (
    <Section label="First targets" count={targets.length}>
      <RowGroup>
        {targets.slice(0, FIRST_TARGETS).map((target) => (
          <div
            key={target.id}
            className="flex min-h-9 items-center justify-between gap-3 px-3.5 text-ui text-ink"
          >
            <span className="truncate">{target.name}</span>
            <span className="shrink-0 font-mono text-meta text-ink-3">
              {CHANNEL_LABELS[target.channel]}
            </span>
          </div>
        ))}
        {hidden > 0 ? (
          <div className="flex min-h-9 items-center px-3.5 font-mono text-meta text-ink-3">
            and {formatCount(hidden)} more
          </div>
        ) : null}
      </RowGroup>
    </Section>
  );
}

export function SkippedList({ items }: { items: CampaignPreview["items"] }) {
  const groups = groupSkipped(items);
  if (groups.length === 0) return null;
  return (
    <Section
      label="Skipped targets"
      count={items.filter((item) => item.outcome === "skipped").length}
    >
      <RowGroup>
        {groups.map((group) => (
          <details key={group.reason} className="group">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-ui text-ink transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
              <span>{SKIP_REASON_LABELS[group.reason]}</span>
              <span className="flex items-center gap-2 font-mono text-meta text-ink-3 tabular-nums">
                {formatCount(group.items.length)}
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 transition-transform group-open:rotate-180"
                />
              </span>
            </summary>
            <ul className="m-0 list-none px-3.5 pb-2">
              {group.items.map((item) => (
                <li key={item.targetId} className="py-1 text-ui">
                  <span className="text-ink">{item.targetName}</span>
                  {item.detail ? (
                    <span className="block text-meta text-ink-3">{item.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </RowGroup>
    </Section>
  );
}

export function AdvisoryList({ items }: { items: CampaignPreview["items"] }) {
  const flagged = advisories(items);
  if (flagged.length === 0) return null;
  return (
    <Section label="Worth knowing" count={flagged.length}>
      <RowGroup>
        {flagged.map((item) => (
          <div key={item.targetId} className="px-3.5 py-2 text-ui">
            <span className="text-ink">{item.targetName}</span>
            <span className="block text-meta text-attention-text">{item.detail}</span>
          </div>
        ))}
      </RowGroup>
    </Section>
  );
}

export function EmailPreview({
  email,
  fromAddress,
  targetName,
  toAddress,
}: {
  email: RenderedEmail;
  fromAddress: string | null;
  targetName: string | null;
  toAddress: string | null;
}) {
  return (
    <Section label="Email preview">
      <div className="rounded-md border border-line bg-surface">
        <dl className="m-0 grid grid-cols-[4rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-line px-3.5 py-3 text-meta">
          <dt className="text-ink-3">From</dt>
          <dd className="m-0 min-w-0 break-words font-mono text-ink">
            {fromAddress ?? "Your mailbox"}
          </dd>
          {targetName ? (
            <>
              <dt className="text-ink-3">To</dt>
              <dd className="m-0 min-w-0 break-words font-mono text-ink">
                {toAddress ? `${targetName} (${toAddress})` : targetName}
              </dd>
            </>
          ) : null}
          <dt className="text-ink-3">Subject</dt>
          <dd className="m-0 min-w-0 break-words font-mono font-medium text-ink">
            {email.subject}
          </dd>
        </dl>
        <pre className="m-0 whitespace-pre-wrap break-words px-3.5 py-3 font-sans text-body text-ink">
          {email.text}
        </pre>
      </div>
    </Section>
  );
}

/**
 * Web forms no approved recipe can fill in. With no agent worker connected they sit in Review
 * until the person does them, so the person hears it before sending, not after.
 */
export function WaitingForPersonNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Alert intent="warning" title={`${pluralize(count, "request")} will wait for you`}>
      {count === 1 ? "It is a web form" : "They are web forms"} with no approved recipe, and no
      agent has connected to fill {count === 1 ? "it" : "them"} in. {count === 1 ? "It" : "They"}{" "}
      will sit in Review until you do {count === 1 ? "it" : "them"} by hand or connect an agent.
    </Alert>
  );
}
