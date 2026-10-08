import type { Requirement } from "@kickrocks/shared";
import { Tag } from "../../components/ui/index.js";
import { REQUIREMENT_LABELS } from "../../lib/labels.js";

/** Requirements that ask something of a person, as opposed to ones the automation can meet. */
export const HUMAN_STEPS: ReadonlySet<Requirement> = new Set([
  "captcha",
  "phone_call",
  "id_upload",
  "account",
  "paid",
  "postal_mail",
  "fax",
]);

/** Only what the person has to do gets a tag. Everything the automation handles stays quiet. */
export function RequirementBadges({
  requirements,
  max,
}: {
  requirements: readonly Requirement[];
  max?: number;
}) {
  const needed = requirements.filter((requirement) => HUMAN_STEPS.has(requirement));
  if (needed.length === 0) return <span className="text-ink-3">-</span>;
  const shown = max === undefined ? needed : needed.slice(0, max);
  const hidden = needed.length - shown.length;
  return (
    <span className="flex flex-nowrap items-center gap-1">
      {shown.map((requirement) => (
        <Tag key={requirement} tone="attention">
          {REQUIREMENT_LABELS[requirement]}
        </Tag>
      ))}
      {hidden > 0 ? <span className="font-mono text-meta text-ink-3">+{hidden}</span> : null}
    </span>
  );
}
