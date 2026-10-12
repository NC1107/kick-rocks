import { API_ROUTES } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useApiQuery } from "./hooks.js";

const POLL_MS = 30_000;

/**
 * How many things wait on the person for this profile, for the Review badge. It reads the same
 * queue the Needs you page and its Start button do, so the three always count the same items.
 */
export function useReviewCount(profileId: string | null): number | null {
  const query = useApiQuery(
    API_ROUTES.needsYouGet,
    profileId ? { query: { profileId }, refetchInterval: POLL_MS } : skipToken,
  );
  return query.data ? query.data.counts.active : null;
}
