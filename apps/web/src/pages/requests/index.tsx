import { API_ROUTES, RequestStatus } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { FileSearch, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  StatusPill,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../../components/ui/index.js";
import { formatDate, formatRelative } from "../../lib/format.js";
import { CHANNEL_LABELS, RIGHT_LABELS } from "../../lib/labels.js";
import { REQUEST_STATUS_META } from "../../lib/status.js";
import { LoadingRows } from "../targets/LoadingRows.js";
import {
  hasRequestFilters,
  REQUESTS_PAGE_SIZE,
  readRequestFilters,
  toRequestQuery,
} from "./filters.js";

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
        description="Every request sent for this profile, and where it stands."
        actions={
          <LinkButton to="/campaigns/new" variant="primary">
            New campaign
          </LinkButton>
        }
      />

      <search
        aria-label="Filter requests"
        className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]"
      >
        <Field label="Search" hideLabel className="col-span-2 lg:col-span-1">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by target or reference"
            maxLength={100}
            leading={<Search aria-hidden="true" />}
          />
        </Field>
        <Field label="Status" hideLabel>
          <Select
            aria-label="Status"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
          >
            <option value="">All statuses</option>
            {RequestStatus.options.map((status) => (
              <option key={status} value={status}>
                {REQUEST_STATUS_META[status].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Channel" hideLabel>
          <Select
            aria-label="Channel"
            value={filters.channel}
            onChange={(event) => setFilter("channel", event.target.value)}
          >
            <option value="">Any channel</option>
            <option value="email">{CHANNEL_LABELS.email}</option>
            <option value="form">{CHANNEL_LABELS.form}</option>
          </Select>
        </Field>
        {filtered && items.length > 0 ? (
          <div className="col-span-2 flex items-center lg:col-span-3">
            <Button variant="ghost" onClick={clearFilters} className="-ml-3.5">
              Clear filters
            </Button>
          </div>
        ) : null}
      </search>

      {filters.targetId ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-base text-ink-muted">
          Showing requests to
          <Badge tone="blue">{target.data?.name ?? filters.targetId}</Badge>
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
            icon={FileSearch}
            title="No requests match"
            description="Try removing a filter or searching for a different target."
            actions={<Button onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={FileSearch}
            title="No requests yet"
            description="Start a campaign to ask brokers and companies to stop selling this profile's data."
            actions={
              <LinkButton to="/campaigns/new" variant="primary">
                Start a campaign
              </LinkButton>
            }
          />
        )
      ) : (
        <>
          <Table label="Requests" aria-busy={list.isPlaceholderData || undefined}>
            <TableHead>
              <tr>
                <TableHeaderCell>Target</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Asked for</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Sent</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Reply due</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {list.isPending ? (
                <LoadingRows
                  columns={[
                    { bar: "w-40" },
                    {},
                    { className: "hidden md:table-cell", bar: "w-32" },
                    { className: "hidden md:table-cell" },
                    { className: "hidden md:table-cell" },
                  ]}
                />
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell wrap className="w-full min-w-0">
                      <Link
                        to={`/requests/${encodeURIComponent(item.id)}`}
                        className="rounded-xs font-medium text-ink hover:text-accent hover:underline"
                      >
                        {item.target.name}
                      </Link>
                      <span className="block font-mono text-sm text-ink-muted">
                        {item.reference}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        {CHANNEL_LABELS[item.channel]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={item.status} />
                    </TableCell>
                    <TableCell wrap className="hidden min-w-40 md:table-cell">
                      {item.rights.map((right) => RIGHT_LABELS[right]).join(", ")}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {item.sentAt ? (
                        <time dateTime={item.sentAt} title={formatDate(item.sentAt)}>
                          {formatRelative(item.sentAt)}
                        </time>
                      ) : (
                        <span className="text-ink-faint">Not sent</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {item.dueAt ? (
                        <time dateTime={item.dueAt} title={formatDate(item.dueAt)}>
                          {formatRelative(item.dueAt)}
                        </time>
                      ) : (
                        <span className="text-ink-faint">None</span>
                      )}
                    </TableCell>
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
