import { API_ROUTES, type TargetFacets } from "@kickrocks/shared";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Alert,
  activeFilterTags,
  Button,
  Checkbox,
  EmptyState,
  Field,
  type FilterGroup,
  type FilterOption,
  Filters,
  FilterTags,
  Input,
  LinkButton,
  PageHeader,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableIdentity,
  TableRow,
  TableToolbar,
  Tag,
} from "../../components/ui/index.js";
import { formatCount } from "../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  PRIORITY_LABELS,
  REQUIREMENT_LABELS,
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../lib/labels.js";
import { AutomationLegend, HealthMark } from "./Automation.js";
import {
  FILTER_KEYS,
  type FilterKey,
  hasFilters,
  readFilters,
  TARGETS_PAGE_SIZE,
  toQuery,
} from "./filters.js";
import { LoadingRows } from "./LoadingRows.js";
import { Priority } from "./Priority.js";
import { RequirementBadges } from "./RequirementBadges.js";

function facetOptions(
  facet: TargetFacets[keyof TargetFacets] | undefined,
  labels: Record<string, string>,
): FilterOption[] {
  return (facet ?? []).map((entry) => ({
    value: entry.value,
    label: labels[entry.value] ?? entry.value,
    count: entry.count,
  }));
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

  const clearFacetFilters = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of FILTER_KEYS) if (key !== "q") next.delete(key);
        next.delete("page");
        return next;
      },
      { replace: true },
    );

  const facetGroup = (
    key: Exclude<FilterKey, "q">,
    label: string,
    allLabel: string,
    options: FilterOption[],
  ): FilterGroup => ({
    id: key,
    label,
    value: filters[key],
    options,
    allLabel,
    onChange: (value) => setFilter(key, value),
  });

  const groups = [
    facetGroup("kind", "Type", "All types", facetOptions(facets.data?.kind, TARGET_KIND_LABELS)),
    facetGroup(
      "category",
      "Category",
      "All categories",
      facetOptions(facets.data?.category, TARGET_CATEGORY_LABELS),
    ),
    facetGroup(
      "contactMethod",
      "Contact",
      "Any contact method",
      facetOptions(facets.data?.contactMethod, CONTACT_METHOD_LABELS),
    ),
    facetGroup(
      "requirement",
      "Needs",
      "Any requirement",
      facetOptions(facets.data?.requirement, REQUIREMENT_LABELS),
    ),
    facetGroup(
      "priority",
      "Priority",
      "Any priority",
      facetOptions(facets.data?.priority, PRIORITY_LABELS),
    ),
  ];

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
        description="Brokers and companies you can ask"
        actions={
          <LinkButton to="/campaigns/new" variant="primary">
            New campaign
          </LinkButton>
        }
      />

      <search aria-label="Filter targets">
        <TableToolbar count={list.data ? `${formatCount(list.data.total)} targets` : undefined}>
          <Field label="Search" hideLabel className="min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search targets"
              maxLength={100}
              leading={<Search aria-hidden="true" />}
            />
          </Field>
          <Filters groups={groups} onClear={clearFacetFilters} />
        </TableToolbar>
      </search>
      <FilterTags tags={activeFilterTags(groups)} />

      {selected.size > 0 ? (
        <div
          role="status"
          className="mb-2.5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-accent-soft px-3.5 py-2 text-ui text-ink"
        >
          <span className="font-mono text-meta tabular-nums">
            {formatCount(selected.size)} selected
          </span>
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
          title={filtered ? "No targets match these filters." : "No targets yet."}
          {...(filtered
            ? {}
            : {
                description:
                  "The broker and company lists are empty. Rebuild the data and restart the server.",
              })}
          actions={filtered ? <Button onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <AutomationLegend />
          <Table label="Targets" aria-busy={list.isPlaceholderData || undefined}>
            <TableHead>
              <tr>
                <TableHeaderCell className="w-10 pr-0 max-sm:p-0">
                  <label
                    htmlFor="select-page"
                    className="flex cursor-pointer items-center justify-center max-sm:min-h-11 max-sm:min-w-11"
                  >
                    <Checkbox
                      id="select-page"
                      aria-label="Select all targets on this page"
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      disabled={selectable.length === 0}
                      onChange={(event) => togglePage(event.target.checked)}
                    />
                  </label>
                </TableHeaderCell>
                <TableHeaderCell>Target</TableHeaderCell>
                <TableHeaderCell className="hidden xl:table-cell">Category</TableHeaderCell>
                <TableHeaderCell>Priority</TableHeaderCell>
                <TableHeaderCell className="hidden md:table-cell">Contact</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Needs</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Scan</TableHeaderCell>
                <TableHeaderCell className="hidden lg:table-cell">Removal</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {list.isPending ? (
                <LoadingRows
                  columns={[
                    { bar: "w-4" },
                    { bar: "w-40" },
                    { className: "hidden xl:table-cell", bar: "w-20" },
                    {},
                    { className: "hidden md:table-cell", bar: "w-20" },
                    { className: "hidden lg:table-cell", bar: "w-24" },
                    { className: "hidden lg:table-cell" },
                    { className: "hidden lg:table-cell" },
                  ]}
                />
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} selected={selected.has(item.id)}>
                    <TableCell className="w-10 pr-0 max-sm:p-0">
                      <label
                        htmlFor={`select-${item.id}`}
                        className="relative flex cursor-pointer items-center justify-center max-sm:min-h-11 max-sm:min-w-11"
                      >
                        <Checkbox
                          id={`select-${item.id}`}
                          aria-label={`Select ${item.name}`}
                          checked={selected.has(item.id)}
                          disabled={item.retired}
                          onChange={(event) => toggle(item.id, event.target.checked)}
                        />
                      </label>
                    </TableCell>
                    <TableCell className="max-w-64 min-w-40">
                      <TableIdentity
                        title={item.name}
                        to={`/targets/${encodeURIComponent(item.id)}`}
                        badge={item.retired ? <Tag>Retired</Tag> : null}
                        meta={item.domain}
                      />
                    </TableCell>
                    <TableCell className="hidden text-ink-2 xl:table-cell">
                      {TARGET_CATEGORY_LABELS[item.category]}
                    </TableCell>
                    <TableCell>
                      <Priority priority={item.priority} />
                    </TableCell>
                    <TableCell className="hidden text-ink-2 md:table-cell">
                      {CONTACT_METHOD_LABELS[item.contactMethod]}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <RequirementBadges requirements={item.requirements} max={2} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <HealthMark health={item.automation.scan} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <HealthMark health={item.automation.remove} />
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
