import { type MailboxRow, mailboxes, profiles } from "@kickrocks/db";
import type { ApiIssue, Mailbox, MailboxInput, MailboxTestBody } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { conflict, invalidRequest, notFound } from "../../core/errors.js";
import { newId } from "../../core/ids.js";
import { findProviderPreset } from "../../mail/presets.js";
import type { MailConnection } from "../../mail/types.js";
import type { AppServices } from "../../services.js";

type MailboxServices = Pick<AppServices, "db" | "clock" | "taskQueue">;

export function requireProfile(services: MailboxServices, profileId: string): void {
  const profile = services.db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.id, profileId))
    .get();
  if (!profile) throw notFound(`Profile ${profileId} not found`, "profile_not_found");
}

export function findMailbox(services: MailboxServices, profileId: string): MailboxRow | null {
  return (
    services.db.select().from(mailboxes).where(eq(mailboxes.profileId, profileId)).get() ?? null
  );
}

export function requireMailbox(services: MailboxServices, profileId: string): MailboxRow {
  requireProfile(services, profileId);
  const mailbox = findMailbox(services, profileId);
  if (!mailbox) throw conflict("mailbox_required", "Connect a mailbox first");
  return mailbox;
}

/** The mailbox as the client may see it: everything except the app password. */
export function toMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    profileId: row.profileId,
    provider: row.provider,
    address: row.address,
    username: row.username,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    replyFolder: row.replyFolder,
    dailyCap: row.dailyCap,
    lastPolledAt: row.lastPolledAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

export function connectionOf(row: MailboxRow): MailConnection {
  return {
    address: row.address,
    username: row.username,
    password: row.secret,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
  };
}

function issue(field: string, message: string): ApiIssue {
  return { path: ["body", field], message };
}

/** A provider Kick Rocks cannot use is refused with the reason, not stored and left to fail later. */
function checkProvider(provider: string): void {
  const preset = findProviderPreset(provider);
  if (!preset) {
    throw invalidRequest("That mail provider is not known", [
      issue("provider", "Choose one of the listed providers"),
    ]);
  }
  if (!preset.supported) {
    throw invalidRequest(preset.unsupportedReason ?? "That mail provider is not supported", [
      issue("provider", preset.unsupportedReason ?? "That mail provider is not supported"),
    ]);
  }
}

type Connecting = Pick<
  MailboxTestBody,
  "username" | "smtpHost" | "smtpPort" | "imapHost" | "imapPort"
>;

/** A saved password was issued for one account on one pair of servers, and goes nowhere else. */
function sameDestination(stored: MailboxRow, body: Connecting): boolean {
  return (
    stored.username === body.username &&
    stored.smtpHost === body.smtpHost &&
    stored.smtpPort === body.smtpPort &&
    stored.imapHost === body.imapHost &&
    stored.imapPort === body.imapPort
  );
}

function requirePassword(
  password: string | undefined,
  stored: MailboxRow | null,
  body: Connecting,
): string {
  if (password) return password;
  if (stored && !sameDestination(stored, body)) {
    throw invalidRequest("The saved app password is for different servers", [
      issue("password", "The username or servers changed, so enter the app password again"),
    ]);
  }
  if (!stored?.secret) {
    throw invalidRequest("An app password is required", [
      issue("password", "Enter the app password"),
    ]);
  }
  return stored.secret;
}

/** The connection a test should use: what was typed, with the stored password when none was typed. */
export function connectionForTest(
  body: MailboxTestBody,
  stored: MailboxRow | null,
): MailConnection {
  checkProvider(body.provider);
  return {
    address: body.address,
    username: body.username,
    password: requirePassword(body.password, stored, body),
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort,
    smtpSecure: body.smtpSecure,
    imapHost: body.imapHost,
    imapPort: body.imapPort,
  };
}

/** Where the poll cursor points only makes sense for the same account on the same server and folder. */
function cursorStillValid(existing: MailboxRow, body: MailboxInput): boolean {
  return (
    existing.imapHost === body.imapHost &&
    existing.imapPort === body.imapPort &&
    existing.username === body.username &&
    existing.replyFolder === body.replyFolder
  );
}

export function saveMailbox(
  services: MailboxServices,
  profileId: string,
  body: MailboxInput,
): MailboxRow {
  checkProvider(body.provider);
  const existing = findMailbox(services, profileId);
  const secret = requirePassword(body.password, existing, body);
  const fields = {
    provider: body.provider,
    address: body.address,
    username: body.username,
    secret,
    smtpHost: body.smtpHost,
    smtpPort: body.smtpPort,
    smtpSecure: body.smtpSecure,
    imapHost: body.imapHost,
    imapPort: body.imapPort,
    replyFolder: body.replyFolder,
    dailyCap: body.dailyCap,
  };

  if (!existing) {
    return services.db
      .insert(mailboxes)
      .values({ id: newId(), profileId, ...fields, createdAt: nowIso(services.clock) })
      .returning()
      .get();
  }
  const keepCursor = cursorStillValid(existing, body);
  return services.db
    .update(mailboxes)
    .set({
      ...fields,
      ...(keepCursor ? {} : { uidValidity: null, lastPollUid: null, lastPolledAt: null }),
      // A fixed setting is a chance to try again, so an old failure is not shown against new settings.
      lastError: null,
    })
    .where(eq(mailboxes.id, existing.id))
    .returning()
    .get();
}

/** Removes the mailbox and stops the polls that were waiting for it. */
export function deleteMailbox(services: MailboxServices, profileId: string): void {
  requireProfile(services, profileId);
  const existing = findMailbox(services, profileId);
  if (!existing) throw notFound("This profile has no mailbox", "mailbox_not_found");
  services.db.transaction(() => {
    for (const task of services.taskQueue.list({
      kinds: ["inbox_poll"],
      profileId,
      status: ["queued", "leased"],
    })) {
      services.taskQueue.cancel(task.id);
    }
    services.db.delete(mailboxes).where(eq(mailboxes.id, existing.id)).run();
  });
}
