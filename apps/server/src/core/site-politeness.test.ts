import { scans, siteVisits, tasks } from "@kickrocks/db";
import { API_ROUTES, type ClaimedTask, type SiteObservation } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskOperations, MCP_CALLER } from "../modules/worker-api/task-operations.js";
import {
  createTestContext,
  DAY,
  HOUR,
  MINUTE,
  seedIdentities,
  seedProfile,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";
import { claimTask } from "./claim.js";
import { cooldownMs } from "./site-politeness.js";

let ctx: TestContext;
let profileId: string;

/** Jitter is a fixed half of its range, so the gap after a start is exactly 25 minutes. */
const HALF = () => 0.5;
const GAP = 25 * MINUTE;

beforeEach(async () => {
  ctx = await createTestContext({ politeness: "default", overrides: { random: HALF } });
  profileId = seedProfile(ctx).id;
  setScanning({ reuseHours: 0 });
});

afterEach(async () => {
  await ctx.close();
});

function setScanning(patch: Partial<ReturnType<typeof ctx.services.politeness.settings>>) {
  ctx.services.settings.set("scanning", { ...ctx.services.settings.get("scanning"), ...patch });
}

function site(domain: string) {
  const target = seedTarget(ctx, { category: "people-search", domain });
  seedRecipe(ctx, target.id, { purpose: "scan" });
  return target;
}

function queueScan(targetId: string, forProfile = profileId) {
  return ctx.services.dispatch.enqueueScan(forProfile, targetId).task;
}

const KINDS = ["scan", "form", "confirm", "canary", "agent"] as const;

function claim(claimerKind: "builtin" | "model" | "mcp" = "builtin"): ClaimedTask | null {
  return claimTask(ctx.services, {
    workerId: "worker-1",
    kinds: KINDS,
    leaseMs: 5 * MINUTE,
    claimerKind,
  });
}

async function complete(task: ClaimedTask, site?: SiteObservation) {
  const response = await ctx.call(API_ROUTES.workerTaskComplete, {
    params: { id: task.id },
    body: { workerId: "worker-1", result: { candidates: [] }, ...(site ? { site } : {}) },
  });
  expect(response.ok, JSON.stringify(response.body)).toBe(true);
}

async function pushBack(task: ClaimedTask, pushback: NonNullable<SiteObservation["pushback"]>) {
  const response = await ctx.call(API_ROUTES.workerTaskFail, {
    params: { id: task.id },
    body: {
      workerId: "worker-1",
      error: `The site answered ${pushback.status ?? pushback.kind}`,
      retryable: true,
      kind: "site",
      site: { pushback },
    },
  });
  expect(response.ok, JSON.stringify(response.body)).toBe(true);
}

const rateLimited = (retryAfterSeconds?: number) =>
  ({
    kind: "rate_limited",
    status: 429,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  }) as const;

function status(domain: string) {
  return ctx.services.politeness.siteStatus(domain);
}

const taskRow = (id: string) => ctx.services.taskQueue.getOrThrow(id);

describe("one task at a time on a site", () => {
  it("holds the next task for a site while one is running, and leaves other sites free", () => {
    const a = site("a.test");
    const b = site("b.test");
    const second = seedProfile(ctx).id;
    queueScan(a.id);
    queueScan(a.id, second);
    queueScan(b.id);

    const first = claim();
    expect(first?.target.id).toBe(a.id);
    const next = claim();
    expect(next?.target.id).toBe(b.id);
    expect(claim()).toBeNull();
  });

  it("keeps a held task queued with its wait recorded, and never fails it", () => {
    const a = site("a.test");
    queueScan(a.id);
    const held = queueScan(a.id, seedProfile(ctx).id);
    claim();
    expect(claim()).toBeNull();

    const row = taskRow(held.id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.runAfter).not.toBeNull();
    expect(ctx.services.taskQueue.waitingFor(row)).toMatchObject({
      reason: "site_busy",
      domain: "a.test",
    });
  });

  it("treats sister domains as one site", () => {
    const intelius = site("intelius.com");
    const truthfinder = site("truthfinder.com");
    queueScan(intelius.id);
    queueScan(truthfinder.id);

    expect(claim()?.target.id).toBe(intelius.id);
    expect(claim()).toBeNull();
    expect(ctx.services.politeness.domainOf(truthfinder.id)).toBe("peopleconnect.us");
  });

  it("groups brokers whose confirmation mail comes from the same platform", () => {
    const one = seedTarget(ctx, {
      category: "people-search",
      domain: "alpha-search.test",
      replyDomains: ["platform-mail.test"],
    });
    const two = seedTarget(ctx, {
      category: "people-search",
      domain: "beta-search.test",
      replyDomains: ["platform-mail.test"],
    });
    expect(ctx.services.politeness.domainOf(one.id)).toBe("platform-mail.test");
    expect(ctx.services.politeness.domainOf(two.id)).toBe("platform-mail.test");
  });
});

describe("the gap between starts", () => {
  it("spaces two starts on a site by the gap plus its jitter, and counts from the start", async () => {
    const a = site("a.test");
    queueScan(a.id);
    const later = queueScan(a.id, seedProfile(ctx).id);
    const first = claim();
    expect(first).not.toBeNull();
    await complete(first as ClaimedTask);

    ctx.clock.advance(GAP - 1000);
    expect(claim()).toBeNull();
    expect(ctx.services.taskQueue.waitingFor(taskRow(later.id))).toMatchObject({
      reason: "site_gap",
    });

    ctx.clock.advance(1000);
    expect(claim()?.id).toBe(later.id);
  });

  it("keeps the jitter between zero and the configured share of the gap", () => {
    const draws = [0, 1];
    for (const draw of draws) {
      const gap = 20 * MINUTE * (1 + 0.5 * draw);
      expect(gap).toBeGreaterThanOrEqual(20 * MINUTE);
      expect(gap).toBeLessThanOrEqual(30 * MINUTE);
    }
  });

  it("applies the same gap to a canary as to everything else", async () => {
    const a = site("a.test");
    ctx.services.settings.set("siteChecks.enabled", true);
    ctx.services.settings.set("auth.passwordHash", "hash");
    queueScan(a.id);
    const scan = claim();
    await complete(scan as ClaimedTask);
    const canary = ctx.services.dispatch.enqueueCanary(`${a.id}.scan.v1`);
    expect(claim()).toBeNull();
    ctx.clock.advance(GAP);
    expect(claim()?.id).toBe(canary.task.id);
  });
});

describe("the caps", () => {
  it("stops a site at its daily cap and opens again a day after the oldest start", async () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
      dailyCapPerSite: 2,
    });
    const a = site("a.test");
    const started = ctx.clock.now().getTime();
    for (let i = 0; i < 3; i++) queueScan(a.id, seedProfile(ctx).id);

    for (let i = 0; i < 2; i++) {
      await complete(claim() as ClaimedTask);
      ctx.clock.advance(HOUR);
    }
    expect(claim()).toBeNull();
    const waiting = ctx.services.taskQueue.list({ status: "queued" })[0];
    expect(waiting && ctx.services.taskQueue.waitingFor(waiting)).toEqual({
      reason: "site_daily_cap",
      domain: "a.test",
      until: new Date(started + DAY).toISOString(),
    });
    expect(status("a.test")).toMatchObject({ visitsToday: 2, dailyCap: 2 });

    ctx.clock.set(new Date(started + DAY));
    expect(claim()).not.toBeNull();
  });

  it("stops all sites at the hourly cap", async () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
      hourlyCapTotal: 2,
    });
    for (const domain of ["a.test", "b.test", "c.test"]) queueScan(site(domain).id);

    await complete(claim() as ClaimedTask);
    await complete(claim() as ClaimedTask);
    expect(claim()).toBeNull();
    const waiting = ctx.services.taskQueue.list({ status: "queued" })[0];
    expect(waiting && ctx.services.taskQueue.waitingFor(waiting)?.reason).toBe("hourly_cap");

    ctx.clock.advance(HOUR);
    expect(claim()).not.toBeNull();
  });

  it("does not hold a confirmation link back for a cap", () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
      dailyCapPerSite: 1,
    });
    const a = site("a.test");
    queueScan(a.id);
    const scan = claim() as ClaimedTask;
    ctx.services.taskQueue.cancel(scan.id);
    expect(ctx.services.politeness.evaluate({ id: "x", kind: "confirm", targetId: a.id })).toEqual({
      allow: true,
      domain: "a.test",
      probe: false,
    });
    expect(
      ctx.services.politeness.evaluate({ id: "y", kind: "scan", targetId: a.id }),
    ).toMatchObject({
      allow: false,
    });
  });

  it("leaves the server's own mail work alone", () => {
    expect(
      ctx.services.politeness.evaluate({ id: "m", kind: "email_send", targetId: null }),
    ).toEqual({
      allow: true,
      domain: null,
      probe: false,
    });
  });
});

describe("pushback", () => {
  it("answers a 429 with the longer of the site's Retry-After and the backoff, without failing the task", async () => {
    const a = site("a.test");
    queueScan(a.id);
    const claimed = claim() as ClaimedTask;
    await pushBack(claimed, rateLimited(10 * 3600));

    const row = taskRow(claimed.id);
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(row.kind).toBe("scan");
    expect(row.runAfter).toBe(new Date(ctx.clock.now().getTime() + 10 * HOUR).toISOString());
    expect(status("a.test")).toMatchObject({
      consecutivePushback: 1,
      lastPushbackKind: "rate_limited",
      coolingDownUntil: row.runAfter,
      breaker: "closed",
    });
  });

  it("uses the backoff when the site names no Retry-After or a shorter one", async () => {
    const a = site("a.test");
    queueScan(a.id);
    await pushBack(claim() as ClaimedTask, rateLimited(60));
    expect(status("a.test")?.coolingDownUntil).toBe(
      new Date(ctx.clock.now().getTime() + 6 * HOUR).toISOString(),
    );
  });

  it("never retries before the cooldown ends, on any claim path", async () => {
    const a = site("a.test");
    const queued = queueScan(a.id);
    await pushBack(claim() as ClaimedTask, rateLimited());

    ctx.clock.advance(6 * HOUR - 1000);
    expect(claim()).toBeNull();
    expect(claim("model")).toBeNull();
    const ops = createTaskOperations(ctx.services, MCP_CALLER);
    expect(
      ops.claim({ workerId: "agent", kinds: KINDS, leaseMs: 5 * MINUTE, claimerKind: "mcp" }),
    ).toBeNull();
    expect(() =>
      ops.claim({
        workerId: "agent",
        kinds: KINDS,
        leaseMs: 5 * MINUTE,
        taskId: queued.id,
        claimerKind: "mcp",
      }),
    ).toThrowError(/pacing its visits to a\.test/);

    ctx.clock.advance(1000 + GAP);
    expect(claim()?.id).toBe(queued.id);
  });

  it("does not hand a rate-limited recipe run to an agent, whatever failure kind it reports", async () => {
    const a = site("a.test");
    queueScan(a.id);
    const claimed = claim() as ClaimedTask;
    const response = await ctx.call(API_ROUTES.workerTaskFail, {
      params: { id: claimed.id },
      body: {
        workerId: "worker-1",
        error: "scan could not find the results list",
        retryable: false,
        kind: "recipe",
        site: { pushback: { kind: "forbidden", status: 403 } },
      },
    });
    expect(response.ok).toBe(true);
    const all = ctx.services.db.select().from(tasks).all();
    expect(all.map((task) => task.kind)).toEqual(["scan"]);
    expect(all[0]?.status).toBe("queued");
  });

  it("doubles the cooldown with each repeat up to the ceiling", () => {
    const settings = { backoffBaseHours: 6, backoffMaxHours: 168 };
    const hours = [1, 2, 3, 4, 5, 6].map((n) => cooldownMs(settings, n, undefined) / HOUR);
    expect(hours).toEqual([6, 12, 24, 48, 96, 168]);
    expect(cooldownMs(settings, 1, 400 * 3600) / HOUR).toBe(400);
  });

  it("grows the cooldown across real repeats and opens the breaker at the third", async () => {
    const a = site("a.test");
    queueScan(a.id);
    const seen: number[] = [];
    for (let round = 1; round <= 3; round++) {
      const claimed = claim() as ClaimedTask;
      expect(claimed).not.toBeNull();
      await pushBack(claimed, { kind: "forbidden", status: 403 });
      const until = Date.parse(status("a.test")?.coolingDownUntil ?? "");
      seen.push((until - ctx.clock.now().getTime()) / HOUR);
      ctx.clock.set(new Date(until + GAP));
    }
    expect(seen).toEqual([6, 12, 24]);
    expect(status("a.test")?.breaker).toBe("half_open");
  });

  it("reads a Cloudflare interstitial and a CAPTCHA as pushback too", async () => {
    const a = site("a.test");
    queueScan(a.id);
    await pushBack(claim() as ClaimedTask, { kind: "challenge" });
    expect(status("a.test")).toMatchObject({ lastPushbackKind: "challenge" });
    ctx.clock.advance(7 * HOUR + GAP);
    await pushBack(claim() as ClaimedTask, { kind: "access_denied" });
    expect(status("a.test")?.consecutivePushback).toBe(2);
  });

  it("treats a block for a CAPTCHA as pushback even when the client reports nothing else", async () => {
    const a = site("a.test");
    queueScan(a.id);
    const claimed = claim() as ClaimedTask;
    const response = await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: claimed.id },
      body: { workerId: "worker-1", reason: "captcha", detail: "A CAPTCHA is on the page." },
    });
    expect(response.ok).toBe(true);
    expect(taskRow(claimed.id).status).toBe("blocked");
    expect(status("a.test")).toMatchObject({ lastPushbackKind: "captcha", consecutivePushback: 1 });
  });

  it("does not count a phone verification as pushback", async () => {
    const a = site("a.test");
    queueScan(a.id);
    const claimed = claim() as ClaimedTask;
    await ctx.call(API_ROUTES.workerTaskBlock, {
      params: { id: claimed.id },
      body: { workerId: "worker-1", reason: "phone_verification" },
    });
    expect(status("a.test")?.consecutivePushback ?? 0).toBe(0);
  });
});

describe("the circuit breaker", () => {
  async function openBreaker() {
    const a = site("a.test");
    queueScan(a.id);
    for (let round = 0; round < 3; round++) {
      await pushBack(claim() as ClaimedTask, rateLimited());
      ctx.clock.set(new Date(Date.parse(status("a.test")?.coolingDownUntil ?? "") + 1));
      if (round < 2) ctx.clock.advance(GAP);
    }
    return a;
  }

  it("pauses the site entirely until the cooldown passes", async () => {
    const a = site("a.test");
    queueScan(a.id);
    for (let round = 0; round < 3; round++) {
      const claimed = claim() as ClaimedTask;
      await pushBack(claimed, rateLimited());
      const until = Date.parse(status("a.test")?.coolingDownUntil ?? "");
      if (round === 2) {
        expect(status("a.test")?.breaker).toBe("open");
        ctx.clock.set(new Date(until - 1000));
        expect(claim()).toBeNull();
        const waiting = ctx.services.taskQueue.list({ status: "queued" })[0];
        expect(waiting && ctx.services.taskQueue.waitingFor(waiting)?.reason).toBe("site_breaker");
      }
      ctx.clock.set(new Date(until + GAP));
    }
  });

  it("lets exactly one cautious probe through, and closes when the probe is clean", async () => {
    const a = await openBreaker();
    for (const _ of [1, 2]) queueScan(a.id, seedProfile(ctx).id);
    expect(status("a.test")?.breaker).toBe("half_open");

    const probe = claim() as ClaimedTask;
    expect(probe).not.toBeNull();
    expect(claim()).toBeNull();
    const visits = ctx.services.db.select().from(siteVisits).all();
    expect(visits.at(-1)?.probe).toBe(true);

    await complete(probe);
    expect(status("a.test")).toMatchObject({ breaker: "closed", consecutivePushback: 0 });
  });

  it("opens again, for longer, when the probe is pushed back", async () => {
    const a = await openBreaker();
    queueScan(a.id, seedProfile(ctx).id);
    const probe = claim() as ClaimedTask;
    await pushBack(probe, rateLimited());

    const state = status("a.test");
    expect(state).toMatchObject({ breaker: "open", consecutivePushback: 4 });
    const cooldown = Date.parse(state?.coolingDownUntil ?? "") - ctx.clock.now().getTime();
    expect(cooldown).toBe(48 * HOUR);
    expect(claim()).toBeNull();
  });

  it("stays half open when the probe ends without telling anything about the site", async () => {
    const a = await openBreaker();
    queueScan(a.id, seedProfile(ctx).id);
    const probe = claim() as ClaimedTask;
    await ctx.call(API_ROUTES.workerTaskFail, {
      params: { id: probe.id },
      body: { workerId: "worker-1", error: "boom", retryable: false, kind: "internal" },
    });
    expect(status("a.test")?.breaker).toBe("half_open");
  });
});

describe("the same gate for every claimer", () => {
  it("holds a model worker and an MCP client behind the same cooldown as the built-in worker", async () => {
    const a = site("a.test");
    queueScan(a.id);
    await pushBack(claim() as ClaimedTask, rateLimited());
    queueScan(a.id, seedProfile(ctx).id);

    const viaModel = await ctx.call(API_ROUTES.workerClaim, {
      body: { workerId: "model-1", kinds: [...KINDS], leaseMs: 300_000, claimer: "model" },
    });
    expect(viaModel.ok && viaModel.body.task).toBeNull();

    const ops = createTaskOperations(ctx.services, MCP_CALLER);
    expect(
      ops.claim({ workerId: "agent", kinds: KINDS, leaseMs: 300_000, claimerKind: "mcp" }),
    ).toBeNull();
  });

  it("makes an agent task wait for a running scan on a sister site", () => {
    queueScan(site("intelius.com").id);
    const noRecipe = seedTarget(ctx, { category: "people-search", domain: "truthfinder.com" });
    const agentTask = queueScan(noRecipe.id);
    expect(agentTask.kind).toBe("agent");

    expect(claim()?.kind).toBe("scan");
    expect(claim("model")).toBeNull();
    expect(
      ctx.services.taskQueue.waitingFor(ctx.services.taskQueue.getOrThrow(agentTask.id)),
    ).toMatchObject({ reason: "site_busy", domain: "peopleconnect.us" });
  });

  it("gives an MCP client the reason when it asks for a waiting task by id", async () => {
    const a = site("a.test");
    const queued = queueScan(a.id);
    await pushBack(claim() as ClaimedTask, rateLimited());
    const ops = createTaskOperations(ctx.services, MCP_CALLER);
    expect(() =>
      ops.claim({
        workerId: "agent",
        kinds: KINDS,
        leaseMs: 300_000,
        taskId: queued.id,
        claimerKind: "mcp",
      }),
    ).toThrowError(/Ask again after/);
  });
});

describe("reusing a scan", () => {
  beforeEach(() => setScanning({ reuseHours: 24, minGapMinutes: 0, gapJitterPercent: 0 }));

  const candidates = [
    {
      recordUrl: "https://a.test/p/1",
      name: "Jordan Example",
      locations: ["Austin, TX"],
    },
  ];

  async function scanned(targetId: string, forProfile: string) {
    const task = queueScan(targetId, forProfile);
    const claimed = claim() as ClaimedTask;
    expect(claimed.id).toBe(task.id);
    const response = await ctx.call(API_ROUTES.workerTaskComplete, {
      params: { id: claimed.id },
      body: { workerId: "worker-1", result: { candidates } },
    });
    expect(response.ok).toBe(true);
  }

  it("finishes a repeat search for the same person on the same site without visiting it", async () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
    });
    const a = site("a.test");
    await scanned(a.id, profileId);
    const visits = ctx.services.db.select().from(siteVisits).all().length;

    const twin = seedProfile(ctx).id;
    const repeat = queueScan(a.id, twin);
    expect(claim()).toBeNull();

    expect(taskRow(repeat.id).status).toBe("done");
    expect(ctx.services.db.select().from(siteVisits).all()).toHaveLength(visits);
    const copy = ctx.services.db
      .select()
      .from(scans)
      .all()
      .find((scan) => scan.profileId === twin);
    expect(copy?.candidates).toEqual(candidates);
    expect(copy?.reusedFromScanId).not.toBeNull();
    expect(copy?.finishedAt).not.toBeNull();
  });

  it("searches again for a different person, a different site, or after the window", async () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
    });
    const a = site("a.test");
    const b = site("b.test");
    await scanned(a.id, profileId);

    const someoneElse = seedProfile(ctx, {
      identities: [
        {
          kind: "name",
          value: { first: "Sam", last: "Sample" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
        {
          kind: "address",
          value: { street: "1 Test Rd", city: "Dallas", state: "TX", zip: "75001" },
          isPrimary: true,
          validFrom: null,
          validTo: null,
        },
      ],
    }).id;
    const different = queueScan(a.id, someoneElse);
    const otherSite = queueScan(b.id, seedProfile(ctx).id);
    expect(claim()?.id).toBeDefined();
    expect(taskRow(different.id).status).not.toBe("done");
    expect(taskRow(otherSite.id).status).not.toBe("done");

    ctx.clock.advance(25 * HOUR);
    seedIdentities(ctx, someoneElse);
    const stale = queueScan(a.id, seedProfile(ctx).id);
    claim();
    expect(taskRow(stale.id).status).not.toBe("done");
  });

  it("does not let a reused result extend its own life", async () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
    });
    const a = site("a.test");
    await scanned(a.id, profileId);
    ctx.clock.advance(20 * HOUR);
    const first = queueScan(a.id, seedProfile(ctx).id);
    claim();
    expect(taskRow(first.id).status).toBe("done");

    ctx.clock.advance(6 * HOUR);
    const later = queueScan(a.id, seedProfile(ctx).id);
    claim();
    expect(taskRow(later.id).status).not.toBe("done");
  });

  it("can be turned off", async () => {
    ctx.services.settings.set("scanning", {
      ...ctx.services.settings.get("scanning"),
      minGapMinutes: 0,
      gapJitterPercent: 0,
      reuseHours: 0,
    });
    const a = site("a.test");
    await scanned(a.id, profileId);
    const repeat = queueScan(a.id, seedProfile(ctx).id);
    expect(claim()?.id).toBe(repeat.id);
  });
});

describe("what the person can see", () => {
  it("reports each site's visits, last pushback, cooldown, and breaker", async () => {
    const a = site("a.test");
    queueScan(a.id);
    await pushBack(claim() as ClaimedTask, rateLimited());

    const sites = await ctx.call(API_ROUTES.settingsSites);
    expect(sites.ok && sites.body).toMatchObject({
      hourlyCap: 12,
      visitsLastHour: 1,
      items: [
        {
          domain: "a.test",
          visitsToday: 1,
          dailyCap: 6,
          lastPushbackKind: "rate_limited",
          breaker: "closed",
        },
      ],
    });

    const forTarget = await ctx.call(API_ROUTES.targetsSite, { params: { id: a.id } });
    expect(forTarget.ok && forTarget.body.site?.coolingDownUntil).not.toBeNull();
    const untouched = await ctx.call(API_ROUTES.targetsSite, {
      params: { id: site("never-visited.test").id },
    });
    expect(untouched.ok && untouched.body).toEqual({ site: null });
  });

  it("explains in the review queue that a task is waiting for a site, not failing", async () => {
    const a = site("a.test");
    queueScan(a.id);
    await pushBack(claim() as ClaimedTask, rateLimited());

    const review = await ctx.call(API_ROUTES.reviewQueue, { query: {} });
    expect(review.ok && review.body.failedTasks).toEqual([]);
    expect(review.ok && review.body.waitingTasks).toMatchObject([
      { kind: "scan", waiting: { reason: "site_cooldown", domain: "a.test" } },
    ]);
  });

  it("tells a claimer which proxy a site goes through, only for the sites the person listed", async () => {
    const a = site("a.test");
    const b = site("b.test");
    queueScan(a.id);
    queueScan(b.id);
    await ctx.call(API_ROUTES.settingsPatch, {
      body: { egress: { proxyUrl: "http://10.0.0.100:8888", domains: ["a.test"] } },
    });
    const first = claim();
    const second = claim();
    const byTarget = new Map([first, second].map((task) => [task?.target.id, task?.proxyUrl]));
    expect(byTarget.get(a.id)).toBe("http://10.0.0.100:8888");
    expect(byTarget.get(b.id)).toBeNull();
  });

  it("refuses a proxy with credentials or a scheme other than http", async () => {
    for (const proxyUrl of [
      "http://user:pass@10.0.0.100:8888",
      "https://proxy.test",
      "socks5://x",
    ]) {
      const response = await ctx.call(API_ROUTES.settingsPatch, { body: { egress: { proxyUrl } } });
      expect(response.ok, proxyUrl).toBe(false);
    }
  });
});
