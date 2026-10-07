import { API_ROUTES, type BlockedTaskItem } from "@kickrocks/shared";
import { useState } from "react";
import { useApiMutation } from "../../api/index.js";
import { Alert, Button, ConfirmDialog, useToast } from "../../components/ui/index.js";
import { describeFailure, type FailureGroup, GROUP_LABELS } from "../../lib/failures.js";
import { pluralize } from "../../lib/format.js";
import { BlockedTaskCard } from "./BlockedTaskCard.js";
import { REVIEW_INVALIDATES } from "./model.js";

interface Group {
  group: FailureGroup;
  items: BlockedTaskItem[];
}

/** Failed tasks sorted by cause, biggest group first, so one fix or one click covers many. */
export function groupFailures(items: readonly BlockedTaskItem[]): Group[] {
  const groups = new Map<FailureGroup, BlockedTaskItem[]>();
  for (const item of items) {
    const { group } = describeFailure(item.task);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return [...groups]
    .map(([group, grouped]) => ({ group, items: grouped }))
    .sort((a, b) => b.items.length - a.items.length || a.group.localeCompare(b.group));
}

export function FailedTasks({
  items,
  profileId,
}: {
  items: readonly BlockedTaskItem[];
  profileId: string;
}) {
  const groups = groupFailures(items);
  return (
    <div className="flex flex-col gap-6">
      <Alert intent="warning" title="These tasks gave up">
        Nothing retries them on its own. Retry one, or open the page and finish it yourself. Dismiss
        what you no longer need.
      </Alert>
      {groups.map((group) => (
        <FailureGroupSection key={group.group} group={group} profileId={profileId} />
      ))}
    </div>
  );
}

function FailureGroupSection({ group, profileId }: { group: Group; profileId: string }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<"retry" | "dismiss" | null>(null);
  const [busy, setBusy] = useState(false);
  const options = { invalidates: REVIEW_INVALIDATES };
  const retry = useApiMutation(API_ROUTES.taskRetry, options);
  const dismiss = useApiMutation(API_ROUTES.taskCancel, options);
  const label = GROUP_LABELS[group.group];

  const runAll = async (action: "retry" | "dismiss") => {
    setBusy(true);
    const call = action === "retry" ? retry : dismiss;
    const results = await Promise.allSettled(
      group.items.map((item) => call.mutateAsync({ params: { id: item.task.id } })),
    );
    setBusy(false);
    setConfirming(null);
    const failed = results.filter((result) => result.status === "rejected").length;
    const done = results.length - failed;
    const verb = action === "retry" ? "queued to retry" : "dismissed";
    if (failed === 0) toast.success(`${pluralize(done, "task")} ${verb}`);
    else toast.error(`${pluralize(failed, "task")} could not be changed`, `${done} ${verb}.`);
  };

  return (
    <section aria-label={label} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-semibold text-ink">
          {label} <span className="font-normal text-ink-muted">({group.items.length})</span>
        </h2>
        {group.items.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirming("retry")}>
              Retry all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming("dismiss")}>
              Dismiss all
            </Button>
          </div>
        ) : null}
      </div>
      {group.items.map((item) => (
        <BlockedTaskCard
          key={item.task.id}
          item={item}
          variant="failed"
          profileId={profileId}
          nested
        />
      ))}

      <ConfirmDialog
        open={confirming === "retry"}
        onClose={() => setConfirming(null)}
        title={`Retry ${pluralize(group.items.length, "task")}?`}
        description={`Each one is queued to run again. Group: ${label.toLowerCase()}.`}
        confirmLabel="Retry all"
        loading={busy}
        onConfirm={() => runAll("retry")}
      />
      <ConfirmDialog
        open={confirming === "dismiss"}
        onClose={() => setConfirming(null)}
        title={`Dismiss ${pluralize(group.items.length, "task")}?`}
        description="They leave the review queue. The requests keep their place, but nothing will try these tasks again."
        confirmLabel="Dismiss all"
        cancelLabel="Keep them"
        destructive
        loading={busy}
        onConfirm={() => runAll("dismiss")}
      />
    </section>
  );
}
