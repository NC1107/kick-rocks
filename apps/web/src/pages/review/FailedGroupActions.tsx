import { API_ROUTES, type BlockedTaskItem } from "@kickrocks/shared";
import { useState } from "react";
import { useApiMutation } from "../../api/index.js";
import {
  Button,
  ConfirmDialog,
  InlineError,
  Section,
  useToast,
} from "../../components/ui/index.js";
import { pluralize } from "../../lib/format.js";
import { REVIEW_INVALIDATES } from "./model.js";

/** Retry or dismiss every task that failed the same way, so one click covers many. */
export function FailedGroupActions({
  items,
  label,
}: {
  items: readonly BlockedTaskItem[];
  label: string;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<"retry" | "dismiss" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const options = { invalidates: REVIEW_INVALIDATES };
  const retry = useApiMutation(API_ROUTES.taskRetry, options);
  const dismiss = useApiMutation(API_ROUTES.taskCancel, options);

  const runAll = async (action: "retry" | "dismiss") => {
    setBusy(true);
    const call = action === "retry" ? retry : dismiss;
    const results = await Promise.allSettled(
      items.map((item) => call.mutateAsync({ params: { id: item.task.id } })),
    );
    setBusy(false);
    setConfirming(null);
    const failed = results.filter((result) => result.status === "rejected").length;
    const done = results.length - failed;
    const verb = action === "retry" ? "queued to retry" : "dismissed";
    if (failed === 0) {
      setProblem(null);
      toast.success(`${pluralize(done, "task")} ${verb}`);
    } else {
      setProblem(`${pluralize(failed, "task")} could not be changed. ${done} ${verb}.`);
    }
  };

  return (
    <Section label="Failed the same way" count={items.length} as="h3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setConfirming("retry")}>
          Retry all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming("dismiss")}>
          Dismiss all
        </Button>
      </div>
      {problem ? <InlineError className="mt-2">{problem}</InlineError> : null}

      <ConfirmDialog
        open={confirming === "retry"}
        onClose={() => setConfirming(null)}
        title={`Retry ${pluralize(items.length, "task")}?`}
        description={`Each one is queued to run again. Cause: ${label.toLowerCase()}.`}
        confirmLabel="Retry all"
        loading={busy}
        onConfirm={() => runAll("retry")}
      />
      <ConfirmDialog
        open={confirming === "dismiss"}
        onClose={() => setConfirming(null)}
        title={`Dismiss ${pluralize(items.length, "task")}?`}
        description="They leave the review queue. The requests keep their place, but nothing will try these tasks again."
        confirmLabel="Dismiss all"
        cancelLabel="Keep them"
        destructive
        loading={busy}
        onConfirm={() => runAll("dismiss")}
      />
    </Section>
  );
}
