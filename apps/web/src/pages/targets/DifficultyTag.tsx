import type { Difficulty } from "@kickrocks/shared";
import { Tag } from "../../components/ui/index.js";
import { DIFFICULTY_LABELS } from "../../lib/labels.js";

/** Neutral for every level: most targets are hard, so a tone would paint the whole list. */
export function DifficultyTag({ difficulty }: { difficulty: Difficulty }) {
  return <Tag>{DIFFICULTY_LABELS[difficulty].toLowerCase()}</Tag>;
}
