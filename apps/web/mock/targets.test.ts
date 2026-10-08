import { describe, expect, it } from "vitest";
import { call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

describe("target handlers", () => {
  it("page the list and report the total", async () => {
    const first = await call({ path: "/targets?pageSize=10" });
    expect(first.json.items).toHaveLength(10);
    expect(first.json.total).toBeGreaterThan(10);
    const second = await call({ path: "/targets?pageSize=10&page=2" });
    expect(second.json.items[0].id).not.toBe(first.json.items[0].id);
  });

  it("filter by kind, category, contact method, requirement, priority, and text", async () => {
    const companies = await call({ path: "/targets?kind=company&pageSize=200" });
    expect(companies.json.items.every((item: { kind: string }) => item.kind === "company")).toBe(
      true,
    );
    const captcha = await call({ path: "/targets?requirement=captcha&pageSize=200" });
    expect(captcha.json.total).toBeGreaterThan(0);
    expect(
      captcha.json.items.every((item: { requirements: string[] }) =>
        item.requirements.includes("captcha"),
      ),
    ).toBe(true);
    const crucial = await call({ path: "/targets?priority=crucial&pageSize=200" });
    expect(crucial.json.items[0].priority).toBe("crucial");
    const search = await call({ path: "/targets?q=peopletrace" });
    expect(search.json.items.map((item: { id: string }) => item.id)).toEqual(["peopletrace"]);
  });

  it("sort the most important targets first", async () => {
    const list = await call({ path: "/targets?pageSize=200" });
    const order = { crucial: 0, high: 1, normal: 2 } as const;
    const ranks = list.json.items.map(
      (item: { priority: keyof typeof order }) => order[item.priority],
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("count each facet", async () => {
    const facets = await call({ path: "/targets/facets" });
    const kinds = Object.fromEntries(
      facets.json.kind.map((entry: { value: string; count: number }) => [entry.value, entry.count]),
    );
    const all = await call({ path: "/targets?pageSize=1" });
    expect(kinds.broker + kinds.company).toBe(all.json.total);
  });

  it("show which recipes a target has and how healthy they are", async () => {
    const detail = await call({ path: "/targets/findrecord" });
    expect(detail.json.recipes.map((recipe: { health: string }) => recipe.health).sort()).toEqual([
      "broken",
      "healthy",
    ]);
    const row = (await call({ path: "/targets?q=findrecord" })).json.items[0];
    expect(row.automation).toEqual({ scan: "healthy", remove: "broken" });
  });

  it("filter by difficulty and count each difficulty in the facets", async () => {
    const facets = (await call({ path: "/targets/facets" })).json.difficulty as {
      value: string;
      count: number;
    }[];
    expect(facets.map((facet) => facet.value)).toEqual(["easy", "medium", "hard"]);
    const all = await call({ path: "/targets?pageSize=1" });
    expect(facets.reduce((sum, facet) => sum + facet.count, 0)).toBe(all.json.total);
    for (const { value, count } of facets) {
      const listed = await call({ path: `/targets?difficulty=${value}&pageSize=200` });
      expect(listed.json.total).toBe(count);
      expect(
        listed.json.items.every((item: { difficulty: string }) => item.difficulty === value),
      ).toBe(true);
    }
  });

  it("report why a target has its difficulty", async () => {
    const detail = await call({ path: "/targets/peopletrace" });
    expect(detail.json.difficulty).toBe("medium");
    expect(detail.json.difficultyReasons).toEqual(["needs_record", "recipe_ready"]);
    const captcha = await call({ path: "/targets/findrecord" });
    expect(captcha.json).toMatchObject({ difficulty: "hard" });
    expect(captcha.json.difficultyReasons).toContain("captcha");
  });

  it("answer 404 for a target that does not exist and 400 for a bad filter", async () => {
    expect((await call({ path: "/targets/not-a-target" })).status).toBe(404);
    expect((await call({ path: "/targets?kind=bogus" })).status).toBe(400);
  });
});
