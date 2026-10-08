import type { RecipeHealth } from "@kickrocks/shared";
import { Badge } from "../../components/ui/index.js";
import { RECIPE_HEALTH_LABELS, RECIPE_HEALTH_TONES } from "../../lib/labels.js";

const HEALTH_MEANINGS: Record<RecipeHealth | "none", string> = {
  none: "No approved recipe, so a person or an agent does this step.",
  unknown: "A recipe is approved but has not been run or checked yet.",
  healthy: "The recipe's last run or site check worked.",
  broken: "The recipe's last run or site check failed, so it needs a new version.",
};

function Line({ purpose, health }: { purpose: string; health: RecipeHealth | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-16 text-sm text-ink-muted">{purpose}</span>
      {health ? (
        <span title={HEALTH_MEANINGS[health]}>
          <Badge tone={RECIPE_HEALTH_TONES[health]}>{RECIPE_HEALTH_LABELS[health]}</Badge>
        </span>
      ) : (
        <span className="text-sm text-ink-faint" title={HEALTH_MEANINGS.none}>
          None
        </span>
      )}
    </span>
  );
}

/** Which of a target's scan and removal steps are automated, and whether they still work. */
export function Automation({
  scan,
  remove,
}: {
  scan: RecipeHealth | null;
  remove: RecipeHealth | null;
}) {
  return (
    <span className="flex flex-col gap-1">
      <Line purpose="Scan" health={scan} />
      <Line purpose="Removal" health={remove} />
    </span>
  );
}

const LEGEND: readonly { term: string; meaning: string }[] = [
  { term: "Scan", meaning: "Looks for you on a people-search site." },
  { term: "Removal", meaning: "Fills in the site's opt-out form for you." },
  { term: "None", meaning: HEALTH_MEANINGS.none },
  { term: "Not checked", meaning: HEALTH_MEANINGS.unknown },
  { term: "Healthy", meaning: HEALTH_MEANINGS.healthy },
  { term: "Broken", meaning: HEALTH_MEANINGS.broken },
];

/** Explains the Automation column, which shows only from the large breakpoint up. */
export function AutomationLegend() {
  return (
    <details className="mb-3 hidden rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-ink-muted lg:block">
      <summary className="cursor-pointer rounded-xs font-medium text-ink">
        What do the Scan and Removal badges mean?
      </summary>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {LEGEND.map((entry) => (
          <div key={entry.term} className="contents">
            <dt className="font-medium text-ink">{entry.term}</dt>
            <dd>{entry.meaning}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3">
        Site checks in Settings are off until you turn them on, so a recipe stays Not checked until
        it has run for you or a check has visited the site.
      </p>
    </details>
  );
}
