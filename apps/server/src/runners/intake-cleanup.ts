import {
  ignoredMessages,
  intakeShadow,
  type MailboxRow,
  type MessageRow,
  mailboxes,
  messages,
  requestEvents,
} from "@kickrocks/db";
import {
  IGNORED_KEEP_DAYS,
  type IntakeCleanup,
  type IntakeIgnored,
  type MessageAdmission,
  parseOutgoingMessageId,
} from "@kickrocks/shared";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { nowIso } from "../core/clock.js";
import { conflict, notFound } from "../core/errors.js";
import {
  bindsToRequest,
  type IntakeContext,
  isFromAnyTarget,
  namesAnyTarget,
  triageBody,
  triageHeaders,
} from "../mail/intake.js";
import type { InboxMessage, InboxSession, MessageHeaders } from "../mail/types.js";
import type { AppServices } from "../services.js";

const HEADER_CHUNK = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Classes that mean a message changed nothing about a request, so only their record remains to remove. */
const CHANGED_NOTHING = new Set(["auto_ack", "unrelated", "unknown"]);

type Verdict = { keep: MessageAdmission } | { drop: true };
type Services = Pick<AppServices, "db" | "clock">;

/** What the gate can say about a message whose server copy is gone: only what was stored. */
function storedHeaders(row: MessageRow): MessageHeaders {
  return {
    uid: row.imapUid,
    messageId: row.messageIdHeader,
    inReplyTo: row.inReplyTo,
    references: [],
    from: { name: null, address: row.fromAddress },
    recipients: [],
    subject: row.subject,
    date: new Date(row.receivedAt),
    isDeliveryReport: row.classification === "bounce",
    headers: {},
  };
}

function storedMessage(row: MessageRow, h: MessageHeaders): InboxMessage {
  return {
    uid: row.imapUid,
    messageId: h.messageId,
    inReplyTo: h.inReplyTo,
    references: h.references,
    from: h.from,
    to: h.recipients,
    subject: h.subject,
    date: h.date,
    text: row.text ?? "",
    html: null,
    isBounce: h.isDeliveryReport,
    autoSubmitted: "auto-submitted" in h.headers,
    headers: h.headers,
    originalMessageIds: [],
    verifyDkim: async () => [],
  };
}

function judge(row: MessageRow, h: MessageHeaders, ctx: IntakeContext): Verdict {
  const header = triageHeaders(h, ctx);
  if (header.verdict === "admit") return { keep: header.by };
  if (header.verdict === "ignore") return { drop: true };
  const body = triageBody(storedMessage(row, h), ctx);
  return body.verdict === "admit" ? { keep: body.by } : { drop: true };
}

const bareId = (id: string) => id.trim().replace(/^<|>$/g, "");

/** Whether Kick Rocks sent the message, or it is the reply to one of ours. */
function isOurs(row: MessageRow, ctx: IntakeContext): boolean {
  const id = row.messageIdHeader;
  if (id === null) return false;
  return (
    parseOutgoingMessageId(id) !== null ||
    ctx.window.some(
      (request) =>
        request.outgoingMessageId !== null && bareId(request.outgoingMessageId) === bareId(id),
    )
  );
}

/**
 * Whether anything about a message could tie it to a request: a bounce, a sender or a name of any
 * request in the window, or one of our references or Message-IDs. Judged on what was stored, as
 * the server's copy may hold more but never less.
 */
function tiedToRequest(row: MessageRow, h: MessageHeaders, ctx: IntakeContext): boolean {
  const text = `${row.subject}\n${row.text ?? ""}`;
  return (
    row.classification === "bounce" ||
    isOurs(row, ctx) ||
    isFromAnyTarget(h, ctx) ||
    bindsToRequest(`${text}\n${row.inReplyTo ?? ""}`, ctx) ||
    namesAnyTarget(text, ctx)
  );
}

function eventsAbout(services: Services, messageId: string) {
  return services.db
    .select()
    .from(requestEvents)
    .where(sql`json_extract(${requestEvents.payload}, '$.messageId') = ${messageId}`)
    .all();
}

function changedNothing(services: Services, row: MessageRow): boolean {
  if (!CHANGED_NOTHING.has(row.classification)) return false;
  return eventsAbout(services, row.id).every((event) => {
    if (event.actor === "user") return false;
    if (event.type === "reply_received") return true;
    return (
      event.type === "classified" &&
      CHANGED_NOTHING.has((event.payload as { classification: string }).classification)
    );
  });
}

/**
 * Whether a stored message may be taken out of the app. This is the only test the list and the
 * confirmation share, so what a person was shown is what a confirmation removes, and it is read
 * again at confirmation because a request may have taken the message since.
 */
function removable(services: Services, row: MessageRow, ctx: IntakeContext): boolean {
  return (
    row.requestId === null &&
    row.reviewed &&
    row.admittedBy === null &&
    !tiedToRequest(row, storedHeaders(row), ctx) &&
    changedNothing(services, row)
  );
}

/**
 * Lists the stored mail the intake gate would not have taken in, once per mailbox. Nothing is
 * removed: the list waits for the person, and an empty one needs no decision.
 */
export async function listCleanupCandidates(
  services: Services,
  mailbox: MailboxRow,
  session: InboxSession,
  ctx: IntakeContext,
): Promise<number> {
  const { db, clock } = services;
  const candidates = db
    .select()
    .from(messages)
    .where(and(eq(messages.mailboxId, mailbox.id), isNull(messages.admittedBy)))
    .all();

  const current = session.uidValidity();
  const sameNumbering = candidates.filter((row) => row.uidValidity === current);
  const found = new Map<number, MessageHeaders>();
  for (let start = 0; start < sameNumbering.length; start += HEADER_CHUNK) {
    const chunk = sameNumbering.slice(start, start + HEADER_CHUNK).map((row) => row.imapUid);
    for (const h of await session.headers(chunk)) found.set(h.uid, h);
  }

  let listed = 0;
  for (const row of candidates) {
    const h = row.uidValidity === current ? found.get(row.imapUid) : undefined;
    const verdict = judge(row, h ?? storedHeaders(row), ctx);
    if ("keep" in verdict) {
      db.update(messages).set({ admittedBy: verdict.keep }).where(eq(messages.id, row.id)).run();
    } else if (removable(services, row, ctx)) {
      db.update(messages).set({ cleanupCandidate: true }).where(eq(messages.id, row.id)).run();
      listed += 1;
    }
  }

  db.update(mailboxes)
    .set(
      listed > 0
        ? { intakeCleanup: "review", intakeCleanupRemoved: null }
        : {
            intakeCleanup: "done",
            intakeCleanupRemoved: 0,
            intakeCleanupAt: clock.now().toISOString(),
          },
    )
    .where(eq(mailboxes.id, mailbox.id))
    .run();
  return listed;
}

function listed(services: Services, mailbox: MailboxRow, ctx: IntakeContext): MessageRow[] {
  return services.db
    .select()
    .from(messages)
    .where(and(eq(messages.mailboxId, mailbox.id), eq(messages.cleanupCandidate, true)))
    .all()
    .filter((row) => removable(services, row, ctx))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** What a confirmation would remove right now. */
export function previewCleanup(
  services: Services,
  mailbox: MailboxRow,
  ctx: IntakeContext,
): IntakeCleanup {
  const items =
    mailbox.intakeCleanup === "review"
      ? listed(services, mailbox, ctx).map((row) => ({
          id: row.id,
          fromAddress: row.fromAddress,
          subject: row.subject,
          receivedAt: row.receivedAt,
        }))
      : [];
  return { state: mailbox.intakeCleanup, items, removed: mailbox.intakeCleanupRemoved };
}

/** Closes the decision: whatever was listed and not removed is no longer a candidate. */
function finishCleanup(
  tx: Pick<Services["db"], "update">,
  mailbox: MailboxRow,
  removed: number,
  at: string,
): void {
  tx.update(messages)
    .set({ cleanupCandidate: false })
    .where(and(eq(messages.mailboxId, mailbox.id), eq(messages.cleanupCandidate, true)))
    .run();
  tx.update(mailboxes)
    .set({ intakeCleanup: "done", intakeCleanupRemoved: removed, intakeCleanupAt: at })
    .where(eq(mailboxes.id, mailbox.id))
    .run();
}

/**
 * Moves the listed mail out of the app, into the ignored list where it stays for a while. The
 * mail itself stays in the person's mailbox.
 */
export function confirmCleanup(
  services: Services,
  mailbox: MailboxRow,
  ctx: IntakeContext,
): number {
  if (mailbox.intakeCleanup !== "review") {
    throw conflict("nothing_to_confirm", "There is no list of mail waiting to be removed");
  }
  const rows = listed(services, mailbox, ctx);
  const ignoredAt = nowIso(services.clock);
  services.db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(ignoredMessages)
        .values({
          id: row.id,
          mailboxId: row.mailboxId,
          imapUid: row.imapUid,
          uidValidity: row.uidValidity,
          messageIdHeader: row.messageIdHeader,
          inReplyTo: row.inReplyTo,
          fromAddress: row.fromAddress,
          subject: row.subject,
          receivedAt: row.receivedAt,
          classification: row.classification,
          confidence: row.confidence,
          rationale: row.rationale,
          links: row.links,
          snippet: row.snippet,
          text: row.text,
          ignoredAt,
        })
        .run();
      const ids = eventsAbout(services, row.id).map((event) => event.id);
      if (ids.length > 0) tx.delete(requestEvents).where(inArray(requestEvents.id, ids)).run();
      tx.delete(messages).where(eq(messages.id, row.id)).run();
    }
    finishCleanup(tx, mailbox, rows.length, ignoredAt);
  });
  return rows.length;
}

/** Leaves everything as it is. */
export function keepStoredMail(services: Services, mailbox: MailboxRow): void {
  if (mailbox.intakeCleanup !== "review") return;
  services.db.transaction((tx) => finishCleanup(tx, mailbox, 0, nowIso(services.clock)));
}

const keptUntil = (ignoredAt: string) =>
  new Date(Date.parse(ignoredAt) + IGNORED_KEEP_DAYS * DAY_MS).toISOString();

const expiryCutoff = (clock: Services["clock"]) =>
  new Date(clock.now().getTime() - IGNORED_KEEP_DAYS * DAY_MS).toISOString();

export function listIgnored(services: Services, mailbox: MailboxRow): IntakeIgnored {
  const rows = services.db
    .select()
    .from(ignoredMessages)
    .where(
      and(
        eq(ignoredMessages.mailboxId, mailbox.id),
        sql`${ignoredMessages.ignoredAt} > ${expiryCutoff(services.clock)}`,
      ),
    )
    .all()
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return {
    items: rows.map((row) => ({
      id: row.id,
      fromAddress: row.fromAddress,
      subject: row.subject,
      receivedAt: row.receivedAt,
      keptUntil: keptUntil(row.ignoredAt),
    })),
  };
}

/** Puts an ignored message back as an unread item in Review, where the person decides what it is. */
export function takeInIgnored(
  services: Services,
  mailbox: MailboxRow,
  messageId: string,
): MessageRow {
  const row = services.db
    .select()
    .from(ignoredMessages)
    .where(and(eq(ignoredMessages.id, messageId), eq(ignoredMessages.mailboxId, mailbox.id)))
    .get();
  if (!row || row.ignoredAt <= expiryCutoff(services.clock)) {
    throw notFound("That message is no longer kept", "ignored_message_not_found");
  }
  return services.db.transaction((tx) => {
    // A rule the person has added since may have stored the same message again.
    const again = tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.mailboxId, row.mailboxId),
          eq(messages.uidValidity, row.uidValidity),
          eq(messages.imapUid, row.imapUid),
        ),
      )
      .get();
    tx.delete(ignoredMessages).where(eq(ignoredMessages.id, row.id)).run();
    if (again) return again;
    return tx
      .insert(messages)
      .values({
        id: row.id,
        mailboxId: row.mailboxId,
        imapUid: row.imapUid,
        uidValidity: row.uidValidity,
        requestId: null,
        messageIdHeader: row.messageIdHeader,
        inReplyTo: row.inReplyTo,
        fromAddress: row.fromAddress,
        subject: row.subject,
        receivedAt: row.receivedAt,
        classification: row.classification,
        confidence: row.confidence,
        rationale: row.rationale,
        links: row.links,
        requestedFields: [],
        snippet: row.snippet,
        text: row.text,
        reviewed: false,
        admittedBy: "person",
        createdAt: nowIso(services.clock),
      })
      .returning()
      .get();
  });
}

/** Deletes what has been kept past its time, and the passed-over list once its week is over or dismissed. */
export function purgeExpiredIntake(services: Services): number {
  const { db, clock } = services;
  const expired = db
    .delete(ignoredMessages)
    .where(lt(ignoredMessages.ignoredAt, expiryCutoff(clock)))
    .run().changes;
  const finished = db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(
      or(
        lt(mailboxes.intakeShadowUntil, clock.now().toISOString()),
        isNotNull(mailboxes.intakeShadowDismissedAt),
      ),
    );
  const closed = db.delete(intakeShadow).where(inArray(intakeShadow.mailboxId, finished)).run();
  return expired + closed.changes;
}
