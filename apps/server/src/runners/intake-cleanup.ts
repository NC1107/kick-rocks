import {
  type MailboxRow,
  type MessageRow,
  mailboxes,
  messages,
  requestEvents,
} from "@kickrocks/db";
import type { MessageAdmission } from "@kickrocks/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  bindsToRequest,
  type IntakeContext,
  isFromOpenTarget,
  namesAnyTarget,
  triageBody,
  triageHeaders,
} from "../mail/intake.js";
import type { InboxMessage, InboxSession, MessageHeaders } from "../mail/types.js";
import type { AppServices } from "../services.js";

const HEADER_CHUNK = 200;
/** Classes that mean a message changed nothing about a request, so only their record remains to remove. */
const CHANGED_NOTHING = new Set(["auto_ack", "unrelated", "unknown"]);

type Verdict = { keep: MessageAdmission } | { retain: true } | { drop: true };

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

/**
 * Without the server's copy the headers are unknown, so a message is dropped only when nothing
 * about it could tie it to a request: not bound, not from a target, not a bounce, not naming one.
 */
function judgeFromStored(row: MessageRow, ctx: IntakeContext): Verdict {
  const h = storedHeaders(row);
  const verdict = judge(row, h, ctx);
  if ("keep" in verdict) return verdict;
  const text = `${row.subject}\n${row.text ?? ""}`;
  const tied =
    row.classification === "bounce" ||
    isFromOpenTarget(h, ctx) ||
    bindsToRequest(`${text}\n${row.inReplyTo ?? ""}`, ctx) ||
    namesAnyTarget(text, ctx);
  return tied ? { retain: true } : verdict;
}

/**
 * Removes the stored copies of mail the intake gate would not have taken in, once per mailbox.
 * A message is removed only when it changed nothing and the person never acted on it, and its
 * timeline entry goes with it. The mail itself stays in the person's mailbox.
 */
export async function cleanUpStoredMail(
  services: AppServices,
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

  let removed = 0;
  for (const row of candidates) {
    const h = row.uidValidity === current ? found.get(row.imapUid) : undefined;
    const verdict = h ? judge(row, h, ctx) : judgeFromStored(row, ctx);
    if ("keep" in verdict) {
      db.update(messages).set({ admittedBy: verdict.keep }).where(eq(messages.id, row.id)).run();
    } else if ("drop" in verdict && changedNothing(services, row)) {
      removeWithTimeline(services, row);
      removed += 1;
    }
  }

  db.update(mailboxes)
    .set({
      intakeCleanup: "done",
      intakeCleanupRemoved: removed,
      intakeCleanupAt: clock.now().toISOString(),
    })
    .where(eq(mailboxes.id, mailbox.id))
    .run();
  return removed;
}

function eventsAbout(services: AppServices, messageId: string) {
  return services.db
    .select()
    .from(requestEvents)
    .where(sql`json_extract(${requestEvents.payload}, '$.messageId') = ${messageId}`)
    .all();
}

function changedNothing(services: AppServices, row: MessageRow): boolean {
  if (row.requestId !== null && !CHANGED_NOTHING.has(row.classification)) return false;
  return eventsAbout(services, row.id).every((event) => {
    if (event.actor === "user") return false;
    if (event.type === "reply_received") return true;
    return (
      event.type === "classified" &&
      CHANGED_NOTHING.has((event.payload as { classification: string }).classification)
    );
  });
}

function removeWithTimeline(services: AppServices, row: MessageRow): void {
  services.db.transaction((tx) => {
    const ids = eventsAbout(services, row.id).map((event) => event.id);
    if (ids.length > 0) tx.delete(requestEvents).where(inArray(requestEvents.id, ids)).run();
    tx.delete(messages).where(eq(messages.id, row.id)).run();
  });
}
