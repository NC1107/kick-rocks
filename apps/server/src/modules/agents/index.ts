import {
  type AgentRow,
  type AgentsResponse,
  API_ROUTES,
  gateVerdict,
  MCP_ACTIVE_MS,
  type TaskSummary,
  WORKER_ONLINE_MS,
} from "@kickrocks/shared";
import { assigneeRefusal, assignTask, refusalSubject } from "../../core/assignment.js";
import { sendsToBroker } from "../../core/claim.js";
import { AppError, conflict } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";

function targetNameOf(services: AppServices, task: Task | null): string | null {
  if (task === null || task.targetId === null) return null;
  return services.targets.get(task.targetId)?.name ?? null;
}

/** The task an agent is working on, found by its lease because an MCP client does not heartbeat. */
function leasedTo(services: AppServices, kind: "model" | "mcp", workerId: string): Task | null {
  return (
    services.taskQueue
      .list({ status: "leased", kinds: ["agent"] })
      .find((task) => task.leaseOwner === workerId && task.claimerKind === kind) ?? null
  );
}

function listAgents(services: AppServices, taskId: string | undefined): AgentsResponse {
  const now = services.clock.now().getTime();
  const records = services.settings.get("agent.gate").records;
  const named = taskId ? services.taskQueue.get(taskId) : null;
  const subject = named ? refusalSubject(named) : null;

  const agents = services.claimers.listAgents().flatMap((row): AgentRow[] => {
    if (row.kind === "builtin") return [];
    const { kind } = row;
    const online =
      now - Date.parse(row.lastSeenAt) <= (kind === "model" ? WORKER_ONLINE_MS : MCP_ACTIVE_MS);
    const leased = leasedTo(services, kind, row.workerId);
    const busy = kind === "model" ? online && row.busy : leased !== null;
    const working =
      leased ?? (row.currentTaskId ? services.taskQueue.get(row.currentTaskId) : null);
    return [
      {
        kind,
        workerId: row.workerId,
        model: row.model,
        gate: kind === "model" ? gateVerdict(records, row.model) : null,
        lastSeenAt: row.lastSeenAt,
        online,
        busy,
        currentTargetName: busy ? targetNameOf(services, working) : null,
        refusal: subject ? assigneeRefusal(services, subject, kind) : null,
      },
    ];
  });

  return {
    agents,
    mcpEnabled: services.settings.get("mcp.enabled"),
    workerTokenSet: services.config.workerToken !== null,
  };
}

/** A refusal that says when to ask again, in whole seconds, so the page can show a clock time. */
function stillWaiting(services: AppServices, why: string, until: string): AppError {
  const seconds = Math.max(
    1,
    Math.ceil((Date.parse(until) - services.clock.now().getTime()) / 1000),
  );
  return new AppError(
    409,
    "site_waiting",
    `${why} Try again in about ${Math.ceil(seconds / 60)} min.`,
    undefined,
    seconds,
  );
}

export const agentsModule: ModulePlugin = (app, services) => {
  const summary = (task: Task): TaskSummary =>
    services.taskQueue.summarize([task])[0] as TaskSummary;

  registerRoute(app, API_ROUTES.agentsList, ({ query }) => listAgents(services, query.taskId));

  registerRoute(app, API_ROUTES.taskAssign, ({ params, body }) => ({
    task: summary(assignTask(services, params.id, body.to, body.fallback)),
  }));

  registerRoute(app, API_ROUTES.taskRunNow, ({ params }) => {
    const task = services.taskQueue.getOrThrow(params.id);
    if (task.kind !== "agent" || task.status !== "queued") {
      throw conflict("invalid_task_state", "Only a queued agent task can be run now");
    }
    const to = task.assignment?.to;
    if (to?.kind === "person") {
      throw conflict("assigned_to_person", "You are doing this task yourself.");
    }
    if (to?.kind === "mcp") {
      throw conflict(
        "mcp_pulls",
        "An MCP client takes work when it calls claim_task, so Kick Rocks cannot start it.",
      );
    }
    const onlineSince = services.clock.now().getTime() - WORKER_ONLINE_MS;
    const takers = services.claimers
      .listAgents()
      .filter(
        (row) =>
          row.kind === "model" &&
          Date.parse(row.lastSeenAt) >= onlineSince &&
          (to === undefined || row.workerId === to.workerId),
      );
    if (takers.length === 0) {
      throw conflict("no_agent_online", "No agent worker is online to take it.");
    }
    if (services.restoreGate.holding() && sendsToBroker(task)) {
      throw conflict(
        "restore_hold",
        "Sending is held after a restore, until the mail sent since the backup is accounted for.",
      );
    }
    const now = services.clock.now().toISOString();
    if (task.leaseOwner !== null && task.runAfter !== null && task.runAfter > now) {
      throw stillWaiting(
        services,
        "The earlier run may still be going, so the task is kept back for a while.",
        task.runAfter,
      );
    }
    const waiting = services.taskQueue.waitingFor(task);
    if (waiting !== null) {
      throw stillWaiting(
        services,
        `Kick Rocks is pacing its visits to ${waiting.domain}.`,
        waiting.until,
      );
    }
    const cleared = services.taskQueue.clearBackoff(task.id);
    return { task: summary(cleared), waiting: services.taskQueue.waitingFor(cleared) };
  });
};
