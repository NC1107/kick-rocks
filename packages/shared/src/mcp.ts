import { z } from "zod";
import { Recipe, RecipePurpose, RecipeRecord } from "./recipe.js";
import { TargetDetail } from "./targets.js";
import {
  BrowserTaskKind,
  ClaimedTask,
  LEASE_MS,
  LeaseMs,
  TaskBlockReport,
  TaskFailureReport,
  TaskKind,
  TaskStatus,
  TaskSummary,
  TaskUsage,
} from "./tasks.js";
import {
  AGENT_DEFAULT_KINDS,
  TaskHeartbeatResponse,
  TaskReleaseBody,
  TaskTransitionResponse,
} from "./worker.js";

const WorkerName = z.string().min(1).max(100);
const TaskId = z.string().min(1);

/**
 * The tools an MCP client sees. The names are the wire names; each tool's input and output are
 * the schemas the server registers it with, so a client library can validate both ends.
 */
export const MCP_TOOLS = {
  list_tasks: {
    description:
      "List tasks with a redacted summary: kind, status, target name, and blocked reason. Contains no personal data.",
    input: z.object({
      status: TaskStatus.optional(),
      kind: TaskKind.optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    output: z.object({ tasks: z.array(TaskSummary) }),
  },
  claim_task: {
    description:
      "Lease the next queued task meant for an agent, or a specific task by id. Returns the full task, including the identifiers it may use and step-by-step instructions, or null when nothing is waiting. Without kinds it takes agent tasks only. With taskId, kinds is ignored: a queued task is leased as it is, and a task a person parked as blocked is handed to you as a new agent task, which names the human check that stopped the earlier run.",
    input: z.object({
      workerId: WorkerName,
      kinds: z
        .array(BrowserTaskKind)
        .min(1)
        .default(() => [...AGENT_DEFAULT_KINDS]),
      taskId: TaskId.optional(),
      leaseMs: LeaseMs.default(LEASE_MS.default),
    }),
    output: z.object({ task: ClaimedTask.nullable() }),
  },
  heartbeat_task: {
    description:
      "Extend the lease on a task you hold. Call it while a long task is running. For a removal, call it with mayHaveSubmitted true as soon as you have clicked the submit button, so the task is held for a person and not retried if your lease runs out.",
    input: z.object({
      workerId: WorkerName,
      taskId: TaskId,
      leaseMs: LeaseMs.default(LEASE_MS.default),
      mayHaveSubmitted: z.boolean().optional(),
    }),
    output: TaskHeartbeatResponse,
  },
  complete_task: {
    description:
      "Report the result of a task you hold. The result must match the shape the task's instructions describe. Include usage with the tokens and cost your run took, so it can be measured.",
    input: z.object({
      workerId: WorkerName,
      taskId: TaskId,
      result: z.unknown(),
      usage: TaskUsage.optional(),
    }),
    output: TaskTransitionResponse,
  },
  block_task: {
    description:
      "Park a task for a human when you hit a CAPTCHA, phone or ID demand, login wall, or bot check. Never try to get past one.",
    input: TaskBlockReport.extend({ workerId: WorkerName, taskId: TaskId }),
    output: TaskTransitionResponse,
  },
  fail_task: {
    description:
      "Report that a task failed. Set retryable when trying again later could work, and kind to site (the broker's page is broken or down), network, or internal (you gave up). Never use recipe.",
    input: TaskFailureReport.extend({ workerId: WorkerName, taskId: TaskId }),
    output: TaskTransitionResponse,
  },
  release_task: {
    description:
      "Hand back a task you hold without finishing it, for example when you are shutting down. It goes back in the queue and the attempt is not counted.",
    input: TaskReleaseBody.extend({ taskId: TaskId }),
    output: TaskTransitionResponse,
  },
  get_target: {
    description:
      "Look up a broker or company: contacts, requirements, and the recipes that exist for it.",
    input: z.object({ targetId: z.string().min(1) }),
    output: TargetDetail,
  },
  get_recipe: {
    description: "Read the recipes stored for a target, optionally for one purpose.",
    input: z.object({ targetId: z.string().min(1), purpose: RecipePurpose.optional() }),
    output: z.object({ recipes: z.array(RecipeRecord) }),
  },
  propose_recipe: {
    description:
      "Submit a new or improved recipe. It is held for a person to review and never runs until approved.",
    input: z.object({ recipe: Recipe, notes: z.string().max(2000).optional() }),
    output: z.object({ recipe: RecipeRecord }),
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;
export const MCP_TOOL_NAMES = Object.keys(MCP_TOOLS) as McpToolName[];
export type McpToolInput<N extends McpToolName> = z.input<(typeof MCP_TOOLS)[N]["input"]>;
export type McpToolOutput<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]["output"]>;
