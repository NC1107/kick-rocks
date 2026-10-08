import {
  API_ROUTES,
  ApiError,
  buildRoutePath,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type RouteBodyInput,
  type RouteDef,
  type RouteParams,
  type RouteQueryInput,
  type RouteResponse,
  requiresCsrfHeader,
} from "@kickrocks/shared";
import { ApiContractError, ApiNetworkError, ApiRequestError, messageForStatus } from "./errors.js";

type Empty = Record<never, never>;

/** Query values a page may pass: arrays become comma lists, which is how the API reads them. */
type QueryArg<Q> = {
  [K in keyof Q]: Q[K] extends string | undefined ? Q[K] | readonly string[] : Q[K];
};

type ParamsArg<R extends RouteDef> = R extends { readonly params: object }
  ? { params: RouteParams<R> }
  : Empty;
type QueryArgs<R extends RouteDef> = R extends { readonly query: object }
  ? { query?: QueryArg<RouteQueryInput<R>> }
  : Empty;
type BodyArg<R extends RouteDef> = R extends { readonly body: object }
  ? { body: RouteBodyInput<R> }
  : Empty;

/** What a call takes, derived from the route: path params and body are required when the route has them. */
export type RouteArgs<R extends RouteDef> = ParamsArg<R> &
  QueryArgs<R> &
  BodyArg<R> & { signal?: AbortSignal | undefined };

/** A tuple that makes the args argument optional when no key in it is required. */
export type ArgsTuple<R extends RouteDef> =
  Empty extends RouteArgs<R> ? [args?: RouteArgs<R>] : [args: RouteArgs<R>];

const unauthorizedListeners = new Set<() => void>();

/**
 * Runs when a signed-in route answers 401, meaning the session ended. The auth gate listens and
 * sends the person to /login, so no page has to handle it.
 */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function serializeQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(","));
    } else {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function routeUrl(
  route: Pick<RouteDef, "path">,
  args?: { params?: unknown; query?: unknown },
) {
  const path = buildRoutePath(route.path, args?.params as Record<string, string> | undefined);
  return `/api${path}${serializeQuery(args?.query as Record<string, unknown> | undefined)}`;
}

/** Where to point an <img> at a task's screenshot. The session cookie goes along with it. */
export function screenshotUrl(taskId: string): string {
  return routeUrl(API_ROUTES.taskScreenshot, { params: { id: taskId } });
}

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toRequestError(status: number, body: unknown): ApiRequestError {
  const parsed = ApiError.safeParse(body);
  if (!parsed.success) {
    return new ApiRequestError(status, "unknown", messageForStatus(status), [], body);
  }
  const { error, message, issues } = parsed.data;
  return new ApiRequestError(
    status,
    error,
    message ?? messageForStatus(status),
    issues ?? [],
    body,
  );
}

/**
 * Calls one route from the shared table. The params, query, and body are typed from the route's
 * schemas, the X-Kick-Rocks header goes on every state-changing call, and the response is parsed
 * with the route's response schema, so a server that breaks the contract fails here, loudly.
 */
export async function callRoute<R extends RouteDef>(
  route: R,
  ...[args]: ArgsTuple<R>
): Promise<RouteResponse<R>> {
  const { body, signal } = (args ?? {}) as { body?: unknown; signal?: AbortSignal };
  const headers: Record<string, string> = { accept: "application/json" };
  if (requiresCsrfHeader(route)) headers[CSRF_HEADER] = CSRF_HEADER_VALUE;
  if (body !== undefined) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(routeUrl(route, args as { params?: unknown; query?: unknown }), {
      method: route.method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
      signal: signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiNetworkError({ cause: error });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const failure = toRequestError(response.status, payload);
    if (response.status === 401 && route.auth === "session") {
      for (const listener of unauthorizedListeners) listener();
    }
    throw failure;
  }

  if (!route.response) return undefined as RouteResponse<R>;
  const parsed = route.response.safeParse(payload);
  if (!parsed.success) {
    throw new ApiContractError(`${route.method} ${route.path}`, parsed.error.message);
  }
  return parsed.data as RouteResponse<R>;
}
