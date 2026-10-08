import type { TargetPriority } from "@kickrocks/shared";
import { cn } from "../../lib/cn.js";
import { PRIORITY_LABELS } from "../../lib/labels.js";

/** A mono word, never a tinted pill: only a crucial target stands out from the rest. */
export function Priority({ priority }: { priority: TargetPriority }) {
  return (
    <span
      className={cn(
        "font-mono text-meta",
        priority === "crucial" ? "font-semibold text-ink" : "text-ink-2",
      )}
    >
      {PRIORITY_LABELS[priority].toLowerCase()}
    </span>
  );
}
