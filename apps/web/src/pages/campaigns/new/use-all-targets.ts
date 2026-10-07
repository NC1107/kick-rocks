import { API_ROUTES, type TargetListItem } from "@kickrocks/shared";
import { useQuery } from "@tanstack/react-query";
import type { ApiRequestError } from "../../../api/index.js";
import { callRoute } from "../../../api/index.js";

const PAGE_SIZE = 200;

/** Every target, fetched page by page, so a preview can say which channel each one would use. */
async function fetchAllTargets(signal: AbortSignal): Promise<TargetListItem[]> {
  const all: TargetListItem[] = [];
  for (let page = 1; ; page += 1) {
    const result = await callRoute(API_ROUTES.targetsList, {
      query: { page, pageSize: PAGE_SIZE },
      signal,
    });
    all.push(...result.items);
    if (all.length >= result.total || result.items.length === 0) return all;
  }
}

export function useAllTargets() {
  return useQuery<TargetListItem[], ApiRequestError>({
    queryKey: ["api", "GET", "/targets", "all"],
    queryFn: ({ signal }) => fetchAllTargets(signal),
    staleTime: 5 * 60_000,
  });
}
