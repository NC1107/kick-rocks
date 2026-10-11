import { scans, taskSends } from "@kickrocks/db";
import {
  assembleNeedsYou,
  type BlockedTaskItem,
  candidateOfMatch,
  candidateOfTask,
  candidateOfVerification,
  type NeedsYouCandidate,
  type NeedsYouQueue,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import type { AppServices } from "../../services.js";
import type { Marks } from "./marks.js";
import { heldLive, items, pendingMatches, verifications } from "./queue.js";

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

function taskCandidate(services: AppServices, item: BlockedTaskItem): NeedsYouCandidate | null {
  const live = item.task.status === "leased";
  return candidateOfTask(item, live ? liveHoldWindow(services, item.task.id) : null);
}

/**
 * Everything that waits on the person and nobody else, in the order to do it. Mail, failures and
 * tasks waiting for an agent have their own pages and are left out.
 */
export function buildNeedsYouQueue(
  services: AppServices,
  marks: Marks,
  profileId: string | undefined,
): NeedsYouQueue {
  const takenByYou = services.taskQueue
    .list({ status: "queued", kinds: ["agent"], profileId })
    .filter((task) => task.assignment?.to.kind === "person");
  const candidates: NeedsYouCandidate[] = [
    ...items(services, [
      ...heldLive(services, profileId),
      ...services.taskQueue.list({ status: "blocked", profileId }),
      ...takenByYou,
    ]).flatMap((item) => taskCandidate(services, item) ?? []),
    ...pendingMatches(services, profileId).map((match) => {
      const scan = services.db
        .select({ startedAt: scans.startedAt, finishedAt: scans.finishedAt })
        .from(scans)
        .where(eq(scans.id, match.scanId))
        .get();
      return candidateOfMatch(
        match,
        scan?.finishedAt ?? scan?.startedAt ?? services.clock.now().toISOString(),
      );
    }),
    ...verifications(services, profileId).map(candidateOfVerification),
  ];
  return assembleNeedsYou(candidates, marks.forProfile(profileId), services.clock.now());
}
