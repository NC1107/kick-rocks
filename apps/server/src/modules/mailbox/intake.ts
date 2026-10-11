import { randomBytes } from "node:crypto";
import { intakeSenders, type MailboxRow, mailboxes, targets } from "@kickrocks/db";
import {
  type CompanyMail,
  type IntakeSender,
  type IntakeSenderBody,
  outgoingMessageId,
  type ReplyAliasResult,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { conflict, invalidRequest, notFound } from "../../core/errors.js";
import { newId } from "../../core/ids.js";
import { findProviderPreset } from "../../mail/presets.js";
import { connectionOf } from "../../runners/connection.js";
import type { AppServices } from "../../services.js";
import { toMailbox } from "./service.js";

/** How long a test mail is given to show up, which is a mailbox's own delivery delay. */
const ALIAS_PROBE_ATTEMPTS = 6;
const ALIAS_PROBE_DELAY_MS = 1_500;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const ADDRESS = /^[^\s@]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

type Mailboxes = Pick<AppServices, "db" | "clock" | "mailHolds">;

function view(services: Mailboxes, row: MailboxRow) {
  return toMailbox(row, services.mailHolds.until(row.id));
}

function update(services: Mailboxes, id: string, values: Partial<MailboxRow>): MailboxRow {
  return services.db.update(mailboxes).set(values).where(eq(mailboxes.id, id)).returning().get();
}

export function setCompanyMail(services: Mailboxes, mailbox: MailboxRow, companyMail: CompanyMail) {
  return view(services, update(services, mailbox.id, { companyMail }));
}

/**
 * The tag is random per mailbox because every broker sees it: a fixed word would tell each of them
 * a tool is sending the request. It is kept once chosen, so turning the address on again does not
 * strand replies sent to the earlier one.
 */
export function aliasFor(address: string, current: string | null = null): string {
  const at = address.lastIndexOf("@");
  const own = `${address.slice(0, at)}+`;
  if (current?.startsWith(own) && current.endsWith(address.slice(at))) return current;
  return `${own}p${randomBytes(3).toString("hex")}${address.slice(at)}`;
}

export function disableReplyAlias(services: Mailboxes, mailbox: MailboxRow) {
  return view(
    services,
    update(services, mailbox.id, { replyAlias: null, replyAliasVerifiedAt: null }),
  );
}

interface ProbeTiming {
  attempts: number;
  delayMs: number;
}

/**
 * Turns on the reply address. It is saved at once but counts only after a test mail sent to it
 * is found in this mailbox, because a provider that drops the tag would send every reply nowhere.
 */
export async function enableReplyAlias(
  services: Pick<AppServices, "db" | "clock" | "mailHolds" | "mail">,
  mailbox: MailboxRow,
  timing: ProbeTiming = { attempts: ALIAS_PROBE_ATTEMPTS, delayMs: ALIAS_PROBE_DELAY_MS },
): Promise<ReplyAliasResult> {
  if (!findProviderPreset(mailbox.provider)?.plusAddressing) {
    throw conflict(
      "alias_unsupported",
      "This mail provider does not deliver plus addresses to your mailbox",
    );
  }
  const alias = aliasFor(mailbox.address, mailbox.replyAlias);
  const saved = update(services, mailbox.id, { replyAlias: alias, replyAliasVerifiedAt: null });
  const connection = connectionOf(saved);
  const domain = mailbox.address.slice(mailbox.address.lastIndexOf("@") + 1);
  // In our own Message-ID format, so the poll that later sees this mail leaves it alone.
  const messageId = outgoingMessageId("alias-test", domain, Math.floor(Date.now() / 1000));

  const fail = (problem: string): ReplyAliasResult => ({
    mailbox: view(services, saved),
    verified: false,
    problem,
  });
  try {
    await services.mail.transport(connection).send({
      from: { name: null, address: mailbox.address },
      to: alias,
      subject: "Kick Rocks reply address test",
      text: "This message checks that replies sent to your Kick Rocks address reach this mailbox. You can delete it.",
      messageId,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The test mail could not be sent");
  }

  const found = await services.mail
    .inbox(connection)
    .withFolder(saved.replyFolder, async (session) => {
      for (let attempt = 0; attempt < timing.attempts; attempt += 1) {
        const uids = await session.search({
          since: new Date(services.clock.now().getTime() - 60 * 60 * 1000),
          messageId,
          limit: 1,
        });
        if (uids === null) return null;
        if (uids.length > 0) return true;
        if (timing.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, timing.delayMs));
      }
      return false;
    });
  if (found === true) {
    const verified = update(services, mailbox.id, { replyAliasVerifiedAt: nowIso(services.clock) });
    return { mailbox: view(services, verified), verified: true, problem: null };
  }
  return fail(
    found === null
      ? "The mail server could not search for the test mail, so the address could not be checked"
      : "The test mail did not arrive in this mailbox, so replies sent to the address would be lost",
  );
}

function toSender(row: typeof intakeSenders.$inferSelect, targetName: string): IntakeSender {
  return {
    id: row.id,
    targetId: row.targetId,
    targetName,
    kind: row.kind,
    value: row.value,
  };
}

export function listIntakeSenders(services: Pick<AppServices, "db">, mailbox: MailboxRow) {
  return services.db
    .select({ sender: intakeSenders, targetName: targets.name })
    .from(intakeSenders)
    .innerJoin(targets, eq(intakeSenders.targetId, targets.id))
    .where(eq(intakeSenders.mailboxId, mailbox.id))
    .all()
    .map(({ sender, targetName }) => toSender(sender, targetName));
}

export function addIntakeSender(
  services: Pick<AppServices, "db" | "clock">,
  mailbox: MailboxRow,
  body: IntakeSenderBody,
): IntakeSender {
  const value = body.value.trim().toLowerCase();
  const kind = value.includes("@") ? "address" : "domain";
  if (!(kind === "address" ? ADDRESS : DOMAIN).test(value)) {
    throw invalidRequest("That is not a domain or an address", [
      { path: ["body", "value"], message: "Enter a domain such as example.org or an address" },
    ]);
  }
  const target = services.db.select().from(targets).where(eq(targets.id, body.targetId)).get();
  if (!target) throw notFound(`Target ${body.targetId} not found`, "target_not_found");
  const existing = services.db
    .select()
    .from(intakeSenders)
    .where(and(eq(intakeSenders.mailboxId, mailbox.id), eq(intakeSenders.value, value)))
    .get();
  if (existing) return toSender(existing, target.name);
  const row = services.db
    .insert(intakeSenders)
    .values({
      id: newId(),
      mailboxId: mailbox.id,
      targetId: target.id,
      kind,
      value,
      createdAt: nowIso(services.clock),
    })
    .returning()
    .get();
  return toSender(row, target.name);
}

export function removeIntakeSender(
  services: Pick<AppServices, "db">,
  mailbox: MailboxRow,
  senderId: string,
): void {
  const removed = services.db
    .delete(intakeSenders)
    .where(and(eq(intakeSenders.id, senderId), eq(intakeSenders.mailboxId, mailbox.id)))
    .returning({ id: intakeSenders.id })
    .all();
  if (removed.length === 0) throw notFound("That sender is not on the list", "sender_not_found");
}
