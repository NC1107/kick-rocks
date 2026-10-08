import { API_ROUTES, isCoolingDown } from "@kickrocks/shared";
import { Link } from "react-router";
import { useApiQuery } from "../../api/index.js";
import { pluralize } from "../../lib/format.js";
import { Tag } from "../ui/index.js";

const POLL_MS = 60_000;

/**
 * Says when Kick Rocks is leaving sites alone. Nothing shows while every site is open, so the
 * chip is a reason to look, not a fixture.
 */
export function SitesChip({ onNavigate }: { onNavigate: (() => void) | undefined }) {
  const sites = useApiQuery(API_ROUTES.settingsSites, { refetchInterval: POLL_MS });
  const cooling = sites.data?.items.filter(isCoolingDown).length ?? 0;
  if (cooling === 0) return null;
  return (
    <Link
      to="/settings"
      onClick={onNavigate}
      className="self-start rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Tag tone="attention">{pluralize(cooling, "site")} cooling down</Tag>
    </Link>
  );
}
