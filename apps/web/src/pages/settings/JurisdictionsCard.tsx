import { API_ROUTES, US_STATES } from "@kickrocks/shared";
import { ChevronDown } from "lucide-react";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ExternalLinkText,
  SkeletonText,
} from "../../components/ui/index.js";
import { formatDate, pluralize } from "../../lib/format.js";
import { RIGHT_LABELS } from "../../lib/labels.js";

const STATE_NAMES = new Map(US_STATES.map((state) => [state.code, state.name]));

export function JurisdictionsCard() {
  const query = useApiQuery(API_ROUTES.settingsJurisdictions, { staleTime: 5 * 60_000 });
  return (
    <Card padding="none">
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
        <CardHeader
          title="Privacy laws"
          description="The laws Kick Rocks cites, chosen by the state on each profile."
          className="mb-3"
        />
      </div>
      {query.isPending ? (
        <div className="border-t border-line p-4 sm:p-5">
          <span className="sr-only">Loading privacy laws</span>
          <SkeletonText lines={4} />
        </div>
      ) : query.isError ? (
        <div className="border-t border-line p-4 sm:p-5">
          <Alert
            intent="danger"
            title="Could not load the privacy laws"
            action={
              <Button size="sm" onClick={() => query.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(query.error)}
          </Alert>
        </div>
      ) : query.data.jurisdictions.length === 0 ? (
        <p className="border-t border-line p-4 text-base text-ink-muted sm:p-5">
          No state laws are loaded.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {query.data.jurisdictions.map((jurisdiction) => (
            <li key={jurisdiction.state}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base text-ink hover:bg-sunken/60 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="font-medium">
                    {STATE_NAMES.get(jurisdiction.state) ?? jurisdiction.state}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    {pluralize(jurisdiction.statutes.length, "law")}
                    <ChevronDown
                      aria-hidden="true"
                      className="size-4 transition-transform group-open:rotate-180"
                    />
                  </span>
                </summary>
                <ul className="m-0 flex list-none flex-col gap-4 px-4 pt-1 pb-4 sm:px-5">
                  {jurisdiction.statutes.map((statute) => (
                    <li key={statute.id}>
                      <p className="text-base font-medium text-ink">{statute.name}</p>
                      <p className="text-sm text-ink-muted">
                        {statute.citation}, in effect since {formatDate(statute.effectiveDate)}
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {statute.rights.map((right) => (
                          <Badge key={right}>{RIGHT_LABELS[right]}</Badge>
                        ))}
                        <span className="text-sm text-ink-muted">
                          {statute.responseDays} days to answer
                        </span>
                      </p>
                      {statute.platform ? (
                        <p className="mt-1.5 text-sm text-ink-muted">
                          <ExternalLinkText href={statute.platform.url}>
                            {statute.platform.name}
                          </ExternalLinkText>
                          {`: ${statute.platform.note}`}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm">
                        <ExternalLinkText href={statute.sourceUrl}>Read the law</ExternalLinkText>
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
