import {
  type KickRocksDb,
  mailboxes,
  matches,
  messages,
  profiles,
  requests,
  scans,
  targets,
} from "@kickrocks/db";
import {
  PROFILE_EXPORT_FORMAT,
  PROFILE_EXPORT_VERSION,
  type ProfileExport,
} from "@kickrocks/shared";
import { asc, eq, sql } from "drizzle-orm";
import { type Clock, nowIso } from "../../core/clock.js";
import { notFound } from "../../core/errors.js";
import { loadIdentities } from "../../core/identities.js";
import type { Requests } from "../../core/request-flow.js";

interface ExportDeps {
  db: KickRocksDb;
  clock: Clock;
  requests: Pick<Requests, "events">;
}

/**
 * One file with everything held about a profile. The mailbox password is left out, and so is the
 * body of every message: a person who wants their mail has it in their own mailbox.
 */
export function exportProfile(
  { db, clock, requests: requestService }: ExportDeps,
  profileId: string,
) {
  const profile = db.select().from(profiles).where(eq(profiles.id, profileId)).get();
  if (!profile) throw notFound(`Profile ${profileId} not found`, "profile_not_found");

  const mailbox = db.select().from(mailboxes).where(eq(mailboxes.profileId, profileId)).get();

  const requestRows = db
    .select({ request: requests, target: targets })
    .from(requests)
    .innerJoin(targets, eq(targets.id, requests.targetId))
    .where(eq(requests.profileId, profileId))
    .orderBy(asc(requests.createdAt), asc(sql`requests.rowid`))
    .all();

  const messageRows = mailbox
    ? db
        .select()
        .from(messages)
        .where(eq(messages.mailboxId, mailbox.id))
        .orderBy(asc(messages.receivedAt), asc(sql`rowid`))
        .all()
    : [];

  const scanRows = db
    .select({ scan: scans, targetName: targets.name })
    .from(scans)
    .innerJoin(targets, eq(targets.id, scans.targetId))
    .where(eq(scans.profileId, profileId))
    .orderBy(asc(scans.startedAt), asc(sql`scans.rowid`))
    .all();

  const matchRows = db
    .select()
    .from(matches)
    .where(eq(matches.profileId, profileId))
    .orderBy(asc(sql`rowid`))
    .all();

  const result: ProfileExport = {
    format: PROFILE_EXPORT_FORMAT,
    version: PROFILE_EXPORT_VERSION,
    exportedAt: nowIso(clock),
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      state: profile.state,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    },
    identities: loadIdentities(db, profileId),
    mailbox: mailbox
      ? {
          provider: mailbox.provider,
          address: mailbox.address,
          username: mailbox.username,
          smtpHost: mailbox.smtpHost,
          smtpPort: mailbox.smtpPort,
          smtpSecure: mailbox.smtpSecure,
          imapHost: mailbox.imapHost,
          imapPort: mailbox.imapPort,
          replyFolder: mailbox.replyFolder,
          dailyCap: mailbox.dailyCap,
          createdAt: mailbox.createdAt,
        }
      : null,
    requests: requestRows.map(({ request, target }) => ({
      id: request.id,
      reference: request.reference,
      target: { id: target.id, name: target.name, domain: target.domain, kind: target.kind },
      rights: request.rights,
      legalBasis: request.legalBasis,
      channel: request.channel,
      status: request.status,
      recordUrl: request.recordUrl,
      followUps: request.followUps,
      sentAt: request.sentAt,
      dueAt: request.dueAt,
      followUpAt: request.followUpAt,
      lastError: request.lastError,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      events: requestService.events(request.id),
    })),
    messages: messageRows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      fromAddress: row.fromAddress,
      subject: row.subject,
      receivedAt: row.receivedAt,
      classification: row.classification,
      confidence: row.confidence,
      requestedFields: row.requestedFields,
      reviewed: row.reviewed,
    })),
    scans: scanRows.map(({ scan, targetName }) => ({
      id: scan.id,
      targetId: scan.targetId,
      targetName,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      error: scan.error,
      candidates: scan.candidates,
    })),
    matches: matchRows.map((row) => ({
      id: row.id,
      scanId: row.scanId,
      targetId: row.targetId,
      recordUrl: row.recordUrl,
      fields: row.fields,
      decision: row.decision,
      decidedAt: row.decidedAt,
      requestId: row.requestId,
    })),
  };
  return result;
}
