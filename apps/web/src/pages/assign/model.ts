import {
  type AgentRow,
  type AgentsResponse,
  ASSIGNMENT_GRACE_MS,
  type AssignBody,
  fallbackAt,
  MCP_ACTIVE_MS,
  type RequestEvent,
  type TaskAssignment,
  type TaskSummary,
} from "@kickrocks/shared";
import { pluralize } from "../../lib/format.js";
import { clockTime } from "../requests/format.js";
import { describeModel, GATE_WORDS } from "../settings/agents/gate.js";

export const GRACE_MINUTES = ASSIGNMENT_GRACE_MS / 60_000;

/** Where the person turns on an agent worker or an MCP client. */
export const AGENT_SETTINGS_PATH = "/settings/agents";

export const NO_AGENTS_TEXT =
  "No agent has connected yet. An agent worker or an MCP client can take sites with no saved steps.";

export const HELD_SENDS_LINE = "Every request it sends waits for your approval in Review.";
export const MCP_SENDS_LINE = "Drives its own browser. Kick Rocks cannot hold what it sends.";

/** One radio value for the picker: who the task goes to. */
export type Choice = "any" | "person" | `model:${string}` | `mcp:${string}`;

export function choiceOf(assignment: TaskAssignment | null): Choice {
  if (assignment === null) return "any";
  if (assignment.to.kind === "person") return "person";
  return `${assignment.to.kind}:${assignment.to.workerId}`;
}

export function agentChoice(agent: Pick<AgentRow, "kind" | "workerId">): Choice {
  return `${agent.kind}:${agent.workerId}`;
}

/** What the assign route takes for a choice. */
export function targetOf(choice: Choice): AssignBody["to"] {
  if (choice === "any" || choice === "person") return choice;
  const split = choice.indexOf(":");
  return {
    kind: choice.slice(0, split) as "model" | "mcp",
    workerId: choice.slice(split + 1),
  };
}

export function workerIdOf(choice: Choice): string | null {
  return choice === "any" || choice === "person" ? null : choice.slice(choice.indexOf(":") + 1);
}

/** "12 minutes", "3 hours": how long ago, without the word ago, for a sentence that supplies its own. */
export function elapsedText(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return pluralize(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return pluralize(hours, "hour");
  return pluralize(Math.floor(hours / 24), "day");
}

/** What a model-backed agent drives and where it stands with the safety gate. */
export function modelLine(row: AgentRow): string {
  const parts = [
    row.model ? describeModel(row.model) : "Model not reported",
    row.gate ? GATE_WORDS[row.gate.state] : null,
  ];
  return parts.filter(Boolean).join(", ");
}

/** What the agent will do about sending, in the gate's words. Null when it sends alone and logs it. */
export function sendingLine(row: AgentRow): string | null {
  if (row.kind === "mcp") return MCP_SENDS_LINE;
  return row.gate && !row.gate.unattended ? HELD_SENDS_LINE : null;
}

/** "Online", "Seen 12 minutes ago", or for an MCP client "Last call 4 minutes ago". */
export function seenText(row: AgentRow, now: number): string {
  if (row.kind === "mcp") return `Last call ${elapsedText(row.lastSeenAt, now)} ago`;
  return row.online ? "Online" : `Seen ${elapsedText(row.lastSeenAt, now)} ago`;
}

/** An MCP client holds a task only while it keeps asking for work, so when it last did is what counts. */
function askedText(row: AgentRow, now: number): string {
  return row.lastClaimAt
    ? `Last asked for work ${elapsedText(row.lastClaimAt, now)} ago`
    : "Has not asked for work yet";
}

/** What is worth saying about an agent's presence beyond the presence mark beside it. */
export function presenceLine(row: AgentRow, now: number): string | null {
  const busy = row.busy ? `Busy with ${row.currentTargetName ?? "a task"}` : null;
  if (row.kind === "mcp") {
    return [seenText(row, now), askedText(row, now), busy].filter(Boolean).join(". ");
  }
  if (!row.online) return seenText(row, now);
  return busy;
}

export function findAgent(
  agents: AgentsResponse | undefined,
  assignee: { kind: string; workerId: string },
): AgentRow | null {
  return (
    agents?.agents.find(
      (row) => row.kind === assignee.kind && row.workerId === assignee.workerId,
    ) ?? null
  );
}

/** When an assignment falls back to its second choice, given what is known of the assignee. */
export function fallbackTime(
  assignment: TaskAssignment,
  agents: AgentsResponse | undefined,
): string {
  const row = assignment.to.kind === "person" ? null : findAgent(agents, assignment.to);
  return fallbackAt(assignment, row?.lastClaimAt ?? null);
}

export function fallbackWords(assignment: TaskAssignment): string {
  return assignment.fallback === "person" ? "it comes back to you" : "any agent may take it";
}

/** The sentence the dialog shows under the fallback choice. */
export function fallbackSentence(
  workerId: string,
  fallback: TaskAssignment["fallback"],
  kind: "model" | "mcp" = "model",
): string {
  const quiet =
    kind === "mcp"
      ? `does not ask for work (claim_task) for ${GRACE_MINUTES} minutes`
      : `is not seen for ${GRACE_MINUTES} minutes`;
  return `If ${workerId} ${quiet}, ${fallback === "person" ? "it comes back to you" : "any agent may take it"}.`;
}

/** The label of the fallback choice, which names what counts as the assignee going quiet. */
export function fallbackLabel(kind: "model" | "mcp"): string {
  return kind === "mcp"
    ? `If it does not ask for work for ${GRACE_MINUTES} minutes`
    : `If it is offline for ${GRACE_MINUTES} minutes`;
}

/** Who a task is meant for, in a line for a list row. */
export function assignmentLine(
  assignment: TaskAssignment | null,
  agents: AgentsResponse | undefined,
  now: number,
): string {
  if (assignment === null) return "Any agent";
  if (assignment.to.kind === "person") return "Yours to do";
  const { workerId } = assignment.to;
  const row = findAgent(agents, assignment.to);
  const known = agents !== undefined;
  if (!known || row?.online) return `Assigned to ${workerId}`;
  const from = clockTime(fallbackTime(assignment, agents));
  const stale = Date.parse(fallbackTime(assignment, agents)) <= now;
  const next = assignment.fallback === "person" ? "back to you" : "any agent";
  return stale ? `${workerId} offline` : `${workerId} offline, ${next} from ${from}`;
}

/** The short label on a task row of the request page. */
export function assigneeTag(task: TaskSummary): string | null {
  if (task.kind !== "agent" || (task.status !== "queued" && task.status !== "leased")) return null;
  if (task.assignment === null) return task.status === "queued" ? "Any agent" : null;
  return task.assignment.to.kind === "person" ? "You" : task.assignment.to.workerId;
}

export interface CalloutState {
  kind: "any" | "assigned" | "working" | "yours";
  title: string;
  lines: string[];
  /** The agent the task is assigned to, or the one found working on it. */
  agent: AgentRow | null;
  /** Show Run now: an agent worker is online to take it. */
  runNow: boolean;
  /** The assignee is an MCP client, which the server cannot wake. */
  mcpHint: boolean;
  /** Nobody has ever connected, so only Any agent and Yourself make sense. */
  nobodyConnected: boolean;
  /** The task is stuck waiting on something the person can fix, so the notice takes the attention tone. */
  needsAttention: boolean;
}

function holderOf(task: TaskSummary, agents: AgentsResponse | undefined): AgentRow | null {
  if (task.assignment && task.assignment.to.kind !== "person") {
    return findAgent(agents, task.assignment.to);
  }
  return (
    agents?.agents.find((row) => row.busy && row.currentTargetName === task.targetName) ?? null
  );
}

const RESTORE_HOLD_LINE = "Sending is held after a restore, so it waits until that clears.";

function askedRecently(row: AgentRow | null, now: number): boolean {
  return row?.lastClaimAt != null && now - Date.parse(row.lastClaimAt) <= MCP_ACTIVE_MS;
}

/** The mark beside an agent: workers are online or offline, an MCP client that calls only when it has time is active or idle. */
export function presenceWord(row: AgentRow): string {
  if (row.kind === "model") return row.online ? "Online" : "Offline";
  return row.online ? "Active" : "Idle";
}

/** What the request page's Agent callout says for a queued or running agent task. */
export function calloutState(
  task: TaskSummary,
  agents: AgentsResponse | undefined,
  now: number,
  sendsHeld = false,
): CalloutState {
  const nobodyConnected = agents !== undefined && agents.agents.length === 0;
  const base = {
    agent: null,
    runNow: false,
    mcpHint: false,
    nobodyConnected,
    needsAttention: false,
  };
  const assignment = task.assignment;

  if (task.status === "leased") {
    const holder = holderOf(task, agents);
    const name =
      holder?.workerId ??
      (assignment && assignment.to.kind !== "person" ? assignment.to.workerId : null);
    return {
      ...base,
      kind: "working",
      agent: holder,
      title: name ? `${name} is working on it` : "An agent is working on it",
      lines: [],
    };
  }

  if (assignment?.to.kind === "person") {
    return {
      ...base,
      kind: "yours",
      title: "You're doing this one",
      lines: ["No agent will take it."],
    };
  }

  if (assignment) {
    const { workerId, kind } = assignment.to as { kind: "model" | "mcp"; workerId: string };
    const row = findAgent(agents, assignment.to as { kind: string; workerId: string });
    const online = row?.online ?? false;
    const common = { ...base, kind: "assigned" as const, agent: row, mcpHint: kind === "mcp" };
    if (!online) {
      const quiet = row ? `Not seen for ${elapsedText(row.lastSeenAt, now)}.` : "Not seen yet.";
      return {
        ...common,
        needsAttention: true,
        title: `Assigned to ${workerId}, offline`,
        lines: [
          `${quiet} From ${clockTime(fallbackTime(assignment, agents))} ${fallbackWords(assignment)}.`,
        ],
      };
    }
    const lines: string[] = [];
    if (row && kind === "model") lines.push(modelLine(row));
    if (row?.busy) {
      lines.push(`Busy with ${row.currentTargetName ?? "another task"}. Takes this next.`);
    } else if (kind === "model") {
      lines.push(
        sendsHeld && task.requestId !== null ? RESTORE_HOLD_LINE : "Takes it within a few seconds.",
      );
    } else {
      lines.push("MCP clients take work when they call claim_task.");
      if (!askedRecently(row, now)) {
        lines.push(
          `Not asked for work ${row?.lastClaimAt ? `for ${elapsedText(row.lastClaimAt, now)}` : "yet"}. From ${clockTime(fallbackTime(assignment, agents))} ${fallbackWords(assignment)}.`,
        );
      }
    }
    return {
      ...common,
      title: `Assigned to ${workerId}`,
      lines,
      runNow: kind === "model",
    };
  }

  const online = agents?.agents.filter((row) => row.online) ?? [];
  const lines = nobodyConnected
    ? [NO_AGENTS_TEXT]
    : online.length > 0
      ? [`Any connected agent may take it. ${online.length} online.`]
      : ["No agent is online right now. Any agent that connects may take it."];
  return {
    ...base,
    needsAttention: true,
    kind: "any",
    title: "Waiting for an agent",
    lines,
    runNow: online.some((row) => row.kind === "model"),
  };
}

/** The line after a fallback moved the task, read from the request's timeline. */
export function lapsedText(events: readonly RequestEvent[], taskId: string): string | null {
  const last = events.findLast(
    (event) => event.type === "task_assigned" && event.payload.taskId === taskId,
  );
  if (last?.type !== "task_assigned" || !last.payload.lapsedFrom) return null;
  const { to, lapsedFrom, why } = last.payload;
  const reason =
    why === "refused"
      ? `${lapsedFrom.workerId} can no longer take it`
      : `${lapsedFrom.workerId} was offline for ${GRACE_MINUTES} minutes`;
  return `${reason}, so ${to === "any" ? "any agent may take it" : "it came back to you"}.`;
}

/** The line the Run now button shows when the server refuses, from the wait it reports. */
export function runNowRefusal(error: { code: string; message: string; body?: unknown }): string {
  const seconds = (error.body as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  if (error.code === "site_waiting" && typeof seconds === "number") {
    const at = new Date(Date.now() + seconds * 1000).toISOString();
    return `Kick Rocks is spacing out visits to this site. It can start from ${clockTime(at)}.`;
  }
  if (error.code === "restore_hold") {
    return "Sending is held after a restore. Run now works again once Kick Rocks has accounted for the mail sent since the backup.";
  }
  return error.message;
}
