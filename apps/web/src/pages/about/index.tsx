import {
  API_ROUTES,
  DataSourceId,
  type DataSourceInfo,
  type InstanceHealth,
} from "@kickrocks/shared";
import { errorMessage, useApiQuery, useInstanceHealth } from "../../api/index.js";
import {
  Button,
  Callout,
  ExternalLinkText,
  PageHeader,
  Row,
  RowGroup,
  Section,
  Skeleton,
  Tag,
} from "../../components/ui/index.js";
import { formatCount, formatDate, formatDateTime, pluralize } from "../../lib/format.js";
import { FactRow, SETTINGS_WIDTH } from "../settings/rows.js";

const POLYFORM_URL = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
const CC_BY_NC_SA_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const ERASER_URL = "https://github.com/drumandbytes/eraser";
const BADBOOL_URL = "https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List";

export function Component() {
  return (
    <>
      <PageHeader title="About" description="Version, data sources, and licenses" />
      <div className={`${SETTINGS_WIDTH} flex flex-col gap-4`}>
        <InstanceSection />
        <SourcesSection />
        <LimitsSection />
        <AttributionSection />
      </div>
    </>
  );
}

function InstanceSection() {
  const health = useInstanceHealth();
  const status = useApiQuery(API_ROUTES.status);

  return (
    <Section label="Kick Rocks">
      {health.isPending || status.isPending ? (
        <RowGroup aria-busy="true">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className={`flex min-h-[2.3125rem] items-center px-3.5 py-2${
                key === 1 ? " max-sm:min-h-[4.0625rem]" : ""
              }`}
            >
              <Skeleton className="h-3.5 w-1/2" />
            </div>
          ))}
          <LicenseRow />
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
          {health.data && !health.data.ok ? (
            <Callout intent="danger" title="This instance is not working properly" className="mb-3">
              <ProblemList health={status.data?.health} />
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
            <LicenseRow />
          </RowGroup>
        </>
      )}
    </Section>
  );
}

function LicenseRow() {
  return (
    <FactRow label="License" mono={false}>
      <ExternalLinkText href={POLYFORM_URL}>PolyForm Noncommercial 1.0.0</ExternalLinkText>
      <span className="block text-ink-3">
        Free to use and change for yourself, not to sell. Copyright NC1107.
      </span>
    </FactRow>
  );
}

const MEBIBYTE = 1024 * 1024;

/** What the health check found, in the order a person would fix it. */
export function problemsOf({ scheduler, database, disk }: InstanceHealth): string[] {
  const problems: string[] = [];
  if (!database.writable) {
    problems.push(
      "The database cannot be written. Check that the data volume is mounted and not read-only.",
    );
  }
  if (disk.low) {
    problems.push(
      `Only ${formatCount(Math.floor((disk.freeBytes ?? 0) / MEBIBYTE))} MB is free on the data volume. Free some space on it.`,
    );
  }
  if (scheduler.stalled) {
    problems.push(
      scheduler.lastPassAt
        ? `The scheduler has not run since ${formatDateTime(scheduler.lastPassAt)}.`
        : "The scheduler has not finished a pass since it started.",
    );
  }
  if (scheduler.sendingStalled && scheduler.sendingSince) {
    problems.push(
      `Mail has been stuck since ${formatDateTime(scheduler.sendingSince)}, probably waiting on a mail server that stopped answering. Nothing is sent or polled until it lets go.`,
    );
  }
  return problems;
}

function ProblemList({ health }: { health: InstanceHealth | undefined }) {
  const problems = health ? problemsOf(health) : [];
  if (problems.length === 0) return <>The server says it cannot do its job right now.</>;
  return (
    <ul className="list-none space-y-1">
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  );
}

function SourcesSection() {
  const query = useApiQuery(API_ROUTES.settingsDataSources, { staleTime: 5 * 60_000 });
  return (
    <Section label="Data sources" {...(query.data ? { count: query.data.sources.length } : {})}>
      {query.isPending ? (
        <RowGroup aria-busy="true">
          {DataSourceId.options.map((id) => (
            <div key={id} className="px-3.5 py-3">
              <Skeleton className="h-[1.875rem] w-full max-sm:h-[3.75rem]" />
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
      trailingBelowOnPhone
    />
  );
}

function LimitsSection() {
  return (
    <Section label="Limits">
      <div className="flex max-w-prose flex-col gap-3 text-body text-ink">
        <p>
          This is not legal advice. A privacy law may not apply to a given business, and a request
          does not guarantee that anything gets deleted.
        </p>
        <p>
          A broker can add you back after it removes you, or get your details again from somewhere
          else. That is why the rescans exist.
        </p>
        <p>
          A request to a broker that never had you can create a new link between your name and your
          email on its side.
        </p>
        <p>
          Many states have no privacy law, so there the email rests on the company's own privacy
          policy, and a broker may not have one.
        </p>
      </div>
    </Section>
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
        <p>
          It also includes entries from the{" "}
          <ExternalLinkText href={ERASER_URL}>Eraser</ExternalLinkText> broker list, under the MIT
          license. The MIT license text stays with the copy of that list in the repository.
        </p>
        <p className="text-ink-2">
          Contacts in the company list were checked against each company's own privacy page.
        </p>
      </div>
    </Section>
  );
}
