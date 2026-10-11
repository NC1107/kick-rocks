import { API_ROUTES, type ListingSite } from "@kickrocks/shared";
import { ScanSearch } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { RequireProfile } from "../../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  DataList,
  Dialog,
  Disclosure,
  EmptyState,
  EntityLink,
  PageHeader,
  RelativeTime,
  Skeleton,
} from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { formatShortDate, pluralize } from "../../../lib/format.js";
import {
  type ChipId,
  chipCount,
  firstBusyChip,
  LISTING_CHIPS,
  pendingRecords,
} from "../../../lib/listings.js";
import { useWide } from "../../../lib/use-wide.js";
import { ScanNotice } from "../../review/ScanNotice.js";
import { TargetsTabs } from "../TargetsTabs.js";
import { ListingLine, ScanTimes } from "./ListingLine.js";
import { RecordList } from "./Records.js";
import { SiteMenu } from "./SiteMenu.js";
import { ScanDialog } from "./scanning.js";

export function Component() {
  return <RequireProfile>{(profile) => <Listings profileId={profile.id} />}</RequireProfile>;
}

function Chips({
  counts,
  value,
  onChange,
}: {
  counts: Parameters<typeof chipCount>[0];
  value: ChipId;
  onChange: (id: ChipId) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="sr-only">Show</legend>
      <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
        {LISTING_CHIPS.map((chip) => {
          const count = chipCount(counts, chip.statuses);
          const selected = chip.id === value;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(chip.id)}
              className={cn(
                "marked inline-flex h-control-sm shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-meta transition-colors duration-100 pointer-coarse:h-11",
                selected
                  ? "border-accent-fill bg-accent-soft text-accent-text"
                  : "border-line-strong text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              {chip.label}
              <span className="font-mono tabular-nums text-ink-3">{count}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SiteRows({
  sites,
  profileId,
  onScan,
}: {
  sites: readonly ListingSite[];
  profileId: string;
  onScan: (site: ListingSite) => void;
}) {
  return (
    <ul aria-label="Sites" className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
      {sites.map((site) => (
        <li
          key={site.targetId}
          className="overflow-hidden rounded-md border border-line bg-surface"
        >
          <div className="flex items-start gap-1 py-2.5 pr-1.5 pl-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <EntityLink
                to={{ kind: "target", id: site.targetId, name: site.targetName }}
                className="self-start text-ui font-medium"
              />
              <ListingLine site={site} profileId={profileId} />
              <ScanTimes site={site} />
            </div>
            <SiteMenu site={site} profileId={profileId} onScan={() => onScan(site)} />
          </div>
          {site.status === "to_confirm" ? (
            <div className="border-t border-line bg-canvas p-2">
              <RecordList records={pendingRecords(site)} label={`Records on ${site.targetName}`} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SiteTable({
  sites,
  profileId,
  onScan,
  onReview,
}: {
  sites: readonly ListingSite[];
  profileId: string;
  onScan: (site: ListingSite) => void;
  onReview: (site: ListingSite) => void;
}) {
  return (
    <DataList
      label="Sites"
      items={sites}
      getKey={(site) => site.targetId}
      identityHeader="Site"
      identity={(site) => ({
        title: site.targetName,
        meta: site.domain,
        to: { kind: "target", id: site.targetId, name: site.targetName },
      })}
      columns={[
        {
          id: "status",
          header: "Status",
          wrap: true,
          cell: (site) => <ListingLine site={site} profileId={profileId} />,
        },
        {
          id: "records",
          header: "Records",
          cell: (site) => {
            const waiting = pendingRecords(site).length;
            if (waiting > 0) {
              return (
                <Button size="sm" onClick={() => onReview(site)}>
                  Review {waiting}
                </Button>
              );
            }
            return <span className="text-ink-3">{site.records.length || "None"}</span>;
          },
        },
        {
          id: "last",
          header: "Last scan",
          kind: "date",
          cell: (site) =>
            site.latestScan ? <RelativeTime iso={site.latestScan.startedAt} /> : "Never",
        },
        {
          id: "next",
          header: "Next scan",
          kind: "date",
          cell: (site) =>
            site.nextRescanAt
              ? Date.parse(site.nextRescanAt) > Date.now()
                ? formatShortDate(site.nextRescanAt)
                : "Due"
              : "None",
        },
        {
          id: "actions",
          header: <span className="sr-only">Actions</span>,
          align: "right",
          cell: (site) => (
            <SiteMenu site={site} profileId={profileId} onScan={() => onScan(site)} />
          ),
        },
      ]}
      tags={() => null}
    />
  );
}

function Listings({ profileId }: { profileId: string }) {
  const listings = useApiQuery(API_ROUTES.listingsList, {
    params: { id: profileId },
    query: { page: 1, pageSize: 200 },
  });
  const dashboard = useApiQuery(API_ROUTES.dashboardGet, { params: { id: profileId } });
  const [params, setParams] = useSearchParams();
  const requested = LISTING_CHIPS.find((candidate) => candidate.id === params.get("show"));
  const chip: ChipId | null = requested?.id ?? null;
  const setChip = (id: ChipId) => setParams({ show: id }, { replace: true });
  const [scanning, setScanning] = useState<{
    title: string;
    description: string;
    targetIds: string[] | null;
    includePastAddresses?: boolean;
  } | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [skippedOpen, setSkippedOpen] = useState(false);

  const counts = listings.data?.counts;
  const active = chip ?? (counts ? firstBusyChip(counts) : "needs_you");

  // Wide screens show a table, so a site's records open from a dialog instead of under its row.
  useEffect(() => {
    if (reviewing && !listings.data?.items.some((site) => site.targetId === reviewing)) {
      setReviewing(null);
    }
  }, [reviewing, listings.data]);

  const everything = listings.data?.items ?? [];
  const neverScanned = everything.length > 0 && everything.every((site) => !site.latestScan);
  const wanted = LISTING_CHIPS.find((candidate) => candidate.id === active)?.statuses ?? [];
  const shown = everything.filter((site) => wanted.includes(site.status));
  const skipped = shown.filter((site) => site.status === "skipped");
  const main = shown.filter((site) => site.status !== "skipped");
  const reviewed = everything.find((site) => site.targetId === reviewing) ?? null;

  const scanAll = () =>
    setScanning({
      title: "Scan every people-search site?",
      description:
        "Kick Rocks opens each site in the worker's browser, one after another, and searches for this person. Nothing is removed until you confirm a record. Paused and skipped sites are left out.",
      targetIds: null,
    });
  const scanOne = (site: ListingSite) =>
    setScanning({
      title: `Scan ${site.targetName}?`,
      description:
        "Kick Rocks searches this site for this person. Nothing is removed until you confirm a record.",
      targetIds: [site.targetId],
      includePastAddresses: site.preference.includePastAddresses,
    });

  const wide = (list: readonly ListingSite[]) => (
    <SiteTable
      sites={list}
      profileId={profileId}
      onScan={scanOne}
      onReview={(s) => setReviewing(s.targetId)}
    />
  );

  return (
    <>
      <PageHeader
        title="Where you're listed"
        description="Your records on people-search sites"
        actions={
          <Button variant="primary" onClick={scanAll}>
            <ScanSearch aria-hidden="true" />
            Scan all sites
          </Button>
        }
      />
      <TargetsTabs />

      <div className="flex flex-col gap-4">
        {dashboard.data ? (
          <ScanNotice
            scanning={dashboard.data.scanning}
            profileId={profileId}
            queuedHeld={dashboard.data.scans.held}
          />
        ) : null}

        {listings.isError ? (
          <Callout
            intent="danger"
            title="Could not load your listings"
            action={
              <Button size="sm" onClick={() => listings.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(listings.error)}
          </Callout>
        ) : listings.isPending ? (
          <Skeleton className="h-40 w-full rounded-md" />
        ) : neverScanned ? (
          <EmptyState
            title="Nothing scanned yet."
            description="Search the people-search sites to see where your records are. You choose which to remove."
            actions={
              <Button variant="primary" onClick={scanAll}>
                Start your first scan
              </Button>
            }
          />
        ) : (
          <>
            {counts ? <Chips counts={counts} value={active} onChange={setChip} /> : null}
            {shown.length === 0 ? (
              <EmptyState
                title={active === "needs_you" ? "Nothing needs you." : "No sites here."}
              />
            ) : (
              <WideSwitch
                narrow={
                  main.length > 0 ? (
                    <SiteRows sites={main} profileId={profileId} onScan={scanOne} />
                  ) : null
                }
                wide={main.length > 0 ? wide(main) : null}
              />
            )}
            {skipped.length > 0 ? (
              <Disclosure
                title={`Skipped (${skipped.length})`}
                description="Left out of every scan until you unskip them."
                open={skippedOpen}
                onOpenChange={setSkippedOpen}
              >
                <WideSwitch
                  narrow={<SiteRows sites={skipped} profileId={profileId} onScan={scanOne} />}
                  wide={wide(skipped)}
                />
              </Disclosure>
            ) : null}
            {listings.data ? (
              <p className="font-mono text-caption text-ink-3">
                {pluralize(everything.length, "site")}
                {listings.data.lastScanAt ? (
                  <>
                    , last scan <RelativeTime iso={listings.data.lastScanAt} />
                  </>
                ) : null}
                {listings.data.nextRescanAt
                  ? `, next rescan ${formatShortDate(listings.data.nextRescanAt)}`
                  : ""}
              </p>
            ) : null}
          </>
        )}
      </div>

      {scanning ? (
        <ScanDialog
          open
          onClose={() => setScanning(null)}
          profileId={profileId}
          selection={
            scanning.targetIds
              ? { targetIds: scanning.targetIds }
              : { preset: "people_search" as const }
          }
          title={scanning.title}
          description={scanning.description}
          siteCount={scanning.targetIds?.length}
          sitePreference={scanning.includePastAddresses}
        />
      ) : null}

      <Dialog
        open={reviewed !== null}
        onClose={() => setReviewing(null)}
        title={reviewed?.targetName ?? "Records"}
        description="Confirm the records that are you. Nothing is removed until you do."
        size="lg"
        footer={<Button onClick={() => setReviewing(null)}>Close</Button>}
      >
        {reviewed ? (
          <RecordList
            records={pendingRecords(reviewed)}
            label={`Records on ${reviewed.targetName}`}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/** The rows on a phone and the table on a wide screen, chosen once so a page describes both. */
function WideSwitch({ narrow, wide }: { narrow: ReactNode; wide: ReactNode }) {
  return useWide() ? wide : narrow;
}
