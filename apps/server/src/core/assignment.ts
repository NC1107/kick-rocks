import {
  type AgentAssignee,
  type AssigneeRefusal,
  type AssignmentFallback,
  type AssignTarget,
  fallbackAt,
  isPersonOnlyBlock,
  type RecipePurpose,
  type TaskAssignee,
  type TaskAssignment,
} from "@kickrocks/shared";
import type { AppServices } from "../services.js";
import { modelStance } from "./agent-policy.js";
import { routedTargets } from "./claim.js";
import { nowIso } from "./clock.js";
import { conflict } from "./errors.js";
import type { Task } from "./task-types.js";

type AssignmentServices = Pick<
  AppServices,
  "db" | "clock" | "settings" | "taskQueue" | "targets" | "requests" | "claimers" | "politeness"
>;

/** What the server would say to a claim by this kind of agent, so the picker can say it first. */
export function assigneeRefusal(
  services: Pick<AppServices, "db" | "settings" | "targets" | "politeness">,
  task: { targetId: string | null; payload: { purpose: RecipePurpose } },
  kind: AgentAssignee["kind"],
): AssigneeRefusal | null {
  if (kind === "mcp") {
    if (!services.settings.get("mcp.enabled")) {
      return {
        code: "mcp_off",
        message: "MCP access is off, so no MCP client can take it.",
        settingsPath: "/settings/agents",
      };
    }
    if (task.targetId === null || !routedTargets(services)(task.targetId)) return null;
    return {
      code: "routed",
      message: "This site goes through a proxy, which an MCP client cannot use.",
      settingsPath: "/settings",
    };
  }
  const stance = modelStance(services, task);
  if (stance === "rejected") {
    return {
      code: "rejected",
      message: "You rejected the recipe for this site.",
      settingsPath: "/settings/recipes",
    };
  }
  if (stance === "unreviewed" && !services.settings.get("agent.takeUnreviewed")) {
    return {
      code: "unreviewed",
      message: "The agent worker leaves sites whose recipe waits for your review.",
      settingsPath: "/settings/agents",
    };
  }
  return null;
}

/** The part of a task that decides whether an agent may take it, for a task an agent could be given. */
export function refusalSubject(
  task: Task,
): { targetId: string | null; payload: { purpose: RecipePurpose } } | null {
  if (task.status !== "queued" && task.status !== "blocked") return null;
  if (task.kind === "agent") return task;
  if (task.kind === "scan") return { targetId: task.targetId, payload: { purpose: "scan" } };
  if (task.kind === "form") return { targetId: task.targetId, payload: { purpose: "remove" } };
  return null;
}

/**
 * Turns what the person picked into the assignment to store. "any" is no assignment, and the
 * fallback only matters for an agent, because a task kept for the person has nobody to lapse.
 */
export function assignmentFor(
  services: Pick<AppServices, "clock">,
  target: AssignTarget,
  fallback: AssignmentFallback | undefined,
): TaskAssignment | null {
  if (target === "any") return null;
  const to: TaskAssignee = target === "person" ? { kind: "person" } : target;
  return {
    to,
    at: nowIso(services.clock),
    by: "user",
    fallback: target === "person" ? "any" : (fallback ?? "any"),
  };
}

/** Refuses an assignee the server would not let take the task, with the reason the picker shows. */
export function requireAssigneeCanTake(
  services: Pick<AppServices, "db" | "settings" | "taskQueue" | "targets" | "politeness">,
  task: Task<"agent">,
  assignment: TaskAssignment | null,
): void {
  if (assignment === null || assignment.to.kind === "person") return;
  const refusal = assigneeRefusal(services, task, assignment.to.kind);
  if (refusal) throw conflict("assignee_cannot_take", refusal.message);
}

/** Records who a task is now meant for on its request's timeline, when it has one. */
function noteAssigned(
  services: Pick<AppServices, "requests">,
  task: Task,
  assignment: TaskAssignment | null,
  lapsed?: { from: AgentAssignee; why: "quiet" | "refused" },
): void {
  if (task.requestId === null) return;
  services.requests.addEvent(task.requestId, {
    type: "task_assigned",
    actor: lapsed ? "system" : "user",
    payload: {
      taskId: task.id,
      to: assignment?.to ?? "any",
      by: lapsed ? "fallback" : "user",
      ...(lapsed ? { lapsedFrom: lapsed.from, why: lapsed.why } : {}),
    },
  });
}

/** Gives a queued agent task to someone, or back to any agent. Never touches the gate. */
export function assignTask(
  services: AssignmentServices,
  taskId: string,
  target: AssignTarget,
  fallback: AssignmentFallback | undefined,
): Task {
  return services.db.transaction(() => {
    const task = services.taskQueue.getOrThrow(taskId);
    if (task.kind !== "agent") {
      throw conflict("not_assignable", `A ${task.kind} task cannot be assigned to an agent`);
    }
    if (task.status === "leased") {
      throw conflict(
        "task_running",
        "An agent is working on this task. Wait for the run to end, or stop it in Review.",
      );
    }
    if (task.status === "blocked") {
      throw conflict(
        "invalid_task_state",
        "This task is blocked. Hand it to an agent from Review instead.",
      );
    }
    const keptForPerson = task.assignment?.to.kind === "person";
    if (target !== "person" && keptForPerson && isPersonOnlyBlock(task.payload.blockedReason)) {
      throw conflict(
        "person_only_block",
        `Task ${taskId} is blocked by ${task.payload.blockedReason}, which an agent cannot get past. Open the page and finish it yourself.`,
      );
    }
    const assignment = assignmentFor(services, target, fallback);
    requireAssigneeCanTake(services, task, assignment);
    const updated = services.taskQueue.assign(taskId, assignment);
    noteAssigned(services, updated, assignment);
    return updated;
  });
}

/** When an assignment falls back: the grace after the later of the pick and the assignee's last call. */
export function assignmentFallbackAt(
  services: Pick<AppServices, "claimers">,
  assignment: TaskAssignment,
): string | null {
  if (assignment.to.kind === "person") return null;
  return fallbackAt(
    assignment,
    services.claimers.lastAvailableAt(assignment.to.kind, assignment.to.workerId),
  );
}

/**
 * Takes queued tasks back from an agent that has been quiet for the grace period, or that the
 * server would no longer give the task to because a setting changed since it was assigned: to
 * any agent, or to the person, as the one who assigned them chose. Returns how many it moved.
 */
export function lapseAssignments(services: AssignmentServices): number {
  const now = nowIso(services.clock);
  let moved = 0;
  for (const task of services.taskQueue.list({ status: "queued", kinds: ["agent"] })) {
    const { assignment } = task;
    if (assignment === null || assignment.to.kind === "person") continue;
    const from = assignment.to;
    const due = assignmentFallbackAt(services, assignment);
    const subject = refusalSubject(task);
    const refused = subject !== null && assigneeRefusal(services, subject, from.kind) !== null;
    if (!refused && (due === null || due > now)) continue;
    services.db.transaction(() => {
      const next: TaskAssignment | null =
        assignment.fallback === "person"
          ? { to: { kind: "person" }, at: now, by: "fallback", fallback: "any", lapsedFrom: from }
          : null;
      const updated = services.taskQueue.assign(task.id, next);
      noteAssigned(services, updated, next, { from, why: refused ? "refused" : "quiet" });
    });
    moved += 1;
  }
  return moved;
}
