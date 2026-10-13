import { API_ROUTES, RequestStatus } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { ChevronDown, Search, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery, useCurrentProfile } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  activeFilterTags,
  Button,
  Callout,
  EmptyState,
  Field,
  type FilterGroup,
  Filters,
  FilterTags,
  Input,
  LinkButton,
  Menu,
  type MenuItem,
  PageHeader,
  Pagination,
  RowGroup,
  Section,
  Segmented,
  Skeleton,
  TableToolbar,
} from "../../components/ui/index.js";
import { pluralize } from "../../lib/format.js";
import { CHANNEL_LABELS } from "../../lib/labels.js";
import { REQUEST_STATUS_META } from "../../lib/status.js";
import { groupByBatch } from "./batches.js";
import {
  ALL_PROFILES,
  hasRequestFilters,
  REQUESTS_PAGE_SIZE,
  readRequestFilters,
  toRequestQuery,
} from "./filters.js";
import { listRefreshInterval } from "./polling.js";
import { RequestRow } from "./RequestRow.js";
import { groupRequests, sectionCount } from "./sections.js";

const SEARCH_DELAY_MS = 250;
const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];

export function Component() {
  return <RequireProfile>{(profile) => <Requests profileId={profile.id} />}</RequireProfile>;
}

function Requests({ profileId }: { profileId: string }) {
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [params, setParams] = useSearchParams();
  const filters = readRequestFilters(params);
  const [search, setSearch] = useState(filters.q);

  const { profiles } = useCurrentProfile();
  const allProfiles = filters.profileId === ALL_PROFILES;
  const scopeId = allProfiles ? null : filters.profileId || profileId;
  const scopeName = profiles.find((candidate) => candidate.id === scopeId)?.displayName;
  const names = new Map(profiles.map((candidate) => [candidate.id, candidate.displayName]));

  const listed = {
    query: toRequestQuery(filters),
    keepPrevious: true,
    refetchInterval: listRefreshInterval,
  } as const;
  const one = useApiQuery(
    API_ROUTES.requestsList,
    scopeId ? { params: { id: scopeId }, ...listed } : skipToken,
  );
  const everyone = useApiQuery(API_ROUTES.requestsListAll, allProfiles ? listed : skipToken);
  const list = allProfiles ? everyone : one;
  const byBatch = !allProfiles && params.get("group") === "batch";
  const batches = useApiQuery(
    API_ROUTES.campaignsList,
    byBatch && scopeId ? { params: { id: scopeId } } : skipToken,
  );
  const target = useApiQuery(
    API_ROUTES.targetsGet,
    filters.targetId ? { params: { id: filters.targetId } } : skipToken,
  );

  const setFilter = (
    key: "q" | "status" | "channel" | "targetId" | "campaignId" | "profileId",
    value: string,
  ) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );

  const setGroup = (value: "status" | "batch") =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === "batch") next.set("group", "batch");
        else next.delete("group");
        return next;
      },
      { replace: true },
    );

  const setPage = (page: number) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (page > 1) next.set("page", String(page));
      else next.delete("page");
      return next;
    });

  const clearFilters = () => {
    setSearch("");
    setParams({}, { replace: true });
  };

  const clearMenuFilters = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of ["status", "channel", "targetId", "campaignId", "page"]) next.delete(key);
        return next;
      },
      { replace: true },
    );

  const groups: FilterGroup[] = [
    {
      id: "status",
      label: "Status",
      value: filters.status,
      allLabel: "Any status",
      options: RequestStatus.options.map((status) => ({
        value: status,
        label: REQUEST_STATUS_META[status].label,
      })),
      onChange: (value) => setFilter("status", value),
    },
    {
      id: "channel",
      label: "Channel",
      value: filters.channel,
      allLabel: "Any channel",
      options: [
        { value: "email", label: CHANNEL_LABELS.email },
        { value: "form", label: CHANNEL_LABELS.form },
      ],
      onChange: (value) => setFilter("channel", value),
    },
  ];
  const scopeItems: MenuItem[] = [
    ...profiles.map((candidate) => ({
      id: candidate.id,
      label: candidate.displayName,
      selected: !allProfiles && candidate.id === scopeId,
      onSelect: () => setFilter("profileId", candidate.id === profileId ? "" : candidate.id),
    })),
    {
      id: ALL_PROFILES,
      label: "All profiles",
      selected: allProfiles,
      separatorBefore: true,
      onSelect: () => setFilter("profileId", ALL_PROFILES),
    },
  ];
  const tags = [
    ...activeFilterTags(groups),
    ...(filters.campaignId
      ? [
          {
            id: "campaignId",
            label: "From one campaign",
            onRemove: () => setFilter("campaignId", ""),
          },
        ]
      : []),
    ...(filters.targetId
      ? [
          {
            id: "targetId",
            label: `Site: ${target.data?.name ?? filters.targetId}`,
            onRemove: () => setFilter("targetId", ""),
          },
        ]
      : []),
  ];

  useEffect(() => setSearch(filters.q), [filters.q]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts a search
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return;
    const timer = setTimeout(() => setFilter("q", search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const items = list.data?.items ?? [];
  const extraFilters = (filters.targetId ? 1 : 0) + (filters.campaignId ? 1 : 0);
  const filtered = hasRequestFilters(filters);
  const resultCount = list.data ? pluralize(list.data.total, "removal") : undefined;
  const sections =
    byBatch && batches.data
      ? groupByBatch(items, batches.data.campaigns).map((section) => ({
          ...section,
          verifiedGone: 0,
        }))
      : groupRequests(items).map((section) => ({ ...section, summary: "" }));

  return (
    <>
      <PageHeader
        title="Removals"
        description="Every request, and where it stands"
        hideDescriptionOnPhone
        actions={
          <LinkButton to="/campaigns/new" variant="primary">
            Send requests
          </LinkButton>
        }
      />

      <TableToolbar count={resultCount}>
        <search aria-label="Filter requests" className="contents">
          {profiles.length > 1 ? (
            <Menu
              heading="Whose requests"
              items={scopeItems}
              className="min-w-0 max-sm:flex-1"
              trigger={(props) => (
                <Button
                  {...props}
                  aria-label={`Profile: ${allProfiles ? "All profiles" : (scopeName ?? "")}`}
                  className="min-w-0 max-w-full shrink max-sm:w-full max-sm:justify-start sm:max-w-44"
                >
                  <UserRound aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{allProfiles ? "All profiles" : scopeName}</span>
                  <ChevronDown aria-hidden="true" className="shrink-0 text-ink-3" />
                </Button>
              )}
            />
          ) : null}
          <Field
            label="Search"
            hideLabel
            className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full sm:w-70 sm:flex-initial"
          >
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search sites"
              maxLength={100}
              leading={<Search aria-hidden="true" />}
            />
          </Field>
          <Filters
            groups={groups}
            onClear={clearMenuFilters}
            resultCount={resultCount}
            triggerRef={filtersButton}
            extraActive={extraFilters}
          />
        </search>
        {allProfiles ? null : (
          <Segmented
            legend="Group by"
            value={byBatch ? "batch" : "status"}
            onValueChange={setGroup}
            options={[
              { value: "status", label: "By status" },
              { value: "batch", label: "By batch" },
            ]}
          />
        )}
      </TableToolbar>
      <FilterTags tags={tags} emptyFocusRef={filtersButton} />

      {list.isError ? (
        <Callout
          intent="danger"
          title="Could not load requests"
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(list.error)}
        </Callout>
      ) : list.data && items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No requests match these filters."
            actions={<Button onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            title="No requests yet."
            actions={<LinkButton to="/campaigns/new">Send requests</LinkButton>}
          />
        )
      ) : (
        <div aria-busy={list.isPlaceholderData || undefined} className="flex flex-col gap-3">
          {list.isPending || (byBatch && batches.isPending) ? (
            <RowGroup aria-label="Loading requests">
              {SKELETON_ROWS.map((id) => (
                <div key={id} className="flex min-h-11 flex-col justify-center gap-1.5 px-3.5 py-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </RowGroup>
          ) : (
            sections.map((section) => (
              <Section
                key={section.id}
                label={section.label}
                count={sectionCount(section.items.length, section.verifiedGone)}
                {...(section.summary
                  ? {
                      actions: (
                        <span className="font-mono text-caption text-ink-3 tabular-nums">
                          {section.summary}
                        </span>
                      ),
                    }
                  : {})}
              >
                <RowGroup role="list" aria-label={section.label}>
                  {section.items.map((item) => (
                    <RequestRow
                      key={item.id}
                      item={item}
                      {...(allProfiles
                        ? { profileName: names.get(item.profileId) ?? "Profile" }
                        : {})}
                    />
                  ))}
                </RowGroup>
              </Section>
            ))
          )}
          {list.data ? (
            <Pagination
              page={list.data.page}
              pageSize={REQUESTS_PAGE_SIZE}
              total={list.data.total}
              onPageChange={setPage}
              noun="removals"
            />
          ) : null}
        </div>
      )}
    </>
  );
}
