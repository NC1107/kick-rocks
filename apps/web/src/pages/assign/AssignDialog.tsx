import type {
  AgentRow,
  AgentsResponse,
  AssigneeRefusal,
  AssignmentFallback,
  TaskAssignment,
} from "@kickrocks/shared";
import { Bot, Plug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useAgents } from "../../api/index.js";
import {
  Button,
  Dialog,
  Field,
  InlineError,
  RadioGroup,
  type RadioOption,
  Select,
  Skeleton,
  TextLink,
} from "../../components/ui/index.js";
import {
  AGENT_SETTINGS_PATH,
  agentChoice,
  type Choice,
  choiceOf,
  fallbackLabel,
  fallbackSentence,
  modelLine,
  NO_AGENTS_TEXT,
  presenceLine,
  presenceWord,
  sendingLine,
  targetOf,
  workerIdOf,
} from "./model.js";
import {
  type HandOverMode,
  type HandOverTask,
  useHandOverMutation,
} from "./useHandOverMutation.js";

export interface AssignDialogProps {
  open: boolean;
  onClose: () => void;
  task: HandOverTask;
  mode: HandOverMode;
}

/** The agent a task is assigned to, or Any agent: doing it yourself is never a row here. */
function agentOnly(assignment: TaskAssignment | null): Choice {
  const choice = choiceOf(assignment);
  return choice === "person" ? "any" : choice;
}

/**
 * Picks which agent takes a task: any agent, one agent worker, or one MCP client. Doing it
 * yourself is the task's own action elsewhere, never a row here. A row the server would refuse is
 * shown disabled with the reason and the setting that changes it.
 */
export function AssignDialog({ open, onClose, task, mode }: AssignDialogProps) {
  const agents = useAgents({ taskId: task.id, enabled: open });
  const [choice, setChoice] = useState<Choice>(agentOnly(task.assignment));
  const [fallback, setFallback] = useState<AssignmentFallback>(task.assignment?.fallback ?? "any");
  const { send, pending, error } = useHandOverMutation(mode, task);

  // Reset while closed, so an opening starts from what the task has now and focus lands on it.
  useEffect(() => {
    if (open) return;
    setChoice(agentOnly(task.assignment));
    setFallback(task.assignment?.fallback ?? "any");
  }, [open, task.assignment]);

  const workerId = workerIdOf(choice);
  const kindOf = choice.startsWith("mcp:") ? "mcp" : "model";
  const submit = () => send({ to: targetOf(choice), ...(workerId ? { fallback } : {}) }, onClose);
  const unchanged =
    mode === "assign" &&
    task.assignment !== null &&
    choice === choiceOf(task.assignment) &&
    fallback === task.assignment.fallback;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      dismissible={!pending}
      title={mode === "handoff" ? "Hand to an agent" : "Choose an agent"}
      description="The agent gets your name, email and what the page asks for."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={agents.isPending || unchanged}
            onClick={submit}
          >
            {mode === "handoff" ? "Hand over" : "Assign"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Picker
          agents={agents.data}
          loading={agents.isPending}
          loadError={agents.isError ? errorMessage(agents.error) : null}
          choice={choice}
          onChoice={setChoice}
        />
        {workerId && agents.data ? (
          <Field label={fallbackLabel(kindOf)} help={fallbackSentence(workerId, fallback, kindOf)}>
            <Select
              value={fallback}
              onChange={(event) => setFallback(event.target.value as AssignmentFallback)}
            >
              <option value="any">Let any agent take it</option>
              <option value="person">Give it to me</option>
            </Select>
          </Field>
        ) : null}
        {error ? <InlineError>{errorMessage(error)}</InlineError> : null}
      </div>
    </Dialog>
  );
}

function Lines({ children }: { children: (string | null)[] }) {
  return (
    <>
      {children
        .filter((line): line is string => line !== null)
        .map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
    </>
  );
}

/** What the link beside a refusal says it opens. */
const REFUSAL_LINKS: Record<AssigneeRefusal["code"], string> = {
  unreviewed: "Review the setting",
  rejected: "Open recipes",
  routed: "Open the proxy setting",
  mcp_off: "Turn on MCP",
};

function agentOption(row: AgentRow, now: number, choice: Choice): RadioOption<Choice> {
  const refusal = row.refusal;
  return {
    value: agentChoice(row),
    autoFocus: agentChoice(row) === choice,
    label: row.workerId,
    disabled: refusal !== null,
    meta: presenceWord(row),
    description: (
      <Lines>
        {[
          row.kind === "model" ? modelLine(row) : "MCP client",
          presenceLine(row, now),
          refusal ? null : sendingLine(row),
        ]}
      </Lines>
    ),
    note: refusal ? (
      <>
        {refusal.message}{" "}
        <TextLink to={refusal.settingsPath}>{REFUSAL_LINKS[refusal.code]}</TextLink>
      </>
    ) : undefined,
  };
}

function Picker({
  agents,
  loading,
  loadError,
  choice,
  onChoice,
}: {
  agents: AgentsResponse | undefined;
  loading: boolean;
  loadError: string | null;
  choice: Choice;
  onChoice: (choice: Choice) => void;
}) {
  const now = Date.now();
  const list = useRef<HTMLDivElement>(null);
  const rows = agents?.agents ?? [];

  // The dialog places focus when it opens, before the agents arrive. Once they do, the choice is
  // where focus belongs, unless the person has already moved it somewhere deliberately.
  useEffect(() => {
    if (loading) return;
    const dialog = list.current?.closest("dialog");
    const active = document.activeElement;
    const untouched =
      !dialog?.contains(active) ||
      active === dialog ||
      active?.getAttribute("aria-label") === "Close";
    if (untouched) list.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [loading]);
  const models = rows.filter((row) => row.kind === "model");
  const clients = rows.filter((row) => row.kind === "mcp");
  const groupValue = (group: readonly AgentRow[]): Choice | null =>
    group.some((row) => agentChoice(row) === choice) ? choice : null;
  const anyChosen: Choice | null = choice === "any" ? choice : null;

  return (
    <>
      {loading ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading agents</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <div ref={list} className="flex flex-col gap-3">
          <RadioGroup<Choice>
            name="assign-to"
            legend="Open to"
            hideLegend
            rows
            value={anyChosen}
            onValueChange={onChoice}
            options={[
              {
                value: "any",
                label: "Any agent",
                autoFocus: choice === "any",
                description: "The first agent that asks takes it.",
                meta: <Bot className="size-4" aria-hidden="true" />,
              },
            ]}
          />
          {models.length > 0 ? (
            <RadioGroup<Choice>
              name="assign-to"
              legend="Agent workers"
              rows
              value={groupValue(models)}
              onValueChange={onChoice}
              options={models.map((row) => agentOption(row, now, choice))}
            />
          ) : null}
          {clients.length > 0 ? (
            <RadioGroup<Choice>
              name="assign-to"
              legend="MCP clients"
              rows
              value={groupValue(clients)}
              onValueChange={onChoice}
              options={clients.map((row) => agentOption(row, now, choice))}
            />
          ) : null}
          {rows.length === 0 && agents ? (
            <p className="flex items-start gap-2 text-meta text-ink-2">
              <Plug aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>
                {NO_AGENTS_TEXT} Set one up in{" "}
                <TextLink to={AGENT_SETTINGS_PATH}>Settings</TextLink>.
                {agents.mcpEnabled ? "" : " MCP access is off."}
              </span>
            </p>
          ) : null}
        </div>
      )}
      {loadError ? <InlineError>{loadError}</InlineError> : null}
    </>
  );
}
