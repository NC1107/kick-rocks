import { API_ROUTES } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useApiQuery } from "./hooks.js";

/** Agent workers poll every few seconds and MCP clients only when they call, so a slow poll is enough. */
export const AGENTS_POLL_MS = 15_000;

/**
 * The agents a task can be given to. With a task id, each row also says why the server would
 * refuse the task to that agent. Polls while `enabled`, so the dialog and the callout stay current.
 */
export function useAgents({
  taskId,
  enabled = true,
}: {
  taskId?: string | undefined;
  enabled?: boolean;
}) {
  return useApiQuery(
    API_ROUTES.agentsList,
    enabled
      ? { query: taskId ? { taskId } : {}, refetchInterval: AGENTS_POLL_MS, staleTime: 5_000 }
      : skipToken,
  );
}
