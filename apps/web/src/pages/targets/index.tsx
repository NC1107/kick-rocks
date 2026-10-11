import { API_ROUTES, needsRecord, type TargetFacets } from "@kickrocks/shared";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useCurrentProfile } from "../../api/current-profile.js";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  activeFilterTags,
  Button,
  Callout,
  ConfirmDialog,
  DataList,
  EmptyState,
  Field,
  type FilterGroup,
  type FilterOption,
  Filters,
  FilterTags,
  Input,
  LinkButton,
  PageHeader,
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
import { useWide } from "../../lib/use-wide.js";
import { AutomationLegend, HealthMark } from "./Automation.js";
import { Difficulty } from "./Difficulty.js";
import {
  FILTER_KEYS,
  type FilterKey,
  hasFilters,
  readFilters,
  TARGETS_PAGE_SIZE,
  toFilter,
  toQuery,
} from "./filters.js";
import { Priority } from "./Priority.js";
import { RequirementBadges } from "./RequirementBadges.js";
import { useMatchingTargets } from "./use-matching-targets.js";

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
  const wide = useWide();
  const filtersButton = useRef<HTMLButtonElement>(null);
  const clearSelectionButton = useRef<HTMLButtonElement>(null);
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

  const toggle = (id: string, on: boolean) => {
    if (allMatching) {
      setMatchingKey(null);
      const remaining = selectable.length - (on ? 0 : 1);
      toast.info(`Selection narrowed to the ${pluralize(remaining, "target")} on this page`);
    }
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

  const selectAllMatching = () => {
    setMatchingKey(filterKey);
    // The pressed button leaves the bar, so focus moves to one that stays.
    queueMicrotask(() => clearSelectionButton.current?.focus());
  };

  const clearSelection = () => {
    setSelected(new Set());
    setMatchingKey(null);
  };

  const matching = useMatchingTargets(filter, allMatching);
  const scannable = matching.data?.filter((item) => needsRecord(item) && !item.retired).length;

  const scan = useApiMutation(API_ROUTES.scansStart, {
    invalidates: [API_ROUTES.scansList, API_ROUTES.reviewQueue, API_ROUTES.dashboardGet],
    onSuccess: (result) => {
      setConfirmingScan(false);
      clearSelection();
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
  const resultCount = list.data ? pluralize(list.data.total, "target") : undefined;

  const selectionBar =
    allMatching || selected.size > 0 ? (
      <div
        role="status"
        className={
          wide
            ? "mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line bg-accent-soft px-3.5 py-2 text-ui text-ink"
            : "sticky bottom-0 z-10 -mx-gutter mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-line bg-accent-soft px-gutter py-2.5 text-ui text-ink"
        }
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-meta tabular-nums">
            {allMatching
              ? `All ${formatCount(total)} matching selected`
              : `${formatCount(selected.size)} selected`}
          </span>
          {offerAllMatching ? (
            <Button size="sm" variant="ghost" className="-ml-2.5" onClick={selectAllMatching}>
              Select all {formatCount(total)} matching
            </Button>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-2 max-lg:contents">
          <Button
            ref={clearSelectionButton}
            size="sm"
            variant="ghost"
            className="-ml-2.5 max-lg:col-start-2 max-lg:row-start-1 max-lg:ml-0"
            onClick={clearSelection}
          >
            Clear selection
          </Button>
          {allMatching ? (
            <Button
              size="sm"
              disabled={!profile || !scannable}
              onClick={() => {
                scan.reset();
                setConfirmingScan(true);
              }}
            >
              Scan these
            </Button>
          ) : null}
          <LinkButton size="sm" variant="primary" to={campaignLink} className="max-lg:col-span-2">
            Ask these to remove my data
          </LinkButton>
        </span>
      </div>
    ) : null;

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
        <TableToolbar>
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

      {wide ? selectionBar : null}
      {scan.isError ? (
        <Callout intent="danger" title="Could not scan these targets" className="mb-2.5">
          {errorMessage(scan.error)}
        </Callout>
      ) : null}

      {list.isError ? (
        <Callout
          intent="danger"
          title="Could not load targets"
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(list.error)}
        </Callout>
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
          {wide ? <AutomationLegend /> : null}
          <DataList
            label="Targets"
            items={items}
            getKey={(item) => item.id}
            identityHeader="Target"
            identity={(item) => ({
              title: item.name,
              meta: item.domain,
              to: `/targets/${encodeURIComponent(item.id)}`,
              ...(item.retired ? { badge: <Tag>Retired</Tag> } : {}),
            })}
            tags={(item) => (
              <>
                <Tag
                  {...(item.priority === "crucial" ? { className: "font-semibold text-ink" } : {})}
                >
                  {PRIORITY_LABELS[item.priority].toLowerCase()}
                </Tag>
                <Tag>{DIFFICULTY_LABELS[item.difficulty].toLowerCase()}</Tag>
              </>
            )}
            columns={[
              {
                id: "category",
                header: "Category",
                className: "hidden 2xl:table-cell",
                cell: (item) => (
                  <span className="text-ink-2">{TARGET_CATEGORY_LABELS[item.category]}</span>
                ),
              },
              {
                id: "priority",
                header: "Priority",
                cell: (item) => <Priority priority={item.priority} />,
              },
              {
                id: "difficulty",
                header: "Difficulty",
                cell: (item) => <Difficulty difficulty={item.difficulty} />,
              },
              {
                id: "contact",
                header: "Contact",
                cell: (item) => (
                  <span className="text-ink-2">{CONTACT_METHOD_LABELS[item.contactMethod]}</span>
                ),
              },
              {
                id: "needs",
                header: "Needs",
                className: "hidden 2xl:table-cell",
                cell: (item) => <RequirementBadges requirements={item.requirements} max={2} />,
              },
              {
                id: "scan",
                header: "Scan",
                className: "hidden xl:table-cell",
                cell: (item) => <HealthMark health={item.automation.scan} />,
              },
              {
                id: "removal",
                header: "Removal",
                className: "hidden xl:table-cell",
                cell: (item) => <HealthMark health={item.automation.remove} />,
              },
            ]}
            selection={{
              idPrefix: "select",
              isChecked: (item) => isChecked(item.id) && !item.retired,
              isDisabled: (item) => item.retired,
              onToggle: (item, on) => toggle(item.id, on),
              label: (item) => `Select ${item.name}`,
              all: {
                label: "Select all targets on this page",
                checked: allSelected,
                indeterminate: someSelected && !allSelected,
                disabled: selectable.length === 0,
                onChange: togglePage,
              },
            }}
            loading={list.isPending}
            busy={list.isPlaceholderData}
            count={resultCount}
            pager={
              list.data
                ? {
                    page: list.data.page,
                    pageSize: TARGETS_PAGE_SIZE,
                    total: list.data.total,
                    onPageChange: setPage,
                    noun: "targets",
                  }
                : undefined
            }
          />
          {wide ? null : selectionBar}
        </>
      )}

      <ConfirmDialog
        open={confirmingScan}
        onClose={() => setConfirmingScan(false)}
        title={`Scan the ${pluralize(scannable ?? 0, "people-search site")} among these ${formatCount(total)}?`}
        description="Kick Rocks searches the people-search sites among them for this person, one after another. Nothing is removed until you confirm a record."
        confirmLabel="Start scans"
        loading={scan.isPending}
        onConfirm={() => profile && scan.mutate({ params: { id: profile.id }, body: { filter } })}
      />
    </>
  );
}
