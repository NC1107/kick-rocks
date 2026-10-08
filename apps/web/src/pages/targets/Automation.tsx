import type { RecipeHealth } from "@kickrocks/shared";
import { StatusShapeGlyph } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { RECIPE_HEALTH_LABELS } from "../../lib/labels.js";
import type { StatusShape } from "../../lib/status.js";

const HEALTH_MEANINGS: Record<RecipeHealth | "none", string> = {
  none: "No approved recipe, so a person or an agent does this step.",
  unknown: "A recipe is approved but has not been run or checked yet.",
  healthy: "The recipe's last run or site check worked.",
  broken: "The recipe's last run or site check failed, so it needs a new version.",
};

const HEALTH_SHAPE: Record<RecipeHealth, StatusShape> = {
  unknown: "dashed-ring",
  healthy: "disc",
  broken: "square",
};

/** The state of one automated step. A target with no saved step for it shows a muted dash. */
export function HealthMark({ health }: { health: RecipeHealth | null }) {
  if (health === null) {
    return (
      <span className="text-ink-3" title={HEALTH_MEANINGS.none}>
        -
      </span>
    );
  }
  return (
    <span
      title={HEALTH_MEANINGS[health]}
      className="inline-flex items-center gap-2 whitespace-nowrap text-meta"
    >
      <StatusShapeGlyph shape={HEALTH_SHAPE[health]} />
      <span className={cn(health === "broken" ? "font-medium text-danger-text" : "text-ink-2")}>
        {RECIPE_HEALTH_LABELS[health]}
      </span>
    </span>
  );
}

const LEGEND: readonly { term: string; meaning: string }[] = [
  { term: "Scan", meaning: "Looks for you on a people-search site." },
  { term: "Removal", meaning: "Fills in the site's opt-out form for you." },
  { term: "No recipe", meaning: HEALTH_MEANINGS.none },
  { term: RECIPE_HEALTH_LABELS.unknown, meaning: HEALTH_MEANINGS.unknown },
  { term: RECIPE_HEALTH_LABELS.healthy, meaning: HEALTH_MEANINGS.healthy },
  { term: RECIPE_HEALTH_LABELS.broken, meaning: HEALTH_MEANINGS.broken },
];

/** Explains the Scan and Removal columns, which show only from the large breakpoint up. */
export function AutomationLegend() {
  return (
    <details className="mb-2.5 hidden rounded-md border border-line px-3.5 py-2 text-meta text-ink-2 lg:block">
      <summary className="cursor-pointer rounded-xs text-ui font-medium text-ink">
        What do the Scan and Removal marks mean?
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
