import { type DbHandle, type MatchRow, matches, type ScanRow, scans } from "@kickrocks/db";
import {
  type Candidate,
  isActiveStatus,
  isOnDomain,
  normalizeRecordUrl,
  RECORD_RIGHTS,
  type RequestRecord,
  type RequestRight,
  scoreCandidate,
} from "@kickrocks/shared";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "../core/errors.js";
import { newId } from "../core/ids.js";
import { scoreProfileOf } from "../core/match-assessment.js";
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
 * Opens a removal for a record without asking. If the request cannot be opened (the target left
 * the dataset, the mailbox is gone) the person is asked instead.
 */
function openUnasked(
  services: AppServices,
  scan: ScanRow,
  candidate: Candidate,
  rights: readonly RequestRight[],
  why: string,
): string | null {
  try {
    return services.requests.open({
      profileId: scan.profileId,
      targetId: scan.targetId,
      rights: [...rights],
      channel: "form",
      recordUrl: candidate.recordUrl,
      actor: "system",
    }).request.id;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    services.logger.info({ scanId: scan.id, code: error.code }, why);
    return null;
  }
}

/**
 * Opens the removal again for a record the person already confirmed is theirs. They said so once,
 * so asking again would make every relisting a chore.
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
  return openUnasked(
    services,
    scan,
    candidate,
    previous.rights,
    "could not reopen a removal for a relisted record",
  );
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
  const today = now.slice(0, 10);
  const profile = scoreProfileOf(tx, scan.profileId, today);
  const autopilot = services.settings.get("agent.autopilot");

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
    // A record that is listed again was not gone, whatever the last scan said.
    for (const match of earlier) {
      if (match.verifiedGoneAt === null) continue;
      tx.update(matches).set({ verifiedGoneAt: null }).where(eq(matches.id, match.id)).run();
    }
    const verdict = judge(services, earlier);
    if (verdict.kind === "skip") continue;

    const { recordUrl, ...fields } = candidate;
    const assessment = scoreCandidate(fields, profile, today);
    // With autopilot on, a record that scores as likely theirs is theirs: the person asked not to
    // be asked. The score never decides on its own otherwise.
    const requestId =
      verdict.kind === "relisted"
        ? reopen(services, scan, candidate, verdict.previous)
        : autopilot && assessment.band === "likely"
          ? openUnasked(
              services,
              scan,
              candidate,
              RECORD_RIGHTS,
              "could not open a removal for a likely record on autopilot",
            )
          : null;
    tx.insert(matches)
      .values({
        id: newId(),
        scanId: scan.id,
        profileId: scan.profileId,
        targetId: scan.targetId,
        recordUrl,
        fields,
        assessment,
        decision: requestId ? "mine" : "pending",
        decidedAt: requestId ? now : null,
        requestId,
      })
      .run();
  }
}

/**
 * Settled removals whose record this scan no longer lists are verified gone. Only a scan that
 * searched the person's own details counts, and only one that listed results or whose site said
 * nothing matched: an empty list the site never confirmed may be a block that looked like a
 * clean page.
 */
function verifyAbsences(
  services: AppServices,
  tx: DbHandle,
  scan: ScanRow,
  candidates: readonly Candidate[],
  noResultsShown: boolean,
): void {
  if (candidates.length === 0 && !noResultsShown) return;
  const listed = new Set(candidates.map((candidate) => normalizeRecordUrl(candidate.recordUrl)));
  const now = services.clock.now().toISOString();
  const earlier = tx
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.profileId, scan.profileId),
        eq(matches.targetId, scan.targetId),
        eq(matches.decision, "mine"),
        isNull(matches.verifiedGoneAt),
      ),
    )
    .all();
  for (const match of earlier) {
    if (match.requestId === null || listed.has(normalizeRecordUrl(match.recordUrl))) continue;
    const request = services.requests.get(match.requestId);
    if (!request || !isSettledRemoval(request)) continue;
    tx.update(matches).set({ verifiedGoneAt: now }).where(eq(matches.id, match.id)).run();
    services.requests.addEvent(request.id, {
      type: "verified_gone",
      actor: "system",
      payload: { recordUrl: match.recordUrl, scanId: scan.id },
    });
  }
}

/**
 * A scan that ended in failure is not final while its task can still report: a holder whose lease
 * ran out on the last attempt may yet deliver the real result, which beats the expiry failure.
 */
const endedInFailure = (scan: ScanRow) => scan.finishedAt !== null && scan.error !== null;

function finishScan(
  services: AppServices,
  tx: DbHandle,
  taskId: string,
  candidates: readonly Candidate[],
  noResultsShown: boolean,
  searchedUnderVariant: boolean,
): void {
  const scan = scanOf(tx, taskId);
  if (!scan || (scan.finishedAt !== null && !endedInFailure(scan))) return;
  tx.update(scans)
    .set({
      finishedAt: services.clock.now().toISOString(),
      candidates: [...candidates],
      noResultsShown,
      error: null,
    })
    .where(eq(scans.id, scan.id))
    .run();
  recordMatches(services, tx, scan, candidates);
  if (!searchedUnderVariant) verifyAbsences(services, tx, scan, candidates, noResultsShown);
}

/** Puts a scan that was marked failed back to running, for the agent that takes the work over. */
function reopenScan(tx: DbHandle, scan: ScanRow): void {
  if (!endedInFailure(scan)) return;
  tx.update(scans).set({ finishedAt: null, error: null }).where(eq(scans.id, scan.id)).run();
}

function failScan(services: AppServices, tx: DbHandle, task: ScanTask): void {
  const scan = scanOf(tx, task.id);
  if (!scan || (scan.finishedAt !== null && !endedInFailure(scan))) return;
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

  taskHandlers.on("scan", "completed", ({ task, actor }, tx) => {
    // The server finishes a scan itself when it reuses an earlier result, and no recipe ran.
    if (actor !== "system") recordRecipeRun(services, tx, task.payload.recipeId, true);
    finishScan(
      services,
      tx,
      task.id,
      task.result?.candidates ?? [],
      task.result?.noResultsShown === true,
      task.payload.variant !== null,
    );
  });

  taskHandlers.on("agent", "completed", ({ task }, tx) => {
    if (task.payload.purpose !== "scan") return;
    const scan = task.result?.purpose === "scan" ? task.result.scan : null;
    finishScan(
      services,
      tx,
      task.id,
      scan?.candidates ?? [],
      scan?.noResultsShown === true,
      task.payload.variant !== null,
    );
  });

  taskHandlers.on("scan", "failed", ({ task }, tx) => {
    if (task.failureKind === "recipe") {
      recordRecipeRun(services, tx, task.payload.recipeId, false);
      const scan = scanOf(tx, task.id);
      const handoff = handToAgentAfterRecipeFailure(services, task);
      // An agent task that was already live belongs to some other scan row, so this one has to
      // keep saying why it failed instead of looking finished with nothing found.
      if (handoff?.created) {
        if (scan) reopenScan(tx, scan);
        return;
      }
    }
    failScan(services, tx, task);
  });

  taskHandlers.on("agent", "failed", ({ task }, tx) => {
    if (task.payload.purpose === "scan") failScan(services, tx, task);
  });
}
