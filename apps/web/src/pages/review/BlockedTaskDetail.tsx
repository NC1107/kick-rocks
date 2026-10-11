import type { BlockedTaskItem, ProfileField } from "@kickrocks/shared";
import { API_ROUTES, resolveProfileFields } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, screenshotUrl, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  ConfirmDialog,
  CopyButton,
  EntityLink,
  ExternalLinkText,
  Hatch,
  RelativeTime,
  Row,
  RowGroup,
  Section,
  Tag,
  TaskStatusMark,
  TextLink,
  useToast,
} from "../../components/ui/index.js";
import { describeFailure } from "../../lib/failures.js";
import { BLOCKED_REASON_LABELS, PROFILE_FIELD_LABELS, TASK_KIND_LABELS } from "../../lib/labels.js";
import { paths } from "../../lib/paths.js";
import { AgentPanel } from "../assign/AgentPanel.js";
import { AssignDialog } from "../assign/AssignDialog.js";
import { DetailFrame } from "./DetailFrame.js";
import { FailedGroupActions } from "./FailedGroupActions.js";
import { HeldSendsPanel } from "./HeldSendsPanel.js";
import { MarkDoneDialog } from "./MarkDoneDialog.js";
import {
  awaitsSubmitApproval,
  canHandOff,
  canReportOutcome,
  instructionSteps,
  REVIEW_INVALIDATES,
  sentWithoutApproval,
} from "./model.js";
import { SentLog } from "./SentLog.js";
import { liveHolds, nextRunHolds } from "./sends-model.js";

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
      <span
        aria-hidden="true"
        className="block border-t border-line px-3 py-1.5 text-caption text-ink-3 sm:hidden"
      >
        Tap to open full size
      </span>
    </a>
  );
}

const IDENTIFIERS_TO_TYPE: readonly ProfileField[] = ["full_name", "email"];

/** The details a person types into the form themselves, one copy button each. */
function ValuesToEnter({ profileId }: { profileId: string }) {
  const profile = useApiQuery(API_ROUTES.profilesGet, { params: { id: profileId } });
  if (!profile.data) return null;
  const values = resolveProfileFields(profile.data.identities, IDENTIFIERS_TO_TYPE, {
    asOf: new Date().toISOString().slice(0, 10),
  });
  const rows = IDENTIFIERS_TO_TYPE.flatMap((field) =>
    values[field] === undefined ? [] : [{ field, value: values[field] }],
  );
  if (rows.length === 0) return null;
  return (
    <Section label="Details to type in" as="h3">
      <RowGroup>
        {rows.map(({ field, value }) => (
          <Row
            key={field}
            title={field === "email" ? <span className="font-mono">{value}</span> : value}
            description={PROFILE_FIELD_LABELS[field]}
            trailing={<CopyButton value={value as string} label="Copy" variant="ghost" />}
          />
        ))}
      </RowGroup>
    </Section>
  );
}

export function BlockedTaskDetail({
  item,
  variant,
  profileId,
  siblings = [],
}: {
  item: BlockedTaskItem;
  variant: "blocked" | "failed" | "agent" | "yours";
  profileId: string;
  /** Failed tasks that failed the same way, this one included, for retrying or dismissing together. */
  siblings?: readonly BlockedTaskItem[];
}) {
  const { task } = item;
  const toast = useToast();
  const settings = useApiQuery(API_ROUTES.settingsGet, { enabled: variant === "blocked" });
  const agentAccessOff = settings.data ? !settings.data.mcp.enabled : false;
  const agentAccessUnknown = variant === "blocked" && settings.data === undefined;
  const [doneOpen, setDoneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [handOffOpen, setHandOffOpen] = useState(false);
  /** The requests the person leaves out when they approve what the last run held. */
  const [declined, setDeclined] = useState<string[]>([]);
  const logs = useApiQuery(API_ROUTES.taskSends, {
    params: { id: task.id },
    enabled: task.kind === "agent",
    refetchInterval: (data) =>
      data?.sends.some((row) => row.status === "pending_live") ? 2_000 : false,
  });
  const log = logs.data;
  const holdingNow = log ? liveHolds(log, Date.now()).length > 0 : false;
  const heldForLater = log ? nextRunHolds(log).length > 0 : false;

  const options = { invalidates: REVIEW_INVALIDATES };

  const resume = useApiMutation(API_ROUTES.taskResume, {
    ...options,
    onSuccess: () => toast.success("Task resumed"),
  });
  const approve = useApiMutation(API_ROUTES.taskApproveSubmit, {
    ...options,
    onSuccess: () =>
      toast.success(
        "Approved for the next run",
        "The agent worker runs the task again and sends each approved request once.",
      ),
  });
  const retry = useApiMutation(API_ROUTES.taskRetry, {
    ...options,
    onSuccess: () => toast.success("Task queued to retry"),
  });
  const cancel = useApiMutation(API_ROUTES.taskCancel, {
    ...options,
    onSuccess: () => {
      setCancelOpen(false);
      toast.success(variant === "failed" ? "Dismissed" : "Task cancelled");
    },
    onError: () => setCancelOpen(false),
  });
  const steps = instructionSteps(item.manualInstructions);
  const needsApproval = awaitsSubmitApproval(task);
  const mayBeSent = sentWithoutApproval(task);
  const busy = approve.isPending || resume.isPending || retry.isPending || cancel.isPending;
  const footerError = [approve, resume, retry, cancel].find((mutation) => mutation.isError)?.error;
  const target = task.targetName ? { id: task.targetId, name: task.targetName } : undefined;
  const failure = variant === "failed" ? describeFailure(task) : null;
  const detail = failure ? failure.detail : (task.blockedDetail ?? null);
  const showsMark =
    variant === "failed" ||
    (variant === "blocked" && (task.blockedReason !== null || task.status === "leased"));

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
    variant === "blocked" && task.status === "leased" ? (
      <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
        Cancel task
      </Button>
    ) : variant === "blocked" && needsApproval ? (
      <>
        {heldForLater || logs.isPending ? (
          <Button
            variant="primary"
            loading={approve.isPending}
            disabled={(busy && !approve.isPending) || logs.isPending}
            onClick={() =>
              approve.mutate({ params: { id: task.id }, body: { declineSendIds: declined } })
            }
          >
            Approve for the next run
          </Button>
        ) : (
          <Button
            variant="primary"
            loading={resume.isPending}
            disabled={busy && !resume.isPending}
            onClick={() => resume.mutate({ params: { id: task.id } })}
          >
            Run again and wait for me
          </Button>
        )}
        <Button onClick={() => setDoneOpen(true)} disabled={busy}>
          Mark done
        </Button>
        <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
          Cancel task
        </Button>
      </>
    ) : variant === "blocked" && mayBeSent ? (
      <>
        <Button variant="primary" onClick={() => setDoneOpen(true)} disabled={busy}>
          Mark done
        </Button>
        <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
          Cancel task
        </Button>
      </>
    ) : variant === "blocked" ? (
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
            disabled={busy || agentAccessOff || agentAccessUnknown}
            onClick={() => setHandOffOpen(true)}
          >
            Hand to an agent
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
          Cancel task
        </Button>
        {agentAccessOff ? (
          <span className="text-meta text-ink-3">
            Agent access is off.{" "}
            <TextLink to={paths.settings("agents")}>Turn it on in Settings</TextLink>
          </span>
        ) : null}
      </>
    ) : variant === "agent" || variant === "yours" ? (
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
        footer={footer}
        error={footerError ? errorMessage(footerError) : undefined}
      >
        {showsMark ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {variant === "failed" ? <TaskStatusMark status={task.status} /> : null}
            {variant === "blocked" && task.blockedReason ? (
              <Tag tone="attention">{BLOCKED_REASON_LABELS[task.blockedReason]}</Tag>
            ) : null}
            {variant === "blocked" && task.status === "leased" ? (
              <Tag tone="attention">Waiting for you</Tag>
            ) : null}
          </div>
        ) : null}

        {variant === "agent" || variant === "yours" ? (
          <AgentPanel task={task} pageUrl={item.url} layout="section" />
        ) : null}

        {detail ? <p className="break-words text-body text-ink">{detail}</p> : null}

        {task.hasScreenshot && !holdingNow ? <Screenshot taskId={task.id} /> : null}

        {log ? (
          <HeldSendsPanel
            taskId={task.id}
            target={target}
            log={log}
            declined={declined}
            onDeclinedChange={setDeclined}
            onFinishByHand={() => {
              if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
              toast.success(
                "Held back",
                "Finish the form yourself, then mark the task done once the run stops.",
              );
            }}
          />
        ) : null}

        <Section label={variant === "failed" ? "What happened" : "What to do"} as="h3">
          {steps.length > 1 && variant !== "failed" ? (
            <ol className="m-0 list-decimal pl-5 text-body text-ink marker:font-mono marker:text-ink-3">
              {steps.map((step) => (
                <li key={step} className="py-0.5">
                  {step}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-body text-ink">{steps.join(" ")}</p>
          )}
          {item.url || failure?.needsProfile ? (
            <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-ui">
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
        </Section>

        {variant !== "failed" && !needsApproval && !mayBeSent && canReportOutcome(task) ? (
          <ValuesToEnter profileId={profileId} />
        ) : null}

        {log ? <SentLog log={log} target={target} /> : null}

        {variant === "failed" && siblings.length > 1 ? (
          <FailedGroupActions items={siblings} label={failure?.label ?? ""} />
        ) : null}
      </DetailFrame>

      <AssignDialog
        open={handOffOpen}
        onClose={() => setHandOffOpen(false)}
        task={task}
        mode="handoff"
      />

      <MarkDoneDialog
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        task={task}
        title={
          variant === "agent" || variant === "yours"
            ? "Finish this task yourself"
            : "Mark this task done"
        }
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={variant === "failed" ? "Dismiss this task?" : "Cancel this task?"}
        description={
          variant === "failed"
            ? "It leaves the review queue. The request keeps its place, but nothing will try this task again."
            : "The request keeps its place, but nothing will try this task again."
        }
        confirmLabel={variant === "failed" ? "Dismiss" : "Cancel task"}
        cancelLabel="Keep it"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate({ params: { id: task.id } })}
      />
    </>
  );
}
