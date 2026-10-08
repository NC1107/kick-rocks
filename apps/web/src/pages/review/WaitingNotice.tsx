import { WAIT_REASON_TEXT, type WaitingTask } from "@kickrocks/shared";
import { Alert } from "../../components/ui/index.js";
import { formatDateTime, formatRelative, pluralize } from "../../lib/format.js";

const KIND_LABELS: Record<string, string> = {
  scan: "Scan",
  form: "Removal",
  confirm: "Confirmation",
  canary: "Check",
  agent: "Agent task",
};

/**
 * Tasks that are queued but held back to keep a site from being flagged. They are not stuck and
 * nothing is needed from the person, so this says so instead of leaving them to look lost.
 */
export function WaitingNotice({ items }: { items: readonly WaitingTask[] }) {
  if (items.length === 0) return null;
  return (
    <Alert
      intent="info"
      title={`${pluralize(items.length, "task")} waiting on a site, not failing`}
      className="mb-5"
    >
      <p>Kick Rocks spaces its visits, and lets a site cool down when it pushes back.</p>
      <ul className="mt-2 flex list-none flex-col gap-1 p-0">
        {items.map((item) => (
          <li key={item.taskId} className="text-sm">
            <span className="font-medium">
              {KIND_LABELS[item.kind] ?? item.kind}
              {item.targetName ? ` for ${item.targetName}` : ""}
            </span>
            {": "}
            {WAIT_REASON_TEXT[item.waiting.reason]}. Next try{" "}
            <time dateTime={item.waiting.until} title={formatDateTime(item.waiting.until)}>
              {formatRelative(item.waiting.until)}
            </time>
            .
          </li>
        ))}
      </ul>
    </Alert>
  );
}
