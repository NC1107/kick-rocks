import type { Requirement } from "@kickrocks/shared";
import { Badge } from "../../components/ui/index.js";
import { REQUIREMENT_LABELS } from "../../lib/labels.js";

/** Requirements that ask something of a person, as opposed to ones the automation can meet. */
const HUMAN_STEPS: ReadonlySet<Requirement> = new Set([
  "captcha",
  "phone_call",
  "id_upload",
  "account",
  "paid",
  "postal_mail",
  "fax",
]);

export function RequirementBadges({
  requirements,
  max,
}: {
  requirements: readonly Requirement[];
  max?: number;
}) {
  if (requirements.length === 0) return <span className="text-sm text-ink-faint">None</span>;
  const shown = max === undefined ? requirements : requirements.slice(0, max);
  const hidden = requirements.length - shown.length;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((requirement) => (
        <Badge key={requirement} tone={HUMAN_STEPS.has(requirement) ? "amber" : "neutral"}>
          {REQUIREMENT_LABELS[requirement]}
        </Badge>
      ))}
      {hidden > 0 ? <Badge variant="outline">+{hidden}</Badge> : null}
    </span>
  );
}
