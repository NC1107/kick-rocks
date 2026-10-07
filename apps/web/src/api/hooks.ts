import type { RouteDef, RouteResponse } from "@kickrocks/shared";
import {
  keepPreviousData,
  type QueryClient,
  skipToken,
  type UseMutationOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type ArgsTuple, callRoute, type RouteArgs } from "./client.js";
import type { ApiRequestError } from "./errors.js";

type Empty = Record<never, never>;
type Anyroute = RouteDef;

/** Every cache key for a route starts with this, so one call can invalidate all its variants. */
export function routeKeyPrefix(route: Pick<RouteDef, "method" | "path">): readonly unknown[] {
  return ["api", route.method, route.path];
}

export function routeKey(
  route: Pick<RouteDef, "method" | "path">,
  args?: { params?: unknown; query?: unknown },
): readonly unknown[] {
  return [...routeKeyPrefix(route), args?.params ?? null, args?.query ?? null];
}

/** Marks every cached answer for these routes stale, so mounted pages refetch them. */
export function invalidateRoutes(
  client: QueryClient,
  ...routes: readonly Pick<RouteDef, "method" | "path">[]
): Promise<unknown> {
  return Promise.all(
    routes.map((route) => client.invalidateQueries({ queryKey: routeKeyPrefix(route) })),
  );
}

export interface QueryExtras<Data = unknown> {
  enabled?: boolean;
  /** Milliseconds before a cached answer counts as stale. */
  staleTime?: number;
  /** Poll while the page is open. A function decides from the latest answer, so polling can stop when nothing is moving. */
  refetchInterval?: number | false | ((data: Data | undefined) => number | false);
  /** Keep showing the previous page of a list while the next one loads. */
  keepPrevious?: boolean;
}

export type QueryOptionsFor<R extends Anyroute> = RouteArgs<R> & QueryExtras<RouteResponse<R>>;

/**
 * Reads one GET route into the react-query cache. Pass the route and its params and query; pass
 * skipToken in place of the options to hold the request until a value such as a profile id exists.
 *
 *   useApiQuery(API_ROUTES.targetsGet, { params: { id } })
 *   useApiQuery(API_ROUTES.requestsList, profileId ? { params: { id: profileId }, query } : skipToken)
 */
export function useApiQuery<R extends Anyroute>(
  route: R,
  ...[options]: Empty extends RouteArgs<R>
    ? [options?: QueryOptionsFor<R> | typeof skipToken]
    : [options: QueryOptionsFor<R> | typeof skipToken]
) {
  const skip = options === skipToken;
  const { enabled, staleTime, refetchInterval, keepPrevious, ...args } = (
    skip ? {} : (options ?? {})
  ) as QueryExtras<RouteResponse<R>> & RouteArgs<R>;
  const callArgs = args as { params?: unknown; query?: unknown };
  return useQuery<RouteResponse<R>, ApiRequestError>({
    queryKey: routeKey(route, callArgs),
    queryFn: skip
      ? skipToken
      : ({ signal }) => callRoute(route, ...([{ ...args, signal }] as unknown as ArgsTuple<R>)),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(staleTime !== undefined ? { staleTime } : {}),
    ...(refetchInterval !== undefined
      ? {
          refetchInterval:
            typeof refetchInterval === "function"
              ? (query: { state: { data: RouteResponse<R> | undefined } }) =>
                  refetchInterval(query.state.data)
              : refetchInterval,
        }
      : {}),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });
}

export interface MutationExtras<R extends Anyroute> {
  /** Routes whose cached answers go stale after this succeeds, so lists and counts refresh. */
  invalidates?: readonly Pick<RouteDef, "method" | "path">[];
  onSuccess?: (data: RouteResponse<R>, variables: RouteArgs<R>) => void | Promise<void>;
  onError?: (error: ApiRequestError, variables: RouteArgs<R>) => void;
}

/**
 * Wraps a state-changing route. Call mutate(args) or mutateAsync(args); the X-Kick-Rocks header is
 * added for you. List what to refresh in invalidates.
 *
 *   const cancel = useApiMutation(API_ROUTES.requestsAct, { invalidates: [API_ROUTES.requestsList] });
 *   cancel.mutate({ params: { id }, body: { action: "cancel" } });
 */
export function useApiMutation<R extends Anyroute>(route: R, extras: MutationExtras<R> = {}) {
  const client = useQueryClient();
  const options: UseMutationOptions<
    RouteResponse<R>,
    ApiRequestError,
    // void lets a route with no required args be called as mutate() with nothing in the brackets.
    // biome-ignore lint/suspicious/noConfusingVoidType: see above
    Empty extends RouteArgs<R> ? RouteArgs<R> | void : RouteArgs<R>
  > = {
    mutationFn: (variables) => callRoute(route, ...([variables ?? {}] as unknown as ArgsTuple<R>)),
    onSuccess: async (data, variables) => {
      if (extras.invalidates?.length) await invalidateRoutes(client, ...extras.invalidates);
      await extras.onSuccess?.(data, (variables ?? {}) as RouteArgs<R>);
    },
    onError: (error, variables) => extras.onError?.(error, (variables ?? {}) as RouteArgs<R>),
  };
  return useMutation(options);
}
