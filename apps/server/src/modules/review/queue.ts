import { mailboxes, matches, messages, requests, targets, tasks } from "@kickrocks/db";
import {
  type BlockedReason,
  type BlockedTaskItem,
  isActiveStatus,
  type ReviewMessage,
  type ReviewQueue,
  type TaskKind,
  type TaskSummary,
  type VerificationItem,
  WebUrl,
} from "@kickrocks/shared";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Task } from "../../core/task-types.js";
import type { AppServices } from "../../services.js";
import { toMatch, toMessageSummary } from "./mappers.js";

/** Days a task that failed for good stays in the queue. */
export const FAILED_WINDOW_DAYS = 30;
const MESSAGE_LIMIT = 200;

/** Tasks a person can do something about. A poll or a canary has no request and nothing to retry by hand. */
const ACTIONABLE_FAILURES: readonly TaskKind[] = ["scan", "form", "agent", "confirm", "email_send"];

const MANUAL_INSTRUCTIONS: Record<BlockedReason, string> = {
  captcha:
    "Open the page, solve the CAPTCHA, and submit the form yourself. Then mark the task done.",
  phone_verification:
    "The site texts a code to a phone. Open the page, finish the check with your phone, then mark the task done.",
  id_upload:
    "The site wants a photo of ID. Kick Rocks never uploads ID for you. Decide whether to send it, then mark the task done or cancel it.",
  email_verification:
    "Check your inbox for the site's message, follow its link, then mark the task done.",
  login_required:
    "The site wants you to sign in first. Create or use an account, finish the removal, then mark the task done.",
  bot_detection:
    "The site blocked the automated browser. Open the page in your own browser and finish the removal.",
  unknown: "Open the page and finish the removal by hand, then mark the task done.",
};

const UNATTENDED_AGENT_INSTRUCTIONS =
  "No agent has picked this up. Connect one in Settings, or open the page, finish the job by hand, and mark it done. Cancel it if you do not want it done.";

/** How long a task may wait for a connected agent before a person is asked to step in. */
const AGENT_PATIENCE_MS = 24 * 60 * 60 * 1000;

const FAILED_INSTRUCTIONS =
  "This task failed and nothing will try it again by itself. Retry it, or finish the job by hand and mark it done.";

const firstWebUrl = (candidates: readonly (string | null | undefined)[]): string | null =>
  candidates.find((url): url is string => !!url && WebUrl.safeParse(url).success) ?? null;

function toItem(services: AppServices, task: Task, summary: TaskSummary): BlockedTaskItem {
  const request = task.requestId ? services.requests.get(task.requestId) : null;
  const target = task.targetId ? services.targets.get(task.targetId) : null;
  return {
    task: summary,
    requestReference: request?.reference ?? null,
    url: firstWebUrl([task.blockedUrl, request?.recordUrl, target?.optOutUrl, target?.searchUrl]),
    manualInstructions:
      task.status === "failed"
        ? FAILED_INSTRUCTIONS
        : task.status === "queued"
          ? UNATTENDED_AGENT_INSTRUCTIONS
          : MANUAL_INSTRUCTIONS[task.blockedReason ?? "unknown"],
  };
}

function items(services: AppServices, list: readonly Task[]): BlockedTaskItem[] {
  const summaries = services.taskQueue.summarize(list);
  return list.map((task, index) => toItem(services, task, summaries[index] as TaskSummary));
}

/**
 * A failed task is stale when newer work holds its dedupe key: a recipe failure that went to an
 * agent, or a retry a person already made. Listing it would offer to redo what is being done.
 */
function withoutSuperseded(
  services: AppServices,
  ids: { id: string; key: string | null; rowid: number }[],
) {
  const keys = [...new Set(ids.flatMap(({ key }) => (key ? [key] : [])))];
  if (keys.length === 0) return ids;
  const newest = new Map(
    services.db
      .select({ key: tasks.dedupeKey, rowid: sql<number>`max(rowid)` })
      .from(tasks)
      .where(inArray(tasks.dedupeKey, keys))
      .groupBy(tasks.dedupeKey)
      .all()
      .map((row) => [row.key, row.rowid]),
  );
  return ids.filter(({ key, rowid }) => key === null || (newest.get(key) ?? rowid) <= rowid);
}

function failedTasks(services: AppServices, profileId: string | undefined): BlockedTaskItem[] {
  const cutoff = new Date(
    services.clock.now().getTime() - FAILED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = services.db
    .select({ id: tasks.id, key: tasks.dedupeKey, rowid: sql<number>`rowid` })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "failed"),
        gte(tasks.updatedAt, cutoff),
        inArray(tasks.kind, [...ACTIONABLE_FAILURES]),
        profileId ? eq(tasks.profileId, profileId) : undefined,
      ),
    )
    .orderBy(desc(tasks.updatedAt), desc(sql`rowid`))
    .all();
  const open = withoutSuperseded(services, rows)
    .map(({ id }) => services.taskQueue.getOrThrow(id))
    .filter((task) => {
      const request = task.requestId ? services.requests.get(task.requestId) : null;
      return task.requestId === null || (request !== null && isActiveStatus(request.status));
    });
  return items(services, open);
}

function pendingMatches(services: AppServices, profileId: string | undefined) {
  return services.db
    .select({ match: matches, targetName: targets.name })
    .from(matches)
    .innerJoin(targets, eq(matches.targetId, targets.id))
    .where(
      and(
        eq(matches.decision, "pending"),
        profileId ? eq(matches.profileId, profileId) : undefined,
      ),
    )
    .orderBy(sql`${matches}.rowid`)
    .all()
    .map(({ match, targetName }) => toMatch(match, targetName));
}

function verifications(services: AppServices, profileId: string | undefined): VerificationItem[] {
  const rows = services.db
    .select({ request: requests, target: targets })
    .from(requests)
    .innerJoin(targets, eq(requests.targetId, targets.id))
    .where(
      and(
        eq(requests.status, "needs_verification"),
        profileId ? eq(requests.profileId, profileId) : undefined,
      ),
    )
    .orderBy(requests.updatedAt)
    .all();
  return rows.flatMap(({ request, target }) => {
    const message = services.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.requestId, request.id),
          eq(messages.classification, "verification_required"),
        ),
      )
      .orderBy(desc(messages.receivedAt), desc(sql`rowid`))
      .limit(1)
      .get();
    if (!message) return [];
    return [
      {
        request: { ...request, target: services.targets.toSummary(target) },
        message: toMessageSummary(message),
        requestedFields: message.requestedFields,
      },
    ];
  });
}

function unreviewedMessages(services: AppServices, profileId: string | undefined): ReviewMessage[] {
  const rows = services.db
    .select({ message: messages, reference: requests.reference, targetName: targets.name })
    .from(messages)
    .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
    .leftJoin(requests, eq(messages.requestId, requests.id))
    .leftJoin(targets, eq(requests.targetId, targets.id))
    .where(
      and(eq(messages.reviewed, false), profileId ? eq(mailboxes.profileId, profileId) : undefined),
    )
    .orderBy(desc(messages.receivedAt), desc(sql`${messages}.rowid`))
    .limit(MESSAGE_LIMIT)
    .all();
  return rows.map(({ message, reference, targetName }) => ({
    ...toMessageSummary(message),
    requestReference: reference,
    targetName,
  }));
}

/**
 * Work handed to an agent that nothing is going to pick up: the built-in worker never claims agent
 * tasks, so without a connected agent they would sit queued with no sign of it anywhere. With MCP
 * on, an agent may simply not have come by yet, so only a task that has waited a day is listed.
 */
function unattendedAgentTasks(services: AppServices, profileId: string | undefined): Task[] {
  const agentConnected = services.settings.get("mcp.enabled");
  const cutoff = new Date(services.clock.now().getTime() - AGENT_PATIENCE_MS).toISOString();
  return services.taskQueue
    .list({ status: "queued", kinds: ["agent"], profileId })
    .filter((task) => !agentConnected || task.createdAt <= cutoff)
    .reverse();
}

/** Everything waiting on a person, optionally for one profile. */
export function buildReviewQueue(
  services: AppServices,
  profileId: string | undefined,
): ReviewQueue {
  return {
    blockedTasks: items(services, [
      ...services.taskQueue.list({ status: "blocked", profileId }).reverse(),
      ...unattendedAgentTasks(services, profileId),
    ]),
    matches: pendingMatches(services, profileId),
    verifications: verifications(services, profileId),
    failedTasks: failedTasks(services, profileId),
    messages: unreviewedMessages(services, profileId),
  };
}
