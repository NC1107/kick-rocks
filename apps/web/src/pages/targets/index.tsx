import { API_ROUTES, type TargetFacets } from "@kickrocks/shared";
import { Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../../components/ui/index.js";
import { formatCount } from "../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  PRIORITY_LABELS,
  PRIORITY_TONES,
  REQUIREMENT_LABELS,
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../lib/labels.js";
import { Automation } from "./Automation.js";
import { type FilterKey, hasFilters, readFilters, TARGETS_PAGE_SIZE, toQuery } from "./filters.js";
import { LoadingRows } from "./LoadingRows.js";
import { RequirementBadges } from "./RequirementBadges.js";

function FacetOptions({
  facet,
  labels,
}: {
  facet: TargetFacets[keyof TargetFacets] | undefined;
  labels: Record<string, string>;
}) {
  return (facet ?? []).map((entry) => (
    <option key={entry.value} value={entry.value}>
      {labels[entry.value] ?? entry.value} ({formatCount(entry.count)})
    </option>
  ));
}

const SEARCH_DELAY_MS = 250;

export function Component() {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [search, setSearch] = useState(filters.q);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const facets = useApiQuery(API_ROUTES.targetsFacets, { staleTime: 60_000 });
  const list = useApiQuery(API_ROUTES.targetsList, { query: toQuery(filters), keepPrevious: true });

  const setFilter = (key: FilterKey, value: string) => {
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
  };

  const setPage = (page: number) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (page > 1) next.set("page", String(page));
      else next.delete("page");
      return next;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setParams({}, { replace: true });
  };

  // The address bar is the source of truth, so the box follows it when a filter is cleared or the
  // back button changes it.
  useEffect(() => setSearch(filters.q), [filters.q]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text starts a search
  useEffect(() => {
    if (search.trim() === filters.q.trim()) return;
    const timer = setTimeout(() => setFilter("q", search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const items = list.data?.items ?? [];
  const selectable = useMemo(() => items.filter((item) => !item.retired), [items]);
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.id));
  const someSelected = selectable.some((item) => selected.has(item.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const togglePage = (on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const item of selectable) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });

  const campaignLink = `/campaigns/new?targets=${[...selected].map(encodeURIComponent).join(",")}`;
  const filtered = hasFilters(filters);

  return (
    <>
      <PageHeader
        title="Targets"
        description="Data brokers and companies you can ask to stop selling your data."
        actions={
          <LinkButton to="/campaigns/new" variant="primary">
            Start a campaign
          </LinkButton>
        }
      />

      <search aria-label="Filter targets" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Field label="Search" hideLabel className="col-span-2 lg:col-span-5 lg:max-w-md">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or domain"
            maxLength={100}
            leading={<Search aria-hidden="true" />}
          />
        </Field>
        <Field label="Type" hideLabel>
          <Select
            aria-label="Type"
            value={filters.kind}
            onChange={(event) => setFilter("kind", event.target.value)}
          >
            <option value="">All types</option>
            <FacetOptions facet={facets.data?.kind} labels={TARGET_KIND_LABELS} />
          </Select>
        </Field>
        <Field label="Category" hideLabel>
          <Select
            aria-label="Category"
            value={filters.category}
            onChange={(event) => setFilter("category", event.target.value)}
          >
            <option value="">All categories</option>
            <FacetOptions facet={facets.data?.category} labels={TARGET_CATEGORY_LABELS} />
          </Select>
        </Field>
        <Field label="Contact method" hideLabel>
          <Select
            aria-label="Contact method"
            value={filters.contactMethod}
            onChange={(event) => setFilter("contactMethod", event.target.value)}
          >
            <option value="">Any contact</option>
            <FacetOptions facet={facets.data?.contactMethod} labels={CONTACT_METHOD_LABELS} />
          </Select>
        </Field>
        <Field label="Requirement" hideLabel>
          <Select
            aria-label="Requirement"
            value={filters.requirement}
            onChange={(event) => setFilter("requirement", event.target.value)}
          >
            <option value="">Any requirement</option>
            <FacetOptions facet={facets.data?.requirement} labels={REQUIREMENT_LABELS} />
          </Select>
        </Field>
        <Field label="Priority" hideLabel>
          <Select
            aria-label="Priority"
            value={filters.priority}
            onChange={(event) => setFilter("priority", event.target.value)}
          >
            <option value="">Any priority</option>
            <FacetOptions facet={facets.data?.priority} labels={PRIORITY_LABELS} />
          </Select>
        </Field>
        {filtered && items.length > 0 ? (
          <div className="col-span-2 flex items-center lg:col-span-5">
            <Button variant="ghost" onClick={clearFilters} className="-ml-3.5">
              Clear filters
            </Button>
          </div>
        ) : null}
      </search>

      {selected.size > 0 ? (
        <div
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft px-4 py-2.5 text-base text-accent-soft-ink"
        >
          <span>{formatCount(selected.size)} selected</span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            <LinkButton size="sm" variant="primary" to={campaignLink}>
              Ask these to remove my data
            </LinkButton>
          </span>
        </div>
      ) : null}

      {list.isError ? (
        <Alert
          intent="danger"
          title="Could not load targets"
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(list.error)}
        </Alert>
      ) : list.data && items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtered ? "No targets match" : "No targets yet"}
          description={
            filtered
              ? "Try removing a filter or searching for a different name."
              : "The broker and company lists are empty. Rebuild the data and restart the server."
          }
          actions={filtered ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <Table label="Targets" aria-busy={list.isPlaceholderData || undefined}>
            <TableHead>
              <tr>
                <TableHeaderCell className="w-10">
                  <Checkbox
                    aria-label="Select all targets on this page"
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    disabled={selectable.length === 0}
                    onChange={(event) => togglePage(event.target.checked)}
                  />
                </TableHeaderCell>
                <TableHeaderCell>Target</TableHeaderCell>
                <TableHeaderCell>Priority</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Contact</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Requirements</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Automation</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {list.isPending ? (
                <LoadingRows
                  columns={[
                    { bar: "w-4" },
                    { bar: "w-40" },
                    {},
                    { className: "hidden md:table-cell" },
                    { className: "hidden md:table-cell", bar: "w-32" },
                    { className: "hidden lg:table-cell" },
                  ]}
                />
              ) : (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="w-10 pr-0">
                      <Checkbox
                        aria-label={`Select ${item.name}`}
                        checked={selected.has(item.id)}
                        disabled={item.retired}
                        onChange={(event) => toggle(item.id, event.target.checked)}
                      />
                    </TableCell>
                    <TableCell wrap className="min-w-48">
                      <Link
                        to={`/targets/${encodeURIComponent(item.id)}`}
                        className="rounded-xs font-medium text-ink hover:text-accent-text hover:underline"
                      >
                        {item.name}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
                        {item.domain}
                        {item.retired ? <Badge tone="sand">Retired</Badge> : null}
                      </span>
                      <span className="block text-sm text-ink-muted">
                        {TARGET_CATEGORY_LABELS[item.category]}
                        <span className="md:hidden">
                          {`, ${CONTACT_METHOD_LABELS[item.contactMethod].toLowerCase()}`}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge tone={PRIORITY_TONES[item.priority]}>
                        {PRIORITY_LABELS[item.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {CONTACT_METHOD_LABELS[item.contactMethod]}
                    </TableCell>
                    <TableCell wrap className="hidden min-w-44 md:table-cell">
                      <RequirementBadges requirements={item.requirements} max={3} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Automation scan={item.automation.scan} remove={item.automation.remove} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {list.data ? (
            <Pagination
              page={list.data.page}
              pageSize={TARGETS_PAGE_SIZE}
              total={list.data.total}
              onPageChange={setPage}
              noun="targets"
            />
          ) : null}
        </>
      )}
    </>
  );
}
