import {
  type AgentRow,
  API_ROUTES,
  type AssigneeRefusal,
  type AssignmentFallback,
  type AssignTarget,
  gateVerdict,
  MCP_ACTIVE_MS,
  type ModelIdentity,
  type TaskAssignment,
  type TaskSummary,
  WORKER_ONLINE_MS,
} from "@kickrocks/shared";
import { conflict, defineMockDomain, handle, MockHttpError, notFound } from "./core.js";
import { addEvent, makeTask } from "./requests.js";
import type { MockStore } from "./store.js";

/** A worker or MCP client that has called in, as the mock remembers it. */
export interface MockAgent {
  kind: "model" | "mcp";
  workerId: string;
  model: ModelIdentity | null;
  /** How long before now it last called. Stored as an offset so the fixture stays as stale as it was set. */
  seenAgoMs: number;
  /** The target it is working on, when it is busy. */
  busyWithTargetId: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const GPT_OSS: ModelIdentity = {
  provider: "ollama",
  name: "gpt-oss:20b",
  version: "sha256:4f2a9c1d7e3b",
  thinking: "default",
  numCtx: 16_384,
};
const QWEN: ModelIdentity = {
  provider: "ollama",
  name: "qwen3:14b",
  version: null,
  thinking: "off",
  numCtx: 16_384,
};

export type AgentPreset = "none" | "one" | "several";
export const AGENT_PRESETS: readonly AgentPreset[] = ["none", "one", "several"];

/** The agents a walk through the UI can start from: nobody, one worker, or a mixed set. */
export function presetAgents(preset: AgentPreset): MockAgent[] {
  const worker: MockAgent = {
    kind: "model",
    workerId: "nick-pc-agent",
    model: GPT_OSS,
    seenAgoMs: 10_000,
    busyWithTargetId: null,
  };
  if (preset === "none") return [];
  if (preset === "one") return [worker];
  return [
    worker,
    {
      kind: "model",
      workerId: "laptop-agent",
      model: QWEN,
      seenAgoMs: 3 * HOUR + 8 * MINUTE,
      busyWithTargetId: null,
    },
    {
      kind: "mcp",
      workerId: "desk-client",
      model: null,
      seenAgoMs: 4 * MINUTE,
      busyWithTargetId: null,
    },
    {
      kind: "mcp",
      workerId: "cursor",
      model: null,
      seenAgoMs: 2 * HOUR + 8 * MINUTE,
      busyWithTargetId: null,
    },
  ];
}

/**
 * Queued agent tasks on two requests, for a walk through the assign flow. Seeded only by the
 * /__mock/agents control, so the default fixtures hold no task waiting for an agent.
 */
function ensureDemoTasks(store: MockStore): void {
  const jordan = store.profiles[0];
  for (const targetId of ["stayfield-hotels", "pixelforge"]) {
    const request = store.requests.find(
      (candidate) => candidate.targetId === targetId && candidate.profileId === jordan?.id,
    );
    const target = store.targets.find((candidate) => candidate.id === targetId);
    if (!(jordan && request && target)) continue;
    if (store.tasks.some((task) => task.kind === "agent" && task.requestId === request.id))
      continue;
    const task = makeTask(
      store,
      {
        kind: "agent",
        status: "queued",
        profileId: jordan.id,
        targetId: target.id,
        targetName: target.name,
        requestId: request.id,
      },
      { minutes: 25 },
    );
    addEvent(store, request, "task_enqueued", "system", task.updatedAt, {
      taskId: task.id,
      kind: "agent",
    });
  }
}

/** Sets who has connected and makes sure a task waits for an agent. */
export function applyAgentPreset(store: MockStore, preset: AgentPreset): void {
  store.agents = presetAgents(preset);
  ensureDemoTasks(store);
}

function rowsOf(store: MockStore, task: TaskSummary | null): AgentRow[] {
  const now = store.clock.now().getTime();
  const records = store.settings.agent.gate.records;
  return store.agents.map((agent) => {
    const online = agent.seenAgoMs <= (agent.kind === "model" ? WORKER_ONLINE_MS : MCP_ACTIVE_MS);
    const target = store.targets.find((candidate) => candidate.id === agent.busyWithTargetId);
    const seen = new Date(now - agent.seenAgoMs).toISOString();
    return {
      kind: agent.kind,
      workerId: agent.workerId,
      model: agent.model,
      gate: agent.kind === "model" ? gateVerdict(records, agent.model) : null,
      lastSeenAt: seen,
      lastClaimAt: seen,
      online,
      busy: online && agent.busyWithTargetId !== null,
      currentTargetName: online ? (target?.name ?? null) : null,
      refusal: task ? refusalFor(store, task, agent.kind) : null,
    };
  });
}

/** The reasons the real server gives, by what the mock knows of the site's recipe and route. */
function refusalFor(
  store: MockStore,
  task: TaskSummary,
  kind: "model" | "mcp",
): AssigneeRefusal | null {
  if (task.status !== "queued" && task.status !== "blocked") return null;
  const target = store.targets.find((candidate) => candidate.id === task.targetId);
  if (kind === "mcp") {
    const { proxyUrl, domains } = store.settings.egress;
    if (proxyUrl && target && domains.includes(target.domain)) {
      return {
        code: "routed",
        message: "This site goes through a proxy, which an MCP client cannot use.",
        settingsPath: "/settings",
      };
    }
    return null;
  }
  const purpose = task.requestId ? "remove" : "scan";
  const statuses = new Set(
    store.recipes
      .filter((recipe) => recipe.targetId === task.targetId && recipe.purpose === purpose)
      .map((recipe) => recipe.status),
  );
  if (!statuses.has("active") && statuses.has("rejected")) {
    return {
      code: "rejected",
      message: "You rejected the recipe for this site.",
      settingsPath: "/settings/recipes",
    };
  }
  if (
    !statuses.has("active") &&
    statuses.has("pending_review") &&
    !store.settings.agent.takeUnreviewed
  ) {
    return {
      code: "unreviewed",
      message: "The agent worker leaves sites whose recipe waits for your review.",
      settingsPath: "/settings/agents",
    };
  }
  return null;
}

/** What the person picked, as the assignment the task carries. Null means any agent. */
export function assignmentFor(
  store: MockStore,
  to: AssignTarget,
  fallback: AssignmentFallback | undefined,
): TaskAssignment | null {
  if (to === "any") return null;
  return {
    to: to === "person" ? { kind: "person" } : to,
    at: store.clock.now().toISOString(),
    by: "user",
    fallback: to === "person" ? "any" : (fallback ?? "any"),
  };
}

function requireTakes(
  store: MockStore,
  task: TaskSummary,
  assignment: TaskAssignment | null,
): void {
  if (assignment === null || assignment.to.kind === "person") return;
  const refusal = refusalFor(store, task, assignment.to.kind);
  if (refusal) throw new MockHttpError(409, "assignee_cannot_take", refusal.message);
}

export default defineMockDomain({
  name: "agents",

  routes: (store) => {
    const taskOf = (id: string): TaskSummary => {
      const task = store.tasks.find((candidate) => candidate.id === id);
      if (!task) throw notFound("That task");
      return task;
    };

    return [
      handle(API_ROUTES.agentsList, ({ query }) => ({
        agents: rowsOf(store, query.taskId ? taskOf(query.taskId) : null),
        mcpEnabled: store.settings.mcp.enabled,
        workerTokenSet: store.settings.worker.enabled,
      })),

      handle(API_ROUTES.taskAssign, ({ params, body }) => {
        const task = taskOf(params.id);
        if (task.kind !== "agent") throw conflict("Only an agent task can be assigned.");
        if (task.status === "leased") {
          throw new MockHttpError(
            409,
            "task_running",
            "An agent is working on this task. Wait for the run to end, or stop it in Review.",
          );
        }
        if (task.status !== "queued") throw conflict("Only a queued task can be assigned.");
        const assignment = assignmentFor(store, body.to, body.fallback);
        requireTakes(store, task, assignment);
        task.assignment = assignment;
        task.updatedAt = store.clock.now().toISOString();
        const request = store.requests.find((candidate) => candidate.id === task.requestId);
        if (request) {
          addEvent(store, request, "task_assigned", "user", task.updatedAt, {
            taskId: task.id,
            to: assignment?.to ?? "any",
            by: "user",
          });
        }
        return { task };
      }),

      handle(API_ROUTES.taskRunNow, ({ params }) => {
        const task = taskOf(params.id);
        if (task.kind !== "agent" || task.status !== "queued") {
          throw conflict("Only a queued agent task can be run now.");
        }
        const to = task.assignment?.to;
        if (to?.kind === "person") throw conflict("You are doing this task yourself.");
        if (to?.kind === "mcp") {
          throw conflict("An MCP client takes work when it calls claim_task.");
        }
        const takers = rowsOf(store, null).filter(
          (row) => row.kind === "model" && row.online && (!to || row.workerId === to.workerId),
        );
        const taker = takers[0];
        if (!taker) throw conflict("No agent worker is online to take it.");
        task.status = "leased";
        task.claimerKind = "model";
        task.updatedAt = store.clock.now().toISOString();
        const agent = store.agents.find((candidate) => candidate.workerId === taker.workerId);
        if (agent) agent.busyWithTargetId = task.targetId;
        return { task, waiting: null };
      }),
    ];
  },
});
