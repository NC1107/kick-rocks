import {
  type DbHandle,
  type KickRocksDb,
  siteState,
  siteVisits,
  targets,
  tasks,
} from "@kickrocks/db";
import {
  BROWSER_TASK_KINDS,
  type BreakerState,
  isQuietHour,
  type Pushback,
  type ScanningSettings,
  type SiteObservation,
  type SiteStatus,
  type SitesStatus,
  siteOwnerKey,
  type TaskWaiting,
  type WaitReason,
} from "@kickrocks/shared";
import { and, asc, count, eq, gt, lt } from "drizzle-orm";
import type { Clock } from "./clock.js";
import { newId } from "./ids.js";
import type { SettingsStore } from "./settings.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long a task waits behind a visit that is still running before the gate looks again. */
const BUSY_RECHECK_MS = 30_000;

/** The most task rows one claim looks through, so a long queue of gated tasks stays cheap. */
export const MAX_GATED_CANDIDATES = 200;

/** How long visit rows are kept; the caps only look back a day. */
const VISIT_RETENTION_MS = 3 * DAY_MS;

export interface TaskForGate {
  /** Null for a request the server makes itself, which has no task row. */
  id: string | null;
  kind: string;
  targetId: string | null;
}

export type GateDecision =
  | { allow: true; domain: string | null; probe: boolean }
  | { allow: false; wait: TaskWaiting };

const ALLOWED_WITHOUT_SITE: GateDecision = { allow: true, domain: null, probe: false };

export interface SitePolitenessDeps {
  db: Pick<KickRocksDb, "select" | "insert" | "update" | "delete" | "transaction">;
  clock: Clock;
  settings: SettingsStore;
  /** Spreads the gap between task starts; replaced in tests. */
  random?: () => number;
}

export interface PushbackOutcome {
  domain: string;
  cooldownUntil: string;
  breakerOpened: boolean;
}

/**
 * The one place that decides whether a browser task may start. The queue asks it inside the claim
 * transaction, so the built-in worker, the model worker, and an MCP client all meet the same gate:
 * at most one running task per site owner, a spaced start, a daily cap per site, an hourly cap
 * overall, and a cooldown with a circuit breaker once a site pushes back.
 */
export interface SitePoliteness {
  /** The site owner a target belongs to, or null for a task without a target. */
  domainOf(targetId: string | null): string | null;
  /** Whether the task may start now, or why it has to wait and until when. Writes nothing. */
  evaluate(task: TaskForGate, handle?: DbHandle): GateDecision;
  /** Records the start of an admitted task, which spaces the next one. */
  admit(task: TaskForGate, decision: GateDecision & { allow: true }, handle?: DbHandle): void;
  /**
   * Asks to make a request to a target's site from the server itself, as following a confirmation
   * link does, and records the visit when the answer is yes. Decided and written in one step.
   */
  startDirect(targetId: string): GateDecision;
  /** Takes in what a run saw of the site. Returns the cooldown a pushback set, if any. */
  observe(
    task: TaskForGate,
    observation: SiteObservation | undefined,
    handle?: DbHandle,
  ): PushbackOutcome | null;
  /** A run finished and the site showed no pushback, which closes a breaker that was probing. */
  recordClean(task: TaskForGate, handle?: DbHandle): void;
  status(): SitesStatus;
  siteStatus(domain: string): SiteStatus | null;
  /** Deletes visits older than the caps look back. Returns how many were removed. */
  prune(): number;
  settings(): ScanningSettings;
}

interface SiteStateRow {
  domain: string;
  nextStartAfter: string | null;
  consecutivePushback: number;
  lastPushbackAt: string | null;
  lastPushbackKind: SiteStatus["lastPushbackKind"];
  coolingDownUntil: string | null;
  breaker: BreakerState;
  crawlDelaySeconds: number | null;
}

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/**
 * How long a site is left alone after its nth pushback in a row: the base doubled each time up to
 * the ceiling, or the site's own Retry-After when that is longer.
 */
export function cooldownMs(
  settings: Pick<ScanningSettings, "backoffBaseHours" | "backoffMaxHours">,
  consecutive: number,
  retryAfterSeconds: number | undefined,
): number {
  const backoff = Math.min(
    settings.backoffBaseHours * 2 ** Math.max(consecutive - 1, 0),
    settings.backoffMaxHours,
  );
  return Math.max(backoff * HOUR_MS, (retryAfterSeconds ?? 0) * 1000);
}

export function createSitePoliteness({
  db,
  clock,
  settings: settingsStore,
  random = Math.random,
}: SitePolitenessDeps): SitePoliteness {
  const ownerByTarget = new Map<string, string>();

  function ownerKeyOf(handle: DbHandle, targetId: string): string | null {
    const known = ownerByTarget.get(targetId);
    if (known !== undefined) return known;
    const row = handle
      .select({ domain: targets.domain, data: targets.data })
      .from(targets)
      .where(eq(targets.id, targetId))
      .get();
    if (!row) return null;
    const replyDomains = "replyDomains" in row.data ? (row.data.replyDomains ?? []) : [];
    const ownerGroup = "ownerGroup" in row.data ? row.data.ownerGroup : undefined;
    const key = siteOwnerKey(row.domain, replyDomains, ownerGroup);
    ownerByTarget.set(targetId, key);
    return key;
  }

  function stateOf(handle: DbHandle, domain: string): SiteStateRow | null {
    return handle.select().from(siteState).where(eq(siteState.domain, domain)).get() ?? null;
  }

  function saveState(
    handle: DbHandle,
    domain: string,
    patch: Partial<Omit<SiteStateRow, "domain">>,
    now: string,
  ): void {
    const current = stateOf(handle, domain);
    if (current) {
      handle
        .update(siteState)
        .set({ ...patch, updatedAt: now })
        .where(eq(siteState.domain, domain))
        .run();
      return;
    }
    handle
      .insert(siteState)
      .values({
        domain,
        nextStartAfter: null,
        consecutivePushback: 0,
        lastPushbackAt: null,
        lastPushbackKind: null,
        coolingDownUntil: null,
        breaker: "closed",
        crawlDelaySeconds: null,
        ...patch,
        updatedAt: now,
      })
      .run();
  }

  /** An open breaker whose cooldown has passed lets one probe through. */
  function effectiveBreaker(state: SiteStateRow | null, nowIso: string): BreakerState {
    if (!state || state.breaker === "closed") return "closed";
    if (state.breaker === "half_open") return "half_open";
    return state.coolingDownUntil !== null && state.coolingDownUntil > nowIso
      ? "open"
      : "half_open";
  }

  function startsSince(handle: DbHandle, sinceIso: string, domain?: string): string[] {
    return handle
      .select({ startedAt: siteVisits.startedAt })
      .from(siteVisits)
      .where(
        domain === undefined
          ? gt(siteVisits.startedAt, sinceIso)
          : and(eq(siteVisits.domain, domain), gt(siteVisits.startedAt, sinceIso)),
      )
      .orderBy(asc(siteVisits.startedAt))
      .all()
      .map((row) => row.startedAt);
  }

  function runningVisit(handle: DbHandle, domain: string): boolean {
    const running = handle
      .select({ n: count() })
      .from(siteVisits)
      .innerJoin(tasks, eq(tasks.id, siteVisits.taskId))
      .where(and(eq(siteVisits.domain, domain), eq(tasks.status, "leased")))
      .get();
    return (running?.n ?? 0) > 0;
  }

  const wait = (reason: WaitReason, domain: string, until: string): GateDecision => ({
    allow: false,
    wait: { reason, domain, until },
  });

  /** The time the nth-oldest start in a window leaves it, which is when a full cap has room again. */
  function windowOpensAt(starts: readonly string[], cap: number, windowMs: number): string {
    const index = Math.max(starts.length - cap, 0);
    return addMs(starts[index] ?? starts[0] ?? new Date().toISOString(), windowMs);
  }

  /** When quiet hours end, if `now` falls inside them; null otherwise. Hours are in the server's local time. */
  function quietHoursEnd(now: Date, config: ScanningSettings): Date | null {
    if (!isQuietHour(now.getHours(), config.quietStartHour, config.quietEndHour)) return null;
    const end = new Date(now);
    end.setHours(config.quietEndHour, 0, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end;
  }

  const isBrowserTask = (task: TaskForGate) =>
    (BROWSER_TASK_KINDS as readonly string[]).includes(task.kind);

  function toStatus(
    state: SiteStateRow | null,
    domain: string,
    visits: readonly string[],
    now: string,
    config: ScanningSettings,
  ): SiteStatus {
    const breaker = effectiveBreaker(state, now);
    const coolingDownUntil =
      state?.coolingDownUntil && state.coolingDownUntil > now ? state.coolingDownUntil : null;
    const nextStartAfter =
      state?.nextStartAfter && state.nextStartAfter > now ? state.nextStartAfter : null;
    return {
      domain,
      visitsToday: visits.length,
      dailyCap: config.dailyCapPerSite,
      lastVisitAt: visits.at(-1) ?? null,
      lastPushbackAt: state?.lastPushbackAt ?? null,
      lastPushbackKind: state?.lastPushbackKind ?? null,
      consecutivePushback: state?.consecutivePushback ?? 0,
      coolingDownUntil,
      breaker,
      nextStartAfter,
      crawlDelaySeconds: state?.crawlDelaySeconds ?? null,
    };
  }

  const domainOf = (targetId: string | null): string | null =>
    targetId === null ? null : ownerKeyOf(db as DbHandle, targetId);

  const politeness: SitePoliteness = {
    settings: () => settingsStore.get("scanning"),
    domainOf,

    evaluate(task, handle = db as DbHandle) {
      if (!isBrowserTask(task) || task.targetId === null) return ALLOWED_WITHOUT_SITE;
      const domain = ownerKeyOf(handle, task.targetId);
      if (domain === null) return ALLOWED_WITHOUT_SITE;
      const config = settingsStore.get("scanning");
      const nowDate = clock.now();
      const now = nowDate.toISOString();
      const state = stateOf(handle, domain);
      const breaker = effectiveBreaker(state, now);

      if (breaker === "open" && state?.coolingDownUntil) {
        return wait("site_breaker", domain, state.coolingDownUntil);
      }
      if (state?.coolingDownUntil && state.coolingDownUntil > now) {
        return wait("site_cooldown", domain, state.coolingDownUntil);
      }
      if (runningVisit(handle, domain)) {
        return wait("site_busy", domain, addMs(now, BUSY_RECHECK_MS));
      }
      if (state?.nextStartAfter && state.nextStartAfter > now) {
        return wait("site_gap", domain, state.nextStartAfter);
      }

      // A confirmation link expires, and opening one is a single page load, so it is counted but
      // never held back by a cap.
      if (task.kind !== "confirm") {
        const quietUntil = quietHoursEnd(nowDate, config);
        if (quietUntil) return wait("quiet_hours", domain, quietUntil.toISOString());
        const today = startsSince(handle, addMs(now, -DAY_MS), domain);
        if (today.length >= config.dailyCapPerSite) {
          return wait(
            "site_daily_cap",
            domain,
            windowOpensAt(today, config.dailyCapPerSite, DAY_MS),
          );
        }
        const lastHour = startsSince(handle, addMs(now, -HOUR_MS));
        if (lastHour.length >= config.hourlyCapTotal) {
          return wait(
            "hourly_cap",
            domain,
            windowOpensAt(lastHour, config.hourlyCapTotal, HOUR_MS),
          );
        }
        const lastDay = startsSince(handle, addMs(now, -DAY_MS));
        if (lastDay.length >= config.dailyCapTotal) {
          return wait("daily_cap", domain, windowOpensAt(lastDay, config.dailyCapTotal, DAY_MS));
        }
      }
      return { allow: true, domain, probe: breaker === "half_open" };
    },

    admit(task, decision, handle = db as DbHandle) {
      if (decision.domain === null) return;
      const config = settingsStore.get("scanning");
      const now = clock.now().toISOString();
      handle
        .insert(siteVisits)
        .values({
          id: newId(),
          domain: decision.domain,
          taskId: task.id,
          startedAt: now,
          probe: decision.probe,
        })
        .run();
      const state = stateOf(handle, decision.domain);
      const baseGapMs = Math.max(
        config.minGapMinutes * MINUTE_MS,
        (state?.crawlDelaySeconds ?? 0) * 1000,
      );
      const gapMs = baseGapMs * (1 + (config.gapJitterPercent / 100) * random());
      saveState(
        handle,
        decision.domain,
        {
          nextStartAfter: addMs(now, Math.round(gapMs)),
          ...(decision.probe ? { breaker: "half_open" as const } : {}),
        },
        now,
      );
    },

    startDirect(targetId) {
      return db.transaction((tx) => {
        const task: TaskForGate = { id: null, kind: "confirm", targetId };
        const decision = politeness.evaluate(task, tx);
        if (decision.allow) politeness.admit(task, decision, tx);
        return decision;
      });
    },

    observe(task, observation, handle = db as DbHandle) {
      const domain = domainOf(task.targetId);
      if (domain === null || !observation) return null;
      const now = clock.now().toISOString();
      if (observation.crawlDelaySeconds !== undefined) {
        saveState(handle, domain, { crawlDelaySeconds: observation.crawlDelaySeconds }, now);
      }
      const pushback: Pushback | undefined = observation.pushback;
      if (!pushback) return null;
      const config = settingsStore.get("scanning");
      const state = stateOf(handle, domain);
      const consecutive = (state?.consecutivePushback ?? 0) + 1;
      const until = addMs(now, cooldownMs(config, consecutive, pushback.retryAfterSeconds));
      const probing = effectiveBreaker(state, now) === "half_open";
      const opens = probing || consecutive >= config.breakerThreshold;
      saveState(
        handle,
        domain,
        {
          consecutivePushback: consecutive,
          lastPushbackAt: now,
          lastPushbackKind: pushback.kind,
          coolingDownUntil: until,
          breaker: opens ? "open" : (state?.breaker ?? "closed"),
        },
        now,
      );
      return {
        domain,
        cooldownUntil: until,
        breakerOpened: opens && state?.breaker !== "open",
      };
    },

    recordClean(task, handle = db as DbHandle) {
      const domain = domainOf(task.targetId);
      if (domain === null) return;
      const now = clock.now().toISOString();
      const state = stateOf(handle, domain);
      if (!state || (state.consecutivePushback === 0 && state.breaker === "closed")) return;
      // A run that began before the site pushed back can still finish cleanly during the
      // cooldown, and says nothing about whether the site has calmed down.
      if (state.coolingDownUntil && state.coolingDownUntil > now) return;
      saveState(
        handle,
        domain,
        { consecutivePushback: 0, breaker: "closed", coolingDownUntil: null },
        now,
      );
    },

    siteStatus(domain) {
      const now = clock.now().toISOString();
      const state = stateOf(db as DbHandle, domain);
      const visits = startsSince(db as DbHandle, addMs(now, -DAY_MS), domain);
      if (!state && visits.length === 0) return null;
      return toStatus(state, domain, visits, now, settingsStore.get("scanning"));
    },

    status() {
      const handle = db as DbHandle;
      const config = settingsStore.get("scanning");
      const now = clock.now().toISOString();
      const since = addMs(now, -DAY_MS);
      const visitRows = handle
        .select({ domain: siteVisits.domain, startedAt: siteVisits.startedAt })
        .from(siteVisits)
        .where(gt(siteVisits.startedAt, since))
        .orderBy(asc(siteVisits.startedAt))
        .all();
      const byDomain = new Map<string, string[]>();
      for (const { domain, startedAt } of visitRows) {
        byDomain.set(domain, [...(byDomain.get(domain) ?? []), startedAt]);
      }
      const states = new Map(
        handle
          .select()
          .from(siteState)
          .all()
          .map((row) => [row.domain, row as SiteStateRow]),
      );
      const domains = [...new Set([...byDomain.keys(), ...states.keys()])].sort();
      const hourAgo = addMs(now, -HOUR_MS);
      return {
        items: domains.map((domain) =>
          toStatus(states.get(domain) ?? null, domain, byDomain.get(domain) ?? [], now, config),
        ),
        visitsLastHour: visitRows.filter((row) => row.startedAt > hourAgo).length,
        hourlyCap: config.hourlyCapTotal,
      };
    },

    prune() {
      const cutoff = addMs(clock.now().toISOString(), -VISIT_RETENTION_MS);
      return db.delete(siteVisits).where(lt(siteVisits.startedAt, cutoff)).run().changes;
    },
  };
  return politeness;
}
