import { API_ROUTES, type RequestEvent, type TaskSummary } from "@kickrocks/shared";
import { Play, Plug } from "lucide-react";
import { type ReactNode, useState } from "react";
import { errorMessage, useAgents, useApiMutation, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  CopyButton,
  ExternalLinkText,
  InlineError,
  Section,
  TextLink,
  useToast,
} from "../../components/ui/index.js";
import { useNow } from "../../lib/use-now.js";
import { MarkDoneDialog } from "../review/MarkDoneDialog.js";
import { liveHolds } from "../review/sends-model.js";
import { AssignDialog } from "./AssignDialog.js";
import {
  AGENT_SETTINGS_PATH,
  type CalloutState,
  calloutState,
  lapsedText,
  runNowRefusal,
} from "./model.js";

const REFRESHED = [
  API_ROUTES.requestsGet,
  API_ROUTES.requestsList,
  API_ROUTES.dashboardGet,
  API_ROUTES.reviewQueue,
  API_ROUTES.agentsList,
] as const;

export interface AgentPanelProps {
  /** A queued or running agent task. */
  task: TaskSummary;
  /** The page where the person can do the task themselves, when the target has one. */
  pageUrl?: string | null | undefined;
  /** The request's timeline, to say when a fallback moved the task. */
  events?: readonly RequestEvent[] | undefined;
  /** A callout above the request, or a section inside a Review item. */
  layout: "callout" | "section";
}

/** Who the task is for, what happens next, and the controls to change it. */
export function AgentPanel({ task, pageUrl, events = [], layout }: AgentPanelProps) {
  const toast = useToast();
  const now = useNow();
  const agents = useAgents({});
  const state = calloutState(task, agents.data, now);
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const holds = useApiQuery(API_ROUTES.taskSends, {
    params: { id: task.id },
    enabled: task.status === "leased",
    refetchInterval: 5_000,
  });
  const heldNow = holds.data ? liveHolds(holds.data, now).length > 0 : false;

  const keep = useApiMutation(API_ROUTES.taskAssign, {
    invalidates: REFRESHED,
    onSuccess: () => toast.success("Kept for you"),
  });
  const runNow = useApiMutation(API_ROUTES.taskRunNow, {
    invalidates: REFRESHED,
    onSuccess: () => toast.success("Asked the agent to take it now"),
  });
  const runNowError = runNow.isError ? runNowRefusal(runNow.error) : null;

  const lapsed = lapsedText(events, task.id);
  const settingsLink = state.nobodyConnected ? (
    <TextLink to={AGENT_SETTINGS_PATH}>Settings, Agents</TextLink>
  ) : null;

  const actions = (
    <PanelActions
      state={state}
      pageUrl={pageUrl}
      onPick={() => setPicking(true)}
      onFinish={layout === "callout" ? () => setFinishing(true) : null}
      onKeep={() => keep.mutate({ params: { id: task.id }, body: { to: "person" } })}
      onRunNow={() => runNow.mutate({ params: { id: task.id } })}
      keeping={keep.isPending}
      running={runNow.isPending}
    />
  );
  const body = (
    <div className="flex flex-col gap-1">
      {state.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {settingsLink ? <p>Set one up in {settingsLink}.</p> : null}
      {state.kind === "working" && heldNow ? (
        <p className="text-attention-text">
          A request is waiting for your approval.{" "}
          <TextLink to={`/review?item=${encodeURIComponent(`blocked:${task.id}`)}`}>
            Open in Review
          </TextLink>
        </p>
      ) : null}
      {state.kind === "working" ? (
        <p className="text-ink-3">Wait for the run to end, or stop it in Review.</p>
      ) : null}
      {state.mcpHint ? (
        <p className="mt-1 flex flex-wrap items-center gap-2">
          <code className="font-mono text-caption text-ink-2">{`claim_task with taskId "${task.id}"`}</code>
          <CopyButton value={`claim_task with taskId "${task.id}"`} label="Copy" />
        </p>
      ) : null}
      {lapsed ? <p>{lapsed}</p> : null}
      {runNowError ? <InlineError>{runNowError}</InlineError> : null}
      {keep.isError ? <InlineError>{errorMessage(keep.error)}</InlineError> : null}
    </div>
  );

  return (
    <>
      {layout === "callout" ? (
        <Callout
          intent={state.needsAttention ? "warning" : "info"}
          title={state.title}
          action={actions}
        >
          {body}
        </Callout>
      ) : (
        <Section label="Agent" as="h3">
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-3.5 py-3 text-meta text-ink-2">
            <p className="text-ui font-semibold text-ink">{state.title}</p>
            {body}
            <div className="mt-1">{actions}</div>
          </div>
        </Section>
      )}
      <AssignDialog open={picking} onClose={() => setPicking(false)} task={task} mode="assign" />
      <MarkDoneDialog
        open={finishing}
        onClose={() => setFinishing(false)}
        task={task}
        title="Finish this task yourself"
      />
    </>
  );
}

function PanelActions({
  state,
  pageUrl,
  onPick,
  onFinish,
  onKeep,
  onRunNow,
  keeping,
  running,
}: {
  state: CalloutState;
  pageUrl: string | null | undefined;
  onPick: () => void;
  onFinish: (() => void) | null;
  onKeep: () => void;
  onRunNow: () => void;
  keeping: boolean;
  running: boolean;
}) {
  const page: ReactNode = pageUrl ? (
    <ExternalLinkText href={pageUrl}>Open the opt-out page</ExternalLinkText>
  ) : null;
  const runNowButton = state.runNow ? (
    <Button size="sm" onClick={onRunNow} loading={running}>
      <Play aria-hidden="true" />
      Run now
    </Button>
  ) : null;

  switch (state.kind) {
    case "yours":
      return (
        <span className="flex flex-wrap items-center gap-3">
          {page}
          {onFinish ? (
            <Button size="sm" variant="primary" onClick={onFinish}>
              Mark done
            </Button>
          ) : null}
          <Button size="sm" onClick={onPick}>
            <Plug aria-hidden="true" />
            Hand back to an agent
          </Button>
        </span>
      );
    case "working":
      return (
        <span className="flex flex-wrap items-center gap-3">
          {page}
          <Button size="sm" disabled>
            Change
          </Button>
        </span>
      );
    case "assigned":
      return (
        <span className="flex flex-wrap items-center gap-3">
          {page}
          {runNowButton}
          <Button size="sm" onClick={onPick}>
            Change
          </Button>
        </span>
      );
    case "any":
      return (
        <span className="flex flex-wrap items-center gap-3">
          {page}
          <Button size="sm" variant="primary" onClick={onPick}>
            Assign
          </Button>
          {runNowButton}
          <Button size="sm" onClick={onKeep} loading={keeping}>
            Do it myself
          </Button>
        </span>
      );
  }
}
