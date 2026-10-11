import { API_ROUTES, RequestStatus } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  activeFilterTags,
  Button,
  Callout,
  DataList,
  EmptyState,
  Field,
  type FilterGroup,
  Filters,
  FilterTags,
  Input,
  LinkButton,
  PageHeader,
  RelativeTime,
  StatusMark,
  TableToolbar,
} from "../../components/ui/index.js";
import { pluralize } from "../../lib/format.js";
import { CHANNEL_LABELS } from "../../lib/labels.js";
import { REQUEST_STATUS_META } from "../../lib/status.js";
import {
  hasRequestFilters,
  REQUESTS_PAGE_SIZE,
  readRequestFilters,
  toRequestQuery,
} from "./filters.js";
import { RIGHT_TOKENS } from "./format.js";
import { listRefreshInterval } from "./polling.js";

const SEARCH_DELAY_MS = 250;

export function Component() {
  return <RequireProfile>{(profile) => <Requests profileId={profile.id} />}</RequireProfile>;
}

function Requests({ profileId }: { profileId: string }) {
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [params, setParams] = useSearchParams();
  const filters = readRequestFilters(params);
  const [search, setSearch] = useState(filters.q);

  const list = useApiQuery(API_ROUTES.requestsList, {
    params: { id: profileId },
    query: toRequestQuery(filters),
    keepPrevious: true,
    refetchInterval: listRefreshInterval,
  });
  const target = useApiQuery(
    API_ROUTES.targetsGet,
    filters.targetId ? { params: { id: filters.targetId } } : skipToken,
  );

  const setFilter = (key: "q" | "status" | "channel" | "targetId", value: string) =>
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
        for (const key of ["status", "channel", "targetId", "page"]) next.delete(key);
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
  const tags = [
    ...activeFilterTags(groups),
    ...(filters.targetId
      ? [
          {
            id: "targetId",
            label: `Target: ${target.data?.name ?? filters.targetId}`,
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
  const filtered = hasRequestFilters(filters);
  const resultCount = list.data ? pluralize(list.data.total, "request") : undefined;

  return (
    <>
      <PageHeader
        title="Requests"
        description="Every request, and where it stands"
        actions={
          <LinkButton to="/campaigns/new" variant="primary">
            New campaign
          </LinkButton>
        }
      />

      <TableToolbar>
        <search aria-label="Filter requests" className="contents">
          <Field label="Search" hideLabel className="min-w-0 flex-1 sm:w-70 sm:flex-initial">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search target or reference"
              maxLength={100}
              leading={<Search aria-hidden="true" />}
            />
          </Field>
          <Filters
            groups={groups}
            onClear={clearMenuFilters}
            resultCount={resultCount}
            triggerRef={filtersButton}
            extraActive={filters.targetId ? 1 : 0}
          />
        </search>
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
            actions={<LinkButton to="/campaigns/new">Start a campaign</LinkButton>}
          />
        )
      ) : (
        <DataList
          label="Requests"
          items={items}
          getKey={(item) => item.id}
          identityHeader="Target"
          identity={(item) => ({
            title: item.target.name,
            meta: item.reference,
            to: `/requests/${encodeURIComponent(item.id)}`,
          })}
          tags={(item) => (
            <>
              <StatusMark status={item.status} />
              <span>{item.rights.map((right) => RIGHT_TOKENS[right]).join(" · ")}</span>
              <span>{CHANNEL_LABELS[item.channel]}</span>
              {item.dueAt ? (
                <span>
                  due <RelativeTime iso={item.dueAt} />
                </span>
              ) : null}
            </>
          )}
          columns={[
            { id: "status", header: "Status", cell: (item) => <StatusMark status={item.status} /> },
            {
              id: "asked",
              header: "Asked",
              mono: true,
              cell: (item) => (
                <span className="text-ink-2">
                  {item.rights.map((right) => RIGHT_TOKENS[right]).join(" · ")}
                </span>
              ),
            },
            {
              id: "channel",
              header: "Channel",
              cell: (item) => <span className="text-ink-2">{CHANNEL_LABELS[item.channel]}</span>,
            },
            { id: "sent", header: "Sent", kind: "date", cell: (item) => timeOrDash(item.sentAt) },
            { id: "due", header: "Due", kind: "date", cell: (item) => timeOrDash(item.dueAt) },
          ]}
          loading={list.isPending}
          busy={list.isPlaceholderData}
          count={resultCount}
          pager={
            list.data
              ? {
                  page: list.data.page,
                  pageSize: REQUESTS_PAGE_SIZE,
                  total: list.data.total,
                  onPageChange: setPage,
                  noun: "requests",
                }
              : undefined
          }
        />
      )}
    </>
  );
}

function timeOrDash(iso: string | null) {
  return iso ? (
    <span className="text-ink-2">
      <RelativeTime iso={iso} />
    </span>
  ) : (
    <span className="text-ink-3">-</span>
  );
}
