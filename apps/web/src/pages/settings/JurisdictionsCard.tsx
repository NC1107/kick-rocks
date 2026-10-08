import { API_ROUTES, type Jurisdiction, US_STATES } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  EmptyState,
  ExternalLinkText,
  RowGroup,
  Section,
  SkeletonText,
} from "../../components/ui/index.js";
import { formatDate, pluralize } from "../../lib/format.js";
import { RIGHT_LABELS } from "../../lib/labels.js";
import { BodyRow } from "./rows.js";

const STATE_NAMES = new Map(US_STATES.map((state) => [state.code, state.name]));

function Statutes({ jurisdiction }: { jurisdiction: Jurisdiction }) {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line border-t border-line bg-canvas p-0">
      {jurisdiction.statutes.map((statute) => (
        <li key={statute.id} className="px-3.5 py-2.5">
          <p className="text-ui font-medium text-ink">{statute.name}</p>
          <p className="font-mono text-caption text-ink-3">
            {statute.citation}, since {formatDate(statute.effectiveDate)}
          </p>
          <p className="mt-1 text-meta text-ink-2">
            {statute.rights.map((right) => RIGHT_LABELS[right]).join(", ")}
            <span className="font-mono text-caption text-ink-3">
              {" "}
              · {statute.responseDays} d to answer
              {statute.responseDaysChange
                ? `, ${statute.responseDaysChange.days} d from ${formatDate(statute.responseDaysChange.from)}`
                : ""}
            </span>
          </p>
          {statute.platform ? (
            <p className="mt-1 text-meta text-ink-2">
              <ExternalLinkText href={statute.platform.url}>
                {statute.platform.name}
              </ExternalLinkText>
              {`: ${statute.platform.note}`}
            </p>
          ) : null}
          <p className="mt-1 text-meta">
            <ExternalLinkText href={statute.sourceUrl}>Read the law</ExternalLinkText>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function JurisdictionsCard() {
  const query = useApiQuery(API_ROUTES.settingsJurisdictions, { staleTime: 5 * 60_000 });
  const withLaws = (query.data?.jurisdictions ?? []).filter(
    (jurisdiction) => jurisdiction.statutes.length > 0,
  );
  const withoutLaws = US_STATES.length - withLaws.length;

  return (
    <Section label="Privacy laws" {...(query.data ? { count: `${withLaws.length} states` } : {})}>
      {query.isPending ? (
        <RowGroup>
          <BodyRow>
            <span className="sr-only">Loading privacy laws</span>
            <SkeletonText lines={4} />
          </BodyRow>
        </RowGroup>
      ) : query.isError ? (
        <Callout
          intent="danger"
          title="Could not load the privacy laws"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      ) : withLaws.length === 0 ? (
        <EmptyState title="No state laws are loaded." />
      ) : (
        <RowGroup>
          <div
            aria-hidden="true"
            className="flex h-8 items-center justify-between bg-canvas px-3.5 text-eyebrow text-ink-3"
          >
            <span>State</span>
            <span>Laws</span>
          </div>
          {withLaws.map((jurisdiction) => (
            <details key={jurisdiction.state} className="group">
              <summary className="flex min-h-row cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-1.5 text-ui text-ink transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
                <span className="font-medium">
                  {STATE_NAMES.get(jurisdiction.state) ?? jurisdiction.state}
                </span>
                <span className="flex items-center gap-2 font-mono text-meta tabular-nums text-ink-2">
                  {pluralize(jurisdiction.statutes.length, "law")}
                  <ChevronDown
                    aria-hidden="true"
                    strokeWidth={1.5}
                    className="size-4 text-ink-3 transition-transform duration-100 group-open:rotate-180"
                  />
                </span>
              </summary>
              <Statutes jurisdiction={jurisdiction} />
            </details>
          ))}
          <BodyRow className="text-meta text-ink-3">
            {`${pluralize(withoutLaws, "state")} ${withoutLaws === 1 ? "has" : "have"} no law on file. Requests there cite the company's own privacy policy.`}
          </BodyRow>
        </RowGroup>
      )}
    </Section>
  );
}
