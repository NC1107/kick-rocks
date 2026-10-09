import { intakeShadow, type MailboxRow, mailboxes } from "@kickrocks/db";
import type { IgnoreRule, IntakeShadow } from "@kickrocks/shared";
import { and, desc, eq } from "drizzle-orm";
import { nowIso } from "../core/clock.js";
import { notFound } from "../core/errors.js";
import { newId } from "../core/ids.js";
import { couldBeAReply, type IntakeContext } from "../mail/intake.js";
import type { InboxMessage, MessageHeaders } from "../mail/types.js";
import type { AppServices } from "../services.js";

type Services = Pick<AppServices, "db" | "clock">;

/** More than a person can read, and a mailbox that fills it has bigger problems than this report. */
const LIST_LIMIT = 300;

/** Whether the week after the upgrade is still running and the person has not closed the report. */
export function shadowActive(services: Services, mailbox: MailboxRow): boolean {
  return (
    mailbox.intakeShadowUntil !== null &&
    mailbox.intakeShadowDismissedAt === null &&
    mailbox.intakeShadowUntil > services.clock.now().toISOString()
  );
}

/**
 * Notes a message the gate passed over, when the rules before the gate would have kept it and it
 * could be a reply. Only the sender, subject and date are kept: the message stays in the
 * person's mailbox, where "Take in" fetches it from.
 */
export function notePassedOver(
  services: Services,
  mailbox: MailboxRow,
  uidValidity: number,
  h: MessageHeaders,
  message: InboxMessage | null,
  rule: IgnoreRule,
  ctx: IntakeContext,
): void {
  if (!shadowActive(services, mailbox) || !couldBeAReply(h, message, ctx)) return;
  const at = nowIso(services.clock);
  services.db
    .insert(intakeShadow)
    .values({
      id: newId(),
      mailboxId: mailbox.id,
      imapUid: h.uid,
      uidValidity,
      fromAddress: h.from.address,
      subject: h.subject.slice(0, 500),
      receivedAt: h.date && !Number.isNaN(h.date.getTime()) ? h.date.toISOString() : at,
      rule,
      createdAt: at,
    })
    .onConflictDoNothing()
    .run();
}

export function readShadow(services: Services, mailbox: MailboxRow): IntakeShadow {
  const active = shadowActive(services, mailbox);
  const items = active
    ? services.db
        .select()
        .from(intakeShadow)
        .where(eq(intakeShadow.mailboxId, mailbox.id))
        .orderBy(desc(intakeShadow.receivedAt))
        .limit(LIST_LIMIT)
        .all()
        .map((row) => ({
          id: row.id,
          fromAddress: row.fromAddress,
          subject: row.subject,
          receivedAt: row.receivedAt,
          rule: row.rule,
        }))
    : [];
  return { active, until: mailbox.intakeShadowUntil, items };
}

export function requireShadowLine(services: Services, mailbox: MailboxRow, id: string) {
  const row = services.db
    .select()
    .from(intakeShadow)
    .where(and(eq(intakeShadow.id, id), eq(intakeShadow.mailboxId, mailbox.id)))
    .get();
  if (!row) throw notFound("That message is not in the list", "shadow_message_not_found");
  return row;
}

export function forgetShadowLine(services: Services, id: string): void {
  services.db.delete(intakeShadow).where(eq(intakeShadow.id, id)).run();
}

/** Closes the report for good and drops what it listed. */
export function dismissShadow(services: Services, mailbox: MailboxRow): void {
  services.db.transaction((tx) => {
    tx.update(mailboxes)
      .set({ intakeShadowDismissedAt: nowIso(services.clock) })
      .where(eq(mailboxes.id, mailbox.id))
      .run();
    tx.delete(intakeShadow).where(eq(intakeShadow.mailboxId, mailbox.id)).run();
  });
}
