import { API_ROUTES, type TargetFacets } from "@kickrocks/shared";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useCurrentProfile } from "../../api/current-profile.js";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Alert,
  activeFilterTags,
  Button,
  Checkbox,
  ConfirmDialog,
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
  useToast,
} from "../../components/ui/index.js";
import { formatCount, pluralize } from "../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  DIFFICULTY_LABELS,
  PRIORITY_LABELS,
  REQUIREMENT_LABELS,
  TARGET_CATEGORY_LABELS,
  TARGET_KIND_LABELS,
} from "../../lib/labels.js";
import { AutomationLegend, HealthMark } from "./Automation.js";
import { DifficultyTag } from "./DifficultyTag.js";
import {
  FILTER_KEYS,
  type FilterKey,
  hasFilters,
  readFilters,
  TARGETS_PAGE_SIZE,
  toFilter,
  toQuery,
} from "./filters.js";
import { LoadingRows } from "./LoadingRows.js";
import { Priority } from "./Priority.js";
import { RequirementBadges } from "./RequirementBadges.js";
import { SelectCell } from "./SelectCell.js";

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
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const [search, setSearch] = useState(filters.q);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  // Which filter "select all matching" was pressed under, so changing the filter drops it.
  const [matchingKey, setMatchingKey] = useState<string | null>(null);
  const [confirmingScan, setConfirmingScan] = useState(false);
  const toast = useToast();
  const { profile } = useCurrentProfile();

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
    facetGroup(
      "difficulty",
      "Difficulty",
      "Any difficulty",
      facetOptions(facets.data?.difficulty, DIFFICULTY_LABELS),
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
  const filter = toFilter(filters);
  const filterKey = JSON.stringify(filter);
  const allMatching = matchingKey === filterKey;
  const total = list.data?.total ?? 0;
  const isChecked = (id: string) => allMatching || selected.has(id);
  const allSelected = selectable.length > 0 && selectable.every((item) => isChecked(item.id));
  const someSelected = selectable.some((item) => isChecked(item.id));
  const offerAllMatching = allSelected && !allMatching && total > items.length;

  const dropAllMatching = () => {
    if (!allMatching) return;
    setMatchingKey(null);
    setSelected(new Set(selectable.map((item) => item.id)));
  };

  const toggle = (id: string, on: boolean) => {
    dropAllMatching();
    setSelected((current) => {
      const next = new Set(allMatching ? selectable.map((item) => item.id) : current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const togglePage = (on: boolean) => {
    if (allMatching && !on) {
      clearSelection();
      return;
    }
    setSelected((current) => {
      const next = new Set(current);
      for (const item of selectable) {
        if (on) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setMatchingKey(null);
  };

  const scan = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [API_ROUTES.scansList, API_ROUTES.reviewQueue, API_ROUTES.dashboardGet],
    onSuccess: (result) => {
      setConfirmingScan(false);
      const started = result.items.filter((item) => item.outcome === "scan_started").length;
      toast.success(
        started === 0 ? "No new scans to start" : `Started ${pluralize(started, "scan")}`,
      );
    },
    onError: () => setConfirmingScan(false),
  });

  const campaignLink = allMatching
    ? `/campaigns/new?filter=${encodeURIComponent(filterKey)}`
    : `/campaigns/new?targets=${[...selected].map(encodeURIComponent).join(",")}`;
  const filtered = hasFilters(filters);
  const resultCount = list.data ? `${formatCount(list.data.total)} targets` : undefined;

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
        <TableToolbar count={resultCount}>
          <Field label="Search" hideLabel className="min-w-0 flex-1 sm:w-70 sm:flex-initial">
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search targets"
              maxLength={100}
              leading={<Search aria-hidden="true" />}
            />
          </Field>
          <Filters
            groups={groups}
            onClear={clearFacetFilters}
            resultCount={resultCount}
            triggerRef={filtersButton}
          />
        </TableToolbar>
      </search>
      <FilterTags tags={activeFilterTags(groups)} emptyFocusRef={filtersButton} />

      {allMatching || selected.size > 0 ? (
        <div
          role="status"
          className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line bg-accent-soft px-3.5 py-2 text-ui text-ink"
        >
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-meta tabular-nums">
              {allMatching
                ? `All ${formatCount(total)} matching selected`
                : `${formatCount(selected.size)} selected`}
            </span>
            {offerAllMatching ? (
              <Button size="sm" variant="ghost" onClick={() => setMatchingKey(filterKey)}>
                Select all {formatCount(total)} matching
              </Button>
            ) : null}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear selection
            </Button>
            {allMatching ? (
              <Button
                size="sm"
                disabled={!profile}
                onClick={() => {
                  scan.reset();
                  setConfirmingScan(true);
                }}
              >
                Scan these
              </Button>
            ) : null}
            <LinkButton size="sm" variant="primary" to={campaignLink}>
              Ask these to remove my data
            </LinkButton>
          </span>
        </div>
      ) : null}
      {scan.isError ? (
        <Alert intent="danger" title="Could not scan these targets" className="mb-2.5">
          {errorMessage(scan.error)}
        </Alert>
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
                  <TableRow key={item.id} selected={isChecked(item.id) && !item.retired}>
                    <SelectCell
                      id={`select-${item.id}`}
                      label={`Select ${item.name}`}
                      checked={isChecked(item.id) && !item.retired}
                      disabled={item.retired}
                      onChange={(on) => toggle(item.id, on)}
                    />
                    <TableCell className="max-w-64 min-w-40">
                      <TableIdentity
                        title={item.name}
                        to={`/targets/${encodeURIComponent(item.id)}`}
                        badge={
                          <>
                            {item.retired ? <Tag>Retired</Tag> : null}
                            <DifficultyTag difficulty={item.difficulty} />
                          </>
                        }
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

      <ConfirmDialog
        open={confirmingScan}
        onClose={() => setConfirmingScan(false)}
        title={`Scan ${formatCount(total)} matching targets?`}
        description="Kick Rocks searches the people-search sites among them for this person, one after another. Nothing is removed until you confirm a record."
        confirmLabel="Start scans"
        loading={scan.isPending}
        onConfirm={() => profile && scan.mutate({ params: { id: profile.id }, body: { filter } })}
      />
    </>
  );
}
