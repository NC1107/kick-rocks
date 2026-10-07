import type { CampaignPreview, RenderedEmail } from "@kickrocks/shared";
import { Bot, ChevronDown, Globe, Mail, ScanSearch, SkipForward } from "lucide-react";
import type { ComponentType } from "react";
import { Card, CardHeader, Skeleton } from "../../../components/ui/index.js";
import { formatCount } from "../../../lib/format.js";
import { SKIP_REASON_LABELS } from "../../../lib/labels.js";
import { advisories, type ChannelCounts, groupSkipped } from "../channels.js";

interface TileProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: number;
  label: string;
  hint: string;
}

function Tile({ icon: Icon, value, label, hint }: TileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-surface p-4">
      <span className="flex items-center gap-2 text-sm text-ink-muted">
        <Icon aria-hidden className="size-4" />
        {label}
      </span>
      <span className="text-3xl font-semibold tabular-nums text-ink">{formatCount(value)}</span>
      <span className="text-sm text-ink-muted">{hint}</span>
    </div>
  );
}

export function CountsSkeleton() {
  return (
    <div aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <span className="sr-only">Loading preview</span>
      {Array.from({ length: 5 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder tiles have no identity
        <Skeleton key={index} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}

/** What a campaign would do, counted by the way each target is reached. */
export function ChannelTiles({ counts }: { counts: ChannelCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Tile icon={Mail} value={counts.email} label="By email" hint="Sent from your mailbox" />
      <Tile icon={Globe} value={counts.form} label="By web form" hint="Filled in by the worker" />
      <Tile icon={Bot} value={counts.manual} label="Agent or you" hint="No working saved steps" />
      <Tile
        icon={ScanSearch}
        value={counts.scan}
        label="Scans first"
        hint="You confirm each record"
      />
      <Tile icon={SkipForward} value={counts.skipped} label="Skipped" hint="See why below" />
    </div>
  );
}

export function SkippedList({ items }: { items: CampaignPreview["items"] }) {
  const groups = groupSkipped(items);
  if (groups.length === 0) return null;
  return (
    <Card padding="none">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHeader
          title="Skipped targets"
          description="These are left out of this campaign, for the reason shown."
          className="mb-2"
        />
      </div>
      <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
        {groups.map((group) => (
          <li key={group.reason}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base text-ink hover:bg-sunken/60 sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="font-medium">{SKIP_REASON_LABELS[group.reason]}</span>
                <span className="flex items-center gap-2 text-sm text-ink-muted tabular-nums">
                  {formatCount(group.items.length)}
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 transition-transform group-open:rotate-180"
                  />
                </span>
              </summary>
              <ul className="m-0 list-none px-4 pb-3 sm:px-5">
                {group.items.map((item) => (
                  <li key={item.targetId} className="py-1.5 text-base">
                    <span className="text-ink">{item.targetName}</span>
                    {item.detail ? (
                      <span className="block text-sm text-ink-muted">{item.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AdvisoryList({ items }: { items: CampaignPreview["items"] }) {
  const flagged = advisories(items);
  if (flagged.length === 0) return null;
  return (
    <Card>
      <CardHeader
        title="Worth knowing"
        description="These still go ahead. Read the note first if one affects what you want."
        className="mb-2"
      />
      <ul className="m-0 list-none divide-y divide-line p-0">
        {flagged.map((item) => (
          <li key={item.targetId} className="py-2 text-base first:pt-0 last:pb-0">
            <span className="text-ink">{item.targetName}</span>
            <span className="block text-sm text-ink-muted">{item.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
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
    <Card>
      <CardHeader
        title="Email preview"
        description="This is the first email in the campaign. Every other one follows the same wording."
      />
      <dl className="m-0 mb-3 grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 border-b border-line pb-3 text-base">
        <dt className="text-ink-muted">From</dt>
        <dd className="m-0 min-w-0 break-words text-ink">{fromAddress ?? "Your mailbox"}</dd>
        {targetName ? (
          <>
            <dt className="text-ink-muted">To</dt>
            <dd className="m-0 min-w-0 break-words text-ink">
              {toAddress ? `${targetName} (${toAddress})` : targetName}
            </dd>
          </>
        ) : null}
        <dt className="text-ink-muted">Subject</dt>
        <dd className="m-0 min-w-0 break-words font-medium text-ink">{email.subject}</dd>
      </dl>
      <pre className="m-0 whitespace-pre-wrap break-words font-sans text-base text-ink">
        {email.text}
      </pre>
    </Card>
  );
}
