import type {
  ApiIssue,
  RouteBody,
  RouteDef,
  RouteParams,
  RouteQuery,
  RouteResponse,
} from "@kickrocks/shared";
import type { MockStore } from "./store.js";

/** A handler throws this to answer with an error body, exactly as the real server would. */
export class MockHttpError extends Error {
  override name = "MockHttpError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: readonly ApiIssue[],
  ) {
    super(message);
  }
}

export const notFound = (what: string) =>
  new MockHttpError(404, "not_found", `${what} was not found.`);
export const conflict = (message: string) => new MockHttpError(409, "conflict", message);
export const invalid = (message: string, path: (string | number)[] = []) =>
  new MockHttpError(400, "invalid_request", message, [{ path, message }]);

/** A non-JSON answer, such as the screenshot image. */
export interface MockBinary {
  binary: Uint8Array;
  contentType: string;
}

export interface MockContext<R extends RouteDef> {
  /** Path parameters, parsed by the route's schema. */
  params: RouteParams<R>;
  /** Query string, parsed by the route's schema, defaults applied. */
  query: RouteQuery<R>;
  /** Request body, parsed by the route's schema. */
  body: RouteBody<R>;
  store: MockStore;
}

type MockHandler<R extends RouteDef> = (
  context: MockContext<R>,
) => RouteResponse<R> | MockBinary | Promise<RouteResponse<R> | MockBinary>;

/** One route and its handler. Build these with {@link handle}. */
export interface MockRoute {
  route: RouteDef;
  handler: (context: MockContext<RouteDef>) => unknown;
}

/**
 * Answers one route of the shared table. The return type is the route's response schema, so a
 * handler that returns the wrong shape fails to compile, and the server validates it again at
 * runtime so a fixture with bad data fails loudly instead of confusing a page.
 */
export function handle<R extends RouteDef>(route: R, handler: MockHandler<R>): MockRoute {
  return { route, handler: handler as unknown as MockRoute["handler"] };
}

/**
 * One domain of the mock: its seed data and its routes. Domains are listed in registry.ts and
 * seeded in that order, so a later domain may read what an earlier one put in the store.
 */
export interface MockDomain {
  name: string;
  /** Fills the store with fixture data. Runs once at startup and again on /__mock/reset. */
  seed?: (store: MockStore) => void;
  routes: (store: MockStore) => MockRoute[];
}

export function defineMockDomain(domain: MockDomain): MockDomain {
  return domain;
}
