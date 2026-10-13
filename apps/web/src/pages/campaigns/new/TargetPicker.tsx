import {
  API_ROUTES,
  ContactMethod,
  Difficulty as DifficultyLevel,
  type TargetFacets,
  type TargetFilter,
  TargetKind,
} from "@kickrocks/shared";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import {
  activeFilterTags,
  Button,
  Callout,
  DataList,
  Field,
  type FilterGroup,
  type FilterOption,
  Filters,
  FilterTags,
  Input,
  Tag,
} from "../../../components/ui/index.js";
import { pluralize } from "../../../lib/format.js";
import {
  CONTACT_METHOD_LABELS,
  DIFFICULTY_LABELS,
  TARGET_KIND_LABELS,
} from "../../../lib/labels.js";
import { Difficulty } from "../../targets/Difficulty.js";

const PICKER_PAGE_SIZE = 8;
const SEARCH_DELAY_MS = 250;

type PickerFilterKey = "difficulty" | "kind" | "contactMethod";
type PickerFilters = Record<PickerFilterKey, string>;
const NO_FILTERS: PickerFilters = { difficulty: "", kind: "", contactMethod: "" };

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

/**
 * Search and tick single targets without leaving the campaign page. The rows match the Targets
 * list, so a target reads the same in both places. Its search and filters stay local because the
 * page already keeps the chosen targets and filter in the address.
 */
export function TargetPicker({
  selectedIds,
  onToggle,
  onUseFilter,
}: {
  selectedIds: readonly string[];
  onToggle: (id: string, on: boolean) => void;
  /** Takes every site the current search and filters match as the campaign's selection. */
  onUseFilter: (filter: TargetFilter) => void;
}) {
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [filters, setFilters] = useState<PickerFilters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, query]);

  const facets = useApiQuery(API_ROUTES.targetsFacets, { staleTime: 60_000 });
  const filtered = Object.values(filters).some((value) => value !== "");
  const activeFilter: TargetFilter = {
    ...(query ? { q: query } : {}),
    ...(filters.difficulty ? { difficulty: DifficultyLevel.parse(filters.difficulty) } : {}),
    ...(filters.kind ? { kind: TargetKind.parse(filters.kind) } : {}),
    ...(filters.contactMethod ? { contactMethod: ContactMethod.parse(filters.contactMethod) } : {}),
  };
  const list = useApiQuery(API_ROUTES.targetsList, {
    query: { page, pageSize: PICKER_PAGE_SIZE, ...activeFilter },
    keepPrevious: true,
  });
  const items = list.data?.items ?? [];

  const setFilter = (key: PickerFilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const group = (
    key: PickerFilterKey,
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
    group(
      "difficulty",
      "Difficulty",
      "Any difficulty",
      facetOptions(facets.data?.difficulty, DIFFICULTY_LABELS),
    ),
    group("kind", "Type", "All types", facetOptions(facets.data?.kind, TARGET_KIND_LABELS)),
    group(
      "contactMethod",
      "Contact",
      "Any contact",
      facetOptions(facets.data?.contactMethod, CONTACT_METHOD_LABELS),
    ),
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Field label="Search sites" hideLabel className="min-w-0 flex-1">
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
          onClear={() => {
            setFilters(NO_FILTERS);
            setPage(1);
          }}
          resultCount={list.data ? pluralize(list.data.total, "site") : undefined}
          triggerRef={filtersButton}
        />
      </div>
      <FilterTags tags={activeFilterTags(groups)} emptyFocusRef={filtersButton} />
      {filtered && list.data && list.data.total > 0 ? (
        <div>
          <Button size="sm" onClick={() => onUseFilter(activeFilter)}>
            Use all {pluralize(list.data.total, "site")} matching
          </Button>
        </div>
      ) : null}
      {list.isError ? (
        <Callout
          intent="danger"
          title="Could not load sites"
          action={
            <Button size="sm" onClick={() => list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(list.error)}
        </Callout>
      ) : list.data && items.length === 0 ? (
        <p className="px-1 text-ui text-ink-2">
          {filtered ? "No sites match those filters." : "No sites match that search."}
        </p>
      ) : (
        <DataList
          label="Pick sites"
          layout="rows"
          headless
          items={items}
          getKey={(item) => item.id}
          identityHeader="Site"
          identity={(item) => ({
            title: item.name,
            meta: item.domain,
            ...(item.retired ? { badge: <Tag>Retired</Tag> } : {}),
          })}
          tags={(item) => (
            <>
              <Difficulty difficulty={item.difficulty} />
              {item.contactMethod === "unknown" ? null : (
                <span className="font-mono text-meta text-ink-2">
                  {CONTACT_METHOD_LABELS[item.contactMethod].toLowerCase()}
                </span>
              )}
            </>
          )}
          columns={[
            {
              id: "difficulty",
              header: "Difficulty",
              cell: (item) => <Difficulty difficulty={item.difficulty} />,
            },
          ]}
          selection={{
            idPrefix: "pick",
            isChecked: (item) => selectedIds.includes(item.id),
            isDisabled: (item) => item.retired,
            onToggle: (item, on) => onToggle(item.id, on),
            label: (item) => `Pick ${item.name}`,
          }}
          loading={list.isPending}
          busy={list.isPlaceholderData}
          count={list.data ? pluralize(list.data.total, "site") : undefined}
          pager={
            list.data
              ? {
                  page: list.data.page,
                  pageSize: PICKER_PAGE_SIZE,
                  total: list.data.total,
                  onPageChange: setPage,
                  noun: "targets",
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
