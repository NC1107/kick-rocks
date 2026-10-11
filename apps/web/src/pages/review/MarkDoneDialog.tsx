import { API_ROUTES, type FormOutcome, type TaskSummary } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Button,
  Dialog,
  Field,
  InlineError,
  Select,
  Textarea,
  useToast,
} from "../../components/ui/index.js";
import { canReportOutcome, OUTCOME_CHOICES, REVIEW_INVALIDATES } from "./model.js";

/** A person did the work by hand: says how it ended, so the request moves to the right state. */
export function MarkDoneDialog({
  open,
  onClose,
  task,
  title = "Mark this task done",
}: {
  open: boolean;
  onClose: () => void;
  task: Pick<TaskSummary, "id" | "kind" | "requestId">;
  title?: string;
}) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<FormOutcome>("submitted");
  const [note, setNote] = useState("");
  const reportsOutcome = canReportOutcome(task);

  const markDone = useApiMutation(API_ROUTES.taskMarkDone, {
    invalidates: [...REVIEW_INVALIDATES, API_ROUTES.agentsList],
    onSuccess: () => {
      close();
      toast.success("Marked done");
    },
  });
  function close() {
    onClose();
    markDone.reset();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description="Say how it ended, so the request moves to the right state."
      dismissible={!markDone.isPending}
      footer={
        <>
          <Button onClick={close} disabled={markDone.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={markDone.isPending}
            onClick={() =>
              markDone.mutate({
                params: { id: task.id },
                body: {
                  ...(reportsOutcome ? { result: { outcome } } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                },
              })
            }
          >
            Mark done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {reportsOutcome ? (
          <Field
            label="How did it end"
            help={OUTCOME_CHOICES.find((choice) => choice.value === outcome)?.hint}
          >
            <Select
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as FormOutcome)}
            >
              {OUTCOME_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Note" optional help="Shown on the request timeline.">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={3}
          />
        </Field>
        {markDone.isError ? <InlineError>{errorMessage(markDone.error)}</InlineError> : null}
      </div>
    </Dialog>
  );
}
