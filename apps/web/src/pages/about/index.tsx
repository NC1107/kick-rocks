import { API_ROUTES, type DataSourceInfo } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  ExternalLinkText,
  PageHeader,
  Row,
  RowGroup,
  Section,
  Skeleton,
  SkeletonText,
  Tag,
} from "../../components/ui/index.js";
import { formatCount, formatDate, pluralize } from "../../lib/format.js";
import { BodyRow, FactRow, SETTINGS_WIDTH } from "../settings/rows.js";

const POLYFORM_URL = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
const CC_BY_NC_SA_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const BADBOOL_URL = "https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List";

export function Component() {
  return (
    <>
      <PageHeader title="About" description="Version, data sources, and licenses" />
      <div className={`${SETTINGS_WIDTH} flex flex-col gap-4`}>
        <InstanceSection />
        <SourcesSection />
        <AttributionSection />
      </div>
    </>
  );
}

function InstanceSection() {
  const health = useApiQuery(API_ROUTES.health);
  const status = useApiQuery(API_ROUTES.status);

  return (
    <Section label="Kick Rocks">
      {health.isPending || status.isPending ? (
        <RowGroup>
          <BodyRow>
            <SkeletonText lines={4} />
          </BodyRow>
        </RowGroup>
      ) : (
        <>
          {health.error || status.error ? (
            <Callout
              intent="danger"
              title="Could not load this instance's details"
              className="mb-3"
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
            </Callout>
          ) : null}
          <RowGroup>
            {health.data ? <FactRow label="Version">{health.data.version}</FactRow> : null}
            {status.data ? (
              <>
                <FactRow label="Broker list" mono={status.data.brokers.available}>
                  {status.data.brokers.available
                    ? `${pluralize(status.data.targets.brokers, "broker")}${
                        status.data.brokers.generatedAt
                          ? `, built ${formatDate(status.data.brokers.generatedAt)}`
                          : ""
                      }`
                    : "Not built yet. Run pnpm data:build, then restart the server."}
                </FactRow>
                <FactRow label="Company list">
                  {pluralize(status.data.targets.companies, "company", "companies")}
                </FactRow>
                <FactRow label="Profiles">{formatCount(status.data.profiles)}</FactRow>
              </>
            ) : null}
            <FactRow label="License" mono={false}>
              <ExternalLinkText href={POLYFORM_URL}>PolyForm Noncommercial 1.0.0</ExternalLinkText>
              <span className="block text-ink-3">
                Free to use and change for yourself, not to sell. Copyright NC1107.
              </span>
            </FactRow>
          </RowGroup>
        </>
      )}
    </Section>
  );
}

function SourcesSection() {
  const query = useApiQuery(API_ROUTES.settingsDataSources, { staleTime: 5 * 60_000 });
  return (
    <Section label="Data sources" {...(query.data ? { count: query.data.sources.length } : {})}>
      {query.isPending ? (
        <RowGroup aria-busy="true">
          {[0, 1, 2].map((key) => (
            <div key={key} className="px-3.5 py-3">
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </RowGroup>
      ) : query.error ? (
        <Callout
          intent="danger"
          title="Could not load the data sources"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      ) : (
        <RowGroup role="list" className="list-none">
          {query.data.sources.map((source) => (
            <li key={source.id}>
              <SourceRow source={source} />
            </li>
          ))}
        </RowGroup>
      )}
    </Section>
  );
}

function SourceRow({ source }: { source: DataSourceInfo }) {
  return (
    <Row
      title={<ExternalLinkText href={source.url}>{source.name}</ExternalLinkText>}
      description={`${source.attribution ? `By ${source.attribution}. ` : ""}${
        source.targetCount === 0
          ? "No entries use it right now."
          : `Used by ${pluralize(source.targetCount, "entry", "entries")}.`
      }`}
      trailing={<Tag>{source.license}</Tag>}
    />
  );
}

function AttributionSection() {
  return (
    <Section label="Attribution">
      <div className="flex max-w-prose flex-col gap-3 text-body text-ink">
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
        <p className="text-ink-2">
          Contacts in the company list were checked against each company's own privacy page.
        </p>
      </div>
    </Section>
  );
}
