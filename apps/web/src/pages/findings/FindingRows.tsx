import { API_ROUTES, type ListingRecord } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  Checkbox,
  ExternalLinkText,
  InlineError,
  useToast,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { pluralize } from "../../lib/format.js";
import { RightsDialog, useMatchDecision } from "../review/match-decision.js";
import { REVIEW_INVALIDATES, splitByBand } from "../review/model.js";
import { UnlikelyGroup } from "../review/UnlikelyGroup.js";
import { fitLine, recordHost, recordSummary } from "./model.js";

/** A 44px square to tap on a phone around the 18px box. */
const TAP = "max-sm:-ml-3 max-sm:min-w-11 max-sm:justify-center";

function FindingRow({
  record,
  selected,
  onToggle,
}: {
  record: ListingRecord;
  selected: boolean;
  onToggle: (on: boolean) => void;
}) {
  const decision = useMatchDecision(record);
  return (
    <li
      data-selected={selected ? "true" : undefined}
      className={cn(
        "marked grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-2 px-3.5 py-2 transition-colors duration-100 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-x-3 sm:py-1.5",
        selected ? "bg-accent-soft" : "hover:bg-hover",
      )}
    >
      <Checkbox
        checked={selected}
        onChange={(event) => onToggle(event.target.checked)}
        label={
          <span className="sr-only">{`Select ${record.targetName}, ${record.fields.name}`}</span>
        }
        className={TAP}
      />
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui">
          <span className="font-semibold text-ink">{record.targetName}</span>
          <span className="min-w-0 break-words font-mono text-meta text-ink-2">
            {recordSummary(record)}
          </span>
        </p>
        <p className="min-w-0 break-words font-mono text-meta text-ink-3 sm:truncate">
          {fitLine(record.assessment)}
          <span className="block max-w-full truncate sm:ml-2 sm:inline">
            <ExternalLinkText href={record.recordUrl}>{recordHost(record)}</ExternalLinkText>
          </span>
        </p>
      </div>
      <div className="col-span-2 grid grid-cols-2 gap-2 sm:col-span-1 sm:flex">
        <Button
          variant="primary"
          size="sm"
          className="max-sm:h-12 max-sm:text-ui"
          onClick={decision.askMine}
          disabled={decision.deciding}
        >
          This is me
        </Button>
        <Button
          size="sm"
          className="max-sm:h-12 max-sm:text-ui"
          loading={decision.decidingNotMine}
          disabled={decision.deciding}
          onClick={decision.notMine}
        >
          Not me
        </Button>
      </div>
      {decision.error ? (
        <InlineError className="col-span-full">{decision.error}</InlineError>
      ) : null}
      {decision.dialog}
    </li>
  );
}

function useBulkDecision(onSettled: (succeeded: readonly string[]) => void) {
  const toast = useToast();
  const [error, setError] = useState<string | undefined>();
  const decide = useApiMutation(API_ROUTES.matchDecideMany, {
    invalidates: [...REVIEW_INVALIDATES, API_ROUTES.listingsList],
  });

  const run = async (
    ids: readonly string[],
    decision: "mine" | "not_mine",
    rights: readonly ("opt_out" | "delete")[],
  ) => {
    setError(undefined);
    try {
      const { results } = await decide.mutateAsync({
        body: {
          decisions: ids.map((matchId) => ({ matchId, decision, rights: [...rights] })),
        },
      });
      const succeeded = results.flatMap((result) => (result.ok ? [result.matchId] : []));
      const failed = results.flatMap((result) => (result.ok ? [] : [result.error.message]));
      onSettled(succeeded);
      if (succeeded.length > 0) {
        toast.success(
          decision === "mine"
            ? `${pluralize(succeeded.length, "removal request")} queued`
            : `${pluralize(succeeded.length, "record")} marked as not you`,
        );
      }
      if (failed.length > 0) {
        setError(`${failed.length} of ${ids.length} could not be saved: ${failed[0]}`);
        return false;
      }
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    }
  };

  return { run, pending: decide.isPending, error, clearError: () => setError(undefined) };
}

function Rows({
  records,
  label,
  selected,
  onToggle,
}: {
  records: readonly ListingRecord[];
  label: string;
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <ul aria-label={label} className="m-0 min-w-0 list-none divide-y divide-line p-0">
      {records.map((record) => (
        <FindingRow
          key={record.id}
          record={record}
          selected={selected.has(record.id)}
          onToggle={(on) => onToggle(record.id, on)}
        />
      ))}
    </ul>
  );
}

/**
 * Every record still waiting for an answer, one row each, across all sites. Rows can be picked
 * and answered together: the rights dialog opens once and applies to everything picked.
 */
export function FindingList({ records }: { records: readonly ListingRecord[] }) {
  const { shown, unlikely } = splitByBand(records);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const bulk = useBulkDecision((succeeded) =>
    setPicked((current) => new Set([...current].filter((id) => !succeeded.includes(id)))),
  );

  const live = new Set(records.map((record) => record.id));
  const selected = new Set([...picked].filter((id) => live.has(id)));
  const shownIds = shown.map((record) => record.id);
  const allShown = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const siteCount = new Set(records.map((record) => record.targetId)).size;

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setPicked(on ? new Set(shownIds) : new Set());
  const ids = [...selected];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex min-h-9 items-center gap-2 border-b border-line px-3.5 max-sm:min-h-11">
          <Checkbox
            checked={allShown}
            indeterminate={!allShown && selected.size > 0}
            onChange={(event) => toggleAll(event.target.checked)}
            label={<span className="sr-only">Select all</span>}
            className={TAP}
          />
          <span className="text-eyebrow font-semibold! text-ink-3">
            {pluralize(records.length, "record")} on {pluralize(siteCount, "site")}
          </span>
        </div>
        <Rows records={shown} label="Records" selected={selected} onToggle={toggle} />
        <UnlikelyGroup matches={unlikely}>
          <Rows records={unlikely} label="Unlikely records" selected={selected} onToggle={toggle} />
        </UnlikelyGroup>
      </div>

      {bulk.error && !asking ? <InlineError>{bulk.error}</InlineError> : null}

      {selected.size > 0 ? (
        <div className="sticky bottom-0 z-10 -mx-gutter flex items-center justify-between gap-3 border-t border-line bg-rail px-gutter py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <span className="font-mono text-meta tabular-nums text-ink-2 max-sm:hidden">
            {selected.size} selected
          </span>
          <div className="flex gap-2 max-sm:w-full">
            <Button
              variant="primary"
              className="max-sm:h-12 max-sm:flex-1"
              disabled={bulk.pending}
              onClick={() => setAsking(true)}
            >
              Remove selected ({selected.size})
            </Button>
            <Button
              className="max-sm:h-12 max-sm:flex-1"
              disabled={bulk.pending}
              onClick={() => void bulk.run(ids, "not_mine", ["opt_out", "delete"])}
            >
              Not me ({selected.size})
            </Button>
          </div>
        </div>
      ) : null}

      <RightsDialog
        open={asking}
        onClose={() => {
          setAsking(false);
          bulk.clearError();
        }}
        title={`Remove ${pluralize(selected.size, "record")}`}
        description="Asks each site to take its record down. Only confirm records that are yours."
        confirmLabel={`Remove ${selected.size}`}
        pending={bulk.pending}
        error={bulk.error}
        onConfirm={async (rights) => {
          if (await bulk.run(ids, "mine", rights)) setAsking(false);
        }}
      />
    </div>
  );
}
