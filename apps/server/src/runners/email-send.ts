import { mailboxes, messages, outgoingMail, tasks } from "@kickrocks/db";
import {
  canTransition,
  type EmailKind,
  outgoingMessageId,
  type RequestRecord,
} from "@kickrocks/shared";
import { and, count, eq } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import type { RequestPatch } from "../core/requests.js";
import type { Task } from "../core/task-types.js";
import { MailSendError, provesNeverSent } from "../mail/transport.js";
import type { OutgoingMail } from "../mail/types.js";
import type { AppServices } from "../services.js";
import { connectionOf, describeError } from "./connection.js";
import { responseWindow } from "./deadlines.js";
import { MailPacer } from "./pacing.js";

const EMAIL_WORKER_ID = "server:email-send";
const LEASE_MS = 5 * 60 * 1000;
/**
 * One pass handles a bounded number of tasks for a bounded time. The scheduler runs its other jobs
 * in the same loop, so a pass that waited on every slow server in turn would starve them.
 */
const PASS_MAX_TASKS = 20;
const PASS_MAX_MS = 60 * 1000;
const HOLDER_STATUSES = new Set<Task["status"]>(["leased", "queued", "failed"]);

type EmailTask = Task<"email_send">;

/** Replies that say the login is not accepted, which no other message through the same mailbox can fix. */
const MAILBOX_RESPONSE_CODES = new Set([421, 530, 534, 535, 538]);

const MAILBOX_ERROR_CODES = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EDNS",
  "ENOTFOUND",
  "ESOCKET",
  "ETIMEDOUT",
  "ETLS",
  "EAUTH",
]);

/** The server could not be reached or would not let the mailbox in, which says nothing about the request. */
export function isMailboxProblem(error: unknown): boolean {
  const { responseCode, code, command } = error as {
    responseCode?: unknown;
    code?: unknown;
    command?: unknown;
  };
  return (
    (typeof responseCode === "number" && MAILBOX_RESPONSE_CODES.has(responseCode)) ||
    (typeof code === "string" && MAILBOX_ERROR_CODES.has(code)) ||
    // A refused sender or login says the mailbox is misconfigured or blocked, whatever the broker is.
    command === "MAIL FROM" ||
    (typeof command === "string" && command.startsWith("AUTH"))
  );
}

/** SMTP says a 5xx answer will not change by asking again, and a bad address is the same. */
function isPermanentSendError(error: unknown): boolean {
  const { responseCode, code } = error as { responseCode?: unknown; code?: unknown };
  // A reply decides on its own: nodemailer files a greylisted 450 under EENVELOPE as well.
  if (typeof responseCode === "number") return responseCode >= 500 && responseCode < 600;
  return code === "EENVELOPE";
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

/**
 * Sends the `email_send` tasks that are due. It is the only code that sends mail: it composes
 * with the same composer the campaign preview uses, respects the mailbox's daily cap and the gap
 * between sends, and records the send, the request's new status, and the task's completion in one
 * transaction so none of them can be missing.
 *
 * A send cannot be undone, so the order is send first and record second. A crash in between makes
 * the lease expire and the mail go out again, which a reply can be matched to either way, whereas
 * recording first would lose a request the person believes was sent.
 */
export class EmailRunner {
  readonly pacer: MailPacer;
  /** Sends that have not yet offered a message body, so a shutdown can tell which ones sent nothing. */
  private readonly beforeData = new Set<string>();
  /** Mail that was offered to a server and not yet recorded, kept here too because a full disk refuses the database marker. */
  private readonly offered = new Map<string, string>();
  /** Sends the server answered with a refusal, whose database marker may outlive the failure if that could not be written. */
  private readonly refused = new Set<string>();

  constructor(
    private readonly services: AppServices,
    random: () => number,
  ) {
    this.pacer = new MailPacer(services, random, services.config.sendGapMs);
  }

  /** A send that is still connecting or logging in has put nothing on the wire that could be delivered. */
  sentNothingYet(taskId: string): boolean {
    return this.beforeData.has(taskId);
  }

  /**
   * Sends the tasks that are due, up to the pass budget, and returns how many went out. A mailbox
   * that fails to connect or log in is held by the first task, so the claim skips the rest of its
   * tasks and the slow server is tried once per pass.
   */
  async runDue(): Promise<number> {
    const { taskQueue, clock } = this.services;
    const deadline = clock.now().getTime() + PASS_MAX_MS;
    let sent = 0;
    for (
      let handled = 0;
      handled < PASS_MAX_TASKS && clock.now().getTime() < deadline;
      handled += 1
    ) {
      const task = taskQueue.claim({
        workerId: EMAIL_WORKER_ID,
        kinds: ["email_send"],
        leaseMs: LEASE_MS,
        excludeProfileIds: this.pacer.waitingProfileIds(),
      });
      if (task?.kind !== "email_send") break;
      if (await this.process(task)) sent += 1;
    }
    return sent;
  }

  private async process(task: EmailTask): Promise<boolean> {
    const { taskQueue, requests, composer, mail, logger } = this.services;
    const request = requests.get(task.payload.requestId);
    const earlier = this.offeredEarlier(task.id);
    if (request?.status !== "queued") {
      if (request && earlier) this.recordOfferedBeforeChange(task, request, earlier);
      this.cancelUnlessFinished(task.id);
      return false;
    }

    // Settled before composing, because composing can throw once the dataset has changed, and then
    // the Message-ID of mail that may already be delivered would never be recorded.
    if (earlier) {
      return this.settleEarlierAttempt(task, request, earlier);
    }

    let composed: ReturnType<typeof composer.requestEmail>;
    try {
      composed = composer.requestEmail(request, task.payload.kind, {
        requestedFields: task.payload.fields,
      });
    } catch (error) {
      this.fail(task, request, error, { retryable: false, kind: "internal" });
      return false;
    }

    const mailbox = this.services.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, composed.mailboxId))
      .get();
    if (!mailbox) {
      this.fail(task, request, new Error("The mailbox is gone"), {
        retryable: false,
        kind: "internal",
      });
      return false;
    }

    const wait = this.pacer.waitUntil(mailbox);
    if (wait) {
      taskQueue.release(task.id, { workerId: EMAIL_WORKER_ID, runAfter: wait });
      return false;
    }

    let outgoing: OutgoingMail;
    try {
      outgoing = this.buildMail(request, task, composed, mailbox.address);
    } catch (error) {
      this.fail(task, request, error, { retryable: false, kind: "internal" });
      return false;
    }

    this.beforeData.add(task.id);
    try {
      const result = await mail.transport(connectionOf(mailbox)).send(outgoing, {
        onData: () => this.beforeData.delete(task.id),
        onBodyEnd: () => this.markOffered(task.id, outgoing.messageId),
      });
      if (result.accepted.length === 0) {
        throw Object.assign(new Error("The mail server rejected the address"), {
          responseCode: 550,
        });
      }
    } catch (error) {
      logger.warn({ requestId: request.id, err: describeError(error) }, "email send failed");
      if (this.cutOffAfterOffer(task.id, error)) {
        return this.settleUnconfirmed(
          task,
          request,
          composed.mailboxId,
          outgoing.messageId,
          describeError(error),
          composed.to,
        );
      }
      this.refused.add(task.id);
      if (isMailboxProblem(error)) {
        this.holdMailbox(task, request, mailbox.id, error);
        return false;
      }
      const permanent = isPermanentSendError(error);
      this.fail(task, request, error, {
        retryable: !permanent,
        kind: permanent ? "site" : "network",
      });
      return false;
    } finally {
      this.beforeData.delete(task.id);
    }

    this.services.mailHolds.clear(mailbox.id);
    this.services.db
      .update(mailboxes)
      .set({ lastSendError: null })
      .where(eq(mailboxes.id, mailbox.id))
      .run();
    const recorded = this.recordSend(task, request.id, composed.mailboxId, outgoing.messageId, {
      recipient: composed.to,
    });
    this.clearOffered(task.id);
    return recorded;
  }

  /** A reply or a refusal settles the send either way, so only a silent end leaves it unknown. */
  private cutOffAfterOffer(taskId: string, error: unknown): boolean {
    if (!this.offered.has(taskId) || this.beforeData.has(taskId)) return false;
    return typeof (error as { responseCode?: unknown }).responseCode !== "number";
  }

  private markOffered(taskId: string, messageId: string): void {
    this.refused.delete(taskId);
    this.offered.set(taskId, messageId);
    try {
      this.services.db
        .update(tasks)
        .set({ unconfirmedMessageId: messageId })
        .where(eq(tasks.id, taskId))
        .run();
    } catch (error) {
      this.services.logger.warn({ err: describeError(error) }, "could not note the offered mail");
    }
  }

  private offeredEarlier(taskId: string): string | null {
    const row = this.services.db
      .select({ id: tasks.unconfirmedMessageId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .get();
    if (this.refused.has(taskId)) return null;
    return this.offered.get(taskId) ?? row?.id ?? null;
  }

  private clearOffered(taskId: string): void {
    this.offered.delete(taskId);
    try {
      this.services.db
        .update(tasks)
        .set({ unconfirmedMessageId: null })
        .where(eq(tasks.id, taskId))
        .run();
    } catch (error) {
      this.services.logger.warn({ err: describeError(error) }, "could not clear the offered mail");
    }
  }

  /**
   * The server answered, so the mail is not in doubt any more. The marker goes in the same
   * transaction as the outcome that follows, because a marker that outlives a refusal would make
   * the next start count a refused mail as sent.
   */
  private clearMarkerInTransaction(taskId: string): void {
    this.services.db
      .update(tasks)
      .set({ unconfirmedMessageId: null })
      .where(eq(tasks.id, taskId))
      .run();
  }

  /**
   * A mail whose whole body went out without an answer may be delivered, and mailing a broker twice
   * costs the person more than a request that goes unanswered, which a follow-up already covers. So
   * it is counted as sent and the timeline says the server did not confirm it. The mailbox is left
   * alone because the person has nothing to fix there.
   */
  private settleUnconfirmed(
    task: EmailTask,
    request: RequestRecord,
    mailboxId: string,
    messageId: string,
    cause: string,
    recipient: string | null,
  ): boolean {
    this.services.logger.warn(
      { requestId: request.id, cause },
      "a send was cut off before the mail server answered, so it is counted as sent",
    );
    const recorded = this.recordSend(task, request.id, mailboxId, messageId, {
      unconfirmed: true,
      recipient,
    });
    this.clearOffered(task.id);
    return recorded;
  }

  /**
   * The person changed the request after the process died with its mail on the wire. The mail may
   * be delivered, and a broker reply to it can only be matched if the Message-ID is on record.
   */
  private recordOfferedBeforeChange(
    task: EmailTask,
    request: RequestRecord,
    messageId: string,
  ): void {
    const mailboxId = this.mailboxIdOf(request);
    if (mailboxId) {
      this.recordSend(task, request.id, mailboxId, messageId, {
        unconfirmed: true,
        recipient: this.intendedRecipient(task, request),
      });
    }
    this.clearOffered(task.id);
  }

  /** A process that died with its mail on the wire is settled as the cut-off send it was. */
  private settleEarlierAttempt(
    task: EmailTask,
    request: RequestRecord,
    messageId: string,
  ): boolean {
    const mailboxId = this.mailboxIdOf(request);
    if (!mailboxId) {
      // The mail may be delivered, so its marker stays for whoever can still match it.
      this.fail(task, request, new Error("The mailbox is gone"), {
        retryable: false,
        kind: "internal",
        keepMarker: true,
      });
      return false;
    }
    return this.settleUnconfirmed(
      task,
      request,
      mailboxId,
      messageId,
      "an earlier attempt",
      this.intendedRecipient(task, request),
    );
  }

  /** Where the lost attempt was addressed, when it can still be told; a follow-up falls back to the dataset otherwise. */
  private intendedRecipient(task: EmailTask, request: RequestRecord): string | null {
    try {
      return this.services.composer.requestEmail(request, task.payload.kind, {
        requestedFields: task.payload.fields,
      }).to;
    } catch {
      return null;
    }
  }

  private mailboxIdOf(request: RequestRecord): string | null {
    const { db } = this.services;
    const mailbox = request.mailboxId
      ? db.select().from(mailboxes).where(eq(mailboxes.id, request.mailboxId)).get()
      : db.select().from(mailboxes).where(eq(mailboxes.profileId, request.profileId)).get();
    return mailbox?.id ?? null;
  }

  private cancelUnlessFinished(taskId: string): void {
    const live = this.services.taskQueue.get(taskId);
    if (live && live.status !== "done" && live.status !== "cancelled") {
      this.services.taskQueue.cancel(taskId, "system");
    }
  }

  /**
   * Pauses the mailbox and shows the person why it is idle. The task keeps its attempt only when
   * the failure proves the mail never reached the server, because a drop after DATA may have
   * delivered it and every hold would then send it again without limit.
   */
  private holdMailbox(
    task: EmailTask,
    request: RequestRecord,
    mailboxId: string,
    error: unknown,
  ): void {
    const { db, taskQueue } = this.services;
    const until = this.services.mailHolds.hold(mailboxId);
    const neverSent = error instanceof MailSendError ? error.neverSent : provesNeverSent(error);
    db.transaction(() => {
      this.clearMarkerInTransaction(task.id);
      db.update(mailboxes)
        .set({ lastSendError: `Sending is paused: ${describeError(error)}` })
        .where(eq(mailboxes.id, mailboxId))
        .run();
      // A send that outlived its lease was already requeued by the reaper, and only a live lease can be released.
      if (neverSent) {
        if (taskQueue.getOrThrow(task.id).status === "leased") {
          taskQueue.release(task.id, { workerId: EMAIL_WORKER_ID, runAfter: until });
        }
      } else this.fail(task, request, error, { retryable: true, kind: "network" });
    });
    this.offered.delete(task.id);
    this.refused.delete(task.id);
  }

  private buildMail(
    request: RequestRecord,
    task: EmailTask,
    composed: {
      email: { subject: string; text: string };
      to: string;
      input: { sender: { name: string | null; address: string } };
    },
    mailboxAddress: string,
  ): OutgoingMail {
    const { db } = this.services;
    const previousSends =
      db
        .select({ n: count() })
        .from(outgoingMail)
        .where(eq(outgoingMail.requestId, request.id))
        .get()?.n ?? 0;
    const inReplyTo =
      task.payload.inReplyTo ??
      (task.payload.kind === "follow_up" ? request.outgoingMessageId : null);
    const references = [
      ...new Set([inReplyTo, request.outgoingMessageId].filter(Boolean)),
    ] as string[];
    return {
      from: { name: composed.input.sender.name, address: mailboxAddress },
      to: composed.to,
      subject: composed.email.subject,
      text: composed.email.text,
      messageId: outgoingMessageId(request.id, domainOf(mailboxAddress), previousSends),
      ...(inReplyTo ? { inReplyTo } : {}),
      ...(references.length > 0 ? { references } : {}),
    };
  }

  private recordSend(
    task: EmailTask,
    requestId: string,
    mailboxId: string,
    messageId: string,
    {
      unconfirmed = false,
      recipient = null,
    }: { unconfirmed?: boolean; recipient?: string | null } = {},
  ): boolean {
    const { db, taskQueue, requests, mailQuota, clock } = this.services;
    const kind: EmailKind = task.payload.kind;
    return db.transaction(() => {
      if (!requests.get(requestId) || !taskQueue.get(task.id)) {
        this.services.logger.info(
          { requestId },
          "the profile was deleted while its mail was in flight, so the send is not recorded",
        );
        return false;
      }
      mailQuota.record({ mailboxId, requestId, kind, messageId, recipient });
      const current = requests.getOrThrow(requestId);
      const live = taskQueue.getOrThrow(task.id);
      const sentEvent = {
        type: "sent" as const,
        payload: {
          channel: "email" as const,
          kind,
          messageId,
          mailboxId,
          ...(unconfirmed ? { unconfirmed } : {}),
        },
      };
      // A send can outlast its lease, which puts the task back in the queue (or fails it) but keeps
      // us as its last holder, and finishing it as that holder is what stops the next pass mailing it again.
      const holdsTask = live.leaseOwner === EMAIL_WORKER_ID && HOLDER_STATUSES.has(live.status);
      if (current.status !== "queued" || !holdsTask) {
        // The person changed the request while the mail was on its way, so only the fact is kept.
        requests.addEvent(requestId, { ...sentEvent, actor: "system" });
        // A task still ours must be finished, or its lease would expire and send the mail again.
        if (holdsTask) {
          taskQueue.complete(task.id, {
            workerId: EMAIL_WORKER_ID,
            actor: "system",
            result: { messageId, kind },
          });
        }
        return true;
      }

      const now = clock.now();
      const window = responseWindow(this.services, current, now);
      const first: RequestPatch = {
        mailboxId,
        lastError: null,
        outgoingMessageId:
          kind === "initial" ? messageId : (current.outgoingMessageId ?? messageId),
        ...(kind === "initial" ? { sentAt: now.toISOString(), followUps: 0 } : {}),
        ...(kind === "follow_up" ? { followUps: current.followUps + 1 } : {}),
      };
      requests.transition(requestId, "sent", { actor: "system", event: sentEvent, patch: first });
      if (kind === "follow_up") {
        requests.addEvent(requestId, {
          type: "follow_up_sent",
          actor: "system",
          payload: { messageId, number: current.followUps + 1 },
        });
      }
      requests.transition(requestId, "awaiting_reply", {
        actor: "system",
        patch: { dueAt: window.dueAt, followUpAt: window.followUpAt },
      });
      taskQueue.complete(task.id, {
        workerId: EMAIL_WORKER_ID,
        actor: "system",
        result: { messageId, kind },
      });
      return true;
    });
  }

  private fail(
    task: EmailTask,
    request: RequestRecord,
    error: unknown,
    how: { retryable: boolean; kind: "internal" | "network" | "site"; keepMarker?: boolean },
  ): void {
    const { db, taskQueue, requests } = this.services;
    const message = error instanceof AppError ? error.message : describeError(error);
    db.transaction(() => {
      if (!how.keepMarker) this.clearMarkerInTransaction(task.id);
      requests.addEvent(request.id, {
        type: "send_failed",
        actor: "system",
        payload: {
          error: message,
          willRetry: how.retryable && task.attempts < task.maxAttempts,
        },
      });
      taskQueue.fail(task.id, {
        workerId: EMAIL_WORKER_ID,
        error: message,
        retryable: how.retryable,
        kind: how.kind,
        actor: "system",
      });
      if (!how.retryable && task.payload.kind === "verification_reply") {
        this.returnToVerification(request.id, task.payload.inReplyTo);
      }
    });
    if (!how.keepMarker) {
      this.offered.delete(task.id);
      this.refused.delete(task.id);
    }
  }

  /** The person still owes the broker an answer, so the request goes back to where they can give it. */
  private returnToVerification(requestId: string, inReplyTo: string | null | undefined): void {
    const { db, requests } = this.services;
    if (!canTransition("queued", "needs_verification", { actor: "system" })) return;
    requests.transition(requestId, "needs_verification", { actor: "system" });
    if (inReplyTo) {
      db.update(messages)
        .set({ reviewed: false })
        .where(and(eq(messages.requestId, requestId), eq(messages.messageIdHeader, inReplyTo)))
        .run();
    }
  }
}
