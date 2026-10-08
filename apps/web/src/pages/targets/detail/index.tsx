import { API_ROUTES, type DataSource, type Requirement } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useParams } from "react-router";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { useBreadcrumbTail } from "../../../components/layout/breadcrumb-context.js";
import {
  Alert,
  Button,
  DescriptionList,
  EmptyState,
  ExternalLinkText,
  LinkButton,
  PageHeader,
  RowGroup,
  Section,
  Skeleton,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tag,
} from "../../../components/ui/index.js";
import { formatDate } from "../../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  DIFFICULTY_LABELS,
  DIFFICULTY_MEANINGS,
  DIFFICULTY_REASON_LABELS,
  RECIPE_STATUS_LABELS,
  REQUIREMENT_LABELS,
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../../lib/labels.js";
import { HealthMark } from "../Automation.js";
import { DifficultyTag } from "../DifficultyTag.js";
import { Priority } from "../Priority.js";
import { HUMAN_STEPS } from "../RequirementBadges.js";

const REQUIREMENT_HELP: Record<Requirement, string> = {
  email_confirmation: "It sends a confirmation email, and the link in it has to be followed.",
  phone_call: "Removal needs a phone call that only you can make.",
  id_upload: "It asks for a photo of ID. Nothing uploads ID for you.",
  captcha: "A CAPTCHA stands in the way. The task waits in Review for you to solve it.",
  account: "You have to create an account before it lets you remove a record.",
  paid: "It charges for removal. Nothing pays on your behalf.",
  record_url: "It removes one record at a time, so it first scans for your record.",
  postal_mail: "It accepts requests by post. Nothing sends mail for you.",
  fax: "It accepts requests by fax. Nothing sends faxes for you.",
};

const LICENSE_LABELS: Record<DataSource["license"], string> = {
  MIT: "MIT",
  "public-record": "Public record",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0",
  "PolyForm-Noncommercial-1.0.0": "PolyForm Noncommercial 1.0.0",
};

const SOURCE_LABELS: Record<DataSource["source"], string> = {
  eraser: "Eraser broker list",
  "ca-registry-2025": "California Data Broker Registry 2025",
  badbool: "Big Ass Data Broker Opt-Out List",
  kickrocks: "Kick Rocks broker data",
  "kickrocks-companies": "Kick Rocks company list",
};

function Missing() {
  return <span className="text-ink-3">Not listed</span>;
}

const MONO = "font-mono text-meta";

function Loading() {
  return (
    <div aria-busy="true" className="flex max-w-180 flex-col gap-4">
      <span className="sr-only">Loading target</span>
      <Skeleton className="h-7 w-64" />
      <div className="rounded-md border border-line bg-surface p-3.5">
        <SkeletonText lines={5} />
      </div>
    </div>
  );
}

export function Component() {
  const { id } = useParams();
  const query = useApiQuery(API_ROUTES.targetsGet, id ? { params: { id } } : skipToken);
  useBreadcrumbTail(query.data?.name);

  if (query.isPending) return <Loading />;

  if (query.isError) {
    const missing = query.error.status === 404;
    return missing ? (
      <EmptyState
        title="Target not found."
        description="It may have been removed from the dataset."
        actions={<LinkButton to="/targets">Back to targets</LinkButton>}
      />
    ) : (
      <>
        <PageHeader title="Target" back={{ to: "/targets", label: "Targets" }} />
        <Alert
          intent="danger"
          title="Could not load this target"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      </>
    );
  }

  const target = query.data;
  const unsupported = target.contactMethod === "unknown";

  return (
    <>
      <PageHeader
        title={target.name}
        description={`${TARGET_KIND_LABELS[target.kind]}, ${TARGET_CATEGORY_LABELS[target.category].toLowerCase()}`}
        back={{ to: "/targets", label: "Targets" }}
        actions={
          <>
            <LinkButton to={`/requests?targetId=${encodeURIComponent(target.id)}`}>
              View requests
            </LinkButton>
            {target.retired ? null : (
              <LinkButton
                to={`/campaigns/new?targets=${encodeURIComponent(target.id)}`}
                variant="primary"
              >
                Ask to remove my data
              </LinkButton>
            )}
          </>
        }
      />

      <div className="flex max-w-180 flex-col gap-4">
        {target.retired ? (
          <Alert intent="warning" title="No longer in the dataset">
            Nothing new is sent to this target, and its history stays.
          </Alert>
        ) : null}
        {unsupported && !target.retired ? (
          <Alert intent="info" title="No way to contact them on file">
            A campaign skips this target until the dataset has an email address or a form for it.
          </Alert>
        ) : null}

        <Section label="Details">
          <div className="rounded-md border border-line bg-surface px-3.5 py-3">
            <DescriptionList
              items={[
                {
                  term: "Priority",
                  description: <Priority priority={target.priority} />,
                },
                { term: "Contact", description: CONTACT_METHOD_LABELS[target.contactMethod] },
                {
                  term: "Website",
                  description: target.website ? (
                    <ExternalLinkText href={target.website} className={MONO}>
                      {target.domain}
                    </ExternalLinkText>
                  ) : (
                    <span className={MONO}>{target.domain}</span>
                  ),
                },
                {
                  term: "Privacy email",
                  description: target.privacyEmail ? (
                    <span className={`${MONO} break-all`}>{target.privacyEmail}</span>
                  ) : (
                    <Missing />
                  ),
                },
                {
                  term: "Opt-out page",
                  description: target.optOutUrl ? (
                    <ExternalLinkText href={target.optOutUrl} className={`${MONO} break-all`}>
                      {target.optOutUrl}
                    </ExternalLinkText>
                  ) : (
                    <Missing />
                  ),
                },
                {
                  term: "Privacy rights page",
                  description: target.privacyRightsUrl ? (
                    <ExternalLinkText
                      href={target.privacyRightsUrl}
                      className={`${MONO} break-all`}
                    >
                      {target.privacyRightsUrl}
                    </ExternalLinkText>
                  ) : (
                    <Missing />
                  ),
                },
                ...(target.needsRecord
                  ? [
                      {
                        term: "Find your record",
                        description: target.searchUrl ? (
                          <ExternalLinkText href={target.searchUrl} className={`${MONO} break-all`}>
                            {target.searchUrl}
                          </ExternalLinkText>
                        ) : (
                          <Missing />
                        ),
                      },
                    ]
                  : []),
                {
                  term: "Region",
                  description: <span className={MONO}>{target.region.toUpperCase()}</span>,
                },
                {
                  term: "Contacts checked",
                  description: target.verifiedAt ? (
                    <span className={MONO}>{formatDate(target.verifiedAt)}</span>
                  ) : (
                    <span className="text-ink-3">Not checked yet</span>
                  ),
                },
              ]}
            />
          </div>
        </Section>

        <Section label="Difficulty" actions={<DifficultyTag difficulty={target.difficulty} />}>
          <RowGroup>
            <p className="px-3.5 py-2.5 text-ui text-ink">
              <span className="font-medium">{DIFFICULTY_LABELS[target.difficulty]}.</span>{" "}
              <span className="text-ink-2">{DIFFICULTY_MEANINGS[target.difficulty]}</span>
            </p>
            {target.difficultyReasons.map((reason) => (
              <p key={reason} className="px-3.5 py-2.5 text-meta text-ink-2">
                {DIFFICULTY_REASON_LABELS[reason]}
              </p>
            ))}
          </RowGroup>
        </Section>

        <Section
          label="Asks of you"
          {...(target.requirements.length > 0 ? { count: target.requirements.length } : {})}
        >
          {target.requirements.length === 0 ? (
            <p className="text-ui text-ink-2">Nothing beyond sending the request.</p>
          ) : (
            <RowGroup className="sm:grid sm:grid-cols-[max-content_minmax(0,1fr)]">
              {target.requirements.map((requirement) => (
                <div
                  key={requirement}
                  className="flex flex-col items-start gap-1 px-3.5 py-2.5 sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-baseline sm:gap-x-3"
                >
                  <Tag tone={HUMAN_STEPS.has(requirement) ? "attention" : "neutral"}>
                    {REQUIREMENT_LABELS[requirement]}
                  </Tag>
                  <span className="min-w-0 text-meta text-ink-2">
                    {REQUIREMENT_HELP[requirement]}
                  </span>
                </div>
              ))}
            </RowGroup>
          )}
          {target.notes ? (
            <div className="mt-3 flex flex-col gap-1.5 text-meta text-ink-2">
              {target.notes.split(" | ").map((part) => (
                <p key={part} className="break-words">
                  {part}
                </p>
              ))}
            </div>
          ) : null}
        </Section>

        <Section label="Automation">
          {target.recipes.length === 0 ? (
            <EmptyState
              title="No saved steps for this target."
              description="Requests go by email where possible. Form tasks wait for an agent or for you in Review."
            />
          ) : (
            <Table label="Recipes for this target">
              <TableHead>
                <tr>
                  <TableHeaderCell>Purpose</TableHeaderCell>
                  <TableHeaderCell className="hidden sm:table-cell">Version</TableHeaderCell>
                  <TableHeaderCell className="hidden sm:table-cell">Source</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Health</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {target.recipes.map((recipe) => (
                  <TableRow key={recipe.id}>
                    <TableCell>{recipe.purpose === "scan" ? "Scan" : "Removal"}</TableCell>
                    <TableCell mono className="hidden sm:table-cell">
                      v{recipe.version}
                    </TableCell>
                    <TableCell className="hidden capitalize text-ink-2 sm:table-cell">
                      {recipe.source}
                    </TableCell>
                    <TableCell className="text-ink-2">
                      {RECIPE_STATUS_LABELS[recipe.status]}
                    </TableCell>
                    <TableCell>
                      <HealthMark health={recipe.health} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>

        <Section label="Sources" count={target.sources.length}>
          {target.sources.length === 0 ? (
            <p className="text-ui text-ink-2">No source on file.</p>
          ) : (
            <RowGroup>
              {target.sources.map((source) => (
                <div
                  key={`${source.source}-${source.upstreamId ?? ""}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5"
                >
                  <span className="text-ui text-ink">{SOURCE_LABELS[source.source]}</span>
                  <Tag>{LICENSE_LABELS[source.license]}</Tag>
                </div>
              ))}
            </RowGroup>
          )}
        </Section>
      </div>
    </>
  );
}
