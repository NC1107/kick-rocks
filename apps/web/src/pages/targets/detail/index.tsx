import { API_ROUTES, type DataSource, type Requirement } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import { useParams } from "react-router";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  ExternalLinkText,
  LinkButton,
  PageHeader,
  Skeleton,
  SkeletonText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../../../components/ui/index.js";
import { formatDate } from "../../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  RECIPE_HEALTH_LABELS,
  RECIPE_HEALTH_TONES,
  RECIPE_STATUS_LABELS,
  REQUIREMENT_LABELS,
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../../lib/labels.js";

const REQUIREMENT_HELP: Record<Requirement, string> = {
  email_confirmation: "It sends a confirmation email, and the link in it has to be followed.",
  phone_call: "Removal needs a phone call. Kick Rocks cannot make it for you.",
  id_upload: "It asks for a photo of ID. Kick Rocks never uploads ID for you.",
  captcha: "A CAPTCHA stands in the way. The task waits in Review for you to solve it.",
  account: "You have to create an account before it lets you remove a record.",
  paid: "It charges for removal. Kick Rocks does not pay on your behalf.",
  record_url: "It removes one listing at a time, so Kick Rocks first scans for your record.",
  postal_mail: "It accepts requests by post. Kick Rocks does not send mail.",
  fax: "It accepts requests by fax. Kick Rocks does not send faxes.",
};

const LICENSE_LABELS: Record<DataSource["license"], string> = {
  MIT: "MIT",
  "public-record": "Public record",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0",
  "PolyForm-Noncommercial-1.0.0": "PolyForm Noncommercial 1.0.0",
};

const SOURCE_LABELS: Record<DataSource["source"], string> = {
  eraser: "Eraser broker list",
  "ca-registry-2026": "California Data Broker Registry 2026",
  badbool: "Big Ass Data Broker Opt-Out List",
  optery: "Optery Data Brokers Directory",
  kickrocks: "Kick Rocks broker data",
  "kickrocks-companies": "Kick Rocks company list",
};

function Missing() {
  return <span className="text-ink-faint">Not listed</span>;
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading target</span>
      <Skeleton className="h-8 w-64" />
      <Card>
        <SkeletonText lines={5} />
      </Card>
    </div>
  );
}

export function Component() {
  const { id } = useParams();
  const query = useApiQuery(API_ROUTES.targetsGet, id ? { params: { id } } : skipToken);

  if (query.isPending) return <Loading />;

  if (query.isError) {
    const missing = query.error.status === 404;
    return missing ? (
      <EmptyState
        icon={SearchX}
        title="Target not found"
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
        description={`${TARGET_KIND_LABELS[target.kind]} in ${TARGET_CATEGORY_LABELS[target.category].toLowerCase()}`}
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

      <div className="flex flex-col gap-5">
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

        <Card>
          <CardHeader title="Details" />
          <DescriptionList
            items={[
              {
                term: "Priority",
                description: (
                  <Badge tone={PRIORITY_TONES[target.priority]}>
                    {PRIORITY_LABELS[target.priority]}
                  </Badge>
                ),
              },
              { term: "Contact", description: CONTACT_METHOD_LABELS[target.contactMethod] },
              {
                term: "Website",
                description: target.website ? (
                  <ExternalLinkText href={target.website}>{target.domain}</ExternalLinkText>
                ) : (
                  target.domain
                ),
              },
              {
                term: "Privacy email",
                description: target.privacyEmail ? (
                  <span className="break-all">{target.privacyEmail}</span>
                ) : (
                  <Missing />
                ),
              },
              {
                term: "Opt-out page",
                description: target.optOutUrl ? (
                  <ExternalLinkText href={target.optOutUrl} className="break-all">
                    {target.optOutUrl}
                  </ExternalLinkText>
                ) : (
                  <Missing />
                ),
              },
              {
                term: "Privacy rights page",
                description: target.privacyRightsUrl ? (
                  <ExternalLinkText href={target.privacyRightsUrl} className="break-all">
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
                        <ExternalLinkText href={target.searchUrl} className="break-all">
                          {target.searchUrl}
                        </ExternalLinkText>
                      ) : (
                        <Missing />
                      ),
                    },
                  ]
                : []),
              { term: "Region", description: target.region.toUpperCase() },
              {
                term: "Contacts checked",
                description: target.verifiedAt ? formatDate(target.verifiedAt) : "Not checked yet",
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader
            title="What it asks of you"
            description={
              target.needsRecord
                ? "Removal starts from a scan that finds your record, then waits for you to confirm it."
                : undefined
            }
          />
          {target.requirements.length === 0 ? (
            <p className="text-base text-ink-muted">Nothing beyond sending the request.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {target.requirements.map((requirement) => (
                <li key={requirement} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Badge className="w-36 justify-center">{REQUIREMENT_LABELS[requirement]}</Badge>
                  <span className="min-w-0 flex-1 text-base text-ink-muted">
                    {REQUIREMENT_HELP[requirement]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {target.notes ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-base text-ink">
              {target.notes.split(" | ").map((part) => (
                <p key={part} className="break-words">
                  {part}
                </p>
              ))}
            </div>
          ) : null}
        </Card>

        <section aria-labelledby="recipes-heading">
          <h2 id="recipes-heading" className="mb-3 text-lg font-semibold text-ink">
            Automation
          </h2>
          {target.recipes.length === 0 ? (
            <EmptyState
              title="No saved steps for this site"
              description="Requests go by email where possible. Form tasks are handed to an agent or wait for you in Review."
              className="py-8"
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
                    <TableCell className="hidden sm:table-cell">v{recipe.version}</TableCell>
                    <TableCell className="hidden capitalize sm:table-cell">
                      {recipe.source}
                    </TableCell>
                    <TableCell>{RECIPE_STATUS_LABELS[recipe.status]}</TableCell>
                    <TableCell>
                      <Badge tone={RECIPE_HEALTH_TONES[recipe.health]}>
                        {RECIPE_HEALTH_LABELS[recipe.health]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <Card>
          <CardHeader
            title="Sources and licenses"
            description="Where this record comes from, and the terms it is shared under."
          />
          {target.sources.length === 0 ? (
            <p className="text-base text-ink-muted">No source on file.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
              {target.sources.map((source) => (
                <li
                  key={`${source.source}-${source.upstreamId ?? ""}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-base text-ink">{SOURCE_LABELS[source.source]}</span>
                  <Badge variant="outline">{LICENSE_LABELS[source.license]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
