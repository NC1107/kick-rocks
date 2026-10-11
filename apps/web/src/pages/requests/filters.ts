import { RequestChannel, RequestStatus } from "@kickrocks/shared";

export const REQUESTS_PAGE_SIZE = 50;

interface RequestFilters {
  q: string;
  status: RequestStatus | "";
  channel: RequestChannel | "";
  targetId: string;
  campaignId: string;
  /** Whose requests to list: empty for the current profile, "all", or one profile's id. */
  profileId: string;
  page: number;
}

/** The value of the profile scope that stands for every profile. */
export const ALL_PROFILES = "all";

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
    campaignId: params.get("campaignId") ?? "",
    profileId: params.get("profileId") ?? "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function hasRequestFilters(filters: RequestFilters): boolean {
  return Boolean(
    filters.q || filters.status || filters.channel || filters.targetId || filters.campaignId,
  );
}

export function toRequestQuery(filters: RequestFilters) {
  return {
    page: filters.page,
    pageSize: REQUESTS_PAGE_SIZE,
    ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.status ? { status: [filters.status] } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.targetId ? { targetId: filters.targetId } : {}),
    ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
  };
}
