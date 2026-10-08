import { RequestChannel, RequestStatus } from "@kickrocks/shared";

export const REQUESTS_PAGE_SIZE = 50;

interface RequestFilters {
  q: string;
  status: RequestStatus | "";
  channel: RequestChannel | "";
  targetId: string;
  page: number;
}

/** Reads the filters from the address bar, dropping a status or channel that is not one. */
export function readRequestFilters(params: URLSearchParams): RequestFilters {
  const status = RequestStatus.safeParse(params.get("status"));
  const channel = RequestChannel.safeParse(params.get("channel"));
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").slice(0, 100),
    status: status.success ? status.data : "",
    channel: channel.success ? channel.data : "",
    targetId: params.get("targetId") ?? "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function hasRequestFilters(filters: RequestFilters): boolean {
  return Boolean(filters.q || filters.status || filters.channel || filters.targetId);
}

export function toRequestQuery(filters: RequestFilters) {
  return {
    page: filters.page,
    pageSize: REQUESTS_PAGE_SIZE,
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.status ? { status: [filters.status] } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.targetId ? { targetId: filters.targetId } : {}),
  };
}
