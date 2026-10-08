import { campaigns, recipes, targets } from "@kickrocks/db";
import { API_ROUTES, MAX_SELECTED_TARGETS } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";
import { createRecipeStore } from "../recipes/store.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const FORM = {
  contactMethod: "form",
  privacyEmail: null,
  optOutUrl: "https://form.test/optout",
} as const;

async function listed(query: Record<string, unknown> = {}) {
  const result = await ctx.call(API_ROUTES.targetsList, { query: query as never });
  if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id).sort();

function seedMixed() {
  seedTarget(ctx, { id: "mailer" });
  seedTarget(ctx, { id: "captcha-mailer", requirements: ["captcha"] });
  seedTarget(ctx, { id: "form-ready", ...FORM });
  seedRecipe(ctx, "form-ready", { purpose: "remove" });
  seedTarget(ctx, { id: "form-bare", ...FORM });
  seedTarget(ctx, {
    id: "finder",
    category: "people-search",
    contactMethod: "form",
    privacyEmail: null,
    optOutUrl: "https://finder.test/optout",
  });
  seedRecipe(ctx, "finder", { purpose: "scan" });
  seedRecipe(ctx, "finder", { purpose: "remove" });
  seedTarget(ctx, { kind: "company", id: "shop" });
}

describe("difficulty on targets", () => {
  it("is reported with its reasons on the list and on the detail", async () => {
    seedMixed();
    const body = await listed();
    const byId = new Map(body.items.map((item) => [item.id, item]));
    expect(byId.get("mailer")).toMatchObject({
      difficulty: "easy",
      difficultyReasons: ["email", "no_record_needed"],
    });
    expect(byId.get("captcha-mailer")).toMatchObject({
      difficulty: "hard",
      difficultyReasons: ["captcha"],
    });
    expect(byId.get("form-ready")).toMatchObject({
      difficulty: "medium",
      difficultyReasons: ["form", "recipe_ready"],
    });
    expect(byId.get("form-bare")).toMatchObject({
      difficulty: "hard",
      difficultyReasons: ["form", "no_recipe"],
    });
    expect(byId.get("finder")).toMatchObject({
      difficulty: "medium",
      difficultyReasons: ["needs_record", "recipe_ready"],
    });
    expect(byId.get("shop")).toMatchObject({ difficulty: "easy" });

    const detail = await ctx.call(API_ROUTES.targetsGet, { params: { id: "form-bare" } });
    expect(detail.ok && detail.body).toMatchObject({
      difficulty: "hard",
      difficultyReasons: ["form", "no_recipe"],
    });
  });

  it("filters the list and keeps the total and paging right", async () => {
    seedMixed();
    expect(ids(await listed({ difficulty: "easy" }))).toEqual(["mailer", "shop"]);
    expect(ids(await listed({ difficulty: "medium" }))).toEqual(["finder", "form-ready"]);
    expect(ids(await listed({ difficulty: "hard" }))).toEqual(["captcha-mailer", "form-bare"]);

    const second = await listed({ difficulty: "medium", pageSize: 1, page: 2 });
    expect(second).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(second.items).toHaveLength(1);
  });

  it("combines with the other filters", async () => {
    seedMixed();
    expect(ids(await listed({ difficulty: "easy", kind: "company" }))).toEqual(["shop"]);
    expect(ids(await listed({ difficulty: "easy", q: "mail" }))).toEqual(["mailer"]);
    expect(ids(await listed({ difficulty: "hard", requirement: "captcha" }))).toEqual([
      "captcha-mailer",
    ]);
  });

  it("leaves retired targets out of the filter and the facets", async () => {
    seedMixed();
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, "mailer")).run();
    expect(ids(await listed({ difficulty: "easy" }))).toEqual(["shop"]);
    const facets = await ctx.call(API_ROUTES.targetsFacets);
    expect(facets.ok && facets.body.difficulty).toEqual([
      { value: "easy", count: 1 },
      { value: "medium", count: 2 },
      { value: "hard", count: 2 },
    ]);
  });

  it("counts every difficulty in the facets, zero included", async () => {
    const empty = await ctx.call(API_ROUTES.targetsFacets);
    expect(empty.ok && empty.body.difficulty).toEqual([
      { value: "easy", count: 0 },
      { value: "medium", count: 0 },
      { value: "hard", count: 0 },
    ]);
    seedMixed();
    const facets = await ctx.call(API_ROUTES.targetsFacets);
    expect(facets.ok && facets.body.difficulty).toEqual([
      { value: "easy", count: 2 },
      { value: "medium", count: 2 },
      { value: "hard", count: 2 },
    ]);
  });

  it("rejects a difficulty that does not exist", async () => {
    const response = await ctx.inject({ url: "/api/targets?difficulty=trivial" });
    expect(response.statusCode).toBe(400);
  });
});

describe("difficulty follows recipe changes at once", () => {
  it("moves a form target to medium when its proposed recipe is approved", async () => {
    seedTarget(ctx, { id: "form-bare", ...FORM });
    const recipe = seedRecipe(ctx, "form-bare", { purpose: "remove", status: "pending_review" });
    expect(ids(await listed({ difficulty: "hard" }))).toEqual(["form-bare"]);

    createRecipeStore(ctx.services).approve(recipe.id);

    expect(ids(await listed({ difficulty: "medium" }))).toEqual(["form-bare"]);
    expect(ids(await listed({ difficulty: "hard" }))).toEqual([]);
  });

  it("moves it back to hard when the recipe breaks, and again when it recovers", async () => {
    seedTarget(ctx, { id: "form-ready", ...FORM });
    const recipe = seedRecipe(ctx, "form-ready", { purpose: "remove" });
    const setHealth = (health: "broken" | "healthy") =>
      ctx.services.db.update(recipes).set({ health }).where(eq(recipes.id, recipe.id)).run();

    setHealth("broken");
    const broken = await ctx.call(API_ROUTES.targetsGet, { params: { id: "form-ready" } });
    expect(broken.ok && broken.body).toMatchObject({
      difficulty: "hard",
      difficultyReasons: ["form", "recipe_broken"],
    });

    setHealth("healthy");
    const healthy = await ctx.call(API_ROUTES.targetsGet, { params: { id: "form-ready" } });
    expect(healthy.ok && healthy.body.difficulty).toBe("medium");
  });

  it("moves it to hard when the recipe is rejected or retired", async () => {
    seedTarget(ctx, { id: "form-ready", ...FORM });
    const recipe = seedRecipe(ctx, "form-ready", { purpose: "remove" });
    ctx.services.db
      .update(recipes)
      .set({ status: "retired" })
      .where(eq(recipes.id, recipe.id))
      .run();
    expect(ids(await listed({ difficulty: "hard" }))).toEqual(["form-ready"]);
  });

  it("judges a target by its newest approved recipe", async () => {
    seedTarget(ctx, { id: "form-ready", ...FORM });
    seedRecipe(ctx, "form-ready", { purpose: "remove", version: 1, health: "healthy" });
    seedRecipe(ctx, "form-ready", { purpose: "remove", version: 2, health: "broken" });
    expect(ids(await listed({ difficulty: "hard" }))).toEqual(["form-ready"]);
  });
});

describe("campaign selection by difficulty", () => {
  function setup() {
    const profile = seedProfile(ctx, { state: "TX" });
    seedMailbox(ctx, profile.id);
    seedMixed();
    return profile;
  }

  const preview = (profileId: string, selection: object) =>
    ctx.call(API_ROUTES.campaignsPreview, {
      params: { id: profileId },
      body: { selection, rights: ["opt_out", "delete"] } as never,
    });

  it("selects every easy target, companies included, with the easy preset", async () => {
    const profile = setup();
    const result = await preview(profile.id, { preset: "easy" });
    expect(result.ok && result.body.items.map((item) => item.targetId).sort()).toEqual([
      "mailer",
      "shop",
    ]);
    expect(result.ok && result.body.counts).toEqual({
      request_created: 2,
      scan_started: 0,
      skipped: 0,
    });
  });

  it("asks companies in a group campaign to opt out only, never to delete", async () => {
    setup();
    for (const selection of [{ preset: "easy" }, { filter: { difficulty: "easy" } }]) {
      const profile = seedProfile(ctx, { state: "TX" });
      seedMailbox(ctx, profile.id);
      const created = await ctx.call(API_ROUTES.campaignsCreate, {
        params: { id: profile.id },
        body: { selection, rights: ["opt_out", "delete"] } as never,
      });
      if (!created.ok) throw new Error(JSON.stringify(created.body));
      const shop = created.body.items.find((item) => item.targetId === "shop");
      const request = ctx.services.requests.getOrThrow(shop?.requestId ?? "");
      expect(request.rights).toEqual(["opt_out"]);
    }
  });

  it("follows target changes between previews", async () => {
    const profile = setup();
    seedTarget(ctx, { id: "later", ...FORM });
    const before = await preview(profile.id, { preset: "easy" });
    expect(before.ok && before.body.items.map((item) => item.targetId)).not.toContain("later");
    ctx.services.db
      .update(targets)
      .set({ privacyEmail: "privacy@later.test", contactMethod: "email" })
      .where(eq(targets.id, "later"))
      .run();
    const after = await preview(profile.id, { preset: "easy" });
    expect(after.ok && after.body.items.map((item) => item.targetId)).toContain("later");
  });

  it("selects the targets a filter matches instead of an id list", async () => {
    const profile = setup();
    const byFilter = await preview(profile.id, { filter: { difficulty: "medium" } });
    expect(byFilter.ok && byFilter.body.items.map((item) => item.targetId).sort()).toEqual([
      "finder",
      "form-ready",
    ]);

    const narrowed = await preview(profile.id, { filter: { kind: "company" } });
    expect(narrowed.ok && narrowed.body.items.map((item) => item.targetId)).toEqual(["shop"]);
  });

  it("selects exactly what GET /targets lists for the same filter", async () => {
    const profile = setup();
    const filter = { difficulty: "easy", q: "mail" } as const;
    const result = await preview(profile.id, { filter });
    expect(result.ok && result.body.items.map((item) => item.targetId)).toEqual(
      (await listed(filter)).items.map((item) => item.id),
    );
  });

  it("accepts an empty filter as everything live", async () => {
    const profile = setup();
    const result = await preview(profile.id, { filter: {} });
    expect(result.ok && result.body.items).toHaveLength(6);
  });

  it("creates the campaign from a filter and remembers the filter", async () => {
    const profile = setup();
    const created = await ctx.call(API_ROUTES.campaignsCreate, {
      params: { id: profile.id },
      body: { selection: { filter: { difficulty: "easy" } }, rights: ["opt_out"] } as never,
    });
    expect(created.ok && created.body.counts.request_created).toBe(2);
    const stored = ctx.services.db.select().from(campaigns).all();
    expect(stored[0]?.selection).toEqual({ filter: { difficulty: "easy" } });
  });

  it("rejects an unknown filter key and a filter beside an id list", async () => {
    const profile = setup();
    for (const selection of [{ filter: { color: "red" } }, { filter: {}, targetIds: ["a"] }]) {
      const response = await ctx.inject({
        method: "POST",
        url: `/api/profiles/${profile.id}/campaigns/preview`,
        payload: { selection, rights: ["opt_out"] },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("refuses a filter that matches more targets than one request may carry", async () => {
    const profile = seedProfile(ctx, { state: "TX" });
    seedMailbox(ctx, profile.id);
    ctx.services.db.transaction(() => {
      for (let i = 0; i <= MAX_SELECTED_TARGETS; i += 1) seedTarget(ctx, { id: `bulk-${i}` });
    });

    const tooMany = await preview(profile.id, { filter: {} });
    expect(tooMany).toMatchObject({
      ok: false,
      status: 422,
      body: { error: "selection_too_large" },
    });
    expect(!tooMany.ok && tooMany.body.message).toContain(String(MAX_SELECTED_TARGETS + 1));

    const created = await ctx.call(API_ROUTES.campaignsCreate, {
      params: { id: profile.id },
      body: { selection: { filter: { kind: "broker" } }, rights: ["opt_out"] } as never,
    });
    expect(created).toMatchObject({ ok: false, status: 422 });

    const narrowed = await preview(profile.id, { filter: { q: "bulk-4999" } });
    expect(narrowed.ok && narrowed.body.items).toHaveLength(1);
  });
});

describe("scan selection by filter", () => {
  it("scans the people-search targets a filter selects and skips the rest", async () => {
    const profile = seedProfile(ctx, { state: "TX" });
    seedMixed();
    const result = await ctx.call(API_ROUTES.scansStart, {
      params: { id: profile.id },
      body: { filter: { difficulty: "medium" } },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.body));
    const byTarget = new Map(result.body.items.map((item) => [item.targetId, item]));
    expect(byTarget.get("finder")?.outcome).toBe("scan_started");
    expect(byTarget.get("form-ready")).toMatchObject({
      outcome: "skipped",
      reason: "unsupported_channel",
    });
  });

  it("refuses a filter that is too broad", async () => {
    const profile = seedProfile(ctx, { state: "TX" });
    ctx.services.db.transaction(() => {
      for (let i = 0; i <= MAX_SELECTED_TARGETS; i += 1) seedTarget(ctx, { id: `bulk-${i}` });
    });
    const result = await ctx.call(API_ROUTES.scansStart, {
      params: { id: profile.id },
      body: { filter: {} },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 422,
      body: { error: "selection_too_large" },
    });
  });
});
