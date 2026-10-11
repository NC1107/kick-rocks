import { z } from "zod";
import { GateVerdict, ModelIdentity } from "./agent-models.js";
import { TaskWaiting } from "./scanning.js";
import {
  AgentAssignee,
  AssigneeKind,
  AssignmentFallback,
  type TaskAssignee,
  type TaskAssignment,
  TaskSummary,
} from "./tasks.js";

/** A worker that beat its heart within this long is online. */
export const WORKER_ONLINE_MS = 2 * 60_000;

/** MCP clients do not heartbeat while idle, so a call this recent counts as active. */
export const MCP_ACTIVE_MS = 10 * 60_000;

/** An agent not seen for this long is no longer offered. */
export const AGENT_LISTED_MS = 7 * 24 * 60 * 60_000;

/** How long an assignee may stay unseen before its task falls back. */
export const ASSIGNMENT_GRACE_MS = 30 * 60_000;

/** How often an MCP client's presence is written, at most. */
export const CLAIMER_TOUCH_MS = 30_000;

/** Why the server will not give a task to one agent, with the page that changes it. */
export const AssigneeRefusal = z.object({
  code: z.enum(["unreviewed", "rejected", "routed"]),
  message: z.string(),
  settingsPath: z.string(),
});
export type AssigneeRefusal = z.infer<typeof AssigneeRefusal>;

export const AgentRow = z.object({
  kind: AssigneeKind,
  workerId: z.string(),
  /** The model an agent worker last said it drives. Null for an MCP client. */
  model: ModelIdentity.nullable(),
  /** Whether the model may send alone. Null for an MCP client, which the gate cannot see. */
  gate: GateVerdict.nullable(),
  lastSeenAt: z.iso.datetime(),
  /**
   * When an assignment to it last had a taker: an agent worker's last beat, or the last time an
   * MCP client asked for work with claim_task. Null until an MCP client has.
   */
  lastClaimAt: z.iso.datetime().nullable(),
  /** A worker beat within {@link WORKER_ONLINE_MS}, or an MCP client called within {@link MCP_ACTIVE_MS}. */
  online: z.boolean(),
  busy: z.boolean(),
  currentTargetName: z.string().nullable(),
  /** Set when a task was named in the query and the server would refuse to give it to this agent. */
  refusal: AssigneeRefusal.nullable(),
});
export type AgentRow = z.infer<typeof AgentRow>;

export const AgentsQuery = z.object({ taskId: z.string().min(1).optional() });
export type AgentsQuery = z.infer<typeof AgentsQuery>;

export const AgentsResponse = z.object({
  agents: z.array(AgentRow),
  mcpEnabled: z.boolean(),
  workerTokenSet: z.boolean(),
});
export type AgentsResponse = z.infer<typeof AgentsResponse>;

/** "any" unassigns, "person" keeps the task for the person. */
export const AssignTarget = z.union([z.enum(["any", "person"]), AgentAssignee]);
export type AssignTarget = z.infer<typeof AssignTarget>;

export const AssignBody = z.object({
  to: AssignTarget,
  fallback: AssignmentFallback.optional(),
});
export type AssignBody = z.infer<typeof AssignBody>;

/** Hand-off may name who the new agent task is for; without it the task keeps the assignment it had. */
export const HandOffBody = AssignBody.partial();
export type HandOffBody = z.infer<typeof HandOffBody>;

export const RunNowResponse = z.object({
  task: TaskSummary,
  waiting: TaskWaiting.nullable(),
});
export type RunNowResponse = z.infer<typeof RunNowResponse>;

/** When an assignment falls back: the grace period after the later of the pick and the last sighting. */
export function fallbackAt(assignment: TaskAssignment, assigneeLastSeenAt: string | null): string {
  const from = Math.max(
    Date.parse(assignment.at),
    assigneeLastSeenAt === null ? Number.NEGATIVE_INFINITY : Date.parse(assigneeLastSeenAt),
  );
  return new Date(from + ASSIGNMENT_GRACE_MS).toISOString();
}

export function assigneeLabel(to: TaskAssignee): string {
  return to.kind === "person" ? "You" : to.workerId;
}

/** "1 assigned to nick-pc-agent, 1 for any agent": how the tasks waiting for an agent are split. */
export function describeAgentTasks(counts: {
  agentTasks: number;
  assignedAgentTasks: number;
  agentAssignees: readonly string[];
}): string {
  const anyAgent = counts.agentTasks - counts.assignedAgentTasks;
  const names = counts.agentAssignees.length === 1 ? ` to ${counts.agentAssignees[0]}` : "";
  return [
    counts.assignedAgentTasks > 0 ? `${counts.assignedAgentTasks} assigned${names}` : null,
    anyAgent > 0 ? `${anyAgent} for any agent` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
}
