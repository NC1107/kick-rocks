import { API_ROUTES } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Link } from "react-router";
import { useApiQuery, useCurrentProfile } from "../../api/index.js";
import { shortRelative } from "../../lib/format.js";
import { TONE_SHAPE } from "../../lib/status.js";
import { useNow } from "../../lib/use-now.js";
import { StatusShapeGlyph } from "../ui/index.js";
import {
  inboxChip,
  mostUrgent,
  type StatusChip,
  sendsChip,
  sitesChip,
  workerChip,
} from "./shell-status.js";

const REFRESH_MS = 30_000;
const SITES_REFRESH_MS = 60_000;

/** Live system state for the header: the worker, the inbox, and either today's sending or, when it matters more, any site being left alone. */
export function useShellStatus(): StatusChip[] {
  const { profile } = useCurrentProfile();
  const settings = useApiQuery(API_ROUTES.settingsGet, { refetchInterval: REFRESH_MS });
  const dashboard = useApiQuery(
    API_ROUTES.dashboardGet,
    profile ? { params: { id: profile.id }, refetchInterval: REFRESH_MS } : skipToken,
  );
  const sites = useApiQuery(API_ROUTES.settingsSites, { refetchInterval: SITES_REFRESH_MS });
  const now = useNow();
  const cooling = sites.data ? sitesChip(sites.data.items) : null;
  const chips: StatusChip[] = [];
  if (settings.data) chips.push(workerChip(settings.data.worker, now, dashboard.data?.scans));
  if (dashboard.data && profile) {
    chips.push(inboxChip(dashboard.data.mailbox, (iso) => shortRelative(iso, now), profile.id));
    // The header holds three chips; a site being left alone is news, today's send count is not.
    const sends = cooling ? null : sendsChip(dashboard.data.sending, profile.id);
    if (sends) chips.push(sends);
  }
  if (cooling) chips.push(cooling);
  return chips;
}

const abnormal = (chip: StatusChip) => chip.tone === "attention" || chip.tone === "danger";

/**
 * One quiet mono line, not a row of pills: a state that is fine is just words, and only a state
 * that needs a look carries its family's shape, so the line stays silent until it has news. Below
 * the lg breakpoint the header has room for one item, so only the most urgent stays.
 */
export function StatusChips({ chips }: { chips: readonly StatusChip[] }) {
  if (chips.length === 0) return null;
  const urgentId = (mostUrgent(chips) ?? chips[0])?.id;
  return (
    <ul
      aria-label="System status"
      className="m-0 flex list-none items-center gap-3 p-0 font-mono text-caption text-ink-3 lg:[&>li+li]:before:mr-3 lg:[&>li+li]:before:content-['·']"
    >
      {chips.map((chip) => (
        <li key={chip.id} className={chip.id === urgentId ? undefined : "max-lg:hidden"}>
          <Link
            to={chip.to}
            className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-xs transition-colors duration-100 hover:text-ink ${abnormal(chip) ? "text-ink-2" : ""}`}
          >
            {abnormal(chip) ? (
              <StatusShapeGlyph shape={TONE_SHAPE[chip.tone]} className="size-2" />
            ) : null}
            <span>{chip.label.toLowerCase()}</span>
            {chip.value ? <span className="text-ink-2">{chip.value}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The one item the phone top bar has room for, in the same mono words as the desktop line: whichever state most needs a look. */
export function UrgentStatusMark({ chips }: { chips: readonly StatusChip[] }) {
  const chip = mostUrgent(chips);
  if (!chip) return null;
  return (
    <Link
      to={chip.to}
      className="inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-xs px-1 font-mono text-caption text-ink-2"
    >
      <StatusShapeGlyph shape={TONE_SHAPE[chip.tone]} className="size-2.5" />
      <span>{chip.label.toLowerCase()}</span>
      {chip.value ? <span>{chip.value}</span> : null}
    </Link>
  );
}
