import { API_ROUTES, type TargetFilter, type TargetListItem } from "@kickrocks/shared";
import { useQuery } from "@tanstack/react-query";
import type { ApiRequestError } from "../../api/index.js";
import { callRoute } from "../../api/index.js";

const PAGE_SIZE = 200;

type ListQuery = TargetFilter;

async function fetchMatching(query: ListQuery, signal: AbortSignal): Promise<TargetListItem[]> {
  const all: TargetListItem[] = [];
  for (let page = 1; ; page += 1) {
    const result = await callRoute(API_ROUTES.targetsList, {
      query: { ...query, page, pageSize: PAGE_SIZE },
      signal,
    });
    all.push(...result.items);
    if (all.length >= result.total || result.items.length === 0) return all;
  }
}

/** Every target a filter matches, fetched only once something needs to look past the visible page. */
export function useMatchingTargets(query: ListQuery, enabled: boolean) {
  return useQuery<TargetListItem[], ApiRequestError>({
    queryKey: ["api", "GET", "/targets", "matching", query],
    queryFn: ({ signal }) => fetchMatching(query, signal),
    enabled,
    staleTime: 60_000,
  });
}
