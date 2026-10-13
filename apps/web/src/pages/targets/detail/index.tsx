import {
  API_ROUTES,
  DATA_SOURCE_DETAILS,
  type DataSource,
  isActiveStatus,
  type Requirement,
  type TargetDetail,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Globe, Mail } from "lucide-react";
import { useParams } from "react-router";
import {
  errorMessage,
  useApiMutation,
  useApiQuery,
  useCurrentProfile,
} from "../../../api/index.js";
import { useBreadcrumbTail } from "../../../components/layout/breadcrumb-context.js";
import {
  BreakableAddress,
  Button,
  Callout,
  CopyButton,
  CountLink,
  DataList,
  EmptyState,
  EntityRow,
  ExternalLinkText,
  FactList,
  LinkButton,
  PageHeader,
  RowGroup,
  Section,
  SkeletonText,
  StatusMark,
  Tag,
  TextLink,
  useToast,
} from "../../../components/ui/index.js";
import { formatDate, pluralize } from "../../../lib/format.js";
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
import { pendingRecords } from "../../../lib/listings.js";
import { paths } from "../../../lib/paths.js";
import { describeScanStart } from "../../../lib/scan-start.js";
import { LISTING_INVALIDATES } from "../../findings/scanning.js";
import { RIGHT_TOKENS } from "../../requests/format.js";
import { HealthMark } from "../Automation.js";
import { Priority } from "../Priority.js";
import { HUMAN_STEPS } from "../RequirementBadges.js";
import { SiteVisits } from "./SiteVisits.js";
import { YourListing } from "./YourListing.js";

const REQUIREMENT_HELP: Record<Requirement, string> = {
  email_confirmation: "It sends a confirmation email, and the link in it has to be followed.",
  phone_call: "Removal needs a phone call that only you can make.",
  id_upload: "It asks for an ID photo, which only you can upload.",
  captcha: "A CAPTCHA stands in the way. The task waits in Review for you to solve it.",
  account: "You have to create an account before it lets you remove a record.",
  paid: "It charges for removal. Nothing pays on your behalf.",
  record_url: "It removes one record at a time, after scanning for yours.",
  postal_mail: "Post only; nothing sends mail for you.",
  fax: "It accepts requests by fax. Nothing sends faxes for you.",
  device_id:
    "It matches only a mobile advertising ID, so a request with your name and address is never matched.",
};

const LICENSE_LABELS: Record<DataSource["license"], string> = {
  MIT: "MIT",
  "public-record": "Public record",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0",
  "PolyForm-Noncommercial-1.0.0": "PolyForm Noncommercial 1.0.0",
};

function Missing() {
  return <span className="text-ink-3">Not listed</span>;
}

const MONO = "font-mono text-meta";

function Loading() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading target</span>
      <PageHeader title="Target" />
      <div className="max-w-180 rounded-md border border-line bg-surface p-3.5">
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
        <PageHeader title="Target" />
        <Callout
          intent="danger"
          title="Could not load this target"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
      </>
    );
  }

  return <TargetView target={query.data} />;
}

const CONTACT_ICONS: Record<TargetDetail["contactMethod"], readonly (typeof Mail)[]> = {
  email: [Mail],
  form: [Globe],
  both: [Mail, Globe],
  unknown: [],
};

function ContactValue({ method }: { method: TargetDetail["contactMethod"] }) {
  const glyphs = CONTACT_ICONS[method];
  if (glyphs.length === 0) return <Missing />;
  return (
    <span className="inline-flex items-center gap-1.5">
      {glyphs.map((Glyph) => (
        <Glyph
          key={Glyph.displayName ?? Glyph.name}
          aria-hidden="true"
          className="size-4 text-ink-2"
        />
      ))}
      <span>{CONTACT_METHOD_LABELS[method]}</span>
    </span>
  );
}

/** The most requests the page lists before sending the person to the full list. */
const REQUESTS_SHOWN = 5;

function TargetRequests({ target }: { target: TargetDetail }) {
  const { profiles } = useCurrentProfile();
  const names = new Map(profiles.map((profile) => [profile.id, profile.displayName]));
  const list = useApiQuery(API_ROUTES.requestsListAll, {
    query: { targetId: target.id, page: 1, pageSize: REQUESTS_SHOWN },
  });
  const items = list.data?.items ?? [];
  if (list.isPending || items.length === 0) return null;
  return (
    <Section label="Requests" count={list.data?.total ?? items.length}>
      <RowGroup>
        {items.map((item) => (
          <EntityRow
            key={item.id}
            to={{
              kind: "request",
              id: item.id,
              reference: item.reference,
              targetName: target.name,
            }}
            title={<span className="font-mono text-meta">{item.reference}</span>}
            meta={`${names.get(item.profileId) ?? "Profile"}, ${item.rights
              .map((right) => RIGHT_TOKENS[right])
              .join(" \u00b7 ")}`}
            trailing={<StatusMark status={item.status} />}
          />
        ))}
      </RowGroup>
      {(list.data?.total ?? 0) > items.length ? (
        <p className="mt-2 text-meta">
          <TextLink to={paths.requests({ targetId: target.id })}>
            See all {list.data?.total}
          </TextLink>
        </p>
      ) : null}
    </Section>
  );
}

/** The request that already covers this target for the profile, which makes asking again pointless. */
function useStandingRequest(targetId: string) {
  const { profile } = useCurrentProfile();
  const list = useApiQuery(
    API_ROUTES.requestsList,
    profile
      ? { params: { id: profile.id }, query: { targetId, page: 1, pageSize: 20 } }
      : skipToken,
  );
  return list.data?.items.find(
    (item) => isActiveStatus(item.status) || item.status === "confirmed",
  );
}

/**
 * What the header offers for a site that removes one record at a time. The first step is finding
 * the record, which is a scan and not a request, so the button follows where the scan stands.
 */
function PeopleSearchAction({ target }: { target: TargetDetail }) {
  const { profile } = useCurrentProfile();
  const toast = useToast();
  const standing = useStandingRequest(target.id);
  const listing = useApiQuery(
    API_ROUTES.listingsGet,
    profile ? { params: { id: profile.id, targetId: target.id } } : skipToken,
  );
  const find = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [...LISTING_INVALIDATES],
    onSuccess: (result) => {
      const summary = describeScanStart(result.items, profile?.id ?? "");
      toast.toast({
        intent: summary.intent,
        title: summary.title,
        description: summary.description,
      });
    },
  });
  const waiting = listing.data ? pendingRecords(listing.data).length : 0;

  if (waiting > 0) {
    return (
      <LinkButton to={`${paths.target(target.id)}#your-listing`} variant="primary">
        Confirm {pluralize(waiting, "record")}
      </LinkButton>
    );
  }
  if (standing) return <StandingLink standing={standing} />;
  if (!profile || listing.data?.status === "skipped") return null;
  const scanned = listing.data?.latestScan !== null && listing.data?.latestScan !== undefined;
  return (
    <Button
      variant="primary"
      loading={find.isPending}
      onClick={() => find.mutate({ params: { id: profile.id }, body: { targetIds: [target.id] } })}
    >
      {scanned ? "Scan again" : "Find my record"}
    </Button>
  );
}

function StandingLink({
  standing,
}: {
  standing: NonNullable<ReturnType<typeof useStandingRequest>>;
}) {
  return (
    <LinkButton to={paths.request(standing.id)}>
      {standing.status === "confirmed" ? "Already removed" : "Removal in progress"}
    </LinkButton>
  );
}

function RemoveAction({ target }: { target: TargetDetail }) {
  const standing = useStandingRequest(target.id);
  if (target.needsRecord) return <PeopleSearchAction target={target} />;
  if (standing) {
    return (
      <LinkButton to={paths.request(standing.id)}>
        {standing.status === "confirmed" ? "Already removed" : "Removal in progress"}
      </LinkButton>
    );
  }
  return (
    <LinkButton to={paths.targetRemove(target.id)} variant="primary">
      Remove my data
    </LinkButton>
  );
}

function TargetView({ target }: { target: TargetDetail }) {
  const unsupported = target.contactMethod === "unknown";
  const asked = useApiQuery(API_ROUTES.requestsListAll, {
    query: { targetId: target.id, page: 1, pageSize: 1 },
  });

  return (
    <>
      <PageHeader
        title={target.name}
        description={`${TARGET_KIND_LABELS[target.kind]}, ${TARGET_CATEGORY_LABELS[target.category].toLowerCase()}`}
        hideDescriptionOnPhone
        actions={
          <>
            {asked.data ? (
              <CountLink
                value={asked.data.total}
                label="Requests"
                to={paths.requests({ targetId: target.id })}
              />
            ) : null}
            {target.retired ? null : <RemoveAction target={target} />}
          </>
        }
      />

      <div className="flex max-w-180 flex-col gap-4">
        {target.retired ? (
          <Callout intent="warning" title="No longer in the dataset">
            Nothing new is sent to this target, and its history stays.
          </Callout>
        ) : null}
        {unsupported && !target.retired ? (
          <Callout intent="info" title="No way to contact them on file">
            A campaign skips this target until the dataset has an email address or a form for it.
          </Callout>
        ) : null}

        {target.needsRecord && !target.retired ? <YourListing targetId={target.id} /> : null}

        <TargetRequests target={target} />

        <Section label="Details">
          <FactList
            dense
            items={[
              { term: "Priority", value: <Priority priority={target.priority} /> },
              {
                term: "Contact",
                hint: CONTACT_METHOD_LABELS[target.contactMethod],
                value: <ContactValue method={target.contactMethod} />,
              },
              {
                term: "Website",
                value: target.website ? (
                  <ExternalLinkText href={target.website} className={MONO}>
                    {target.domain}
                  </ExternalLinkText>
                ) : (
                  <span className={MONO}>{target.domain}</span>
                ),
              },
              {
                term: "Privacy email",
                value: target.privacyEmail ? (
                  <span className="inline-flex max-w-full items-start gap-x-1">
                    <span className={`${MONO} min-w-0`}>
                      <BreakableAddress text={target.privacyEmail} />
                    </span>
                    <span className="-my-1 shrink-0">
                      <CopyButton iconOnly value={target.privacyEmail} label="Copy privacy email" />
                    </span>
                  </span>
                ) : (
                  <Missing />
                ),
              },
              {
                term: "Opt-out page",
                value: target.optOutUrl ? (
                  <ExternalLinkText href={target.optOutUrl} className={`${MONO} break-all`}>
                    {target.optOutUrl}
                  </ExternalLinkText>
                ) : (
                  <Missing />
                ),
              },
              {
                term: "Rights page",
                value: target.privacyRightsUrl ? (
                  <ExternalLinkText href={target.privacyRightsUrl} className={`${MONO} break-all`}>
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
                      value: target.searchUrl ? (
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
                value: (
                  <>
                    <span className={MONO}>{target.region.toUpperCase()}</span>
                    {target.verifiedAt ? (
                      <>
                        , contacts checked{" "}
                        <span className={MONO}>{formatDate(target.verifiedAt)}</span>
                      </>
                    ) : (
                      ", contacts not checked yet"
                    )}
                  </>
                ),
              },
            ]}
          />
        </Section>

        <Section label="Difficulty">
          <RowGroup>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2.5 text-ui text-ink">
              <Tag>{DIFFICULTY_LABELS[target.difficulty]}</Tag>
              <span className="text-ink-2">{DIFFICULTY_MEANINGS[target.difficulty]}</span>
            </p>
            {target.difficultyReasons.map((reason) => (
              <p key={reason} data-row className="px-3.5 py-2.5 text-meta text-ink-2">
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
                  data-row
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
            <div data-user-content className="mt-3 flex flex-col gap-1.5 text-meta text-ink-2">
              {target.notes.split(" | ").map((part) => (
                <p key={part} className="break-words">
                  {part}
                </p>
              ))}
            </div>
          ) : null}
        </Section>

        {target.kind === "broker" ? <SiteVisits targetId={target.id} /> : null}

        <Section
          label="Automation"
          actions={
            target.recipes.length > 0 ? (
              <TextLink to={paths.settings("recipes")} className="text-meta">
                Recipes in Settings
              </TextLink>
            ) : null
          }
        >
          {target.recipes.length === 0 ? (
            <EmptyState
              title="No saved steps for this target."
              description="Form tasks wait in Review for an agent or you."
            />
          ) : (
            <DataList
              label="Recipes for this target"
              items={target.recipes}
              getKey={(recipe) => recipe.id}
              identityHeader="Purpose"
              identity={(recipe) => ({ title: recipe.purpose === "scan" ? "Scan" : "Removal" })}
              tags={(recipe) => (
                <>
                  <span className="font-mono">v{recipe.version}</span>
                  <span>{RECIPE_STATUS_LABELS[recipe.status]}</span>
                  <HealthMark health={recipe.health} />
                </>
              )}
              columns={[
                {
                  id: "version",
                  header: "Version",
                  mono: true,
                  cell: (recipe) => <>v{recipe.version}</>,
                },
                {
                  id: "source",
                  header: "Source",
                  cell: (recipe) => <span className="capitalize text-ink-2">{recipe.source}</span>,
                },
                {
                  id: "status",
                  header: "Status",
                  cell: (recipe) => (
                    <span className="text-ink-2">{RECIPE_STATUS_LABELS[recipe.status]}</span>
                  ),
                },
                {
                  id: "health",
                  header: "Health",
                  cell: (recipe) => <HealthMark health={recipe.health} />,
                },
              ]}
            />
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
                  <span className="text-ui text-ink">
                    {DATA_SOURCE_DETAILS[source.source].name}
                  </span>
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
