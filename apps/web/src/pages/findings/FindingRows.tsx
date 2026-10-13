import { API_ROUTES, type ListingRecord } from "@kickrocks/shared";
import { useId, useState } from "react";
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
import { fitParts, recordHost, recordSummary } from "./model.js";

/** The box stays 18px; the label around it is a 44px square to tap, pulled left so the box keeps the row's indent. */
function PickBox({
  checked,
  indeterminate = false,
  onChange,
  name,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (on: boolean) => void;
  name: string;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="-ml-3.5 flex size-11 shrink-0 cursor-pointer items-center justify-center"
    >
      <Checkbox
        id={id}
        checked={checked}
        indeterminate={indeterminate}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={name}
      />
    </label>
  );
}

/**
 * Wraps only between the pieces, so "name, age, city" never splits across two lines. A phone
 * shows just the verdict word and keeps the matched fields in the title, so a row stays short.
 */
function FitLine({ record }: { record: ListingRecord }) {
  const parts = fitParts(record.assessment);
  return (
    <span title={parts.join(" · ")}>
      {parts.map((part, index) => (
        <span key={part} className={index > 0 ? "max-sm:hidden" : undefined}>
          {index > 0 ? " · " : ""}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </span>
  );
}

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
        "marked grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3.5 py-1 transition-colors duration-100",
        selected ? "bg-accent-soft" : "hover:bg-hover",
      )}
    >
      <PickBox
        checked={selected}
        onChange={onToggle}
        name={`Select ${record.targetName}, ${record.fields.name}`}
      />
      <div className="min-w-0 py-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui">
          <a
            href={record.recordUrl}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-ink hover:underline"
          >
            {record.targetName}
          </a>
          <span className="min-w-0 text-ui text-ink-2">{recordSummary(record)}</span>
        </p>
        <p className="min-w-0 font-mono text-meta text-ink-3">
          <FitLine record={record} />
          <span className="ml-2 max-sm:hidden">
            <ExternalLinkText href={record.recordUrl}>{recordHost(record)}</ExternalLinkText>
          </span>
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-ink-3 focus-visible:text-ink max-sm:h-11 max-sm:border max-sm:border-line-strong max-sm:px-3 max-sm:text-ink-2"
        loading={decision.decidingNotMine}
        disabled={decision.deciding}
        onClick={decision.notMine}
      >
        Not me
      </Button>
      {decision.error ? (
        <InlineError className="col-span-full">{decision.error}</InlineError>
      ) : null}
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
 * Every record still waiting for an answer, one row each, across all sites. The header button
 * removes the picked rows, or every likely row when none is picked; the rights dialog opens once
 * and applies to all of them. Unlikely records stay out of the no-selection case so a bulk
 * removal never asserts a record the score says is probably someone else.
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
  const shownSiteCount = new Set(shown.map((record) => record.targetId)).size;

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setPicked(on ? new Set(shownIds) : new Set());
  const ids = selected.size > 0 ? [...selected] : shownIds;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3.5 py-1">
          <PickBox
            checked={allShown}
            indeterminate={!allShown && selected.size > 0}
            onChange={toggleAll}
            name="Select all"
          />
          <span className="-ml-3.5 mr-auto text-eyebrow font-semibold! text-ink-3">
            {pluralize(shown.length, "record")} {"·"} {pluralize(shownSiteCount, "site")}
          </span>
          <div className="flex items-center gap-2">
            {selected.size > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-ink-3 hover:text-ink max-sm:h-11"
                aria-label={`Not me (${selected.size} selected)`}
                disabled={bulk.pending}
                onClick={() => void bulk.run(ids, "not_mine", ["opt_out", "delete"])}
              >
                Not me
              </Button>
            ) : null}
            {ids.length > 0 ? (
              <Button
                variant="primary"
                size="sm"
                className="max-sm:h-11"
                disabled={bulk.pending}
                onClick={() => setAsking(true)}
              >
                {selected.size > 0
                  ? `Remove ${selected.size} selected`
                  : `Remove me from ${pluralize(shownSiteCount, "site")}`}
              </Button>
            ) : null}
          </div>
        </div>
        <Rows records={shown} label="Records" selected={selected} onToggle={toggle} />
        <UnlikelyGroup matches={unlikely}>
          <Rows records={unlikely} label="Unlikely records" selected={selected} onToggle={toggle} />
        </UnlikelyGroup>
      </div>

      {bulk.error && !asking ? <InlineError>{bulk.error}</InlineError> : null}

      <RightsDialog
        open={asking}
        onClose={() => {
          setAsking(false);
          bulk.clearError();
        }}
        title={`Remove ${pluralize(ids.length, "record")}`}
        description="Asks each site to take its record down. Only confirm records that are yours."
        confirmLabel={`Remove ${ids.length}`}
        pending={bulk.pending}
        error={bulk.error}
        onConfirm={async (rights) => {
          if (await bulk.run(ids, "mine", rights)) setAsking(false);
        }}
      />
    </div>
  );
}
