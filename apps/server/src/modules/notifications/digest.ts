import {
  type MailboxRow,
  mailboxes,
  profiles,
  requestEvents,
  requests,
  targets,
} from "@kickrocks/db";
import {
  type DigestSendResult,
  type DigestSettings,
  outgoingMessageId,
  type RequestStatus,
  reviewAttention,
} from "@kickrocks/shared";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { newId } from "../../core/ids.js";
import { connectionOf, describeError } from "../../runners/connection.js";
import type { AppServices } from "../../services.js";
import { buildReviewQueue } from "../review/queue.js";
import { readState, updateState } from "./state.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
const MAX_CHANGE_LINES = 40;

/** The latest moment at or before `now` when the digest is scheduled to go out; null when it is off. */
export function latestDigestSlot(digest: DigestSettings, now: Date): Date | null {
  if (digest.frequency === "off") return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), digest.hourUtc);
  if (digest.frequency === "daily") {
    return new Date(today > now.getTime() ? today - DAY_MS : today);
  }
  const back = (now.getUTCDay() - digest.weekday + 7) % 7;
  const slot = today - back * DAY_MS;
  return new Date(slot > now.getTime() ? slot - 7 * DAY_MS : slot);
}

const periodMs = (digest: DigestSettings) => (digest.frequency === "weekly" ? 7 * DAY_MS : DAY_MS);

export function digestIsDue(services: AppServices): boolean {
  const { digest } = services.settings.get("notifications");
  const now = services.clock.now();
  const slot = latestDigestSlot(digest, now);
  if (!slot) return false;
  const state = readState(services);
  if (state.digestRetryAfter && Date.parse(state.digestRetryAfter) > now.getTime()) return false;
  return state.digestLastSentAt === null || Date.parse(state.digestLastSentAt) < slot.getTime();
}

const label = (status: RequestStatus) => status.replace(/_/g, " ");

interface Change {
  targetName: string;
  from: RequestStatus;
  to: RequestStatus;
}

/** Each request's net move in the window, so a request that went back and forth shows as one line. */
function statusChanges(
  services: AppServices,
  profileId: string,
  since: Date,
  until: Date,
): Change[] {
  const rows = services.db
    .select({
      requestId: requestEvents.requestId,
      payload: requestEvents.payload,
      targetName: targets.name,
    })
    .from(requestEvents)
    .innerJoin(requests, eq(requests.id, requestEvents.requestId))
    .innerJoin(targets, eq(targets.id, requests.targetId))
    .where(
      and(
        eq(requests.profileId, profileId),
        eq(requestEvents.type, "status_changed"),
        gt(requestEvents.createdAt, since.toISOString()),
        lte(requestEvents.createdAt, until.toISOString()),
      ),
    )
    .orderBy(asc(requestEvents.createdAt), asc(sql`${requestEvents}.rowid`))
    .all();
  const byRequest = new Map<string, Change>();
  for (const row of rows) {
    const { from, to } = row.payload as { from: RequestStatus; to: RequestStatus };
    const seen = byRequest.get(row.requestId);
    byRequest.set(row.requestId, { targetName: row.targetName, from: seen?.from ?? from, to });
  }
  return [...byRequest.values()].filter((change) => change.from !== change.to);
}

function attentionLines(services: AppServices, profileId: string): string[] {
  const queue = buildReviewQueue(services, profileId);
  const a = reviewAttention(queue);
  const lines: [number, string][] = [
    [a.blockedTasks, "Blocked tasks to finish by hand"],
    [a.needsVerification, "Requests waiting for you to approve identifiers"],
    [a.pendingMatches, "Listings waiting for your decision"],
    [a.failedTasks, "Failed tasks"],
    [a.agentTasks, "Tasks waiting for an agent"],
    [a.unreviewedMessages, "Replies to review"],
  ];
  return lines.filter(([count]) => count > 0).map(([count, text]) => `${text}: ${count}`);
}

function totalsLine(services: AppServices, profileId: string): string {
  const counts = new Map<RequestStatus, number>();
  for (const row of services.db
    .select({ status: requests.status })
    .from(requests)
    .where(eq(requests.profileId, profileId))
    .all()) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${label(status)} ${count}`)
    .join(", ");
}

export interface DigestContent {
  subject: string;
  text: string;
}

/** The digest for one profile, or null when nothing changed and nothing waits on the person. */
export function buildDigest(
  services: AppServices,
  profile: { id: string; displayName: string },
  since: Date,
  until: Date,
): DigestContent | null {
  const changes = statusChanges(services, profile.id, since, until);
  const needs = attentionLines(services, profile.id);
  if (changes.length === 0 && needs.length === 0) return null;

  const appUrl = services.config.publicUrl;
  const lines = [
    `Kick Rocks digest for ${profile.displayName}`,
    `From ${since.toISOString()} to ${until.toISOString()}`,
    "",
  ];
  if (needs.length > 0) {
    lines.push("Needs you", ...needs.map((line) => `- ${line}`), `Open ${appUrl}/review`, "");
  }
  if (changes.length > 0) {
    lines.push(
      "Status changes",
      ...changes
        .slice(0, MAX_CHANGE_LINES)
        .map((c) => `- ${c.targetName}: ${label(c.from)} -> ${label(c.to)}`),
    );
    if (changes.length > MAX_CHANGE_LINES) {
      lines.push(`- and ${changes.length - MAX_CHANGE_LINES} more, see ${appUrl}/requests`);
    }
    lines.push("");
  }
  const totals = totalsLine(services, profile.id);
  if (totals) lines.push("All requests", totals, "");
  lines.push(`Sent by your Kick Rocks at ${appUrl} to your own mailbox.`);

  const subject = `Kick Rocks digest: ${changes.length} status ${
    changes.length === 1 ? "change" : "changes"
  }, ${needs.length} ${needs.length === 1 ? "thing needs" : "things need"} you`;
  return { subject, text: lines.join("\n") };
}

function messageIdFor(address: string): string {
  // The `kr.` form is what the inbox poll recognises as Kick Rocks' own mail, so the digest that
  // lands back in the same inbox is skipped instead of filed in Review as an unmatched reply.
  const domain = address.split("@")[1] ?? "kickrocks.invalid";
  return outgoingMessageId(`digest-${newId()}`, domain);
}

async function sendOne(
  services: AppServices,
  mailbox: MailboxRow,
  content: DigestContent,
): Promise<void> {
  await services.mail.transport(connectionOf(mailbox)).send({
    from: { name: "Kick Rocks", address: mailbox.address },
    to: mailbox.address,
    subject: content.subject,
    text: content.text,
    messageId: messageIdFor(mailbox.address),
  });
}

/**
 * Mails the digest from each profile's own mailbox to that same address, covering the time since
 * the last digest. It uses the mailbox transport as the request emails do, so nothing leaves
 * through a service the person did not already trust with their mail.
 */
export async function sendDigest(services: AppServices): Promise<DigestSendResult> {
  const now = services.clock.now();
  const { digest } = services.settings.get("notifications");
  const state = readState(services);
  const since = state.digestLastSentAt
    ? new Date(state.digestLastSentAt)
    : new Date(now.getTime() - periodMs(digest));

  const rows = services.db
    .select({ mailbox: mailboxes, profile: profiles })
    .from(mailboxes)
    .innerJoin(profiles, eq(profiles.id, mailboxes.profileId))
    .all();

  let sent = 0;
  const failures: string[] = [];
  for (const { mailbox, profile } of rows) {
    const content = buildDigest(services, profile, since, now);
    if (!content) continue;
    try {
      await sendOne(services, mailbox, content);
      sent += 1;
    } catch (error) {
      services.logger.warn({ mailboxId: mailbox.id, err: describeError(error) }, "digest failed");
      failures.push(describeError(error));
    }
  }

  const error = failures.length > 0 ? failures.join("; ") : null;
  const noMailbox = rows.length === 0;
  const failed = noMailbox || (failures.length > 0 && sent === 0);
  const noMailboxError = "Connect a mailbox to receive the digest";
  updateState(services, () =>
    failed
      ? {
          digestLastError: noMailbox ? noMailboxError : error,
          digestRetryAfter: new Date(now.getTime() + RETRY_AFTER_FAILURE_MS).toISOString(),
        }
      : {
          digestLastSentAt: now.toISOString(),
          digestLastError: error,
          digestRetryAfter: null,
        },
  );

  if (noMailbox) return { outcome: "no_mailbox", sent: 0, error: noMailboxError };
  if (failed) return { outcome: "failed", sent, error };
  return { outcome: sent > 0 ? "sent" : "nothing_to_report", sent, error };
}

/** The scheduler's entry: sends when a slot has passed since the last digest. */
export async function sendDigestIfDue(services: AppServices): Promise<DigestSendResult | null> {
  return digestIsDue(services) ? sendDigest(services) : null;
}
