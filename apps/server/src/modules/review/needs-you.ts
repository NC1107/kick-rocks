import { scans, taskSends } from "@kickrocks/db";
import {
  type BlockedTaskItem,
  kindOfTask,
  type Match,
  NEEDS_YOU_CHIPS,
  NEEDS_YOU_EFFORT,
  type NeedsYouItem,
  type NeedsYouQueue,
  needsYouCounts,
  orderNeedsYou,
  type VerificationItem,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import type { AppServices } from "../../services.js";
import type { Marks } from "./marks.js";
import { heldLive, items, pendingMatches, verifications } from "./queue.js";

type Candidate = Omit<NeedsYouItem, "order" | "tries" | "lastTriedAt" | "openedAt"> & {
  title: string;
};

function liveHoldWindow(services: AppServices, taskId: string) {
  const rows = services.db
    .select({ expiresAt: taskSends.expiresAt, createdAt: taskSends.createdAt })
    .from(taskSends)
    .where(
      and(
        eq(taskSends.taskId, taskId),
        eq(taskSends.kind, "held"),
        eq(taskSends.status, "pending_live"),
      ),
    )
    .all();
  const expiries = rows.flatMap(({ expiresAt }) => (expiresAt ? [expiresAt] : [])).sort();
  const starts = rows.map(({ createdAt }) => createdAt).sort();
  return { expiresAt: expiries[0] ?? null, since: starts[0] ?? null };
}

function taskCandidate(services: AppServices, item: BlockedTaskItem): Candidate | null {
  const { task } = item;
  const kind = kindOfTask(task);
  if (kind === null) return null;
  const hold = kind === "hold" ? liveHoldWindow(services, task.id) : null;
  const since =
    hold?.since ??
    (task.status === "queued" ? (task.assignment?.at ?? task.updatedAt) : task.updatedAt);
  return {
    key: `task:${task.id}`,
    kind,
    effort: NEEDS_YOU_EFFORT[kind],
    since,
    expiresAt: hold?.expiresAt ?? null,
    target: task.targetId && task.targetName ? { id: task.targetId, name: task.targetName } : null,
    requestReference: item.requestReference,
    url: item.url,
    chips: [...NEEDS_YOU_CHIPS[kind]],
    source: { task: item },
    title: task.targetName ?? "Task",
  };
}

function matchCandidate(services: AppServices, match: Match): Candidate {
  const scan = services.db
    .select({ startedAt: scans.startedAt, finishedAt: scans.finishedAt })
    .from(scans)
    .where(eq(scans.id, match.scanId))
    .get();
  return {
    key: `match:${match.id}`,
    kind: "record",
    effort: NEEDS_YOU_EFFORT.record,
    since: scan?.finishedAt ?? scan?.startedAt ?? services.clock.now().toISOString(),
    expiresAt: null,
    target: { id: match.targetId, name: match.targetName },
    requestReference: null,
    url: null,
    chips: [],
    source: { match },
    title: match.fields.name,
  };
}

function detailsCandidate(item: VerificationItem): Candidate {
  return {
    key: `details:${item.request.id}`,
    kind: "details",
    effort: NEEDS_YOU_EFFORT.details,
    since: item.message.receivedAt,
    expiresAt: null,
    target: { id: item.request.target.id, name: item.request.target.name },
    requestReference: item.request.reference,
    url: null,
    chips: [...item.requestedFields],
    source: { verification: item },
    title: item.request.target.name,
  };
}

/**
 * Everything that waits on the person and nobody else, in the order to do it. Mail, failures and
 * tasks waiting for an agent have their own pages and are left out. A mark that is older than the
 * item was written about something that has since changed, so it counts for nothing.
 */
export function buildNeedsYouQueue(
  services: AppServices,
  marks: Marks,
  profileId: string | undefined,
): NeedsYouQueue {
  const now = services.clock.now();
  const takenByYou = services.taskQueue
    .list({ status: "queued", kinds: ["agent"], profileId })
    .filter((task) => task.assignment?.to.kind === "person");
  const candidates = [
    ...items(services, [
      ...heldLive(services, profileId),
      ...services.taskQueue.list({ status: "blocked", profileId }),
      ...takenByYou,
    ]),
  ].flatMap((item) => taskCandidate(services, item) ?? []);
  candidates.push(
    ...pendingMatches(services, profileId).map((match) => matchCandidate(services, match)),
    ...verifications(services, profileId).map(detailsCandidate),
  );

  const stored = marks.forProfile(profileId);
  const active: NeedsYouItem[] = [];
  const snoozed: NeedsYouQueue["snoozed"] = [];
  for (const { title, ...candidate } of candidates) {
    const row = stored.get(candidate.key);
    const current = row && row.updatedAt >= candidate.since ? row : undefined;
    const until = current?.snoozedUntil ?? null;
    if (candidate.kind !== "hold" && until !== null && new Date(until) > now) {
      snoozed.push({ key: candidate.key, kind: candidate.kind, title, until });
      continue;
    }
    active.push({
      ...candidate,
      order: 0,
      tries: current?.tries ?? 0,
      lastTriedAt: current?.lastTriedAt ?? null,
      openedAt: current?.openedAt ?? null,
    });
  }
  const ordered = orderNeedsYou(active, now);
  snoozed.sort((a, b) => a.until.localeCompare(b.until) || a.key.localeCompare(b.key));
  return { items: ordered, snoozed, counts: needsYouCounts(ordered, snoozed.length) };
}
