import {
  intakeSenders,
  type MailboxRow,
  type MessageRow,
  mailboxes,
  messages,
  requests,
  targets,
} from "@kickrocks/db";
import {
  type FindMissingReplyBody,
  type FoundMessage,
  MESSAGE_TEXT_MAX_CHARS,
  type MessageAdmission,
  ProfileField,
  parseOutgoingMessageId,
  type RequestStatus,
  WebUrl,
} from "@kickrocks/shared";
import { and, eq, gte, inArray, isNotNull, min, ne, or } from "drizzle-orm";
import { newId } from "../core/ids.js";
import {
  curatedReplyDomainsOfRow,
  replyAddressesOfRow,
  replyDomainsOfRow,
} from "../core/targets.js";
import type { Task } from "../core/task-types.js";
import {
  type HeaderVerdict,
  type IntakeContext,
  intakeContext,
  isSoftAdmission,
  readPlanFor,
  type SearchScope,
  triageBody,
  triageHeaders,
} from "../mail/intake.js";
import type {
  ClassificationResult,
  ClassifierRequest,
  InboxMessage,
  InboxSession,
  MessageHeaders,
} from "../mail/types.js";
import type { AppServices } from "../services.js";
import { connectionOf, describeError } from "./connection.js";
import { cleanUpStoredMail } from "./intake-cleanup.js";
import {
  applyReply,
  awaitingConfirmationOf,
  CONFIDENCE_THRESHOLD,
  followConfirmationLinks,
} from "./reply.js";

const INBOX_WORKER_ID = "server:inbox-poll";
const LEASE_MS = 10 * 60 * 1000;
/** Headers are small, so a page holds far more messages than a page of downloads could. */
const PAGE_LIMIT = 500;
/** How far back a rescan looks for mail from one target, at most. */
const RESCAN_LIMIT = 200;
/** The most a person's one-off search lists. */
const FIND_LIMIT = 100;
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
  /** Messages whose headers were looked at. */
  scanned: number;
  /** Messages stored. */
  kept: number;
  /** Messages not stored, whatever the reason. Counts only: nothing else about them is kept. */
  ignored: number;
  stored: number;
  skipped: number;
  needsReview: number;
  pages: number;
}

interface Admitted {
  message: InboxMessage;
  by: MessageAdmission | null;
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
  /**
   * The requests that were open when the current page was admitted. A reply earlier in the page
   * can close one, and the mail behind it was let in because it was open, so it still binds.
   */
  private openAtAdmission: ReadonlySet<string> = new Set();

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

    const totals: PollTotals = {
      scanned: 0,
      kept: 0,
      ignored: 0,
      stored: 0,
      skipped: 0,
      needsReview: 0,
      pages: 0,
    };
    let more = false;
    try {
      more = await this.readFolder(mailbox, totals, task.payload.rescan);
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
      .set({
        lastError: null,
        lastPolledAt: clock.now().toISOString(),
        lastPollScanned: totals.scanned,
        lastPollKept: totals.kept,
      })
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
  private async readFolder(
    mailbox: MailboxRow,
    totals: PollTotals,
    rescan: { since: string; targetId: string } | undefined,
  ): Promise<boolean> {
    const { db, mail } = this.services;
    const inbox = mail.inbox(connectionOf(mailbox));
    let afterUid = mailbox.lastPollUid;
    let uidValidity = mailbox.uidValidity;
    const since = this.readFrom(mailbox);

    return inbox.withFolder(mailbox.replyFolder, async (session) => {
      if (mailbox.intakeCleanup === "pending") {
        await cleanUpStoredMail(this.services, mailbox, session, this.intake(mailbox));
      }
      if (rescan) await this.rescan(session, mailbox, rescan, totals);

      for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
        const result = await session.scan(afterUid, uidValidity, { since, limit: PAGE_LIMIT });
        totals.pages += 1;
        totals.scanned += result.messages.length;
        const admitted = await this.admit(session, mailbox, result.uidValidity, result.messages);
        totals.ignored += result.messages.length - admitted.length;
        for (const { message, by } of admitted) {
          await this.ingestSafely(mailbox, result.uidValidity, message, by, totals);
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
    });
  }

  /** Looks again at one target's recent mail, which a cursor may have passed before a request expected it. */
  private async rescan(
    session: InboxSession,
    mailbox: MailboxRow,
    rescan: { since: string; targetId: string },
    totals: PollTotals,
  ): Promise<void> {
    if (mailbox.uidValidity === null) return;
    const target = this.services.db
      .select()
      .from(targets)
      .where(eq(targets.id, rescan.targetId))
      .get();
    if (!target) return;
    const domains = [
      ...new Set([
        target.domain,
        ...curatedReplyDomainsOfRow(target),
        ...replyDomainsOfRow(target),
      ]),
    ];
    const uids = await session.search({
      since: new Date(rescan.since),
      from: domains,
      limit: RESCAN_LIMIT,
    });
    if (!uids || uids.length === 0) return;
    const found = await session.headers(uids);
    totals.scanned += found.length;
    const admitted = await this.admit(session, mailbox, mailbox.uidValidity, found);
    totals.ignored += found.length - admitted.length;
    for (const { message, by } of admitted) {
      await this.ingestSafely(mailbox, mailbox.uidValidity, message, by, totals);
    }
  }

  /**
   * Decides which of a page of messages concern a request, downloading as few as it can. Headers
   * settle most; a server-side search narrows the rest; whatever is left is read here and judged
   * on its text. A message the gate cannot judge is kept for a person rather than lost.
   */
  private async admit(
    session: InboxSession,
    mailbox: MailboxRow,
    uidValidity: number,
    headers: MessageHeaders[],
  ): Promise<Admitted[]> {
    const fresh = headers.filter((h) => !this.alreadyKnown(mailbox.id, uidValidity, h));
    if (fresh.length === 0) return [];
    const ctx = this.intake(mailbox);
    this.openAtAdmission = new Set(ctx.open.map((request) => request.id));

    const admittedBy = new Map<number, MessageAdmission | null>();
    const toRead: number[] = [];
    const gated: Array<{ uid: number; scope: SearchScope; terms: string[] }> = [];
    for (const h of fresh) {
      let verdict: HeaderVerdict;
      try {
        verdict = triageHeaders(h, ctx);
      } catch (error) {
        this.services.logger.error(
          { mailboxId: mailbox.id, uid: h.uid, err: describeError(error) },
          "intake triage failed, so the message is kept for review",
        );
        admittedBy.set(h.uid, null);
        continue;
      }
      if (verdict.verdict === "admit") admittedBy.set(h.uid, verdict.by);
      else if (verdict.verdict === "needs_body") {
        const plan = readPlanFor(h, verdict, ctx);
        if (plan.read === "now") toRead.push(h.uid);
        else gated.push({ uid: h.uid, scope: plan.scope, terms: plan.terms });
      }
    }

    toRead.push(...(await this.searchHits(session, gated)));

    const wanted = [...admittedBy.keys(), ...toRead];
    if (wanted.length === 0) return [];
    const fetched = await session.fetchMessages(wanted);
    const admitted: Admitted[] = [];
    for (const message of fetched) {
      if (admittedBy.has(message.uid)) {
        admitted.push({ message, by: admittedBy.get(message.uid) ?? null });
        continue;
      }
      try {
        const verdict = triageBody(message, ctx);
        if (verdict.verdict === "admit") admitted.push({ message, by: verdict.by });
      } catch (error) {
        this.services.logger.error(
          { mailboxId: mailbox.id, uid: message.uid, err: describeError(error) },
          "intake triage failed, so the message is kept for review",
        );
        admitted.push({ message, by: null });
      }
    }
    return admitted;
  }

  /** The search-gated messages worth a download: those the server found a term in, or all when it cannot search. */
  private async searchHits(
    session: InboxSession,
    gated: Array<{ uid: number; scope: SearchScope; terms: string[] }>,
  ): Promise<number[]> {
    const hits: number[] = [];
    for (const scope of new Set(gated.map((entry) => entry.scope))) {
      const group = gated.filter((entry) => entry.scope === scope);
      const uids = group.map((entry) => entry.uid);
      const found = await session.searchBodies(uids, group[0]?.terms ?? []);
      hits.push(...(found === null ? uids : uids.filter((uid) => found.has(uid))));
    }
    return hits;
  }

  private alreadyKnown(mailboxId: string, uidValidity: number, h: MessageHeaders): boolean {
    const { db } = this.services;
    const byUid = db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.mailboxId, mailboxId),
          eq(messages.uidValidity, uidValidity),
          eq(messages.imapUid, h.uid),
        ),
      )
      .get();
    // A renumbered folder presents every old message under a new uid, and applying it again would
    // undo what later mail and the person's own answers have since done.
    return (
      byUid !== undefined || (h.messageId !== null && this.alreadyStored(mailboxId, h.messageId))
    );
  }

  private intake(mailbox: MailboxRow): IntakeContext {
    const { db, clock } = this.services;
    return intakeContext({
      requests: this.classifierRequests(mailbox.profileId),
      verifiedAlias: mailbox.replyAliasVerifiedAt ? mailbox.replyAlias : null,
      companyMail: mailbox.companyMail,
      personSenders: db
        .select({
          targetId: intakeSenders.targetId,
          kind: intakeSenders.kind,
          value: intakeSenders.value,
        })
        .from(intakeSenders)
        .where(eq(intakeSenders.mailboxId, mailbox.id))
        .all(),
      now: clock.now(),
    });
  }

  /**
   * A one-off server-side search the person asks for to find a reply the intake rules passed over.
   * It lists what the rules would do with each hit and stores nothing.
   */
  async find(
    mailbox: MailboxRow,
    { query, from, to }: FindMissingReplyBody,
  ): Promise<{ messages: FoundMessage[]; searched: boolean }> {
    const inbox = this.services.mail.inbox(connectionOf(mailbox));
    const day = 24 * 60 * 60 * 1000;
    const text = /^kr-/i.test(query.trim()) ? [query.trim()] : [];
    return inbox.withFolder(mailbox.replyFolder, async (session) => {
      const uids = await session.search({
        since: new Date(`${from}T00:00:00.000Z`),
        until: new Date(Date.parse(`${to}T00:00:00.000Z`) + day),
        ...(text.length > 0 ? { text } : { from: [query.trim().toLowerCase()] }),
        limit: FIND_LIMIT,
      });
      if (uids === null) return { messages: [], searched: false };
      const uidValidity = session.uidValidity();
      const headers = await session.headers(uids);
      const ctx = this.intake(mailbox);
      const undecided = new Map<number, HeaderVerdict>();
      const found: FoundMessage[] = [];
      const verdicts = new Map<number, MessageAdmission | null>();
      for (const h of headers) {
        const verdict = triageHeaders(h, ctx);
        if (verdict.verdict === "admit") verdicts.set(h.uid, verdict.by);
        else if (verdict.verdict === "needs_body") undecided.set(h.uid, verdict);
        else verdicts.set(h.uid, null);
      }
      for (const message of await session.fetchMessages([...undecided.keys()])) {
        const verdict = triageBody(message, ctx);
        verdicts.set(message.uid, verdict.verdict === "admit" ? verdict.by : null);
      }
      for (const h of headers) {
        found.push({
          uid: h.uid,
          uidValidity,
          fromAddress: h.from.address,
          subject: h.subject,
          receivedAt: h.date?.toISOString() ?? null,
          stored: this.alreadyKnown(mailbox.id, uidValidity, h),
          admittedBy: verdicts.get(h.uid) ?? null,
        });
      }
      return { messages: found.reverse(), searched: true };
    });
  }

  /** Stores one message the person picked from a search, whatever the rules said about it. */
  async takeIn(
    mailbox: MailboxRow,
    { uid, uidValidity }: { uid: number; uidValidity: number },
  ): Promise<MessageRow | null> {
    const inbox = this.services.mail.inbox(connectionOf(mailbox));
    const message = await inbox.withFolder(mailbox.replyFolder, async (session) => {
      if (session.uidValidity() !== uidValidity) return null;
      return (await session.fetchMessages([uid]))[0] ?? null;
    });
    if (!message) return null;
    await this.ingest(mailbox, uidValidity, message, "person");
    return (
      this.services.db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.mailboxId, mailbox.id),
            eq(messages.uidValidity, uidValidity),
            eq(messages.imapUid, uid),
          ),
        )
        .get() ?? null
    );
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
    by: MessageAdmission | null,
    totals: PollTotals,
  ): Promise<void> {
    try {
      const outcome = await this.ingest(mailbox, uidValidity, message, by);
      if (outcome === "skipped") {
        totals.skipped += 1;
        totals.ignored += 1;
      } else {
        totals.stored += 1;
        totals.kept += 1;
        if (outcome === "needs_review") totals.needsReview += 1;
      }
    } catch (error) {
      // One message that cannot be stored must not stop the rest of the folder from being read.
      this.services.logger.error(
        { mailboxId: mailbox.id, uid: message.uid, err: describeError(error) },
        "could not store a message",
      );
      totals.skipped += 1;
      totals.ignored += 1;
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
    by: MessageAdmission | null,
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

    const context = this.classifierRequests(mailbox.profileId).map((request) =>
      this.openAtAdmission.has(request.id) ? { ...request, open: true } : request,
    );
    const classified = await this.classify(message, context);
    // Mail let in on its sender or its wording alone, and found to be about nothing, is not worth keeping.
    if (
      by !== null &&
      isSoftAdmission(by) &&
      classified.requestId === null &&
      classified.classification === "unrelated"
    ) {
      return "skipped";
    }
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
        admittedBy: by,
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
      admittedBy: MessageAdmission | null;
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
        admittedBy: stored.admittedBy,
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
      open: OUTSTANDING.includes(request.status) || request.awaitingConfirmationSince !== null,
      targetKind: target.kind,
      contactAddress: target.privacyEmail,
      sentAt: request.sentAt,
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
