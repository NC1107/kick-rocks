import type { RecipeHealth } from "@kickrocks/shared";
import { Badge } from "../../components/ui/index.js";
import { RECIPE_HEALTH_LABELS, RECIPE_HEALTH_TONES } from "../../lib/labels.js";

function Line({ purpose, health }: { purpose: string; health: RecipeHealth | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-16 text-sm text-ink-muted">{purpose}</span>
      {health ? (
        <Badge tone={RECIPE_HEALTH_TONES[health]}>{RECIPE_HEALTH_LABELS[health]}</Badge>
      ) : (
        <span className="text-sm text-ink-faint">None</span>
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
