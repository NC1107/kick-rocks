import { API_ROUTES, type ScanSummary } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import { HoldReason } from "../../components/holds/HoldReason.js";
import {
  Button,
  Callout,
  DataList,
  Dialog,
  EmptyState,
  RelativeTime,
  TaskStatusMark,
  useToast,
} from "../../components/ui/index.js";
import { describeFailure } from "../../lib/failures.js";
import { pluralize } from "../../lib/format.js";
import { describeScanStart } from "../../lib/scan-start.js";
import { DetailFrame } from "./DetailFrame.js";
import { REVIEW_INVALIDATES } from "./model.js";
import { ScanNotice } from "./ScanNotice.js";

/** A failed scan stops mattering once a later scan of the same site worked. */
function withoutSupersededFailures(scans: readonly ScanSummary[]): ScanSummary[] {
  return scans.filter(
    (scan) =>
      scan.error === null ||
      !scans.some(
        (other) =>
          other.targetId === scan.targetId &&
          other.error === null &&
          other.finishedAt !== null &&
          other.startedAt > scan.startedAt,
      ),
  );
}

const errorText = (scan: ScanSummary): string | null =>
  scan.error === null ? null : describeFailure({ lastError: scan.error, failureKind: null }).detail;

function matchSummary(scan: ScanSummary): string {
  if (scan.finishedAt === null && scan.taskStatus !== "failed") {
    return "Waiting for results";
  }
  if (scan.candidateCount === 0) return "No records found";
  const { pending, mine, not_mine } = scan.matchCounts;
  const parts = [
    pending > 0 ? `${pending} to confirm` : null,
    mine > 0 ? `${mine} yours` : null,
    not_mine > 0 ? `${not_mine} not you` : null,
  ].filter(Boolean);
  return `${pluralize(scan.candidateCount, "record")}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/** What a scan came to, or for a queued one why it has not started. */
function ScanResult({ scan, profileId }: { scan: ScanSummary; profileId: string }) {
  const failure = errorText(scan);
  if (failure) return <span className="text-danger-text">{failure}</span>;
  if (scan.hold)
    return <HoldReason hold={scan.hold} profileId={profileId} glyph={false} showSite={false} />;
  return <>{matchSummary(scan)}</>;
}

export function ScansPanel({ profileId }: { profileId: string }) {
  const toast = useToast();
  const scans = useApiQuery(API_ROUTES.scansList, {
    params: { id: profileId },
    query: { pageSize: 50 },
  });
  const dashboard = useApiQuery(API_ROUTES.dashboardGet, { params: { id: profileId } });
  const [confirming, setConfirming] = useState(false);
  const items = withoutSupersededFailures(scans.data?.items ?? []);
  const start = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [...REVIEW_INVALIDATES],
    onSuccess: (result) => {
      setConfirming(false);
      const summary = describeScanStart(result.items, profileId, dashboard.data?.scanning);
      toast.toast({
        intent: summary.intent,
        title: summary.title,
        description: summary.description,
        action: summary.action,
      });
    },
    onError: () => setConfirming(false),
  });

  return (
    <>
      <DetailFrame
        label="Scans"
        title="Scans"
        meta="Search people-search sites for records that look like you."
        error={start.isError ? errorMessage(start.error) : undefined}
        footer={
          <Button variant="primary" onClick={() => setConfirming(true)}>
            Scan all
          </Button>
        }
      >
        {dashboard.data ? (
          <ScanNotice
            scanning={dashboard.data.scanning}
            profileId={profileId}
            queuedHeld={dashboard.data.scans.held}
            className="mb-4"
          />
        ) : null}
        {scans.isError ? (
          <Callout
            intent="danger"
            title="Could not load scans"
            action={
              <Button size="sm" onClick={() => scans.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(scans.error)}
          </Callout>
        ) : scans.data && items.length === 0 ? (
          <EmptyState title="No scans yet." />
        ) : (
          <DataList
            label="Recent scans"
            layout="rows"
            items={items}
            getKey={(scan) => scan.id}
            identityHeader="Site"
            identity={(scan) => ({
              title: scan.targetName,
              to: { kind: "target", id: scan.targetId, name: scan.targetName },
              meta: (
                <>
                  Started <RelativeTime iso={scan.startedAt} />
                </>
              ),
            })}
            tags={(scan) => (
              <>
                {scan.taskStatus ? <TaskStatusMark status={scan.taskStatus} /> : null}
                <ScanResult scan={scan} profileId={profileId} />
              </>
            )}
            columns={[
              {
                id: "status",
                header: "Status",
                cell: (scan) =>
                  scan.taskStatus ? <TaskStatusMark status={scan.taskStatus} /> : null,
              },
              {
                id: "result",
                header: "Result",
                wrap: true,
                className: "text-meta",
                cell: (scan) => (
                  <span className="text-ink-2">
                    <ScanResult scan={scan} profileId={profileId} />
                  </span>
                ),
              },
            ]}
            loading={scans.isPending}
            count={pluralize(items.length, "scan")}
          />
        )}
      </DetailFrame>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Scan every people-search site?"
        description="Kick Rocks opens each site in the worker's browser, one after another, and searches for this person. Nothing is removed until you confirm a record."
        dismissible={!start.isPending}
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={start.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={start.isPending}
              onClick={() =>
                start.mutate({ params: { id: profileId }, body: { preset: "people_search" } })
              }
            >
              Start scans
            </Button>
          </>
        }
      />
    </>
  );
}
