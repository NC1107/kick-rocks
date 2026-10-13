import { API_ROUTES, type Dashboard } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import { Button, Callout, PageHeader, Skeleton } from "../../components/ui/index.js";
import { ScanDialog } from "../findings/scanning.js";
import { ScanNotice } from "../review/ScanNotice.js";
import {
  checklistSteps,
  Hero,
  NeedsYouSection,
  RemovalsSection,
  SetupChecklist,
} from "./sections.js";

const REFRESH_MS = 30_000;

export function Component() {
  return <RequireProfile>{(profile) => <HomeView profileId={profile.id} />}</RequireProfile>;
}

function HomeView({ profileId }: { profileId: string }) {
  const [scanning, setScanning] = useState(false);
  const query = useApiQuery(API_ROUTES.dashboardGet, {
    params: { id: profileId },
    refetchInterval: REFRESH_MS,
  });

  const header = (
    <PageHeader
      title="Home"
      actions={<Button onClick={() => setScanning(true)}>Scan now</Button>}
    />
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <HomeSkeleton />
      </>
    );
  }

  if (query.error) {
    return (
      <>
        {header}
        <Callout
          intent="danger"
          title="Could not load Home"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      </>
    );
  }

  return (
    <>
      {header}
      <HomeBody dashboard={query.data} profileId={profileId} onScan={() => setScanning(true)} />
      {scanning ? (
        <ScanDialog
          open
          onClose={() => setScanning(false)}
          profileId={profileId}
          selection={{ preset: "people_search" }}
          title="Scan every people-search site?"
        />
      ) : null}
    </>
  );
}

function HomeBody({
  dashboard,
  profileId,
  onScan,
}: {
  dashboard: Dashboard;
  profileId: string;
  onScan: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ScanNotice
        scanning={dashboard.scanning}
        profileId={profileId}
        queuedHeld={dashboard.scans.held}
      />
      <SetupChecklist steps={checklistSteps(dashboard, profileId)} onScan={onScan} />
      <Hero listings={dashboard.listings} onScan={onScan} />
      <NeedsYouSection attention={dashboard.attention} />
      <RemovalsSection dashboard={dashboard} />
    </div>
  );
}

function SkeletonLabel({ width }: { width: string }) {
  return (
    <div className="mt-2.5 mb-1.5 flex min-h-5 items-center">
      <Skeleton className={`h-2.5 ${width}`} />
    </div>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line">
      {Array.from({ length: rows }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
        <div key={row} className="flex h-row items-center justify-between gap-6 px-3.5">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-3.5 w-6" />
        </div>
      ))}
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">Loading</span>
      <div>
        <SkeletonLabel width="w-28" />
        <SkeletonRows rows={2} />
      </div>
      <div>
        <SkeletonLabel width="w-20" />
        <SkeletonRows rows={1} />
      </div>
      <div>
        <SkeletonLabel width="w-24" />
        <Skeleton className="mb-2.5 h-1.5 w-full rounded-full" />
        <SkeletonRows rows={3} />
      </div>
    </div>
  );
}
