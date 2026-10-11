import { matches } from "@kickrocks/db";
import { API_ROUTES, type Candidate } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  jordanIdentities,
  seedProfile,
  seedRecipe,
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
  seedRecipe(ctx, targetId, { purpose: "scan" });
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

function scanWith(candidates: Candidate[]) {
  const queue = ctx.services.taskQueue;
  const { task } = ctx.services.dispatch.enqueueScan(profileId, targetId);
  const claimed = queue.claim({ workerId: "w", kinds: [task.kind], leaseMs: 60_000 });
  queue.complete(claimed?.id ?? "", {
    workerId: "w",
    actor: claimed?.kind === "agent" ? "agent" : "worker",
    result: claimed?.kind === "agent" ? { purpose: "scan", scan: { candidates } } : { candidates },
  });
}

const allMatches = () => ctx.services.db.select().from(matches).all();
const assessmentOf = (suffix: string) =>
  allMatches().find((match) => match.recordUrl.endsWith(suffix))?.assessment;

describe("match assessment", () => {
  it("scores a record against the profile when the scan is stored", () => {
    const age = ctx.clock.now().getUTCFullYear() - 1990;
    scanWith([candidate("1", { age: age - 1 }), candidate("2", { age: age + 20 })]);

    expect(assessmentOf("/1")?.band).toBe("likely");
    expect(assessmentOf("/2")?.band).toBe("unlikely");
    expect(assessmentOf("/2")?.reasons).toContainEqual(
      expect.objectContaining({ kind: "age", weight: "contradicts" }),
    );
  });

  it("scores again when the profile changes, for records still waiting", async () => {
    scanWith([candidate("1", { phones: ["555-555-0199"] })]);
    const before = assessmentOf("/1");
    expect(before?.reasons.some((reason) => reason.kind === "phone")).toBe(false);

    const identities = jordanIdentities().map((identity) =>
      identity.kind === "phone" ? { ...identity, value: { number: "+15555550199" } } : identity,
    );
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profileId },
      body: { identities },
    });
    expect(result.ok).toBe(true);
    expect(assessmentOf("/1")?.reasons).toContainEqual({ kind: "phone", weight: "strong" });
    expect(assessmentOf("/1")?.score).toBeGreaterThan(before?.score ?? 0);
  });

  it("leaves a decided record's score alone when the profile changes", async () => {
    scanWith([candidate("1")]);
    ctx.services.db
      .update(matches)
      .set({ decision: "not_mine" })
      .where(eq(matches.recordUrl, "https://records.test/p/1"))
      .run();
    const before = assessmentOf("/1");

    await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profileId },
      body: { identities: jordanIdentities().filter((identity) => identity.kind !== "address") },
    });
    expect(assessmentOf("/1")).toEqual(before);
  });

  it("puts band, score and reasons on the review queue and no profile values", async () => {
    scanWith([candidate("1", { phones: ["555-555-0123"] })]);
    const result = await ctx.call(API_ROUTES.reviewQueue, {});
    const assessment = result.ok ? result.body.matches[0]?.assessment : null;
    expect(assessment).toMatchObject({ band: "likely", score: expect.any(Number) });
    expect(JSON.stringify(assessment)).not.toContain("0123");
    expect(JSON.stringify(assessment)).not.toContain("jordan@example.com");
  });
});
