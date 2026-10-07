import { API_ROUTES, type ScanSummary } from "@kickrocks/shared";
import { ScanSearch } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TaskStatusPill,
  useToast,
} from "../../components/ui/index.js";
import { formatRelative, pluralize } from "../../lib/format.js";
import { LoadingRows } from "../targets/LoadingRows.js";
import { REVIEW_INVALIDATES } from "./model.js";

function matchSummary(scan: ScanSummary): string {
  if (scan.finishedAt === null && scan.taskStatus !== "failed") return "Waiting for results";
  if (scan.candidateCount === 0) return "No records found";
  const { pending, mine, not_mine } = scan.matchCounts;
  const parts = [
    pending > 0 ? `${pending} to confirm` : null,
    mine > 0 ? `${mine} yours` : null,
    not_mine > 0 ? `${not_mine} not you` : null,
  ].filter(Boolean);
  return `${pluralize(scan.candidateCount, "record")}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

export function ScansPanel({ profileId }: { profileId: string }) {
  const toast = useToast();
  const scans = useApiQuery(API_ROUTES.scansList, {
    params: { id: profileId },
    query: { pageSize: 50 },
  });
  const [confirming, setConfirming] = useState(false);
  const start = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [...REVIEW_INVALIDATES],
    onSuccess: (result) => {
      setConfirming(false);
      const started = result.items.filter((item) => item.outcome === "scan_started").length;
      const skipped = result.items.length - started;
      toast.success(
        started === 0
          ? "No new scans to start"
          : `Started ${pluralize(started, "scan")}${skipped > 0 ? `, ${skipped} already running` : ""}`,
      );
    },
    onError: (error) => {
      setConfirming(false);
      toast.error("That did not work", errorMessage(error));
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-base text-ink-muted">
          A scan searches a people-search site for records that look like you. Each one waits under
          Records to confirm.
        </p>
        <Button variant="primary" onClick={() => setConfirming(true)}>
          Scan people-search sites
        </Button>
      </div>

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

      {scans.isError ? (
        <Alert
          intent="danger"
          title="Could not load scans"
          action={
            <Button size="sm" onClick={() => scans.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(scans.error)}
        </Alert>
      ) : scans.data && scans.data.items.length === 0 ? (
        <EmptyState
          icon={ScanSearch}
          title="No scans yet"
          description="Scan people-search sites to find records to remove."
        />
      ) : (
        <Table label="Scans">
          <TableHead>
            <tr>
              <TableHeaderCell>Site</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="hidden md:table-cell">Result</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {scans.isPending ? (
              <LoadingRows
                rows={4}
                columns={[{ bar: "w-40" }, {}, { className: "hidden md:table-cell", bar: "w-40" }]}
              />
            ) : (
              scans.data?.items.map((scan) => (
                <TableRow key={scan.id}>
                  <TableCell wrap className="w-full min-w-0">
                    <span className="block font-medium text-ink">{scan.targetName}</span>
                    <span className="block text-sm text-ink-muted">
                      Started{" "}
                      <time dateTime={scan.startedAt}>{formatRelative(scan.startedAt)}</time>
                    </span>
                    <span className="block text-sm text-ink-muted md:hidden">
                      {scan.error ?? matchSummary(scan)}
                    </span>
                  </TableCell>
                  <TableCell className="align-top md:align-middle">
                    {scan.taskStatus ? <TaskStatusPill status={scan.taskStatus} /> : null}
                  </TableCell>
                  <TableCell wrap className="hidden min-w-56 md:table-cell">
                    {scan.error ? (
                      <span className="text-danger">{scan.error}</span>
                    ) : (
                      matchSummary(scan)
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
