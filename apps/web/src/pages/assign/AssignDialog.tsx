import {
  type AgentRow,
  type AgentsResponse,
  API_ROUTES,
  type AssigneeRefusal,
  type AssignmentFallback,
  type TaskSummary,
} from "@kickrocks/shared";
import { Bot, Plug, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useAgents, useApiMutation } from "../../api/index.js";
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
  useToast,
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

const REFRESHED = [
  API_ROUTES.requestsGet,
  API_ROUTES.requestsList,
  API_ROUTES.dashboardGet,
  API_ROUTES.reviewQueue,
  API_ROUTES.agentsList,
] as const;

export interface AssignDialogProps {
  open: boolean;
  onClose: () => void;
  task: Pick<TaskSummary, "id" | "assignment" | "targetName">;
  /** "assign" changes who a queued task is for; "handoff" gives a blocked task to an agent. */
  mode: "assign" | "handoff";
}

/**
 * Picks who a task goes to: any agent, one agent worker, one MCP client, or the person. A row the
 * server would refuse is shown disabled with the reason and the setting that changes it.
 */
export function AssignDialog({ open, onClose, task, mode }: AssignDialogProps) {
  const toast = useToast();
  const agents = useAgents({ taskId: task.id, enabled: open });
  const [choice, setChoice] = useState<Choice>(choiceOf(task.assignment));
  const [fallback, setFallback] = useState<AssignmentFallback>(task.assignment?.fallback ?? "any");

  // Each opening starts from what the task has now, not from what an earlier visit left half done.
  useEffect(() => {
    if (!open) return;
    setChoice(choiceOf(task.assignment));
    setFallback(task.assignment?.fallback ?? "any");
  }, [open, task.assignment]);

  const done = (title: string) => {
    toast.success(title);
    onClose();
  };
  const assign = useApiMutation(API_ROUTES.taskAssign, {
    invalidates: REFRESHED,
    onSuccess: () =>
      done(
        choice === "any"
          ? "Open to any agent"
          : choice === "person"
            ? "Kept for you"
            : `Assigned to ${workerIdOf(choice)}`,
      ),
  });
  const handOff = useApiMutation(API_ROUTES.taskHandOff, {
    invalidates: REFRESHED,
    onSuccess: () =>
      done(
        choice === "person"
          ? "Kept for you"
          : choice === "any"
            ? "Handed to an agent"
            : `Handed to ${workerIdOf(choice)}`,
      ),
  });
  const mutation = mode === "handoff" ? handOff : assign;

  const workerId = workerIdOf(choice);
  const kindOf = choice.startsWith("mcp:") ? "mcp" : "model";
  const body = { to: targetOf(choice), ...(workerId ? { fallback } : {}) };
  const submit = () => {
    if (mode === "handoff") handOff.mutate({ params: { id: task.id }, body });
    else assign.mutate({ params: { id: task.id }, body });
  };
  const unchanged =
    mode === "assign" &&
    choice === choiceOf(task.assignment) &&
    fallback === (task.assignment?.fallback ?? "any");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      dismissible={!mutation.isPending}
      title={mode === "handoff" ? "Hand this task to an agent" : "Who takes this task"}
      description={
        mode === "handoff"
          ? "The agent receives your name and email address, and what the page asks for from this profile, to fill in the form for you."
          : "This chooses who gets the task first. It is not a lock."
      }
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
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
        {mutation.isError ? <InlineError>{errorMessage(mutation.error)}</InlineError> : null}
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
  const inGroup = (list: Choice[]): Choice | null => (list.includes(choice) ? choice : null);

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
            value={inGroup(["any"])}
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
          <RadioGroup<Choice>
            name="assign-to"
            legend="Yourself"
            hideLegend
            rows
            value={inGroup(["person"])}
            onValueChange={onChoice}
            options={[
              {
                value: "person",
                label: "I'll do it myself",
                autoFocus: choice === "person",
                description: "No agent will take it. You finish it and mark it done.",
                meta: <User className="size-4" aria-hidden="true" />,
              },
            ]}
          />
          {rows.length === 0 && agents ? (
            <p className="flex items-start gap-2 text-meta text-ink-2">
              <Plug aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <span>
                {NO_AGENTS_TEXT} Set one up in{" "}
                <TextLink to={AGENT_SETTINGS_PATH}>Settings, Agents</TextLink>.
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
