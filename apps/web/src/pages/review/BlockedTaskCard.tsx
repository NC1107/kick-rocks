import type { BlockedTaskItem, FormOutcome } from "@kickrocks/shared";
import { API_ROUTES } from "@kickrocks/shared";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, screenshotUrl, useApiMutation } from "../../api/index.js";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  ExternalLinkText,
  Field,
  Select,
  TaskStatusPill,
  Textarea,
  useToast,
} from "../../components/ui/index.js";
import { formatRelative } from "../../lib/format.js";
import { BLOCKED_REASON_LABELS, FAILURE_KIND_LABELS, TASK_KIND_LABELS } from "../../lib/labels.js";
import {
  canHandOff,
  canReportOutcome,
  instructionSteps,
  OUTCOME_CHOICES,
  REVIEW_INVALIDATES,
} from "./model.js";

function Screenshot({ taskId }: { taskId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-6 text-sm text-ink-muted">
        <ImageOff aria-hidden="true" className="size-4 shrink-0" />
        The screenshot could not be loaded.
      </p>
    );
  }
  return (
    <a
      href={screenshotUrl(taskId)}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded-md border border-line bg-sunken"
    >
      <img
        src={screenshotUrl(taskId)}
        alt="The page where the task stopped"
        loading="lazy"
        onError={() => setFailed(true)}
        className="mx-auto max-h-72 w-full object-contain"
      />
      <span className="sr-only">(opens the full screenshot in a new tab)</span>
    </a>
  );
}

export function BlockedTaskCard({
  item,
  variant,
}: {
  item: BlockedTaskItem;
  variant: "blocked" | "failed";
}) {
  const { task } = item;
  const toast = useToast();
  const [doneOpen, setDoneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [outcome, setOutcome] = useState<FormOutcome>("submitted");
  const [note, setNote] = useState("");

  const options = { invalidates: REVIEW_INVALIDATES };
  const fail = (error: Parameters<typeof errorMessage>[0]) =>
    toast.error("That did not work", errorMessage(error));

  const resume = useApiMutation(API_ROUTES.taskResume, {
    ...options,
    onSuccess: () => toast.success("Task resumed"),
    onError: fail,
  });
  const handOff = useApiMutation(API_ROUTES.taskHandOff, {
    ...options,
    onSuccess: () => toast.success("Handed to an agent"),
    onError: fail,
  });
  const retry = useApiMutation(API_ROUTES.taskRetry, {
    ...options,
    onSuccess: () => toast.success("Task queued to retry"),
    onError: fail,
  });
  const cancel = useApiMutation(API_ROUTES.taskCancel, {
    ...options,
    onSuccess: () => {
      setCancelOpen(false);
      toast.success("Task cancelled");
    },
    onError: (error) => {
      setCancelOpen(false);
      fail(error);
    },
  });
  const markDone = useApiMutation(API_ROUTES.taskMarkDone, {
    ...options,
    onSuccess: () => {
      setDoneOpen(false);
      toast.success("Marked done");
    },
    onError: fail,
  });

  const reportsOutcome = canReportOutcome(task);
  const steps = instructionSteps(item.manualInstructions);
  const busy =
    resume.isPending ||
    handOff.isPending ||
    retry.isPending ||
    cancel.isPending ||
    markDone.isPending;
  const detail = variant === "failed" ? task.lastError : (task.blockedDetail ?? null);
  const pill = (
    <span className="flex flex-wrap items-center gap-2">
      {variant === "failed" ? <TaskStatusPill status={task.status} /> : null}
      {variant === "blocked" && task.blockedReason ? (
        <Badge tone="amber">{BLOCKED_REASON_LABELS[task.blockedReason]}</Badge>
      ) : null}
      {variant === "failed" && task.failureKind ? (
        <Badge tone="red">{FAILURE_KIND_LABELS[task.failureKind]}</Badge>
      ) : null}
    </span>
  );

  return (
    <Card aria-label={`${task.targetName ?? "Task"}, ${TASK_KIND_LABELS[task.kind]}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="break-words text-lg font-semibold text-ink">
            {task.targetName ?? "Unknown target"}
          </h3>
          <p className="text-sm text-ink-muted">
            {TASK_KIND_LABELS[task.kind]}
            {item.requestReference ? (
              <>
                {" for request "}
                {task.requestId ? (
                  <Link
                    to={`/requests/${encodeURIComponent(task.requestId)}`}
                    className="rounded-xs font-mono text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                  >
                    {item.requestReference}
                  </Link>
                ) : (
                  <span className="font-mono">{item.requestReference}</span>
                )}
              </>
            ) : null}
            {", updated "}
            <time dateTime={task.updatedAt}>{formatRelative(task.updatedAt)}</time>
          </p>
        </div>
        {pill}
      </div>

      {detail ? <p className="mt-3 break-words text-base text-ink">{detail}</p> : null}

      {task.hasScreenshot ? (
        <div className="mt-4">
          <Screenshot taskId={task.id} />
        </div>
      ) : null}

      <div className="mt-4 rounded-md bg-sunken p-3.5">
        <h4 className="mb-1.5 text-sm font-semibold text-ink">
          {variant === "blocked" ? "What to do" : "What happened"}
        </h4>
        {steps.length > 1 ? (
          <ol className="m-0 list-decimal pl-5 text-base text-ink">
            {steps.map((step) => (
              <li key={step} className="py-0.5">
                {step}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-base text-ink">{steps[0]}</p>
        )}
        {item.url ? (
          <p className="mt-2.5 text-base">
            <ExternalLinkText href={item.url} className="break-all">
              Open the page
            </ExternalLinkText>
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {variant === "blocked" ? (
          <>
            <Button variant="primary" onClick={() => setDoneOpen(true)} disabled={busy}>
              Mark done
            </Button>
            <Button
              loading={resume.isPending}
              disabled={busy && !resume.isPending}
              onClick={() => resume.mutate({ params: { id: task.id } })}
            >
              Resume
            </Button>
            {canHandOff(task) ? (
              <Button
                loading={handOff.isPending}
                disabled={busy && !handOff.isPending}
                onClick={() => handOff.mutate({ params: { id: task.id } })}
              >
                Hand to an agent
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
              Cancel task
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            loading={retry.isPending}
            disabled={busy && !retry.isPending}
            onClick={() => retry.mutate({ params: { id: task.id } })}
          >
            Retry
          </Button>
        )}
      </div>

      <Dialog
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        title="Mark this task done"
        description="Say how it ended, so the request moves to the right state."
        dismissible={!markDone.isPending}
        footer={
          <>
            <Button onClick={() => setDoneOpen(false)} disabled={markDone.isPending}>
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
        </div>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this task?"
        description="The request keeps its place, but nothing will try this task again."
        confirmLabel="Cancel task"
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate({ params: { id: task.id } })}
      />
    </Card>
  );
}
