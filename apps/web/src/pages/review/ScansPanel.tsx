import { API_ROUTES, type ScanSummary } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import { HoldReason } from "../../components/holds/HoldReason.js";
import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  RelativeTime,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableIdentity,
  TableRow,
  TableSkeletonRows,
  TaskStatusMark,
  useToast,
} from "../../components/ui/index.js";
import { describeFailure } from "../../lib/failures.js";
import { pluralize } from "../../lib/format.js";
import { paths } from "../../lib/paths.js";
import { describeScanStart } from "../../lib/scan-start.js";
import { DetailFrame } from "./DetailFrame.js";
import { REVIEW_INVALIDATES } from "./model.js";

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
    return <HoldReason hold={scan.hold} profileId={profileId} targetId={scan.targetId} />;
  return <>{matchSummary(scan)}</>;
}

export function ScansPanel({ profileId }: { profileId: string }) {
  const toast = useToast();
  const scans = useApiQuery(API_ROUTES.scansList, {
    params: { id: profileId },
    query: { pageSize: 50 },
  });
  const [confirming, setConfirming] = useState(false);
  const items = withoutSupersededFailures(scans.data?.items ?? []);
  const start = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [...REVIEW_INVALIDATES],
    onSuccess: (result) => {
      setConfirming(false);
      const summary = describeScanStart(result.items, profileId);
      toast.success(summary.title, summary.description, { action: summary.action });
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
          <Table label="Scans table">
            <TableHead>
              <tr>
                <TableHeaderCell>Site</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Result</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {scans.isPending ? (
                <TableSkeletonRows columns={3} rows={4} />
              ) : (
                items.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell wrap className="w-full min-w-0 py-1">
                      <TableIdentity
                        title={scan.targetName}
                        to={paths.target(scan.targetId)}
                        meta={
                          <>
                            Started <RelativeTime iso={scan.startedAt} />
                          </>
                        }
                      />
                      <span className="block pb-1 text-meta text-ink-3 md:hidden">
                        <ScanResult scan={scan} profileId={profileId} />
                      </span>
                    </TableCell>
                    <TableCell className="align-top md:align-middle">
                      {scan.taskStatus ? <TaskStatusMark status={scan.taskStatus} /> : null}
                    </TableCell>
                    <TableCell wrap className="hidden min-w-56 text-meta md:table-cell">
                      <span className="text-ink-2">
                        <ScanResult scan={scan} profileId={profileId} />
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
