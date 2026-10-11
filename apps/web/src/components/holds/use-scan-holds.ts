import { API_ROUTES, type Dashboard } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useApiQuery, useCurrentProfile } from "../../api/index.js";

const REFRESH_MS = 30_000;

/** The current profile's queued scans and what holds them, shared with the dashboard's own cache. */
export function useScanHolds(): Dashboard["scans"] | null {
  const { profile } = useCurrentProfile();
  const dashboard = useApiQuery(
    API_ROUTES.dashboardGet,
    profile ? { params: { id: profile.id }, refetchInterval: REFRESH_MS } : skipToken,
  );
  return dashboard.data?.scans ?? null;
}
