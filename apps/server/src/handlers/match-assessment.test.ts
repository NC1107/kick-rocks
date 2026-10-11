import { matches } from "@kickrocks/db";
import { API_ROUTES, type Candidate, parseAgeText } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scoreUnscoredMatches } from "../core/match-assessment.js";
import {
  createTestContext,
  DAY,
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

  it("scores a card that states an age range from the scan to the stored assessment", async () => {
    const dob = { date: "1979-01-01" };
    const identities = jordanIdentities().map((identity) =>
      identity.kind === "dob" ? { ...identity, value: dob } : identity,
    );
    await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profileId },
      body: { identities },
    });
    const range = parseAgeText("Ages 42-47") ?? undefined;
    const decade = parseAgeText("In their 40s") ?? undefined;
    scanWith([candidate("1", { ageRange: range }), candidate("2", { ageRange: decade })]);

    expect(assessmentOf("/1")?.reasons).toContainEqual(
      expect.objectContaining({ kind: "age", weight: "strong" }),
    );
    expect(assessmentOf("/1")?.band).toBe("likely");
    const loose = assessmentOf("/2");
    expect(loose?.reasons).toContainEqual(
      expect.objectContaining({ kind: "age", weight: "weak", candidate: { low: 40, high: 49 } }),
    );
    expect(loose?.reasons.some((reason) => reason.weight === "contradicts")).toBe(false);
    expect(loose?.band).toBe("maybe");
  });

  it("scores again when only the profile state changes", async () => {
    await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profileId },
      body: { identities: jordanIdentities().filter((identity) => identity.kind !== "address") },
    });
    scanWith([candidate("1", { locations: ["Dallas, TX"] })]);
    expect(assessmentOf("/1")?.reasons).toContainEqual(
      expect.objectContaining({ kind: "place", weight: "weak", state: "TX" }),
    );

    const result = await ctx.call(API_ROUTES.profilesUpdate, {
      params: { id: profileId },
      body: { state: "CA" },
    });
    expect(result.ok).toBe(true);
    expect(assessmentOf("/1")?.reasons).toContainEqual({ kind: "place", weight: "neutral" });
  });

  it("judges a record on the day of its scan when it is scored again a year later", async () => {
    const age = ctx.clock.now().getUTCFullYear() - 1990 - 1;
    scanWith([candidate("1", { age })]);
    const before = assessmentOf("/1");
    expect(before?.reasons).toContainEqual(
      expect.objectContaining({ kind: "age", weight: "strong" }),
    );

    ctx.clock.advance(366 * DAY);
    await ctx.call(API_ROUTES.profilesUpdate, { params: { id: profileId }, body: { state: "CA" } });
    const after = assessmentOf("/1");
    expect(after?.reasons.find((reason) => reason.kind === "age")).toEqual(
      before?.reasons.find((reason) => reason.kind === "age"),
    );
  });

  it("scores the waiting records that have no assessment yet", () => {
    scanWith([candidate("1", { phones: ["555-555-0123"] })]);
    const stored = assessmentOf("/1");
    ctx.services.db.update(matches).set({ assessment: null }).run();
    expect(assessmentOf("/1")).toBeNull();

    scoreUnscoredMatches(ctx.services.db);
    expect(assessmentOf("/1")).toEqual(stored);
  });
});
