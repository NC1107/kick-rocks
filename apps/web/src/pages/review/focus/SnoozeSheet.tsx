import { Dialog } from "../../../components/ui/index.js";
import { WORDS } from "./copy.js";
import { type SnoozePreset, snoozePresets } from "./model.js";

const CLOCK = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** Four times to come back at. The list is worked out when the sheet opens, in the person's own time zone. */
export function SnoozeSheet({
  open,
  onClose,
  onPick,
  now,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (preset: SnoozePreset) => void;
  now: () => Date;
}) {
  const presets = open ? snoozePresets(now()) : [];
  return (
    <Dialog open={open} onClose={onClose} title={WORDS.snoozeTitle} size="sm">
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {presets.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              onClick={() => onPick(preset)}
              className="flex min-h-control w-full items-center justify-between gap-3 rounded-sm border border-line-strong px-3 text-left text-ui text-ink hover:bg-hover focus-visible:-outline-offset-2 pointer-coarse:min-h-11"
            >
              {preset.label}
              <span className="font-mono text-meta text-ink-3">{CLOCK.format(preset.until)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
