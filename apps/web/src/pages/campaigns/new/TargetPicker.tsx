import { API_ROUTES } from "@kickrocks/shared";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Button, Callout, DataList, Field, Input, Tag } from "../../../components/ui/index.js";
import { pluralize } from "../../../lib/format.js";
import { DIFFICULTY_LABELS } from "../../../lib/labels.js";
import { Difficulty } from "../../targets/Difficulty.js";

const PICKER_PAGE_SIZE = 8;
const SEARCH_DELAY_MS = 250;

/**
 * Search and tick single targets without leaving the campaign page. The rows match the Targets
 * list, so a target reads the same in both places.
 */
export function TargetPicker({
  selectedIds,
  onToggle,
}: {
  selectedIds: readonly string[];
  onToggle: (id: string, on: boolean) => void;
}) {
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

  const list = useApiQuery(API_ROUTES.targetsList, {
    query: { page, pageSize: PICKER_PAGE_SIZE, ...(query ? { q: query } : {}) },
    keepPrevious: true,
  });
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Search targets" hideLabel>
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search targets"
          maxLength={100}
          leading={<Search aria-hidden="true" />}
        />
      </Field>
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
        <p className="px-1 text-ui text-ink-2">No targets match that search.</p>
      ) : (
        <DataList
          label="Pick targets"
          headless
          items={items}
          getKey={(item) => item.id}
          identityHeader="Target"
          identity={(item) => ({
            title: item.name,
            meta: item.domain,
            ...(item.retired ? { badge: <Tag>Retired</Tag> } : {}),
          })}
          tags={(item) => <Tag>{DIFFICULTY_LABELS[item.difficulty].toLowerCase()}</Tag>}
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
          count={list.data ? pluralize(list.data.total, "target") : undefined}
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
