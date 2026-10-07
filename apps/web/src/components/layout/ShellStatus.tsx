import { API_ROUTES } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useApiQuery, useCurrentProfile } from "../../api/index.js";
import { cn } from "../../lib/cn.js";
import { shortRelative } from "../../lib/format.js";
import { TONE_SHAPE } from "../../lib/status.js";
import { useNow } from "../../lib/use-now.js";
import { StatusShapeGlyph, Tooltip } from "../ui/index.js";
import { inboxChip, mostUrgent, type StatusChip, sendsChip, workerChip } from "./shell-status.js";

const REFRESH_MS = 30_000;

/** Live system state for the header: the worker, the inbox, and today's sending. */
export function useShellStatus(): StatusChip[] {
  const { profile } = useCurrentProfile();
  const settings = useApiQuery(API_ROUTES.settingsGet, { refetchInterval: REFRESH_MS });
  const dashboard = useApiQuery(
    API_ROUTES.dashboardGet,
    profile ? { params: { id: profile.id }, refetchInterval: REFRESH_MS } : skipToken,
  );
  const now = useNow();
  const chips: StatusChip[] = [];
  if (settings.data) chips.push(workerChip(settings.data.worker, now));
  if (dashboard.data) {
    chips.push(inboxChip(dashboard.data.mailbox, (iso) => shortRelative(iso, now)));
    const sends = sendsChip(dashboard.data.sending);
    if (sends) chips.push(sends);
  }
  return chips;
}

function chipText(chip: StatusChip): string {
  return chip.value ? `${chip.label} ${chip.value}` : chip.label;
}

/**
 * Each chip leads with the shape of its family, not a bare dot, so a worker that is online and a
 * send that failed differ without color. That is also why there is no halo: a halo on a triangle
 * or a square would blur the very edge that tells them apart. Below the lg breakpoint the header
 * has room for one chip, so only the most urgent stays.
 */
export function StatusChips({ chips }: { chips: readonly StatusChip[] }) {
  if (chips.length === 0) return null;
  const urgentId = (mostUrgent(chips) ?? chips[0])?.id;
  return (
    <ul aria-label="System status" className="m-0 flex list-none items-center gap-2 p-0">
      {chips.map((chip) => (
        <li
          key={chip.id}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border border-line px-2.5 text-caption text-ink-2",
            chip.id === urgentId ? undefined : "max-lg:hidden",
          )}
        >
          <StatusShapeGlyph shape={TONE_SHAPE[chip.tone]} className="size-2" />
          <span>{chip.label}</span>
          {chip.value ? <span className="font-mono text-ink">{chip.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** The one mark the phone top bar has room for: whichever state most needs a look. */
export function UrgentStatusMark({ chips }: { chips: readonly StatusChip[] }) {
  const chip = mostUrgent(chips);
  if (!chip) return null;
  return (
    <Tooltip content={chipText(chip)}>
      <button
        type="button"
        aria-label={chipText(chip)}
        className="flex size-11 items-center justify-center rounded-xs"
      >
        <StatusShapeGlyph shape={TONE_SHAPE[chip.tone]} className="size-2.5" />
      </button>
    </Tooltip>
  );
}
