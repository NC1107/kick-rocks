import { API_ROUTES, type AuthState, type ReviewQueue } from "@kickrocks/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { onUnauthorized } from "./client.js";
import { routeKey, routeKeyPrefix, useApiMutation, useApiQuery } from "./hooks.js";

/** Whether this instance needs its first password, and whether this browser is signed in. */
export function useAuthState() {
  return useApiQuery(API_ROUTES.authState, { staleTime: 60_000 });
}

/** Marks this browser signed out, wipes everything cached for the old session, and lets the gate redirect. */
export function useEndSession() {
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
    "blockedTasks" | "matches" | "verifications" | "failedTasks" | "messages"
  >,
) {
  return (
    queue.blockedTasks.length +
    queue.matches.filter((match) => match.decision === "pending").length +
    queue.verifications.length +
    queue.failedTasks.length +
    queue.messages.length
  );
}
