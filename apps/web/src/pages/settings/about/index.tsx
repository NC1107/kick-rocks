import {
  API_ROUTES,
  DataSourceId,
  type DataSourceInfo,
  type InstanceHealth,
} from "@kickrocks/shared";
import { errorMessage, useApiQuery, useInstanceHealth } from "../../../api/index.js";
import {
  Button,
  Callout,
  ExternalLinkText,
  Row,
  RowGroup,
  Section,
  Skeleton,
  Tag,
} from "../../../components/ui/index.js";
import { versionLabel } from "../../../components/layout/shell-status.js";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatRelative,
  pluralize,
} from "../../../lib/format.js";
import { FactRow, SETTINGS_WIDTH } from "../rows.js";
import { SettingsHeader } from "../SettingsHeader.js";

const POLYFORM_URL = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
const CC_BY_NC_SA_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
const REPO_URL = "https://github.com/NC1107/kick-rocks";
const ISSUES_URL = `${REPO_URL}/issues`;
const ERASER_URL = "https://github.com/drumandbytes/eraser";
const BADBOOL_URL = "https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List";

export function Component() {
  return (
    <>
      <SettingsHeader section="About" description="Version, data sources, and licenses" />
      <div className={`${SETTINGS_WIDTH} flex flex-col gap-4`}>
        <InstanceSection />
        <SourcesSection />
        <LicensesSection />
        <LinksSection />
      </div>
    </>
  );
}

function InstanceSection() {
  const health = useInstanceHealth();
  const status = useApiQuery(API_ROUTES.status);

  return (
    <Section label="Version">
      {health.isPending || status.isPending ? (
        <RowGroup aria-busy="true">
          {["Version", "Built", "Broker list", "Backup"].map((label) => (
            <FactRow key={label} label={label}>
              <Skeleton className="h-3.5 w-1/2" />
            </FactRow>
          ))}
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
            {health.data ? (
              <FactRow label="Version">{versionLabel(health.data.version)}</FactRow>
            ) : null}
            {status.data ? (
              <>
                <FactRow label="Built">
                  {status.data.builtAt ? formatDate(status.data.builtAt) : "Not recorded"}
                </FactRow>
                <FactRow label="Broker list" mono={status.data.brokers.available}>
                  {status.data.brokers.available
                    ? `${pluralize(status.data.targets.brokers, "broker")}${
                        status.data.brokers.generatedAt
                          ? `, built ${formatDate(status.data.brokers.generatedAt)}`
                          : ""
                      }`
                    : "Not built yet. Run pnpm data:build, then restart the server."}
                </FactRow>
                <FactRow label="Backup" mono={false}>
                  <BackupFreshness backup={status.data.health.backup} />
                </FactRow>
              </>
            ) : null}
          </RowGroup>
        </>
      )}
    </Section>
  );
}

function LinksSection() {
  return (
    <Section label="Links">
      <RowGroup>
        <FactRow label="Source code" mono={false}>
          <ExternalLinkText href={REPO_URL}>github.com/NC1107/kick-rocks</ExternalLinkText>
        </FactRow>
        <FactRow label="Problems" mono={false}>
          <ExternalLinkText href={ISSUES_URL}>Report an issue</ExternalLinkText>
        </FactRow>
      </RowGroup>
    </Section>
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

export function backupSummary({ lastVerifiedAt, stale }: InstanceHealth["backup"]): string {
  if (!lastVerifiedAt) return "No verified backup yet. Run ./install.sh --backup.";
  const when = `Last verified backup ${formatRelative(lastVerifiedAt)}.`;
  return stale ? `${when} That is too old: run ./install.sh --backup again.` : when;
}

function BackupFreshness({ backup }: { backup: InstanceHealth["backup"] }) {
  return (
    <span className={backup.stale ? "text-danger-text" : undefined}>{backupSummary(backup)}</span>
  );
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

function LicensesSection() {
  return (
    <Section label="Licenses">
      <div className="flex max-w-prose flex-col gap-3 text-body text-ink">
        <p>
          Kick Rocks is under{" "}
          <ExternalLinkText href={POLYFORM_URL}>PolyForm Noncommercial 1.0.0</ExternalLinkText>.
          Free to use and change for yourself, not to sell. Copyright NC1107.
        </p>
        <p>
          The broker list includes entries from the{" "}
          <ExternalLinkText href={BADBOOL_URL}>Big Ass Data Broker Opt-Out List</ExternalLinkText>{" "}
          by Yael Grauer, under{" "}
          <ExternalLinkText href={CC_BY_NC_SA_URL}>CC BY-NC-SA 4.0</ExternalLinkText>, converted to
          Kick Rocks's format with added fields. The resulting list is shared under the same
          license, separately from the application code.
        </p>
        <p>
          It also includes entries from the{" "}
          <ExternalLinkText href={ERASER_URL}>Eraser</ExternalLinkText> broker list, under the MIT
          license. The license text stays with the copy of that list in the repository.
        </p>
        <p className="text-ink-2">
          This is not legal advice, and a request does not guarantee that anything gets deleted.
        </p>
      </div>
    </Section>
  );
}
