import { API_ROUTES } from "@kickrocks/shared";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  Field,
  Input,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableIdentity,
  TableRow,
  TableSkeletonRows,
  Tag,
} from "../../../components/ui/index.js";
import { Difficulty } from "../../targets/Difficulty.js";
import { SelectCell } from "../../targets/SelectCell.js";

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
        <div>
          <Table label="Pick targets" aria-busy={list.isPlaceholderData || undefined}>
            <TableBody>
              {list.isPending ? (
                <TableSkeletonRows columns={3} rows={4} />
              ) : (
                items.map((item) => (
                  <TableRow key={item.id} selected={selectedIds.includes(item.id)}>
                    <SelectCell
                      id={`pick-${item.id}`}
                      label={`Pick ${item.name}`}
                      checked={selectedIds.includes(item.id)}
                      disabled={item.retired}
                      onChange={(on) => onToggle(item.id, on)}
                    />
                    <TableCell className="min-w-0">
                      <TableIdentity
                        title={item.name}
                        meta={item.domain}
                        {...(item.retired ? { badge: <Tag>Retired</Tag> } : {})}
                      />
                    </TableCell>
                    <TableCell>
                      <Difficulty difficulty={item.difficulty} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {list.data ? (
            <Pagination
              page={list.data.page}
              pageSize={PICKER_PAGE_SIZE}
              total={list.data.total}
              onPageChange={setPage}
              noun="targets"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
