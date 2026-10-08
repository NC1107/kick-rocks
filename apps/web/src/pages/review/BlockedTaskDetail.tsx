import type { BlockedTaskItem, FormOutcome, ProfileField } from "@kickrocks/shared";
import { API_ROUTES, resolveProfileFields } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, screenshotUrl, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  ConfirmDialog,
  CopyButton,
  Dialog,
  ExternalLinkText,
  Field,
  Hatch,
  InlineError,
  RelativeTime,
  Row,
  RowGroup,
  Section,
  Select,
  Tag,
  TaskStatusMark,
  Textarea,
  TextLink,
  useToast,
} from "../../components/ui/index.js";
import { describeFailure } from "../../lib/failures.js";
import { BLOCKED_REASON_LABELS, PROFILE_FIELD_LABELS, TASK_KIND_LABELS } from "../../lib/labels.js";
import { DetailFrame } from "./DetailFrame.js";
import { FailedGroupActions } from "./FailedGroupActions.js";
import { HeldSendsPanel } from "./HeldSendsPanel.js";
import {
  awaitsSubmitApproval,
  canHandOff,
  canReportOutcome,
  instructionSteps,
  OUTCOME_CHOICES,
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
  variant: "blocked" | "failed" | "agent";
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
  const [outcome, setOutcome] = useState<FormOutcome>("submitted");
  const [note, setNote] = useState("");
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
  const handOff = useApiMutation(API_ROUTES.taskHandOff, {
    ...options,
    onSuccess: () => {
      setHandOffOpen(false);
      toast.success(
        "Handed to an agent",
        "It waits under Waiting for an agent until one takes it.",
      );
    },
    onError: () => setHandOffOpen(false),
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
  const markDone = useApiMutation(API_ROUTES.taskMarkDone, {
    ...options,
    onSuccess: () => {
      setDoneOpen(false);
      toast.success("Marked done");
    },
  });

  const reportsOutcome = canReportOutcome(task);
  const steps = instructionSteps(item.manualInstructions);
  const needsApproval = awaitsSubmitApproval(task);
  const mayBeSent = sentWithoutApproval(task);
  const busy =
    approve.isPending ||
    resume.isPending ||
    handOff.isPending ||
    retry.isPending ||
    cancel.isPending ||
    markDone.isPending;
  const footerError = [approve, resume, handOff, retry, cancel].find(
    (mutation) => mutation.isError,
  )?.error;
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
          {task.requestId ? (
            <TextLink to={`/requests/${encodeURIComponent(task.requestId)}`} className="font-mono">
              {item.requestReference}
            </TextLink>
          ) : (
            <span className="font-mono">{item.requestReference}</span>
          )}
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
            loading={handOff.isPending}
            disabled={(busy && !handOff.isPending) || agentAccessOff || agentAccessUnknown}
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
            Agent access is off. <TextLink to="/settings">Turn it on in Settings</TextLink>
          </span>
        ) : null}
      </>
    ) : variant === "agent" ? (
      <>
        <Button variant="primary" onClick={() => setDoneOpen(true)} disabled={busy}>
          I did it myself
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
        title={task.targetName ?? "Unknown target"}
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

        {detail ? <p className="break-words text-body text-ink">{detail}</p> : null}

        {task.hasScreenshot && !holdingNow ? <Screenshot taskId={task.id} /> : null}

        {log ? (
          <HeldSendsPanel
            taskId={task.id}
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
          {variant === "agent" ? (
            <p className="mt-2 text-meta text-ink-3">
              An agent is an AI assistant you connect over MCP in{" "}
              <TextLink to="/settings">Settings</TextLink>.
            </p>
          ) : null}
          {item.url || failure?.needsProfile ? (
            <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-ui">
              {item.url ? (
                <ExternalLinkText href={item.url} className="break-all">
                  Open the page
                </ExternalLinkText>
              ) : null}
              {failure?.needsProfile ? (
                <TextLink to={`/profiles/${encodeURIComponent(profileId)}`}>
                  Open the profile to add it
                </TextLink>
              ) : null}
            </p>
          ) : null}
        </Section>

        {variant !== "failed" && !needsApproval && !mayBeSent && canReportOutcome(task) ? (
          <ValuesToEnter profileId={profileId} />
        ) : null}

        {log ? <SentLog log={log} /> : null}

        {variant === "failed" && siblings.length > 1 ? (
          <FailedGroupActions items={siblings} label={failure?.label ?? ""} />
        ) : null}
      </DetailFrame>

      <ConfirmDialog
        open={handOffOpen}
        onClose={() => setHandOffOpen(false)}
        title="Hand this task to an agent?"
        description="An agent is an AI assistant you connected to Kick Rocks over MCP. The task leaves your hands and waits until a connected agent takes it. The agent then receives your name and email address, and what the page asks for from this profile, to fill in the form for you."
        confirmLabel="Hand to an agent"
        loading={handOff.isPending}
        onConfirm={() => handOff.mutate({ params: { id: task.id } })}
      >
        <p className="text-ui text-ink-2">
          Nothing happens until one is connected.{" "}
          <TextLink to="/settings">Connect one in Settings</TextLink>.
        </p>
      </ConfirmDialog>

      <Dialog
        open={doneOpen}
        onClose={() => {
          setDoneOpen(false);
          markDone.reset();
        }}
        title={variant === "agent" ? "Finish this task yourself" : "Mark this task done"}
        description="Say how it ended, so the request moves to the right state."
        dismissible={!markDone.isPending}
        footer={
          <>
            <Button
              onClick={() => {
                setDoneOpen(false);
                markDone.reset();
              }}
              disabled={markDone.isPending}
            >
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
