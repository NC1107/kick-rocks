import type { RecipeHealth } from "@kickrocks/shared";
import { StatusShapeGlyph } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { RECIPE_HEALTH_LABELS } from "../../lib/labels.js";
import type { StatusShape } from "../../lib/status.js";

const HEALTH_SHAPE: Record<RecipeHealth, StatusShape> = {
  unknown: "dashed-ring",
  healthy: "disc",
  broken: "square",
};

/** The state of one automated step. A target with no saved step for it shows a muted dash. */
export function HealthMark({ health }: { health: RecipeHealth | null }) {
  if (health === null) return <span className="text-ink-3">-</span>;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-meta">
      <StatusShapeGlyph shape={HEALTH_SHAPE[health]} />
      <span className={cn(health === "broken" ? "font-medium text-danger-text" : "text-ink-2")}>
        {RECIPE_HEALTH_LABELS[health]}
      </span>
    </span>
  );
}
