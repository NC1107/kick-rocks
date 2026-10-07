import { type DbHandle, type MatchRow, matches, type ScanRow, scans } from "@kickrocks/db";
import {
  type Candidate,
  isActiveStatus,
  isOnDomain,
  normalizeRecordUrl,
  type RequestRecord,
} from "@kickrocks/shared";
import { and, eq } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import { newId } from "../core/ids.js";
import type { Task } from "../core/task-types.js";
import type { AppServices } from "../services.js";
import { handToAgentAfterRecipeFailure, recordRecipeRun } from "./recipe-runs.js";

type ScanTask = Task<"scan"> | Task<"agent">;

function scanOf(tx: DbHandle, taskId: string): ScanRow | undefined {
  return tx.select().from(scans).where(eq(scans.taskId, taskId)).get();
}

/** A removal that finished and was never undone: finding the person here again means they were relisted. */
const isSettledRemoval = (request: RequestRecord) =>
  request.status === "confirmed" || request.status === "no_record";

type Verdict = { kind: "skip" } | { kind: "ask" } | { kind: "relisted"; previous: RequestRecord };

/**
 * What a record found by a scan means given everything the person already decided about it.
 * A record they said is not theirs stays that way, a record already being removed is left alone,
 * and one whose removal had finished is a relisting, which is what re-scanning is for.
 */
function judge(services: AppServices, earlier: readonly MatchRow[]): Verdict {
  if (earlier.length === 0) return { kind: "ask" };
  if (earlier.some((match) => match.decision === "pending")) return { kind: "skip" };
  const mine = earlier.filter((match) => match.decision === "mine");
  if (mine.length === 0) return { kind: "skip" };

  const requests = mine
    .map((match) => (match.requestId ? services.requests.get(match.requestId) : null))
    .filter((request): request is RequestRecord => request !== null);
  if (requests.some((request) => isActiveStatus(request.status))) return { kind: "skip" };
  const settled = requests
    .filter(isSettledRemoval)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .at(-1);
  return settled ? { kind: "relisted", previous: settled } : { kind: "ask" };
}

/**
 * Opens the removal again for a record the person already confirmed is theirs. They said so once,
 * so asking again would make every relisting a chore; if the request cannot be opened (the target
 * left the dataset, the mailbox is gone) the person is asked instead.
 */
function reopen(
  services: AppServices,
  scan: ScanRow,
  candidate: Candidate,
  previous: RequestRecord,
): string | null {
  services.requests.addEvent(previous.id, {
    type: "relisted",
    actor: "system",
    payload: { recordUrl: candidate.recordUrl, previousStatus: previous.status },
  });
  try {
    return services.requests.open({
      profileId: scan.profileId,
      targetId: scan.targetId,
      rights: previous.rights,
      channel: "form",
      recordUrl: candidate.recordUrl,
      actor: "system",
    }).request.id;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    services.logger.info(
      { scanId: scan.id, code: error.code },
      "could not reopen a removal for a relisted record",
    );
    return null;
  }
}

function recordMatches(
  services: AppServices,
  tx: DbHandle,
  scan: ScanRow,
  candidates: readonly Candidate[],
): void {
  const history = tx
    .select()
    .from(matches)
    .where(and(eq(matches.profileId, scan.profileId), eq(matches.targetId, scan.targetId)))
    .all();
  const seen = new Set<string>();
  const now = services.clock.now().toISOString();
  const domain = services.targets.getOrThrow(scan.targetId).domain;

  for (const candidate of candidates) {
    const key = normalizeRecordUrl(candidate.recordUrl);
    if (key === null || seen.has(key)) continue;
    // A scan page is untrusted, so a partner or ad link it lists must never become a place the
    // person's details are sent to.
    if (!isOnDomain(candidate.recordUrl, domain)) {
      services.logger.warn(
        { scanId: scan.id, host: new URL(candidate.recordUrl).hostname },
        "dropped a scan candidate that is not on the broker's site",
      );
      continue;
    }
    seen.add(key);

    const earlier = history.filter((match) => normalizeRecordUrl(match.recordUrl) === key);
    const verdict = judge(services, earlier);
    if (verdict.kind === "skip") continue;

    const { recordUrl, ...fields } = candidate;
    const requestId =
      verdict.kind === "relisted" ? reopen(services, scan, candidate, verdict.previous) : null;
    tx.insert(matches)
      .values({
        id: newId(),
        scanId: scan.id,
        profileId: scan.profileId,
        targetId: scan.targetId,
        recordUrl,
        fields,
        decision: requestId ? "mine" : "pending",
        decidedAt: requestId ? now : null,
        requestId,
      })
      .run();
  }
}

function finishScan(
  services: AppServices,
  tx: DbHandle,
  taskId: string,
  candidates: readonly Candidate[],
): void {
  const scan = scanOf(tx, taskId);
  if (!scan || scan.finishedAt !== null) return;
  tx.update(scans)
    .set({
      finishedAt: services.clock.now().toISOString(),
      candidates: [...candidates],
      error: null,
    })
    .where(eq(scans.id, scan.id))
    .run();
  recordMatches(services, tx, scan, candidates);
}

function failScan(services: AppServices, tx: DbHandle, task: ScanTask): void {
  const scan = scanOf(tx, task.id);
  if (!scan || scan.finishedAt !== null) return;
  tx.update(scans)
    .set({
      finishedAt: services.clock.now().toISOString(),
      error: task.lastError ?? "The scan failed",
    })
    .where(eq(scans.id, scan.id))
    .run();
}

/** Scan results become matches, and a scan that cannot finish says why instead of looking busy forever. */
export function registerScanHandlers(services: AppServices): void {
  const { taskHandlers } = services;

  taskHandlers.on("scan", "completed", ({ task }, tx) => {
    recordRecipeRun(services, tx, task.payload.recipeId, true);
    finishScan(services, tx, task.id, task.result?.candidates ?? []);
  });

  taskHandlers.on("agent", "completed", ({ task }, tx) => {
    if (task.payload.purpose !== "scan") return;
    const result = task.result?.purpose === "scan" ? task.result.scan.candidates : [];
    finishScan(services, tx, task.id, result);
  });

  taskHandlers.on("scan", "failed", ({ task }, tx) => {
    if (task.failureKind === "recipe") {
      recordRecipeRun(services, tx, task.payload.recipeId, false);
      if (handToAgentAfterRecipeFailure(services, task)) return;
    }
    failScan(services, tx, task);
  });

  taskHandlers.on("agent", "failed", ({ task }, tx) => {
    if (task.payload.purpose === "scan") failScan(services, tx, task);
  });
}
