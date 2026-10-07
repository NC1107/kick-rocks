import { type MailboxRow, mailboxes, messages, requests, targets } from "@kickrocks/db";
import {
  MESSAGE_TEXT_MAX_CHARS,
  ProfileField,
  parseOutgoingMessageId,
  type RequestStatus,
  WebUrl,
} from "@kickrocks/shared";
import { and, eq, gte, inArray, isNotNull, min, ne, or } from "drizzle-orm";
import { newId } from "../core/ids.js";
import { curatedReplyDomainsOfRow, replyAddressesOfRow, replyDomainsOfRow } from "../core/targets.js";
import type { Task } from "../core/task-types.js";
import type { ClassificationResult, ClassifierRequest, InboxMessage } from "../mail/types.js";
import type { AppServices } from "../services.js";
import { connectionOf, describeError } from "./connection.js";
import {
  applyReply,
  awaitingConfirmationOf,
  CONFIDENCE_THRESHOLD,
  followConfirmationLinks,
} from "./reply.js";

export const INBOX_WORKER_ID = "server:inbox-poll";
const LEASE_MS = 10 * 60 * 1000;
const PAGE_LIMIT = 50;
const MAX_PAGES_PER_RUN = 10;
const SUBJECT_MAX_CHARS = 500;
const SNIPPET_MAX_CHARS = 280;
/** How long a finished request stays in the classifier context, so it never weighs years of history. */
const CORRELATION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

/** Statuses in which a broker's answer is still expected, which is where a poll starts reading. */
const OUTSTANDING: readonly RequestStatus[] = [
  "queued",
  "sent",
  "awaiting_reply",
  "needs_verification",
  "bounced",
  "rejected",
  "no_response",
  "follow_up_due",
];

type PollTask = Task<"inbox_poll">;

interface PollTotals {
  fetched: number;
  stored: number;
  skipped: number;
  needsReview: number;
  pages: number;
}

/** Mail that is certain to be nothing to act on, which needs no look from a person. */
const isNoise = (classified: ClassificationResult) =>
  classified.classification === "unrelated" || classified.classification === "auto_ack";

const snippetOf = (text: string): string | null => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat ? flat.slice(0, SNIPPET_MAX_CHARS) : null;
};

/**
 * Reads a mailbox's reply folder, stores what it finds, classifies each message, and applies the
 * answer to the request it belongs to. A poll never reads a whole folder: it starts at the oldest
 * request still waiting, and afterwards at its cursor.
 */
export class InboxRunner {
  constructor(private readonly services: AppServices) {}

  /** Runs every due poll and returns how many it ran. */
  async runDue(): Promise<number> {
    let ran = 0;
    for (;;) {
      const task = this.services.taskQueue.claim({
        workerId: INBOX_WORKER_ID,
        kinds: ["inbox_poll"],
        leaseMs: LEASE_MS,
      });
      if (task?.kind !== "inbox_poll") break;
      await this.process(task);
      ran += 1;
    }
    return ran;
  }

  private async process(task: PollTask): Promise<void> {
    const { db, taskQueue, clock, logger } = this.services;
    const mailbox = db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, task.payload.mailboxId))
      .get();
    if (!mailbox) {
      taskQueue.cancel(task.id, "system");
      return;
    }

    const totals: PollTotals = { fetched: 0, stored: 0, skipped: 0, needsReview: 0, pages: 0 };
    let more = false;
    try {
      more = await this.readFolder(mailbox, totals);
    } catch (error) {
      const message = describeError(error);
      logger.warn({ mailboxId: mailbox.id, err: message }, "inbox poll failed");
      db.update(mailboxes)
        .set({ lastError: message, lastPolledAt: clock.now().toISOString() })
        .where(eq(mailboxes.id, mailbox.id))
        .run();
      taskQueue.fail(task.id, {
        workerId: INBOX_WORKER_ID,
        error: message,
        retryable: false,
        kind: "network",
        actor: "system",
      });
      return;
    }

    db.update(mailboxes)
      .set({ lastError: null, lastPolledAt: clock.now().toISOString() })
      .where(eq(mailboxes.id, mailbox.id))
      .run();
    taskQueue.complete(task.id, {
      workerId: INBOX_WORKER_ID,
      actor: "system",
      result: { ...totals },
    });
    // A long backlog is read over several polls so no single one holds the lease for long.
    if (more) this.services.dispatch.enqueueInboxPoll(mailbox.id);
  }

  /** Reads pages until the folder is drained or the page budget is spent. Returns whether more waits. */
  private async readFolder(mailbox: MailboxRow, totals: PollTotals): Promise<boolean> {
    const { db, mail } = this.services;
    const inbox = mail.inbox(connectionOf(mailbox));
    let afterUid = mailbox.lastPollUid;
    let uidValidity = mailbox.uidValidity;
    const since = this.readFrom(mailbox);

    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      const result = await inbox.fetchSince(mailbox.replyFolder, afterUid, uidValidity, {
        since,
        limit: PAGE_LIMIT,
      });
      totals.pages += 1;
      totals.fetched += result.messages.length;
      for (const message of result.messages) {
        await this.ingestSafely(mailbox, result.uidValidity, message, totals);
      }

      uidValidity = result.uidValidity;
      const lastUid = result.messages.at(-1)?.uid ?? null;
      afterUid = result.hasMore ? (lastUid ?? afterUid) : (result.highestUid ?? afterUid);
      db.update(mailboxes)
        .set({ uidValidity, lastPollUid: afterUid })
        .where(eq(mailboxes.id, mailbox.id))
        .run();
      if (!result.hasMore) return false;
    }
    return true;
  }

  /** The oldest request still waiting, never before the mailbox existed; today when nothing waits. */
  private readFrom(mailbox: MailboxRow): Date {
    const { db, clock } = this.services;
    const oldest = db
      .select({ sentAt: min(requests.sentAt) })
      .from(requests)
      .where(
        and(
          eq(requests.mailboxId, mailbox.id),
          inArray(requests.status, [...OUTSTANDING]),
          isNotNull(requests.sentAt),
        ),
      )
      .get()?.sentAt;
    const floor = new Date(mailbox.createdAt).getTime();
    const start = oldest ? Date.parse(oldest) : clock.now().getTime();
    return new Date(Math.max(start, floor));
  }

  private async ingestSafely(
    mailbox: MailboxRow,
    uidValidity: number,
    message: InboxMessage,
    totals: PollTotals,
  ): Promise<void> {
    try {
      const outcome = await this.ingest(mailbox, uidValidity, message);
      if (outcome === "skipped") totals.skipped += 1;
      else {
        totals.stored += 1;
        if (outcome === "needs_review") totals.needsReview += 1;
      }
    } catch (error) {
      // One message that cannot be stored must not stop the rest of the folder from being read.
      this.services.logger.error(
        { mailboxId: mailbox.id, uid: message.uid, err: describeError(error) },
        "could not store a message",
      );
      totals.skipped += 1;
    }
  }

  private alreadyStored(mailboxId: string, messageIdHeader: string): boolean {
    return (
      this.services.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(eq(messages.mailboxId, mailboxId), eq(messages.messageIdHeader, messageIdHeader)),
        )
        .get() !== undefined
    );
  }

  private async ingest(
    mailbox: MailboxRow,
    uidValidity: number,
    message: InboxMessage,
  ): Promise<"skipped" | "stored" | "needs_review"> {
    const { db, clock } = this.services;
    const seen = db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.mailboxId, mailbox.id),
          eq(messages.uidValidity, uidValidity),
          eq(messages.imapUid, message.uid),
        ),
      )
      .get();
    if (seen) return "skipped";
    // A renumbered folder presents every old message under a new uid, and applying it again would
    // undo what later mail and the person's own answers have since done.
    if (message.messageId && this.alreadyStored(mailbox.id, message.messageId)) return "skipped";
    // Our own sent mail turns up in an "all mail" folder, and is not a reply to anything.
    if (message.messageId && parseOutgoingMessageId(message.messageId)) return "skipped";

    const context = this.classifierRequests(mailbox.profileId);
    const classified = await this.classify(message, context);
    const request = classified.requestId
      ? (context.find((candidate) => candidate.id === classified.requestId) ?? null)
      : null;
    const requestRecord = request ? this.services.requests.get(request.id) : null;
    const confident = classified.confidence >= CONFIDENCE_THRESHOLD;
    const link =
      requestRecord && confident && classified.classification === "confirmation_link"
        ? await followConfirmationLinks(this.services, requestRecord, classified.links)
        : null;

    const requestedFields = ProfileField.array().safeParse(classified.requestedFields);
    const receivedAt =
      message.date && !Number.isNaN(message.date.getTime()) ? message.date : clock.now();

    return db.transaction(() => {
      const id = newId();
      const fields = requestedFields.success ? requestedFields.data : [];
      let reviewed = confident && isNoise(classified);
      if (requestRecord) {
        // The request may have moved while the network calls ran, so it is read again.
        const current = this.services.requests.getOrThrow(requestRecord.id);
        this.services.requests.addEvent(current.id, {
          type: "reply_received",
          actor: "system",
          payload: {
            messageId: id,
            from: message.from.address,
            subject: message.subject.slice(0, SUBJECT_MAX_CHARS),
          },
        });
        reviewed = false;
        if (confident) {
          reviewed = !applyReply(this.services, {
            request: current,
            messageId: id,
            classification: classified.classification,
            confidence: classified.confidence,
            correlation: classified.correlation,
            actor: "system",
            link,
            requestedFields: fields,
          }).needsReview;
        }
      }
      this.insertMessage(id, mailbox, uidValidity, message, receivedAt, {
        classified,
        requestId: requestRecord?.id ?? null,
        requestedFields: fields,
        reviewed,
      });
      return reviewed ? "stored" : "needs_review";
    });
  }

  private insertMessage(
    id: string,
    mailbox: MailboxRow,
    uidValidity: number,
    message: InboxMessage,
    receivedAt: Date,
    stored: {
      classified: ClassificationResult;
      requestId: string | null;
      requestedFields: ProfileField[];
      reviewed: boolean;
    },
  ): void {
    this.services.db
      .insert(messages)
      .values({
        id,
        mailboxId: mailbox.id,
        imapUid: message.uid,
        uidValidity,
        requestId: stored.requestId,
        messageIdHeader: message.messageId,
        inReplyTo: message.inReplyTo,
        fromAddress: message.from.address,
        subject: message.subject.slice(0, SUBJECT_MAX_CHARS),
        receivedAt: receivedAt.toISOString(),
        classification: stored.classified.classification,
        confidence: stored.classified.confidence,
        rationale: stored.classified.rationale,
        links: stored.classified.links.filter((link) => WebUrl.safeParse(link).success),
        requestedFields: stored.requestedFields,
        snippet: snippetOf(message.text),
        text: message.text.slice(0, MESSAGE_TEXT_MAX_CHARS),
        reviewed: stored.reviewed,
        createdAt: this.services.clock.now().toISOString(),
      })
      .run();
  }

  /** A classifier that is down must not lose mail: the message is kept for a person instead. */
  private async classify(
    message: InboxMessage,
    requests: ClassifierRequest[],
  ): Promise<ClassificationResult> {
    try {
      return await this.services.mail.classifier.classify(message, { requests });
    } catch (error) {
      return {
        requestId: null,
        correlation: null,
        classification: "unknown",
        confidence: 0,
        rationale: `Classification failed: ${describeError(error)}`,
        links: [],
        requestedFields: [],
      };
    }
  }

  private classifierRequests(profileId: string): ClassifierRequest[] {
    const { db, clock } = this.services;
    const cutoff = new Date(clock.now().getTime() - CORRELATION_WINDOW_MS).toISOString();
    const rows = db
      .select({ request: requests, target: targets })
      .from(requests)
      .innerJoin(targets, eq(requests.targetId, targets.id))
      .where(
        and(
          eq(requests.profileId, profileId),
          ne(requests.status, "draft"),
          or(gte(requests.updatedAt, cutoff), inArray(requests.status, [...OUTSTANDING])),
        ),
      )
      .all();
    return rows.map(({ request, target }) => ({
      id: request.id,
      reference: request.reference,
      outgoingMessageId: request.outgoingMessageId,
      status: request.status,
      channel: request.channel,
      targetId: target.id,
      targetName: target.name,
      targetDomain: target.domain,
      replyDomains: replyDomainsOfRow(target),
      curatedReplyDomains: curatedReplyDomainsOfRow(target),
      replyAddresses: replyAddressesOfRow(target),
      recordUrl: request.recordUrl,
      awaitingConfirmation: request.awaitingConfirmationSince
        ? {
            ...awaitingConfirmationOf(this.services, request.id, target),
            since: request.awaitingConfirmationSince,
          }
        : null,
    }));
  }
}
