import type { ListingSite } from "@kickrocks/shared";
import { Ellipsis } from "lucide-react";
import { useNavigate } from "react-router";
import { IconButton, Menu, type MenuItem } from "../../../components/ui/index.js";
import { paths } from "../../../lib/paths.js";
import { useSitePreference } from "./scanning.js";

const PAUSE_DAYS = 30;

/** The day a pause of a set length ends on the person's own calendar, as YYYY-MM-DD. */
export function pauseEnd(days: number = PAUSE_DAYS): string {
  const end = new Date(Date.now() + days * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

/** What can be done to one site from its row: scan it now, pause it, skip it, or change its cadence. */
export function SiteMenu({
  site,
  profileId,
  onScan,
}: {
  site: ListingSite;
  profileId: string;
  onScan: () => void;
}) {
  const navigate = useNavigate();
  const preference = useSitePreference(profileId, site.targetId);
  const { mode } = site.preference;

  const items: MenuItem[] = [
    mode === "skipped"
      ? {
          id: "unskip",
          label: "Unskip and scan",
          disabled: preference.pending,
          onSelect: () => preference.set({ mode: "auto" }, onScan),
        }
      : { id: "scan", label: "Scan now", onSelect: onScan },
    mode === "paused"
      ? {
          id: "resume",
          label: "Resume",
          disabled: preference.pending,
          onSelect: () => preference.set({ mode: "auto" }),
        }
      : {
          id: "pause",
          label: `Pause for ${PAUSE_DAYS} days`,
          disabled: preference.pending || mode === "skipped",
          onSelect: () => preference.set({ mode: "paused", pausedUntil: pauseEnd() }),
        },
    ...(mode === "skipped"
      ? []
      : [
          {
            id: "skip",
            label: "Skip this site",
            disabled: preference.pending,
            onSelect: () => preference.set({ mode: "skipped" }),
          },
        ]),
    {
      id: "cadence",
      label: "Rescan every...",
      separatorBefore: true,
      onSelect: () => navigate(`${paths.target(site.targetId)}#your-listing`),
    },
  ];

  return (
    <Menu
      align="end"
      items={items}
      trigger={(props) => (
        <IconButton
          label={`More for ${site.targetName}`}
          className="pointer-coarse:size-11"
          {...props}
        >
          <Ellipsis />
        </IconButton>
      )}
    />
  );
}
