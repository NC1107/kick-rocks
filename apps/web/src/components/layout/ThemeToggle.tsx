import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { type ThemePreference, useTheme } from "../../lib/theme.js";
import { Tooltip } from "../ui/index.js";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match system theme", icon: Monitor },
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
];

/** System, light, or dark. The choice lives in localStorage and applies before first paint. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <fieldset
      className={cn("m-0 inline-flex rounded-md border border-line bg-surface p-0.5", className)}
    >
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = preference === value;
        return (
          <Tooltip key={value} content={label}>
            <button
              type="button"
              aria-pressed={selected}
              aria-label={label}
              onClick={() => setPreference(value)}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-sm transition-colors duration-100 max-sm:size-11",
                selected
                  ? "bg-accent-soft text-accent-soft-ink"
                  : "text-ink-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
            </button>
          </Tooltip>
        );
      })}
    </fieldset>
  );
}
