import { API_ROUTES, type ListingSite } from "@kickrocks/shared";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  EmptyState,
  PageHeader,
  RelativeTime,
  Section,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "../../components/ui/index.js";
import { formatShortDate, pluralize } from "../../lib/format.js";
import { ScanNotice } from "../review/ScanNotice.js";
import { FindingList } from "./FindingRows.js";
import {
  FINDING_TABS,
  type FindingTab,
  firstBusyTab,
  pendingFindings,
  rollup,
  tabFromParam,
  tabOf,
} from "./model.js";
import { SiteRows } from "./SiteRows.js";
import { ScanDialog } from "./scanning.js";

export function Component() {
  return <RequireProfile>{(profile) => <Findings profileId={profile.id} />}</RequireProfile>;
}

const EMPTY_WORDS: Record<FindingTab, string> = {
  needs_you: "Nothing to confirm.",
  in_progress: "No removals in progress.",
  gone: "Nothing removed yet.",
  not_listed: "No sites cleared yet.",
  not_scanned: "Every site has been scanned.",
};

function Findings({ profileId }: { profileId: string }) {
  const listings = useApiQuery(API_ROUTES.listingsList, {
    params: { id: profileId },
    query: { page: 1, pageSize: 200 },
  });
  const dashboard = useApiQuery(API_ROUTES.dashboardGet, { params: { id: profileId } });
  const [params, setParams] = useSearchParams();
  const [scanning, setScanning] = useState<{
    title: string;
    targetIds: string[] | null;
    includePastAddresses?: boolean;
  } | null>(null);

  const sites = listings.data?.items ?? [];
  const summary = rollup(sites);
  const active = tabFromParam(params.get("show")) ?? firstBusyTab(summary.counts);
  const neverScanned = sites.length > 0 && sites.every((site) => !site.latestScan);

  const scanAll = () => setScanning({ title: "Scan every people-search site?", targetIds: null });
  const scanOne = (site: ListingSite) =>
    setScanning({
      title: `Scan ${site.targetName}?`,
      targetIds: [site.targetId],
      includePastAddresses: site.preference.includePastAddresses,
    });

  const inTab = (tab: FindingTab) => sites.filter((site) => tabOf(site.status) === tab);

  function panel(tab: FindingTab) {
    const shown = inTab(tab);
    if (shown.length === 0) return <EmptyState title={EMPTY_WORDS[tab]} />;
    if (tab !== "needs_you") {
      return (
        <SiteRows
          sites={shown}
          profileId={profileId}
          label={FINDING_TABS.find((candidate) => candidate.id === tab)?.label ?? tab}
          onScan={scanOne}
        />
      );
    }
    const records = pendingFindings(shown);
    const stuck = shown.filter((site) => site.status !== "to_confirm");
    return (
      <div className="flex flex-col gap-4">
        {records.length > 0 ? <FindingList records={records} /> : null}
        {stuck.length > 0 ? (
          <Section label="Stuck" count={String(stuck.length)}>
            <SiteRows sites={stuck} profileId={profileId} label="Stuck sites" onScan={scanOne} />
          </Section>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Findings" actions={<Button onClick={scanAll}>Scan all sites</Button>} />

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
            title="Could not load your findings"
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
            description="Scan the people-search sites to see where you are listed."
            actions={
              <Button variant="primary" onClick={scanAll}>
                Start your first scan
              </Button>
            }
          />
        ) : (
          <>
            <Tabs
              value={active}
              onValueChange={(next) => setParams({ show: next }, { replace: true })}
            >
              <TabList aria-label="Findings" className="max-sm:flex-wrap max-sm:overflow-x-visible">
                {FINDING_TABS.map((tab) => (
                  <Tab key={tab.id} value={tab.id} count={summary.counts[tab.id] || undefined}>
                    {tab.label}
                  </Tab>
                ))}
              </TabList>
              <TabPanel value={active}>{panel(active)}</TabPanel>
            </Tabs>
            {listings.data ? (
              <p className="font-mono text-caption text-ink-3">
                Listed on {pluralize(summary.listed, "site")}
                {listings.data.lastScanAt ? (
                  <>
                    {" \u00b7 "}last scan <RelativeTime iso={listings.data.lastScanAt} />
                  </>
                ) : null}
                {listings.data.nextRescanAt
                  ? ` \u00b7 next rescan ${formatShortDate(listings.data.nextRescanAt)}`
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
          siteCount={scanning.targetIds?.length}
          sitePreference={scanning.includePastAddresses}
        />
      ) : null}
    </>
  );
}
