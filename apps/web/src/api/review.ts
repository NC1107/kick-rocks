import { API_ROUTES } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useApiQuery } from "./hooks.js";
import { reviewCount } from "./session.js";

const POLL_MS = 30_000;

/** How many things wait on the person for this profile, for the Review badge. Polls every 30 seconds. */
export function useReviewCount(profileId: string | null): number | null {
  const query = useApiQuery(
    API_ROUTES.reviewQueue,
    profileId ? { query: { profileId }, refetchInterval: POLL_MS } : skipToken,
  );
  return query.data ? reviewCount(query.data) : null;
}
