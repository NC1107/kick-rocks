import type { BlockedTaskItem } from "@kickrocks/shared";
import { API_ROUTES } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, screenshotUrl, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  ConfirmDialog,
  EntityLink,
  ExternalLinkText,
  Hatch,
  RelativeTime,
  Section,
  TaskStatusMark,
  TextLink,
  useToast,
} from "../../components/ui/index.js";
import { describeFailure } from "../../lib/failures.js";
import { TASK_KIND_LABELS } from "../../lib/labels.js";
import { paths } from "../../lib/paths.js";
import { AgentPanel } from "../assign/AgentPanel.js";
import { DetailFrame } from "./DetailFrame.js";
import { FailedGroupActions } from "./FailedGroupActions.js";
import { Chips } from "./focus/Chips.js";
import { headlineFor } from "./headline.js";
import { MarkDoneDialog } from "./MarkDoneDialog.js";
import { canReportOutcome, REVIEW_INVALIDATES } from "./model.js";
import { SentLog } from "./SentLog.js";

function Screenshot({ taskId }: { taskId: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Hatch className="px-3 py-8">The screenshot could not be loaded.</Hatch>;
  // The task stores no image size, so the box is reserved up front and the sections below stay put.
  return (
    <a
      href={screenshotUrl(taskId)}
      target="_blank"
      rel="noopener noreferrer"
      className="block aspect-4/3 max-h-72 overflow-auto rounded-sm border border-line bg-canvas"
    >
      <img
        src={screenshotUrl(taskId)}
        alt="The page where the task stopped"
        loading="lazy"
        onError={() => setFailed(true)}
        className="mx-auto h-auto w-full max-w-full object-contain"
      />
      <span className="sr-only">(opens the full screenshot in a new tab)</span>
    </a>
  );
}

/**
 * The detail of a row on the Problems or Agents page: a task that failed for good, or one that
 * waits for an agent. Tasks that wait for the person are handled one at a time in Needs you.
 */
export function BlockedTaskDetail({
  item,
  variant,
  profileId,
  siblings = [],
}: {
  item: BlockedTaskItem;
  variant: "failed" | "agent";
  profileId: string;
  /** Failed tasks that failed the same way, this one included, for retrying or dismissing together. */
  siblings?: readonly BlockedTaskItem[];
}) {
  const { task } = item;
  const toast = useToast();
  const [doneOpen, setDoneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const logs = useApiQuery(API_ROUTES.taskSends, {
    params: { id: task.id },
    enabled: task.kind === "agent",
  });
  const log = logs.data;
  const options = { invalidates: REVIEW_INVALIDATES };

  const retry = useApiMutation(API_ROUTES.taskRetry, {
    ...options,
    onSuccess: () => toast.success("Queued to retry"),
  });
  const cancel = useApiMutation(API_ROUTES.taskCancel, {
    ...options,
    onSuccess: () => {
      setCancelOpen(false);
      toast.success(variant === "failed" ? "Dismissed" : "Task cancelled");
    },
    onError: () => setCancelOpen(false),
  });
  const busy = retry.isPending || cancel.isPending;
  const footerError = [retry, cancel].find((mutation) => mutation.isError)?.error;
  const failure = variant === "failed" ? describeFailure(task) : null;

  const meta = (
    <>
      {TASK_KIND_LABELS[task.kind]}
      {item.requestReference ? (
        <>
          {" for request "}
          <EntityLink
            to={{ kind: "request", id: task.requestId, reference: item.requestReference }}
          />
        </>
      ) : null}
      {", updated "}
      <RelativeTime iso={task.updatedAt} />
    </>
  );

  const footer =
    variant === "agent" ? (
      <>
        <Button variant="primary" onClick={() => setDoneOpen(true)} disabled={busy}>
          Mark done
        </Button>
        <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
          Cancel task
        </Button>
      </>
    ) : (
      <>
        <Button
          variant="primary"
          loading={retry.isPending}
          disabled={busy && !retry.isPending}
          onClick={() => retry.mutate({ params: { id: task.id } })}
        >
          Retry
        </Button>
        <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
          Dismiss
        </Button>
      </>
    );

  return (
    <>
      <DetailFrame
        label={`${task.targetName ?? "Task"}, ${TASK_KIND_LABELS[task.kind]}`}
        title={
          task.targetName ? (
            <EntityLink
              to={{ kind: "target", id: task.targetId, name: task.targetName }}
              variant="quiet"
            />
          ) : (
            "Unknown target"
          )
        }
        meta={meta}
        headline={headlineFor({
          kind: variant === "agent" ? "agents" : "failed",
          key: task.id,
          item,
        })}
        footer={footer}
        error={footerError ? errorMessage(footerError) : undefined}
      >
        {variant === "failed" ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <TaskStatusMark status={task.status} />
          </div>
        ) : (
          <AgentPanel task={task} layout="section" />
        )}

        {failure ? <p className="break-words text-body text-ink">{failure.detail}</p> : null}

        {task.hasScreenshot ? <Screenshot taskId={task.id} /> : null}

        {item.url || failure?.needsProfile ? (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-ui">
            {item.url ? (
              <ExternalLinkText href={item.url} className="break-all">
                Open the page
              </ExternalLinkText>
            ) : null}
            {failure?.needsProfile ? (
              <TextLink to={paths.profile(profileId)}>Open the profile to add it</TextLink>
            ) : null}
          </p>
        ) : null}

        {variant === "agent" && canReportOutcome(task) ? (
          <Section label="Details to type in" as="h3">
            <Chips profileId={profileId} fields={["full_name", "email"]} />
          </Section>
        ) : null}

        {log ? (
          <SentLog
            log={log}
            target={task.targetName ? { id: task.targetId, name: task.targetName } : undefined}
          />
        ) : null}

        {variant === "failed" && siblings.length > 1 ? (
          <FailedGroupActions items={siblings} label={failure?.label ?? ""} />
        ) : null}
      </DetailFrame>

      <MarkDoneDialog
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        task={task}
        title="Finish this task yourself"
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={variant === "failed" ? "Dismiss this task?" : "Cancel this task?"}
        description="Nothing will try it again."
        confirmLabel={variant === "failed" ? "Dismiss" : "Cancel task"}
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate({ params: { id: task.id } })}
      />
    </>
  );
}
