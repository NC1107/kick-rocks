import { API_ROUTES, type RouteResponse } from "@kickrocks/shared";
import { useQuery } from "@tanstack/react-query";
import { callRoute } from "./client.js";
import { ApiRequestError } from "./errors.js";
import { routeKey } from "./hooks.js";

type Health = RouteResponse<typeof API_ROUTES.health>;

/**
 * The health check answers 503 with a body that says the instance is unwell, and that body still
 * carries the version, so a 503 is an answer here and not a failed request.
 */
async function readHealth(signal: AbortSignal): Promise<Health> {
  try {
    return await callRoute(API_ROUTES.health, { signal });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 503) {
      const body = API_ROUTES.health.response.safeParse(error.body);
      if (body.success) return body.data;
    }
    throw error;
  }
}

export function useInstanceHealth() {
  return useQuery<Health, ApiRequestError>({
    queryKey: routeKey(API_ROUTES.health),
    queryFn: ({ signal }) => readHealth(signal),
  });
}
