import { API_ROUTES, type Dashboard } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useApiQuery } from "./hooks.js";

const POLL_MS = 30_000;

/**
 * Everything waiting on the person, as one number: the needs-you queue plus mail to sort and
 * problems, which have their own Inbox tabs. Home and the Inbox badge both show this.
 */
export function needsYouTotal(attention: Dashboard["attention"]): number {
  return attention.needsYou.active + attention.unreviewedMessages + attention.failedTasks;
}

/** The Inbox badge count for this profile, read from the dashboard Home also uses. */
export function useInboxCount(profileId: string | null): number | null {
  const query = useApiQuery(
    API_ROUTES.dashboardGet,
    profileId ? { params: { id: profileId }, refetchInterval: POLL_MS } : skipToken,
  );
  return query.data ? needsYouTotal(query.data.attention) : null;
}
