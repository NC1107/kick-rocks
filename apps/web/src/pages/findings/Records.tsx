import type { ListingRecord } from "@kickrocks/shared";
import {
  Button,
  EntityLink,
  ExternalLinkText,
  InlineError,
  StatusMark,
} from "../../components/ui/index.js";
import { MatchFit } from "../review/MatchFit.js";
import { useMatchDecision } from "../review/match-decision.js";
import { sortByBand, splitByBand } from "../review/model.js";
import { UnlikelyGroup } from "../review/UnlikelyGroup.js";

function placesOf(record: ListingRecord): string {
  return record.fields.locations?.join("; ") ?? "";
}

/** One record a scan found, with the answer it needs when it has not been given yet. */
function RecordItem({ record }: { record: ListingRecord }) {
  const decision = useMatchDecision(record);
  const { fields } = record;
  const places = placesOf(record);
  const ageText =
    fields.age ?? (fields.ageRange ? `${fields.ageRange.low}-${fields.ageRange.high}` : "");
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink">
          {fields.name}
          {ageText ? <span className="font-normal text-ink-2">, {ageText}</span> : null}
        </p>
        {places ? <p className="text-meta text-ink-2">{places}</p> : null}
        {record.decision === "pending" && record.assessment ? (
          <MatchFit assessment={record.assessment} className="my-1" />
        ) : null}
        <p className="relative min-w-0 truncate text-caption">
          <ExternalLinkText href={record.recordUrl} className="font-mono">
            {record.recordUrl.replace(/^https?:\/\/(www\.)?/, "")}
          </ExternalLinkText>
        </p>
      </div>
      {record.decision === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={decision.askMine}
            disabled={decision.deciding}
          >
            This is me
          </Button>
          <Button
            size="sm"
            loading={decision.decidingNotMine}
            disabled={decision.deciding}
            onClick={decision.notMine}
          >
            Not me
          </Button>
        </div>
      ) : record.decision === "mine" && record.request ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
          <StatusMark status={record.request.status} />
          <EntityLink
            to={{
              kind: "request",
              id: record.request.id,
              reference: record.request.reference,
              targetName: record.targetName,
            }}
          />
        </p>
      ) : (
        <p className="text-meta text-ink-3">
          {record.decision === "not_mine" ? "You said this is not you." : "You said this is you."}
        </p>
      )}
      {decision.error ? <InlineError>{decision.error}</InlineError> : null}
      {decision.dialog}
    </li>
  );
}

function Records({ records, label }: { records: readonly ListingRecord[]; label: string }) {
  if (records.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className="m-0 min-w-0 list-none divide-y divide-line overflow-hidden rounded-md border border-line bg-surface p-0"
    >
      {records.map((record) => (
        <RecordItem key={record.id} record={record} />
      ))}
    </ul>
  );
}

/**
 * The records of one site. Those waiting for an answer come first, likely ones before the rest and
 * the unlikely ones folded away; answered records follow and never feed the bulk action.
 */
export function RecordList({
  records,
  label,
}: {
  records: readonly ListingRecord[];
  label: string;
}) {
  const { shown, unlikely } = splitByBand(
    records.filter((record) => record.decision === "pending"),
  );
  const answered = records.filter((record) => record.decision !== "pending");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Records records={shown} label={label} />
      <UnlikelyGroup matches={unlikely}>
        <Records
          records={unlikely}
          label={`Unlikely records on ${label.replace(/^Records on /, "")}`}
        />
      </UnlikelyGroup>
      <Records
        records={sortByBand(answered)}
        label={`Answered records on ${label.replace(/^Records on /, "")}`}
      />
    </div>
  );
}
