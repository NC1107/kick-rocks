import { matches, recipes, scans } from "@kickrocks/db";
import type { Candidate } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedMatch,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";

let ctx: TestContext;
let profileId: string;
let targetId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  targetId = seedTarget(ctx, {
    category: "people-search",
    contactMethod: "form",
    domain: "records.test",
    searchUrl: "https://records.test/search",
    requirements: ["record_url"],
  }).id;
});

afterEach(async () => {
  await ctx.close();
});

const candidate = (path: string, overrides: Partial<Candidate> = {}): Candidate => ({
  recordUrl: `https://records.test/p/${path}`,
  name: "Jordan Example",
  locations: ["Austin, TX"],
  ...overrides,
});

const queue = () => ctx.services.taskQueue;

/** Enqueues a scan and has a worker finish it with these candidates. */
function scanWith(candidates: Candidate[]) {
  const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
  const claimed = queue().claim({ workerId: "w", kinds: [task.kind], leaseMs: 60_000 });
  queue().complete(claimed?.id ?? "", {
    workerId: "w",
    actor: claimed?.kind === "agent" ? "agent" : "worker",
    result: claimed?.kind === "agent" ? { purpose: "scan", scan: { candidates } } : { candidates },
  });
  return { taskId: task.id, scanId: scanId ?? "" };
}

const scanRow = (id: string) => ctx.services.db.select().from(scans).where(eq(scans.id, id)).get();
const allMatches = () => ctx.services.db.select().from(matches).all();

describe("scan results", () => {
  beforeEach(() => {
    seedRecipe(ctx, targetId, { purpose: "scan" });
  });

  it("turns candidates into matches for the person to decide", () => {
    const { scanId } = scanWith([
      candidate("1", { age: 35, relatives: ["Casey Example"] }),
      candidate("2"),
    ]);

    expect(scanRow(scanId)).toMatchObject({
      finishedAt: ctx.clock.now().toISOString(),
      error: null,
    });
    expect(scanRow(scanId)?.candidates).toHaveLength(2);
    const rows = allMatches();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      scanId,
      profileId,
      targetId,
      recordUrl: "https://records.test/p/1",
      decision: "pending",
      decidedAt: null,
      requestId: null,
      fields: { name: "Jordan Example", age: 35, relatives: ["Casey Example"] },
    });
    expect(rows[0]?.fields).not.toHaveProperty("recordUrl");
  });

  it("drops a candidate whose record is on another site", () => {
    scanWith([
      candidate("1"),
      { ...candidate("2"), recordUrl: "https://collector.example/p/2" },
      { ...candidate("3"), recordUrl: "https://records.test.evil.example/p/3" },
    ]);
    expect(allMatches().map((match) => match.recordUrl)).toEqual(["https://records.test/p/1"]);
  });

  it("finishes a scan that found nobody", () => {
    const { scanId } = scanWith([]);
    expect(scanRow(scanId)).toMatchObject({ finishedAt: expect.any(String), candidates: [] });
    expect(allMatches()).toHaveLength(0);
  });

  it("keeps one match for a record listed twice under different spellings", () => {
    scanWith([
      candidate("1"),
      { ...candidate("1"), recordUrl: "http://www.records.test/p/1/#top" },
    ]);
    expect(allMatches()).toHaveLength(1);
  });

  it("does not ask again about a record the person said is not theirs", () => {
    const earlier = seedScan(ctx, { profileId, targetId });
    seedMatch(ctx, {
      scanId: earlier.id,
      profileId,
      targetId,
      recordUrl: "https://records.test/p/1",
      decision: "not_mine",
    });
    scanWith([{ ...candidate("1"), recordUrl: "https://www.records.test/p/1/" }, candidate("2")]);
    expect(
      allMatches()
        .map((match) => match.recordUrl)
        .sort(),
    ).toEqual(["https://records.test/p/1", "https://records.test/p/2"]);
  });

  it("does not list a record that is still waiting for a decision from an earlier scan", () => {
    scanWith([candidate("1")]);
    scanWith([candidate("1")]);
    expect(allMatches()).toHaveLength(1);
  });

  it("leaves a record alone while its removal is in motion", () => {
    const earlier = seedScan(ctx, { profileId, targetId });
    const request = seedRequest(ctx, {
      profileId,
      targetId,
      channel: "form",
      status: "awaiting_reply",
      recordUrl: "https://records.test/p/1",
    });
    seedMatch(ctx, {
      scanId: earlier.id,
      profileId,
      targetId,
      recordUrl: "https://records.test/p/1",
      decision: "mine",
      requestId: request.id,
    });
    scanWith([candidate("1")]);
    expect(allMatches()).toHaveLength(1);
    expect(
      ctx.services.requests.events(request.id).some((event) => event.type === "relisted"),
    ).toBe(false);
  });

  it("asks again about a record whose removal was cancelled", () => {
    const earlier = seedScan(ctx, { profileId, targetId });
    const request = seedRequest(ctx, {
      profileId,
      targetId,
      channel: "form",
      status: "cancelled",
      recordUrl: "https://records.test/p/1",
    });
    seedMatch(ctx, {
      scanId: earlier.id,
      profileId,
      targetId,
      recordUrl: "https://records.test/p/1",
      decision: "mine",
      requestId: request.id,
    });
    scanWith([candidate("1")]);
    expect(allMatches().filter((match) => match.decision === "pending")).toHaveLength(1);
  });

  describe("a record that was removed and is listed again", () => {
    function removedBefore(status: "confirmed" | "no_record") {
      const earlier = seedScan(ctx, { profileId, targetId });
      const request = seedRequest(ctx, {
        profileId,
        targetId,
        channel: "form",
        status,
        rights: ["opt_out", "delete"],
        recordUrl: "https://records.test/p/1",
      });
      seedMatch(ctx, {
        scanId: earlier.id,
        profileId,
        targetId,
        recordUrl: "https://records.test/p/1",
        decision: "mine",
        requestId: request.id,
      });
      return request;
    }

    it("opens the removal again for the same record and rights, and says so on the old request", () => {
      seedMailbox(ctx, profileId);
      seedRecipe(ctx, targetId, { purpose: "remove" });
      const old = removedBefore("confirmed");

      const { scanId } = scanWith([candidate("1")]);

      const relisted = allMatches().find((match) => match.scanId === scanId);
      expect(relisted).toMatchObject({ decision: "mine", decidedAt: expect.any(String) });
      const reopened = ctx.services.requests.getOrThrow(relisted?.requestId ?? "");
      expect(reopened).toMatchObject({
        status: "queued",
        channel: "form",
        recordUrl: "https://records.test/p/1",
        rights: ["opt_out", "delete"],
      });
      expect(reopened.id).not.toBe(old.id);
      expect(ctx.services.taskQueue.hasLiveTask(reopened.id)).toBe(true);
      expect(
        ctx.services.requests.events(old.id).find((event) => event.type === "relisted"),
      ).toMatchObject({
        actor: "system",
        payload: { recordUrl: "https://records.test/p/1", previousStatus: "confirmed" },
      });
      expect(ctx.services.requests.getOrThrow(old.id).status).toBe("confirmed");
    });

    it("treats a record that was not found before the same way", () => {
      seedMailbox(ctx, profileId);
      seedRecipe(ctx, targetId, { purpose: "remove" });
      removedBefore("no_record");
      scanWith([candidate("1")]);
      expect(allMatches().filter((match) => match.decision === "mine")).toHaveLength(2);
    });

    it("asks the person when the removal cannot be opened", () => {
      seedRecipe(ctx, targetId, { purpose: "remove" });
      const old = removedBefore("confirmed");

      const { scanId } = scanWith([candidate("1")]);

      const relisted = allMatches().find((match) => match.scanId === scanId);
      expect(relisted).toMatchObject({ decision: "pending", requestId: null });
      expect(ctx.services.requests.events(old.id).some((event) => event.type === "relisted")).toBe(
        true,
      );
    });
  });

  it("finishes the scan and records an agent's result the same way", () => {
    ctx.services.db.update(recipes).set({ status: "retired" }).run();
    const { taskId, scanId } = scanWith([candidate("1")]);
    expect(queue().getOrThrow(taskId).kind).toBe("agent");
    expect(scanRow(scanId)?.finishedAt).not.toBeNull();
    expect(allMatches()).toHaveLength(1);
  });

  it("finishes a scan a person marked done by hand with nothing found", () => {
    const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
    queue().claim({ workerId: "w", kinds: ["scan"], leaseMs: 60_000 });
    queue().block(task.id, { workerId: "w", reason: "captcha", actor: "worker" });
    queue().markDone(task.id, { actor: "user" });
    expect(scanRow(scanId ?? "")).toMatchObject({ finishedAt: expect.any(String), candidates: [] });
  });

  it("takes a person's own list of candidates for a blocked scan", () => {
    const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
    queue().claim({ workerId: "w", kinds: ["scan"], leaseMs: 60_000 });
    queue().block(task.id, { workerId: "w", reason: "captcha", actor: "worker" });
    queue().markDone(task.id, { actor: "user", result: { candidates: [candidate("9")] } });
    expect(allMatches()).toHaveLength(1);
    expect(scanRow(scanId ?? "")?.candidates).toHaveLength(1);
  });

  it("counts a scan that finished as a run that worked for its recipe", () => {
    const recipe = ctx.services.db.select().from(recipes).get();
    ctx.services.db.update(recipes).set({ failureCount: 2 }).run();
    scanWith([]);
    expect(
      ctx.services.db
        .select()
        .from(recipes)
        .where(eq(recipes.id, recipe?.id ?? ""))
        .get(),
    ).toMatchObject({ failureCount: 0, health: "healthy" });
  });
});

describe("scans that fail", () => {
  beforeEach(() => {
    seedRecipe(ctx, targetId, { purpose: "scan" });
  });

  function failScan(kind: "recipe" | "site", retryable = false) {
    const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
    const claimed = queue().claim({ workerId: "w", kinds: ["scan"], leaseMs: 60_000 });
    queue().fail(task.id, {
      workerId: "w",
      error: kind === "recipe" ? "selector gone" : "site down",
      retryable,
      kind,
      step: 2,
      actor: "worker",
    });
    return { taskId: task.id, scanId: scanId ?? "", claimed };
  }

  it("says why on the scan when the site failed for good", () => {
    const { scanId } = failScan("site");
    expect(scanRow(scanId)).toMatchObject({
      finishedAt: ctx.clock.now().toISOString(),
      error: "site down",
    });
  });

  it("does not finish a scan that will be retried", () => {
    const { scanId } = failScan("site", true);
    expect(scanRow(scanId)).toMatchObject({ finishedAt: null, error: null });
  });

  it("hands a broken recipe's scan to an agent that keeps the scan row", () => {
    const { taskId, scanId } = failScan("recipe");

    const agent = scanRow(scanId)?.taskId;
    expect(agent).not.toBe(taskId);
    expect(queue().getOrThrow(agent ?? "")).toMatchObject({
      kind: "agent",
      status: "queued",
      payload: { purpose: "scan", reason: "recipe_failed", previousError: "selector gone" },
    });
    expect(scanRow(scanId)).toMatchObject({ finishedAt: null, error: null });
  });

  it("counts only a recipe failure against the recipe and marks it broken on the third", () => {
    const health = () => ctx.services.db.select().from(recipes).get();
    failScan("site");
    expect(health()).toMatchObject({ failureCount: 0, health: "unknown" });

    for (let run = 1; run <= 3; run += 1) {
      const { scanId } = failScan("recipe");
      expect(health()?.failureCount).toBe(run);
      queue().cancel(scanRow(scanId)?.taskId ?? "");
    }
    expect(health()?.health).toBe("broken");
  });

  it("lets the agent finish the scan", () => {
    const { scanId } = failScan("recipe");
    const agent = queue().claim({ workerId: "agent-1", kinds: ["agent"], leaseMs: 60_000 });
    queue().complete(agent?.id ?? "", {
      workerId: "agent-1",
      actor: "agent",
      result: { purpose: "scan", scan: { candidates: [candidate("7")] } },
    });
    expect(scanRow(scanId)?.finishedAt).not.toBeNull();
    expect(allMatches()).toHaveLength(1);
  });

  it("fails the scan for good when an agent gives up", () => {
    const { scanId } = failScan("recipe");
    const agent = queue().claim({ workerId: "agent-1", kinds: ["agent"], leaseMs: 60_000 });
    queue().fail(agent?.id ?? "", {
      workerId: "agent-1",
      error: "no search box",
      retryable: false,
      actor: "agent",
    });
    expect(scanRow(scanId)).toMatchObject({
      error: "no search box",
      finishedAt: expect.any(String),
    });
  });

  it("leaves a cancelled scan unfinished, because the agent that replaces it still owns the row", () => {
    const { task, scanId } = ctx.services.dispatch.enqueueScan(profileId, targetId);
    queue().cancel(task.id, "user");
    expect(scanRow(scanId ?? "")).toMatchObject({ finishedAt: null, error: null });
  });
});
