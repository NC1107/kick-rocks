import type { ListingRecord } from "@kickrocks/shared";
import {
  Button,
  EntityLink,
  ExternalLinkText,
  InlineError,
  StatusMark,
} from "../../../components/ui/index.js";
import { useMatchDecision } from "../../review/match-decision.js";

function placesOf(record: ListingRecord): string {
  return record.fields.locations?.join("; ") ?? "";
}

/** One record a scan found, with the answer it needs when it has not been given yet. */
function RecordItem({ record }: { record: ListingRecord }) {
  const decision = useMatchDecision(record);
  const { fields } = record;
  const places = placesOf(record);
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink">
          {fields.name}
          {fields.age === undefined ? (
            ""
          ) : (
            <span className="font-normal text-ink-2">, {fields.age}</span>
          )}
        </p>
        {places ? <p className="text-meta text-ink-2">{places}</p> : null}
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

/** The records of one site, the ones that need an answer first. */
export function RecordList({
  records,
  label,
}: {
  records: readonly ListingRecord[];
  label: string;
}) {
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
