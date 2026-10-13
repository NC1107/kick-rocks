import { API_ROUTES, type Jurisdiction, US_STATES } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiQuery, useCurrentProfile } from "../../api/index.js";
import {
  Button,
  Callout,
  EmptyState,
  ExternalLinkText,
  RowGroup,
  Section,
  Select,
  SkeletonText,
} from "../../components/ui/index.js";
import { formatDate } from "../../lib/format.js";
import { RIGHT_LABELS } from "../../lib/labels.js";
import { BodyRow } from "./rows.js";

const STATE_NAMES = new Map(US_STATES.map((state) => [state.code, state.name]));

function Statutes({ jurisdiction }: { jurisdiction: Jurisdiction }) {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line bg-canvas p-0">
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

/**
 * The laws for one state at a time, the profile's own by default: a person cares about the law
 * that applies to them, and the other states stay a pick away rather than a wall of rows.
 */
export function JurisdictionsCard() {
  const query = useApiQuery(API_ROUTES.settingsJurisdictions, { staleTime: 5 * 60_000 });
  const { profile } = useCurrentProfile();
  const [picked, setPicked] = useState<string | null>(null);
  const withLaws = (query.data?.jurisdictions ?? []).filter(
    (jurisdiction) => jurisdiction.statutes.length > 0,
  );
  const stateCode = picked ?? profile?.state ?? withLaws[0]?.state ?? null;
  const chosen = withLaws.find((jurisdiction) => jurisdiction.state === stateCode) ?? null;

  return (
    <Section
      label="Privacy laws"
      actions={
        withLaws.length > 0 ? (
          <Select
            aria-label="State"
            value={stateCode ?? ""}
            onChange={(event) => setPicked(event.target.value)}
            className="w-44"
          >
            {withLaws.map((jurisdiction) => (
              <option key={jurisdiction.state} value={jurisdiction.state}>
                {STATE_NAMES.get(jurisdiction.state) ?? jurisdiction.state}
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
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
      ) : chosen ? (
        <RowGroup>
          <Statutes jurisdiction={chosen} />
        </RowGroup>
      ) : (
        <EmptyState
          title={`${profile ? (STATE_NAMES.get(profile.state) ?? profile.state) : "This state"} has no privacy law on file.`}
          description="Requests there cite the site's own policy instead."
        />
      )}
    </Section>
  );
}
