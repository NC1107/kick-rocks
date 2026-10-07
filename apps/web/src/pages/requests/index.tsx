import { API_ROUTES, RequestStatus } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  StatusMark,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableIdentity,
  TableRow,
  TableSkeletonRows,
  TableToolbar,
  Tag,
  Tooltip,
} from "../../components/ui/index.js";
import { formatDateTime, pluralize } from "../../lib/format.js";
import { CHANNEL_LABELS } from "../../lib/labels.js";
import { REQUEST_STATUS_META } from "../../lib/status.js";
import {
  hasRequestFilters,
  REQUESTS_PAGE_SIZE,
  readRequestFilters,
  toRequestQuery,
} from "./filters.js";
import { RIGHT_TOKENS, shortRelative } from "./format.js";
import { listRefreshInterval } from "./polling.js";

const SEARCH_DELAY_MS = 250;

export function Component() {
  return <RequireProfile>{(profile) => <Requests profileId={profile.id} />}</RequireProfile>;
}

function Requests({ profileId }: { profileId: string }) {
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

  useEffect(() => setSearch(filters.q), [filters.q]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts a search
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return;
    const timer = setTimeout(() => setFilter("q", search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const items = list.data?.items ?? [];
  const filtered = hasRequestFilters(filters);

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

      <TableToolbar count={list.data ? pluralize(list.data.total, "request") : undefined}>
        <search aria-label="Filter requests" className="contents">
          <Field label="Search" hideLabel className="w-full sm:w-70">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search target or reference"
              maxLength={100}
              leading={<Search aria-hidden="true" />}
            />
          </Field>
          <Field
            label="Status"
            hideLabel
            className="max-sm:min-w-0 max-sm:flex-1 max-sm:basis-2/5 sm:w-52"
          >
            <Select
              aria-label="Status"
              value={filters.status}
              onChange={(event) => setFilter("status", event.target.value)}
            >
              <option value="">Status: all</option>
              {RequestStatus.options.map((status) => (
                <option key={status} value={status}>
                  Status: {REQUEST_STATUS_META[status].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Channel"
            hideLabel
            className="max-sm:min-w-0 max-sm:flex-1 max-sm:basis-2/5 sm:w-44"
          >
            <Select
              aria-label="Channel"
              value={filters.channel}
              onChange={(event) => setFilter("channel", event.target.value)}
            >
              <option value="">Channel: any</option>
              <option value="email">Channel: {CHANNEL_LABELS.email}</option>
              <option value="form">Channel: {CHANNEL_LABELS.form}</option>
            </Select>
          </Field>
          {filtered && items.length > 0 ? (
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </search>
      </TableToolbar>

      {filters.targetId ? (
        <p className="mb-2.5 flex flex-wrap items-center gap-2 text-meta text-ink-2">
          Showing requests to
          <Tag>{target.data?.name ?? filters.targetId}</Tag>
          <Button size="sm" variant="ghost" onClick={() => setFilter("targetId", "")}>
            Show all targets
          </Button>
        </p>
      ) : null}

      {list.isError ? (
        <Alert
          intent="danger"
          title="Could not load requests"
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(list.error)}
        </Alert>
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
        <>
          <Table label="Requests" aria-busy={list.isPlaceholderData || undefined}>
            <TableHead>
              <tr>
                <TableHeaderCell>Target</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Asked</TableHeaderCell>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell align="right">Sent</TableHeaderCell>
                <TableHeaderCell align="right">Due</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {list.isPending ? (
                <TableSkeletonRows columns={6} rows={8} />
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="h-auto max-w-72 min-w-52">
                      <TableIdentity
                        title={
                          <Link
                            to={`/requests/${encodeURIComponent(item.id)}`}
                            className="rounded-xs hover:text-accent-text hover:underline"
                          >
                            {item.target.name}
                          </Link>
                        }
                        meta={item.reference}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusMark status={item.status} />
                    </TableCell>
                    <TableCell mono className="text-ink-2">
                      {item.rights.map((right) => RIGHT_TOKENS[right]).join(" \u00b7 ")}
                    </TableCell>
                    <TableCell className="text-ink-2">{CHANNEL_LABELS[item.channel]}</TableCell>
                    <TimeCell iso={item.sentAt} />
                    <TimeCell iso={item.dueAt} />
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {list.data ? (
            <Pagination
              page={list.data.page}
              pageSize={REQUESTS_PAGE_SIZE}
              total={list.data.total}
              onPageChange={setPage}
              noun="requests"
            />
          ) : null}
        </>
      )}
    </>
  );
}

function TimeCell({ iso }: { iso: string | null }) {
  return (
    <TableCell mono align="right" className="text-ink-2">
      {iso ? (
        <Tooltip content={formatDateTime(iso)}>
          <time dateTime={iso}>{shortRelative(iso)}</time>
        </Tooltip>
      ) : (
        <span className="text-ink-3">-</span>
      )}
    </TableCell>
  );
}
