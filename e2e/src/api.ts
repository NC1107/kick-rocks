import {
  API_ROUTES,
  type ApiError,
  buildRoutePath,
  type RouteBodyInput,
  type RouteDef,
  type RouteQueryInput,
  type RouteResponse,
} from "@kickrocks/shared";
import { STACK } from "./stack.js";

export interface CallInput<R extends RouteDef> {
  params?: Record<string, string>;
  query?: RouteQueryInput<R>;
  body?: RouteBodyInput<R>;
}

export type ApiResult<R extends RouteDef> =
  | { ok: true; status: number; body: RouteResponse<R> }
  | { ok: false; status: number; body: ApiError };

/** A browser's view of the server: one cookie jar, the CSRF header, and every answer checked against the route table. */
export class Api {
  private cookie = "";

  constructor(private readonly baseUrl: string = STACK.serverUrl) {}

  async try<R extends RouteDef>(route: R, input: CallInput<R> = {}): Promise<ApiResult<R>> {
    const pairs = Object.entries((input.query ?? {}) as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)] as [string, string]);
    const query = pairs.length > 0 ? `?${new URLSearchParams(pairs).toString()}` : "";
    const headers: Record<string, string> = { "x-kick-rocks": "1" };
    if (this.cookie) headers.cookie = this.cookie;
    if (route.auth === "worker") headers.authorization = `Bearer ${STACK.workerToken}`;
    if (input.body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(
      `${this.baseUrl}/api${buildRoutePath(route.path, input.params)}${query}`,
      {
        method: route.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      },
    );
    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("kr_session="));
    if (setCookie) this.cookie = (setCookie.split(";")[0] ?? "").trim();

    if (!response.ok) {
      return { ok: false, status: response.status, body: (await response.json()) as ApiError };
    }
    const expected = route.status ?? 200;
    if (response.status !== expected) {
      throw new Error(`${route.method} ${route.path} answered ${response.status}, not ${expected}`);
    }
    if (route.binary) {
      return {
        ok: true,
        status: response.status,
        body: Buffer.from(await response.arrayBuffer()),
      } as ApiResult<R>;
    }
    return {
      ok: true,
      status: response.status,
      body: route.response?.parse(await response.json()),
    } as ApiResult<R>;
  }

  /** Calls a route and returns its body, failing the test with the server's own words when it refuses. */
  async call<R extends RouteDef>(route: R, input: CallInput<R> = {}): Promise<RouteResponse<R>> {
    const result = await this.try(route, input);
    if (!result.ok) {
      throw new Error(
        `${route.method} ${route.path} answered ${result.status}: ${JSON.stringify(result.body)}`,
      );
    }
    return result.body as RouteResponse<R>;
  }
}

export { API_ROUTES };
