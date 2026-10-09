import { responseWindow } from "../runners/deadlines.js";
import type { AppServices } from "../services.js";
import { sendsToBroker } from "./claim.js";
import type { SendChannel } from "./sent-journal.js";
import type { Task } from "./task-types.js";

type SettleServices = Pick<
  AppServices,
  "taskQueue" | "requests" | "sentJournal" | "clock" | "db" | "logger" | "settings" | "legal"
>;

/** The channels whose send satisfies a task: a form can be taken over by an agent, a link only by itself. */
const SATISFYING: Record<"form" | "agent" | "confirm", readonly SendChannel[]> = {
  form: ["form", "agent"],
  agent: ["form", "agent"],
  confirm: ["confirm"],
};

export const MAY_HAVE_BEEN_SUBMITTED =
  "This may have been submitted after the backup was taken, and the restored data does not show it. Confirm on the broker's side before submitting it again.";

/**
 * Decides what becomes of the browser work that was queued when the data was restored, before the
 * hold on it lifts. No Sent folder exists for a form, so a task that was already queued cannot be
 * told apart from one the earlier instance ran after the backup, unless the send journal shows it
 * went out. A send the journal shows is recorded and its task closed. Every other one goes to Review,
 * where a person decides, instead of submitting a second time. Work queued after the restore is new.
 */
export function settleBrowserWorkAfterRestore(services: SettleServices, restoredAt: Date): void {
  const { taskQueue, sentJournal, logger } = services;
  // An expired lease from before the restore is a task that was running, and it is queued by now.
  taskQueue.reapExpiredLeases();
  const journal = sentJournal.entries();
  let closed = 0;
  let held = 0;
  for (const task of taskQueue.list({ status: "queued", kinds: ["form", "confirm", "agent"] })) {
    if (!sendsToBroker(task)) continue;
    if (Date.parse(task.createdAt) >= restoredAt.getTime()) continue;
    const satisfying = SATISFYING[task.kind as keyof typeof SATISFYING];
    const sent =
      task.requestId !== null &&
      journal.some(
        (entry) =>
          entry.requestId === task.requestId &&
          satisfying.includes(entry.channel) &&
          entry.at > task.createdAt,
      );
    if (sent) {
      closeAsSent(services, task);
      closed += 1;
    } else {
      taskQueue.holdQueuedForPerson(task.id, { detail: MAY_HAVE_BEEN_SUBMITTED, actor: "system" });
      held += 1;
    }
  }
  if (closed + held > 0)
    logger.info({ closed, held }, "browser work queued at the restore settled");
}

function closeAsSent(services: SettleServices, task: Task): void {
  const { taskQueue, requests, clock } = services;
  services.db.transaction(() => {
    taskQueue.cancel(task.id, "system");
    if (task.kind === "confirm" || task.requestId === null) return;
    const request = requests.get(task.requestId);
    if (request?.status !== "queued") return;
    const now = clock.now();
    const window = responseWindow(services, request, now);
    requests.transition(request.id, "awaiting_reply", {
      actor: "system",
      event: {
        type: "sent",
        payload: {
          channel: "form",
          kind: "initial",
          messageId: null,
          mailboxId: request.mailboxId,
          foundInJournal: true,
        },
      },
      patch: {
        sentAt: now.toISOString(),
        followUps: 0,
        dueAt: window.dueAt,
        followUpAt: window.followUpAt,
        lastError: null,
        awaitingConfirmationSince: null,
      },
    });
  });
}
