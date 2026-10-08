import { API_ROUTES, type AuthState, type ReviewQueue, reviewAttention } from "@kickrocks/shared";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { callRoute, onUnauthorized } from "./client.js";
import { routeKey, routeKeyPrefix, useApiMutation, useApiQuery } from "./hooks.js";

const AUTH_STATE_STALE_MS = 60_000;

/** Whether this instance needs its first password, and whether this browser is signed in. */
export function useAuthState() {
  return useApiQuery(API_ROUTES.authState, { staleTime: AUTH_STATE_STALE_MS });
}

/**
 * Starts the auth state request before React renders, so it travels alongside the first route's
 * chunk instead of waiting behind it. The gate then reads the cached answer.
 */
export function prefetchAuthState(client: QueryClient): Promise<void> {
  return client.prefetchQuery({
    queryKey: routeKey(API_ROUTES.authState),
    queryFn: ({ signal }) => callRoute(API_ROUTES.authState, { signal }),
    staleTime: AUTH_STATE_STALE_MS,
  });
}

/** Marks this browser signed out, wipes everything cached for the old session, and lets the gate redirect. */
function useEndSession() {
  const client = useQueryClient();
  return (state: Pick<AuthState, "setupRequired"> = { setupRequired: false }) => {
    client.removeQueries({ predicate: (query) => query.queryKey[2] !== API_ROUTES.authState.path });
    client.setQueryData(routeKey(API_ROUTES.authState), {
      setupRequired: state.setupRequired,
      authenticated: false,
    } satisfies AuthState);
  };
}

/** Sends a signed-out visitor to the login page whenever any request comes back 401. */
export function useUnauthorizedListener() {
  const endSession = useEndSession();
  useEffect(() => onUnauthorized(() => endSession()), [endSession]);
}

export function useLogin() {
  const client = useQueryClient();
  return useApiMutation(API_ROUTES.authLogin, {
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: routeKeyPrefix(API_ROUTES.authState) });
    },
  });
}

export function useSetup() {
  const client = useQueryClient();
  return useApiMutation(API_ROUTES.authSetup, {
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: routeKeyPrefix(API_ROUTES.authState) });
    },
  });
}

export function useLogout() {
  const endSession = useEndSession();
  return useApiMutation(API_ROUTES.authLogout, { onSuccess: () => endSession() });
}

/** The number on the Review badge: everything waiting on a person. */
export function reviewCount(
  queue: Pick<
    ReviewQueue,
    "blockedTasks" | "matches" | "verifications" | "failedTasks" | "agentTasks" | "messages"
  >,
) {
  return Object.values(reviewAttention(queue)).reduce((sum, n) => sum + n, 0);
}
