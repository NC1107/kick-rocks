import type { Difficulty as DifficultyLevel } from "@kickrocks/shared";
import { DIFFICULTY_LABELS } from "../../lib/labels.js";

/** A mono word like Priority: most targets are hard, so a tag or a tone would paint the whole list. */
export function Difficulty({ difficulty }: { difficulty: DifficultyLevel }) {
  return (
    <span className="font-mono text-meta text-ink-2">
      {DIFFICULTY_LABELS[difficulty].toLowerCase()}
    </span>
  );
}
