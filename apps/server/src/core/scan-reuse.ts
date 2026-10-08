import { createHash } from "node:crypto";
import { type KickRocksDb, recipes, scans } from "@kickrocks/db";
import { type ProfileField, resolveProfileFields, type ScanVariant } from "@kickrocks/shared";
import { and, desc, eq, gte, isNotNull, isNull, ne } from "drizzle-orm";
import type { AppServices } from "../services.js";
import { type Clock, nowIso } from "./clock.js";
import { loadIdentities } from "./identities.js";

const REUSE_WORKER = "kickrocks-scan-reuse";
const REUSE_LEASE_MS = 60_000;
const MAX_REUSED_PER_PASS = 100;

/**
 * Names who is being searched for and where. Two scans with the same key would type the same
 * values into the same site, so the second can use the first one's answer. The key is a hash, so
 * it can sit in the database without holding the person's details.
 */
export function scanSearchKey(
  db: KickRocksDb,
  clock: Clock,
  input: {
    profileId: string;
    targetId: string;
    recipeId: string | null;
    variant: ScanVariant | null;
    /** The fields an agent may search with, which a scan without a recipe has no other way to name. */
    agentFields: readonly ProfileField[];
  },
): string {
  const recipe = input.recipeId
    ? db
        .select({ definition: recipes.definition })
        .from(recipes)
        .where(eq(recipes.id, input.recipeId))
        .get()
    : undefined;
  const names = recipe?.definition.fields ?? input.agentFields;
  const fields = resolveProfileFields(loadIdentities(db, input.profileId), names, {
    asOf: nowIso(clock).slice(0, 10),
    nameId: input.variant?.nameId ?? null,
    addressId: input.variant?.addressId ?? null,
  });
  const normalized = Object.entries(fields)
    .map(([name, value]) => [name, String(value).trim().toLowerCase()] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify([input.targetId, normalized]))
    .digest("hex");
}

type ReuseServices = Pick<AppServices, "db" | "clock" | "settings" | "taskQueue">;

/**
 * Finishes queued scans from an earlier scan for the same identity on the same site, when that one
 * finished inside the reuse window. The site is not visited, the task never takes a slot at the
 * gate, and the result flows through the normal completion so matches are made exactly as if the
 * search had run. A copy never counts as a fresh search, so reuse cannot extend itself.
 */
export function reuseRecentScans(services: ReuseServices): number {
  const { db, clock, settings, taskQueue } = services;
  const { reuseHours } = settings.get("scanning");
  if (reuseHours === 0) return 0;
  const cutoff = new Date(clock.now().getTime() - reuseHours * 3_600_000).toISOString();

  let reused = 0;
  const queued = taskQueue.list({ status: "queued", kinds: ["scan", "agent"], limit: 500 });
  for (const task of queued) {
    if (reused >= MAX_REUSED_PER_PASS) break;
    if (task.kind === "agent" && task.payload.purpose !== "scan") continue;
    const pending = db.select().from(scans).where(eq(scans.taskId, task.id)).get();
    if (!pending?.searchKey || pending.finishedAt !== null) continue;
    const source = db
      .select()
      .from(scans)
      .where(
        and(
          eq(scans.searchKey, pending.searchKey),
          ne(scans.id, pending.id),
          isNotNull(scans.finishedAt),
          gte(scans.finishedAt, cutoff),
          isNull(scans.error),
          isNotNull(scans.candidates),
          isNull(scans.reusedFromScanId),
        ),
      )
      .orderBy(desc(scans.finishedAt))
      .get();
    if (!source?.candidates) continue;

    const candidates = source.candidates;
    const done = db.transaction(() => {
      const leased = taskQueue.claim({
        workerId: REUSE_WORKER,
        kinds: [task.kind],
        leaseMs: REUSE_LEASE_MS,
        taskId: task.id,
        skipPoliteness: true,
      });
      if (!leased) return false;
      taskQueue.complete(task.id, {
        workerId: REUSE_WORKER,
        result: task.kind === "agent" ? { purpose: "scan", scan: { candidates } } : { candidates },
        actor: "system",
      });
      db.update(scans).set({ reusedFromScanId: source.id }).where(eq(scans.id, pending.id)).run();
      return true;
    });
    if (done) reused += 1;
  }
  return reused;
}
