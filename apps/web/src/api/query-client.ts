import { QueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "./errors.js";

/** One client for the whole app. A 4xx is the server's answer, so retrying it only repeats it. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (failures, error) =>
          !(error instanceof ApiRequestError && error.status < 500) && failures < 2,
      },
      mutations: { retry: false },
    },
  });
}
