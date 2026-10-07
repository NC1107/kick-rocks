import type { BlockedTaskItem, FormOutcome, ProfileField } from "@kickrocks/shared";
import { API_ROUTES, resolveProfileFields } from "@kickrocks/shared";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage, screenshotUrl, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CopyButton,
  Dialog,
  ExternalLinkText,
  Field,
  Select,
  TaskStatusPill,
  Textarea,
  useToast,
} from "../../components/ui/index.js";
import { describeFailure } from "../../lib/failures.js";
import { formatRelative } from "../../lib/format.js";
import { BLOCKED_REASON_LABELS, PROFILE_FIELD_LABELS, TASK_KIND_LABELS } from "../../lib/labels.js";
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
      className="block max-h-72 overflow-auto rounded-md border border-line bg-sunken"
    >
      <img
        src={screenshotUrl(taskId)}
        alt="The page where the task stopped"
        loading="lazy"
        onError={() => setFailed(true)}
        className="mx-auto h-auto w-[44rem] max-w-none sm:w-full sm:max-w-full sm:object-contain"
      />
      <span className="sr-only">(opens the full screenshot in a new tab)</span>
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
    <div className="mt-3">
      <p className="mb-1.5 text-sm font-semibold text-ink">Details to type into the form</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {rows.map(({ field, value }) => (
          <li key={field} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-words text-base text-ink">
              <span className="text-ink-muted">{PROFILE_FIELD_LABELS[field]}: </span>
              {value}
            </span>
            <CopyButton value={value as string} label="Copy" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BlockedTaskCard({
  item,
  variant,
  profileId,
  nested = false,
}: {
  item: BlockedTaskItem;
  variant: "blocked" | "failed" | "agent";
  profileId: string;
  /** The card sits under a section heading, so its own title is one level lower. */
  nested?: boolean;
}) {
  const Title = nested ? "h3" : "h2";
  const SubTitle = nested ? "h4" : "h3";
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
    onSuccess: () => {
      setHandOffOpen(false);
      toast.success(
        "Handed to an agent",
        "It now waits under Waiting for an agent until one takes it.",
      );
    },
    onError: (error) => {
      setHandOffOpen(false);
      fail(error);
    },
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
      toast.success(variant === "failed" ? "Dismissed" : "Task cancelled");
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
  const failure = variant === "failed" ? describeFailure(task) : null;
  const detail = failure ? failure.detail : (task.blockedDetail ?? null);
  const pill = (
    <span className="flex flex-wrap items-center gap-2">
      {variant === "failed" ? <TaskStatusPill status={task.status} /> : null}
      {variant === "blocked" && task.blockedReason ? (
        <Badge tone="amber">{BLOCKED_REASON_LABELS[task.blockedReason]}</Badge>
      ) : null}
      {variant === "agent" ? <Badge tone="amber">Waiting for an agent</Badge> : null}
      {failure ? <Badge tone="red">{failure.label}</Badge> : null}
    </span>
  );

  return (
    <Card aria-label={`${task.targetName ?? "Task"}, ${TASK_KIND_LABELS[task.kind]}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <Title className="break-words text-lg font-semibold text-ink">
            {task.targetName ?? "Unknown target"}
          </Title>
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
        <SubTitle className="mb-1.5 text-sm font-semibold text-ink">
          {variant === "failed" ? "What happened" : "What to do"}
        </SubTitle>
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
        {failure?.needsProfile ? (
          <p className="mt-2.5 text-base">
            <Link
              to={`/profiles/${encodeURIComponent(profileId)}`}
              className="text-accent underline underline-offset-2"
            >
              Open the profile to add it
            </Link>
          </p>
        ) : null}
        {variant !== "failed" && canReportOutcome(task) ? (
          <ValuesToEnter profileId={profileId} />
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
              <span className="text-sm text-ink-muted">
                Agent access is off.{" "}
                <Link to="/settings" className="text-accent underline underline-offset-2">
                  Turn it on in Settings
                </Link>
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
        )}
      </div>

      <ConfirmDialog
        open={handOffOpen}
        onClose={() => setHandOffOpen(false)}
        title="Hand this task to an agent?"
        description="An agent is an AI assistant you connected to Kick Rocks over MCP. The task leaves your hands and waits until a connected agent takes it. The agent then receives your name and email address, and what the page asks for from this profile, to fill in the form for you."
        confirmLabel="Hand to an agent"
        loading={handOff.isPending}
        onConfirm={() => handOff.mutate({ params: { id: task.id } })}
      >
        <p className="text-base text-ink-muted">
          Nothing happens until one is connected.{" "}
          <Link to="/settings" className="text-accent underline underline-offset-2">
            Connect one in Settings
          </Link>
          .
        </p>
      </ConfirmDialog>

      <Dialog
        open={doneOpen}
        onClose={() => setDoneOpen(false)}
        title={variant === "agent" ? "Finish this task yourself" : "Mark this task done"}
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
    </Card>
  );
}
