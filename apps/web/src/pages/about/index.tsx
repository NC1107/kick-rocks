import { API_ROUTES, type DataSourceInfo } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  ExternalLinkText,
  PageHeader,
  Skeleton,
  SkeletonText,
} from "../../components/ui/index.js";
import { formatCount, formatDate, pluralize } from "../../lib/format.js";

const POLYFORM_URL = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
const CC_BY_NC_SA_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const BADBOOL_URL = "https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List";

export function Component() {
  return (
    <>
      <PageHeader
        title="About"
        description="Where the data comes from, and the licenses that apply to it."
      />
      <div className="flex max-w-3xl flex-col gap-6">
        <InstanceCard />
        <SourcesCard />
        <AttributionCard />
      </div>
    </>
  );
}

function InstanceCard() {
  const health = useApiQuery(API_ROUTES.health);
  const status = useApiQuery(API_ROUTES.status);

  return (
    <Card>
      <CardHeader
        title="Kick Rocks"
        description="Sends data broker and company opt-out requests from your own mailbox, and tracks every reply."
      />
      {health.isPending || status.isPending ? (
        <SkeletonText lines={4} />
      ) : (
        <>
          {health.error || status.error ? (
            <Alert
              intent="danger"
              title="Could not load this instance's details"
              className="mb-4"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    void health.refetch();
                    void status.refetch();
                  }}
                >
                  Try again
                </Button>
              }
            >
              {errorMessage(health.error ?? status.error)}
            </Alert>
          ) : null}
          <DescriptionList
            items={[
              ...(health.data ? [{ term: "Version", description: health.data.version }] : []),
              ...(status.data
                ? [
                    {
                      term: "Broker list",
                      description: status.data.brokers.available
                        ? `${pluralize(status.data.targets.brokers, "broker")}${
                            status.data.brokers.generatedAt
                              ? `, built ${formatDate(status.data.brokers.generatedAt)}`
                              : ""
                          }`
                        : "Not built yet. Run pnpm data:build, then restart the server.",
                    },
                    {
                      term: "Company list",
                      description: pluralize(status.data.targets.companies, "company", "companies"),
                    },
                    { term: "Profiles", description: formatCount(status.data.profiles) },
                  ]
                : []),
              {
                term: "License",
                description: (
                  <>
                    <ExternalLinkText href={POLYFORM_URL}>
                      PolyForm Noncommercial 1.0.0
                    </ExternalLinkText>
                    . Free to use and change for yourself, not to sell. Copyright NC1107.
                  </>
                ),
              },
            ]}
          />
        </>
      )}
    </Card>
  );
}

function SourcesCard() {
  const query = useApiQuery(API_ROUTES.settingsDataSources, { staleTime: 5 * 60_000 });
  return (
    <Card>
      <CardHeader
        title="Data sources"
        description="Every broker and company in the lists keeps a record of where it came from."
      />
      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : query.error ? (
        <Alert
          intent="danger"
          title="Could not load the data sources"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0">
          {query.data.sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function SourceRow({ source }: { source: DataSourceInfo }) {
  return (
    <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-base font-medium text-ink">
          <ExternalLinkText href={source.url}>{source.name}</ExternalLinkText>
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {source.attribution ? `By ${source.attribution}. ` : ""}
          {source.targetCount === 0
            ? "No entries use it right now."
            : `Used by ${pluralize(source.targetCount, "entry", "entries")}.`}
        </p>
      </div>
      <Badge variant="outline" className="self-start">
        {source.license}
      </Badge>
    </li>
  );
}

function AttributionCard() {
  return (
    <Card>
      <CardHeader title="Attribution" />
      <div className="flex max-w-prose flex-col gap-3 text-base text-ink">
        <p>
          The broker list includes entries from the{" "}
          <ExternalLinkText href={BADBOOL_URL}>Big Ass Data Broker Opt-Out List</ExternalLinkText>{" "}
          by Yael Grauer, under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0
          license (<ExternalLinkText href={CC_BY_NC_SA_URL}>CC BY-NC-SA 4.0</ExternalLinkText>).
        </p>
        <p>
          Kick Rocks converted those entries into its own format and added fields to them. The
          resulting broker list is shared under the same license, separately from the application
          code.
        </p>
        <p className="text-ink-muted">
          Contacts in the company list were checked against each company's own privacy page.
        </p>
      </div>
    </Card>
  );
}
