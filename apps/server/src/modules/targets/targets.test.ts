import { targets } from "@kickrocks/db";
import { API_ROUTES } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  seedRecipe,
  seedTarget,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const list = (query: Record<string, unknown> = {}) =>
  ctx.call(API_ROUTES.targetsList, { query: query as never });

async function listed(query: Record<string, unknown> = {}) {
  const result = await list(query);
  if (!result.ok) throw new Error(`list failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

describe("GET /targets", () => {
  it("lists targets with crucial first, then by name", async () => {
    seedTarget(ctx, { id: "zeta", name: "Zeta Data", priority: "crucial" });
    seedTarget(ctx, { id: "alpha", name: "alpha lists", priority: "normal" });
    seedTarget(ctx, { id: "beta", name: "Beta Lists", priority: "high" });
    seedTarget(ctx, { id: "acme", name: "Acme Lists", priority: "normal" });

    const body = await listed();
    expect(body.items.map((item) => item.id)).toEqual(["zeta", "beta", "acme", "alpha"]);
    expect(body.total).toBe(4);
    expect(body.page).toBe(1);
  });

  it("filters by kind, category, contact method, priority, and requirement", async () => {
    seedTarget(ctx, {
      id: "people",
      category: "people-search",
      contactMethod: "form",
      priority: "high",
      requirements: ["captcha", "record_url"],
    });
    seedTarget(ctx, { id: "market", category: "marketing", contactMethod: "email" });
    seedTarget(ctx, { id: "shop", kind: "company", category: "retail", contactMethod: "form" });

    expect((await listed({ kind: "company" })).items.map((i) => i.id)).toEqual(["shop"]);
    expect((await listed({ category: "people-search" })).items.map((i) => i.id)).toEqual([
      "people",
    ]);
    expect((await listed({ contactMethod: "email" })).items.map((i) => i.id)).toEqual(["market"]);
    expect((await listed({ priority: "high" })).items.map((i) => i.id)).toEqual(["people"]);
    expect((await listed({ requirement: "captcha" })).items.map((i) => i.id)).toEqual(["people"]);
    expect((await listed({ requirement: "paid" })).items).toEqual([]);
    expect(
      (await listed({ kind: "broker", category: "people-search", requirement: "record_url" }))
        .total,
    ).toBe(1);
  });

  it("searches name and domain, treating wildcards as plain text", async () => {
    seedTarget(ctx, { id: "spokeo-like", name: "Spoke Search", domain: "spoke.test" });
    seedTarget(ctx, { id: "percent", name: "100% Data", domain: "pct.test" });
    seedTarget(ctx, { id: "under", name: "Under_Score", domain: "under.test" });
    seedTarget(ctx, { id: "other", name: "Other", domain: "other.test" });

    expect((await listed({ q: "SPOKE" })).items.map((i) => i.id)).toEqual(["spokeo-like"]);
    expect((await listed({ q: "pct.test" })).items.map((i) => i.id)).toEqual(["percent"]);
    expect((await listed({ q: "100%" })).items.map((i) => i.id)).toEqual(["percent"]);
    expect((await listed({ q: "%" })).items.map((i) => i.id)).toEqual(["percent"]);
    expect((await listed({ q: "r_s" })).items.map((i) => i.id)).toEqual(["under"]);
    expect((await listed({ q: "nothing-like-this" })).items).toEqual([]);
  });

  it("paginates and reports the total", async () => {
    for (const name of ["A", "B", "C", "D", "E"]) seedTarget(ctx, { id: name.toLowerCase(), name });

    const second = await listed({ pageSize: 2, page: 2 });
    expect(second.items.map((i) => i.id)).toEqual(["c", "d"]);
    expect(second).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect((await listed({ pageSize: 2, page: 9 })).items).toEqual([]);
  });

  it("rejects an unknown filter value with a query issue", async () => {
    const result = await list({ category: "nonsense", pageSize: 5000 });
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (result.ok) return;
    const paths = (result.body.issues ?? []).map((issue) => issue.path.join("."));
    expect(paths).toContain("query.category");
    expect(paths).toContain("query.pageSize");
  });

  it("leaves retired targets out of the list and the facets but keeps their detail", async () => {
    seedTarget(ctx, { id: "live" });
    const gone = seedTarget(ctx, { id: "gone" });
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, gone.id)).run();

    expect((await listed()).items.map((i) => i.id)).toEqual(["live"]);
    const facets = await ctx.call(API_ROUTES.targetsFacets);
    expect(facets.ok && facets.body.kind).toEqual([{ value: "broker", count: 1 }]);
    const detail = await ctx.call(API_ROUTES.targetsGet, { params: { id: "gone" } });
    expect(detail).toMatchObject({ ok: true, body: { id: "gone", retired: true } });
  });

  it("shows the health of the newest active recipe per purpose, and ignores proposals", async () => {
    seedTarget(ctx, { id: "auto" });
    seedTarget(ctx, { id: "plain" });
    seedRecipe(ctx, "auto", { purpose: "remove", version: 1, health: "broken" });
    seedRecipe(ctx, "auto", { purpose: "remove", version: 2, health: "healthy" });
    seedRecipe(ctx, "auto", { purpose: "scan", version: 1, health: "unknown" });
    seedRecipe(ctx, "plain", { purpose: "remove", status: "pending_review", health: "healthy" });
    seedRecipe(ctx, "plain", { purpose: "scan", status: "retired", health: "healthy" });

    const items = new Map((await listed()).items.map((i) => [i.id, i.automation]));
    expect(items.get("auto")).toEqual({ scan: "unknown", remove: "healthy" });
    expect(items.get("plain")).toEqual({ scan: null, remove: null });
  });

  it("marks the targets that remove a specific record", async () => {
    seedTarget(ctx, { id: "people", category: "people-search" });
    seedTarget(ctx, { id: "market", category: "marketing" });
    const items = new Map((await listed()).items.map((i) => [i.id, i.needsRecord]));
    expect(items.get("people")).toBe(true);
    expect(items.get("market")).toBe(false);
  });
});

describe("GET /targets/facets", () => {
  it("keeps what a site demands out of the categories and in the requirements", async () => {
    seedTarget(ctx, { id: "a", category: "marketing" });
    seedTarget(ctx, { id: "b", category: "requires-id", requiresId: true });
    seedTarget(ctx, { id: "c", category: "people-search", requirements: ["id_upload"] });

    const facets = await ctx.call(API_ROUTES.targetsFacets);
    expect(facets.ok && facets.body.category.map((entry) => entry.value).sort()).toEqual([
      "marketing",
      "people-search",
    ]);
    expect(facets.ok && facets.body.requirement).toEqual([{ value: "id_upload", count: 2 }]);

    const list = await ctx.call(API_ROUTES.targetsList, {
      query: { requirement: "id_upload", page: 1, pageSize: 25 },
    });
    expect(list.ok && list.body.items.map((item) => item.id).sort()).toEqual(["b", "c"]);
  });

  it("counts every facet, most common first, with requirements counted once per target", async () => {
    seedTarget(ctx, { id: "a", category: "marketing", contactMethod: "email" });
    seedTarget(ctx, { id: "b", category: "marketing", contactMethod: "both", priority: "high" });
    seedTarget(ctx, {
      id: "c",
      category: "people-search",
      contactMethod: "form",
      priority: "crucial",
      requirements: ["captcha", "email_confirmation"],
    });
    seedTarget(ctx, { id: "d", kind: "company", category: "retail", contactMethod: "email" });
    seedTarget(ctx, { id: "e", category: "marketing", requirements: ["captcha"] });

    const result = await ctx.call(API_ROUTES.targetsFacets);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.kind).toEqual([
      { value: "broker", count: 4 },
      { value: "company", count: 1 },
    ]);
    expect(result.body.category).toEqual([
      { value: "marketing", count: 3 },
      { value: "people-search", count: 1 },
      { value: "retail", count: 1 },
    ]);
    expect(result.body.contactMethod).toEqual([
      { value: "both", count: 2 },
      { value: "email", count: 2 },
      { value: "form", count: 1 },
    ]);
    expect(result.body.priority).toEqual([
      { value: "normal", count: 3 },
      { value: "crucial", count: 1 },
      { value: "high", count: 1 },
    ]);
    expect(result.body.requirement).toEqual([
      { value: "captcha", count: 2 },
      { value: "email_confirmation", count: 1 },
    ]);
  });

  it("answers empty lists when there are no targets", async () => {
    const result = await ctx.call(API_ROUTES.targetsFacets);
    expect(result).toMatchObject({
      ok: true,
      body: { kind: [], category: [], contactMethod: [], requirement: [], priority: [] },
    });
  });
});

describe("GET /targets/:id", () => {
  it("returns a broker with its sources, licenses, and every recipe", async () => {
    seedTarget(ctx, {
      id: "spokey",
      name: "Spokey",
      category: "people-search",
      notes: "Needs the listing URL.",
      searchUrl: "https://spokey.test/search",
      sources: [
        { source: "badbool", license: "CC-BY-NC-SA-4.0" },
        { source: "eraser", license: "MIT", upstreamId: "spokey" },
      ],
    });
    seedRecipe(ctx, "spokey", { purpose: "remove", version: 1, health: "healthy" });
    seedRecipe(ctx, "spokey", { purpose: "remove", version: 2, status: "pending_review" });
    seedRecipe(ctx, "spokey", { purpose: "scan", version: 1, source: "user" });

    const result = await ctx.call(API_ROUTES.targetsGet, { params: { id: "spokey" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      id: "spokey",
      kind: "broker",
      needsRecord: true,
      searchUrl: "https://spokey.test/search",
      privacyEmail: "privacy@spokey.test",
      region: "us",
      notes: "Needs the listing URL.",
      verifiedAt: null,
      sources: [
        { source: "badbool", license: "CC-BY-NC-SA-4.0" },
        { source: "eraser", license: "MIT", upstreamId: "spokey" },
      ],
    });
    expect(result.body.recipes).toEqual([
      {
        id: "spokey.remove.v2",
        purpose: "remove",
        version: 2,
        source: "bundled",
        status: "pending_review",
        health: "unknown",
      },
      {
        id: "spokey.remove.v1",
        purpose: "remove",
        version: 1,
        source: "bundled",
        status: "active",
        health: "healthy",
      },
      {
        id: "spokey.scan.v1",
        purpose: "scan",
        version: 1,
        source: "user",
        status: "active",
        health: "unknown",
      },
    ]);
  });

  it("returns a company with the day its contacts were verified", async () => {
    seedTarget(ctx, { kind: "company", id: "shopco", verifiedAt: "2026-09-30" });
    const result = await ctx.call(API_ROUTES.targetsGet, { params: { id: "shopco" } });
    expect(result).toMatchObject({
      ok: true,
      body: {
        kind: "company",
        verifiedAt: "2026-09-30",
        website: "https://shopco.test",
        recipes: [],
        sources: [{ source: "kickrocks-companies", license: "PolyForm-Noncommercial-1.0.0" }],
      },
    });
  });

  it("answers 404 for a target that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.targetsGet, { params: { id: "nope" } });
    expect(result).toMatchObject({ ok: false, status: 404, body: { error: "target_not_found" } });
  });
});
